import random
import string
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import get_current_user, require_roles

router = APIRouter(prefix="/api", tags=["billing"])


def _next_bill_number() -> str:
    stamp = datetime.utcnow().strftime("%y%m%d")
    suffix = "".join(random.choices(string.digits, k=4))
    return f"BILL-{stamp}-{suffix}"


@router.post("/bills")
def create_bill(payload: schemas.BillCreate, db: Session = Depends(get_db),
                user=Depends(require_roles(models.RoleName.admin, models.RoleName.manager,
                                            models.RoleName.cashier))):
    order = db.query(models.Order).filter(models.Order.id == payload.order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    subtotal = sum(
        (Decimal(i.unit_price) * i.quantity for i in order.items if not i.is_cancelled),
        Decimal("0"),
    )
    cabin_fee = Decimal("0")
    if order.table and "cabin" in order.table.name.lower():
        cabin_fee = Decimal("500.00")
        subtotal += cabin_fee

    tax_setting = db.query(models.TaxSetting).first()
    tax_amount = Decimal("0")
    service_amount = Decimal("0")
    if tax_setting:
        if tax_setting.tax_enabled:
            tax_amount = (subtotal * Decimal(tax_setting.tax_percent) / Decimal("100")).quantize(Decimal("0.01"))
        if tax_setting.service_charge_enabled:
            service_amount = (subtotal * Decimal(tax_setting.service_charge_percent) / Decimal("100")).quantize(Decimal("0.01"))

    if payload.discount_percent < 0 or payload.discount_percent > 100:
        raise HTTPException(status_code=400, detail="Discount percentage must be between 0 and 100")
    discount_amount = (subtotal * payload.discount_percent / Decimal("100")).quantize(Decimal("0.01"))
    grand_total = subtotal + tax_amount + service_amount - discount_amount

    total_paid = sum((p.amount for p in payload.payments), Decimal("0"))
    if total_paid > grand_total:
        raise HTTPException(status_code=400, detail="Paid amount cannot exceed grand total")
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

    for p in payload.payments:
        db.add(models.Payment(bill_id=bill.id, method=p.method, amount=p.amount, received_by=user.id))

    if grand_total - total_paid > 0:
        db.add(models.CustomerBalance(
            customer_id=payload.customer_id, bill_id=bill.id,
            original_amount=grand_total - total_paid, remaining_amount=grand_total - total_paid,
        ))

    order.status = models.OrderStatus.completed
    if order.table:
        order.table.status = models.TableStatus.available

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
        "payments": [{"method": p.method.value, "amount": str(p.amount)} for p in payload.payments],
    }


@router.post("/outstanding/repay")
def repay_balance(payload: schemas.RepaymentCreate, db: Session = Depends(get_db),
                   user=Depends(require_roles(models.RoleName.admin, models.RoleName.manager,
                                               models.RoleName.cashier))):
    balance = db.query(models.CustomerBalance).filter(
        models.CustomerBalance.id == payload.customer_balance_id).first()
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
