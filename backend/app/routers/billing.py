import random
import string
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.database import get_db
from app import models, schemas
from app.deps import get_current_user, require_roles
from app.billing_math import calculate_bill

router = APIRouter(prefix="/api", tags=["billing"])


def _next_bill_number() -> str:
    stamp = datetime.utcnow().strftime("%y%m%d")
    suffix = "".join(random.choices(string.digits, k=4))
    return f"BILL-{stamp}-{suffix}"


@router.post("/bills")
def create_bill(payload: schemas.BillCreate, db: Session = Depends(get_db),
                user=Depends(require_roles(models.RoleName.admin, models.RoleName.manager,
                                            models.RoleName.cashier))):
    order = db.query(models.Order).filter(models.Order.id == payload.order_id).with_for_update().first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != models.OrderStatus.open:
        raise HTTPException(status_code=409, detail="Only open orders can be billed")

    if any(not p.amount.is_finite() or p.amount < 0 for p in payload.payments):
        raise HTTPException(status_code=400, detail="Payment amounts must be non-negative finite values")

    if db.query(models.Bill).filter(models.Bill.order_id == order.id).first():
        raise HTTPException(status_code=409, detail="This order has already been billed")

    subtotal = sum(
        (Decimal(i.unit_price) * i.quantity for i in order.items if not i.is_cancelled),
        Decimal("0"),
    )
    cabin_fee = Decimal("0")
    if order.table and "cabin" in order.table.name.lower():
        cabin_fee = Decimal("500.00")
        subtotal += cabin_fee

    tax_setting = db.query(models.TaxSetting).first()
    tax_enabled = bool(tax_setting and tax_setting.tax_enabled)
    tax_percent = Decimal(tax_setting.tax_percent) if tax_setting else Decimal("0")
    service_enabled = bool(tax_setting and tax_setting.service_charge_enabled)
    service_percent = Decimal(tax_setting.service_charge_percent) if tax_setting else Decimal("0")
    totals = calculate_bill(subtotal, payload.discount_percent, tax_enabled, tax_percent,
                            service_enabled, service_percent)
    subtotal = totals["subtotal"]
    tax_amount = totals["tax_amount"]
    service_amount = totals["service_charge_amount"]
    discount_amount = totals["discount_amount"]
    grand_total = totals["grand_total"]

    tendered_total = sum((p.amount for p in payload.payments), Decimal("0"))
    change_due = Decimal("0.00")
    if tendered_total > grand_total:
        if len(payload.payments) != 1 or payload.payments[0].method != models.PaymentMethod.cash:
            raise HTTPException(status_code=400, detail="Overpayment is allowed only for a single cash payment")
        change_due = tendered_total - grand_total
        total_paid = grand_total
        payment_rows = [(payload.payments[0].method, grand_total)]
    else:
        total_paid = tendered_total
        payment_rows = [(p.method, p.amount) for p in payload.payments]
    if total_paid < grand_total and not payload.customer_id:
        raise HTTPException(status_code=400, detail="Customer required to record an outstanding balance")

    bill = models.Bill(
        bill_number=_next_bill_number(), order_id=order.id, customer_id=payload.customer_id,
        subtotal=subtotal, tax_amount=tax_amount, service_charge_amount=service_amount,
        discount_amount=discount_amount, grand_total=grand_total,
        amount_paid=total_paid, outstanding_amount=grand_total - total_paid,
    )
    db.add(bill)
    db.flush()

    for method, amount in payment_rows:
        if amount > 0:
            db.add(models.Payment(bill_id=bill.id, method=method, amount=amount, received_by=user.id))
            if method == models.PaymentMethod.cash:
                open_shift = db.execute(text("SELECT id FROM cash_drawer_shifts WHERE status='open' ORDER BY opened_at DESC LIMIT 1 FOR UPDATE")).first()
                if open_shift:
                    db.execute(text("""INSERT INTO cash_drawer_entries(shift_id,entry_type,amount,reference,notes,created_by)
                        VALUES(:shift,'sale',:amount,:reference,'Cash received for POS bill',:user)"""),
                        {"shift": open_shift.id, "amount": amount, "reference": bill.bill_number, "user": user.id})

    if grand_total - total_paid > 0:
        db.add(models.CustomerBalance(
            customer_id=payload.customer_id, bill_id=bill.id,
            original_amount=grand_total - total_paid, remaining_amount=grand_total - total_paid,
        ))

    order.status = models.OrderStatus.completed
    if order.table:
        order.table.status = models.TableStatus.available

    # Deduct recipe ingredients atomically with bill creation. Orders without recipes remain billable.
    for order_item in order.items:
        if order_item.is_cancelled:
            continue
        recipe = db.execute(text("SELECT id,yield_quantity FROM recipes WHERE menu_item_id=:menu_id"),
                            {"menu_id": order_item.menu_item_id}).mappings().first()
        if not recipe:
            continue
        ingredients = db.execute(text("""SELECT ri.item_id,ri.quantity,i.name,i.unit,i.quantity stock_quantity,
            i.average_cost FROM recipe_items ri JOIN inventory_items i ON i.id=ri.item_id
            WHERE ri.recipe_id=:recipe_id FOR UPDATE OF i"""), {"recipe_id": recipe["id"]}).mappings().all()
        for ingredient in ingredients:
            used = Decimal(str(ingredient["quantity"])) * order_item.quantity / Decimal(str(recipe["yield_quantity"]))
            available = Decimal(str(ingredient["stock_quantity"]))
            if available < used:
                raise HTTPException(status_code=409, detail="Insufficient stock for " + ingredient["name"] + ": need " + str(used) + " " + ingredient["unit"] + ", have " + str(available))
            db.execute(text("UPDATE inventory_items SET quantity=quantity-:used,updated_at=NOW() WHERE id=:id"),
                       {"used": used, "id": ingredient["item_id"]})
            db.execute(text("""INSERT INTO stock_movements(item_id,movement_type,quantity,unit_cost,reference,notes,created_by)
                VALUES(:item,'consumption',:qty,:cost,:reference,:notes,:user)"""),
                {"item": ingredient["item_id"], "qty": used, "cost": ingredient["average_cost"],
                 "reference": bill.bill_number, "notes": "Recipe consumption on bill " + bill.bill_number, "user": user.id})

    db.commit()
    db.refresh(bill)
    restaurant = db.query(models.RestaurantSetting).first()
    bill_items = [{
        "name": item.menu_item.name,
        "quantity": item.quantity,
        "unit_price": str(item.unit_price),
        "total": str(Decimal(item.unit_price) * item.quantity),
    } for item in order.items if not item.is_cancelled]
    if cabin_fee > 0:
        bill_items.append({
            "name": "Cabin fee",
            "quantity": 1,
            "unit_price": "500.00",
            "total": "500.00",
        })

    return {
        "id": bill.id, "bill_number": bill.bill_number, "subtotal": str(subtotal),
        "tax_amount": str(tax_amount), "service_charge_amount": str(service_amount),
        "discount_percent": str(payload.discount_percent), "discount_amount": str(discount_amount),
        "grand_total": str(grand_total), "amount_paid": str(total_paid),
        "tendered_amount": str(tendered_total), "change_due": str(change_due),
        "tax_percent": str(tax_percent), "service_charge_percent": str(service_percent),
        "outstanding_amount": str(grand_total - total_paid),
        "cabin_fee": str(cabin_fee),
        "created_at": bill.created_at,
        "restaurant": {
            "name": restaurant.name if restaurant else "",
            "address": restaurant.address if restaurant else "",
            "phone": restaurant.phone if restaurant else "",
            "currency": restaurant.currency if restaurant else "NPR",
            "receipt_footer": restaurant.receipt_footer if restaurant else "Thankyou For Visiting Us.",
        },
        "table_name": order.table.name if order.table else "",
        "order_number": order.order_number,
        "items": bill_items,
        "payments": [{"method": method.value, "amount": str(amount)} for method, amount in payment_rows if amount > 0],
    }


@router.post("/outstanding/repay")
def repay_balance(payload: schemas.RepaymentCreate, db: Session = Depends(get_db),
                   user=Depends(require_roles(models.RoleName.admin, models.RoleName.manager,
                                               models.RoleName.cashier))):
    if not payload.amount.is_finite() or payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Repayment amount must be a positive finite value")
    balance = db.query(models.CustomerBalance).filter(
        models.CustomerBalance.id == payload.customer_balance_id).with_for_update().first()
    if not balance:
        raise HTTPException(status_code=404, detail="Outstanding balance not found")
    if payload.amount > balance.remaining_amount:
        raise HTTPException(status_code=400, detail="Repayment exceeds remaining balance")

    balance.remaining_amount -= payload.amount
    bill = db.query(models.Bill).filter(models.Bill.id == balance.bill_id).first()
    if bill:
        bill.amount_paid += payload.amount
        bill.outstanding_amount = balance.remaining_amount
    db.add(models.BalanceTransaction(
        customer_balance_id=balance.id, amount=payload.amount, received_by=user.id,
    ))
    db.commit()
    return {"remaining_amount": str(balance.remaining_amount)}


@router.get("/outstanding")
def list_outstanding(db: Session = Depends(get_db),
                      user=Depends(require_roles(models.RoleName.admin, models.RoleName.manager))):
    balances = db.query(models.CustomerBalance).filter(models.CustomerBalance.remaining_amount > 0).all()
    return [{
        "id": b.id, "customer_id": b.customer_id, "bill_id": b.bill_id,
        "original_amount": str(b.original_amount), "remaining_amount": str(b.remaining_amount),
        "created_at": b.created_at,
    } for b in balances]
