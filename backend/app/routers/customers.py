from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.database import get_db
from app import models, schemas
from app.deps import get_current_user, require_roles

router = APIRouter(prefix="/api/customers", tags=["customers"])


@router.get("", response_model=list[schemas.CustomerOut])
def list_customers(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return db.query(models.Customer).all()


@router.post("")
def create_customer(payload: schemas.CustomerCreate, db: Session = Depends(get_db),
                     user=Depends(require_roles(models.RoleName.admin, models.RoleName.manager,
                                                 models.RoleName.cashier, models.RoleName.waiter))):
    customer = models.Customer(**payload.model_dump())
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return {"id": customer.id, "name": customer.name, "phone": customer.phone}


@router.get("/history")
def customer_history(customer_id: str | None = None, date_from: date | None = None,
                     date_to: date | None = None, db: Session = Depends(get_db),
                     user=Depends(require_roles(models.RoleName.admin))):
    query = db.query(models.Bill).filter(models.Bill.customer_id.isnot(None))
    if customer_id:
        query = query.filter(models.Bill.customer_id == customer_id)
    if date_from:
        query = query.filter(models.Bill.created_at >= datetime.combine(date_from, time.min))
    if date_to:
        query = query.filter(models.Bill.created_at < datetime.combine(date_to + timedelta(days=1), time.min))

    bills = query.order_by(models.Bill.created_at.desc()).all()
    grouped = {}
    for bill in bills:
        customer = db.query(models.Customer).filter(models.Customer.id == bill.customer_id).first()
        if not customer:
            continue
        record = grouped.setdefault(customer.id, {
            "customer_id": customer.id, "name": customer.name, "phone": customer.phone,
            "total_spent": 0, "visit_count": 0, "bills": [],
        })
        record["total_spent"] += bill.grand_total
        record["visit_count"] += 1
        order = db.query(models.Order).filter(models.Order.id == bill.order_id).first()
        record["bills"].append({
            "id": bill.id,
            "bill_number": bill.bill_number,
            "created_at": bill.created_at,
            "table_name": order.table.name if order and order.table else "",
            "items": [{
                "name": item.menu_item.name,
                "quantity": item.quantity,
                "unit_price": str(item.unit_price),
                "total": str(item.unit_price * item.quantity),
            } for item in order.items if not item.is_cancelled] if order else [],
            "grand_total": str(bill.grand_total),
            "amount_paid": str(bill.amount_paid),
            "outstanding_amount": str(bill.outstanding_amount),
        })

    for record in grouped.values():
        record["total_spent"] = str(record["total_spent"])
    return list(grouped.values())


@router.delete("/{customer_id}")
def delete_customer(customer_id: str, db: Session = Depends(get_db),
                    user=Depends(require_roles(models.RoleName.admin))):
    customer = db.query(models.Customer).filter(models.Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(404, "Customer not found")
    if db.query(models.Bill).filter(models.Bill.customer_id == customer_id).first():
        raise HTTPException(409, "This customer has bill history. The record is protected to preserve financial history.")
    if db.query(models.CustomerBalance).filter(models.CustomerBalance.customer_id == customer_id).first():
        raise HTTPException(409, "This customer has a credit balance history and cannot be deleted.")
    loyalty_table = db.execute(text("SELECT to_regclass('public.loyalty_accounts')")).scalar()
    if loyalty_table and db.execute(text("SELECT 1 FROM loyalty_accounts WHERE customer_id=:id LIMIT 1"),
                                   {"id": customer_id}).first():
        raise HTTPException(409, "This customer has loyalty points history and cannot be deleted.")
    db.add(models.AuditLog(user_id=user.id, action="customer.deleted", details=f"Deleted customer {customer.name}"))
    db.delete(customer)
    db.commit()
    return {"ok": True}
