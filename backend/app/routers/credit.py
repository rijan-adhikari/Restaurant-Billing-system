from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import require_roles

router = APIRouter(prefix="/api/credit", tags=["credit"])


@router.get("")
def list_credit(search: str = "", db: Session = Depends(get_db),
                user=Depends(require_roles(models.RoleName.admin, models.RoleName.manager, models.RoleName.cashier))):
    customers = db.query(models.Customer).order_by(models.Customer.name).all()
    normalized = search.strip().lower()
    result = []
    for customer in customers:
        if normalized and normalized not in customer.name.lower() and normalized not in (customer.phone or "").lower():
            continue
        balances = db.query(models.CustomerBalance).filter(
            models.CustomerBalance.customer_id == customer.id,
            models.CustomerBalance.remaining_amount > 0,
        ).all()
        result.append({
            "customer_id": customer.id,
            "name": customer.name,
            "phone": customer.phone,
            "total_due": str(sum((balance.remaining_amount for balance in balances), Decimal("0"))),
            "balances": [{
                "id": balance.id,
                "bill_id": balance.bill_id,
                "original_amount": str(balance.original_amount),
                "remaining_amount": str(balance.remaining_amount),
                "created_at": balance.created_at,
            } for balance in balances],
        })
    return result


@router.get("/{customer_id}")
def credit_details(customer_id: str, db: Session = Depends(get_db),
                   user=Depends(require_roles(models.RoleName.admin, models.RoleName.manager, models.RoleName.cashier))):
    customer = db.query(models.Customer).filter(models.Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    balances = db.query(models.CustomerBalance).filter(
        models.CustomerBalance.customer_id == customer_id,
        models.CustomerBalance.remaining_amount > 0,
    ).all()
    return {
        "customer_id": customer.id,
        "name": customer.name,
        "phone": customer.phone,
        "total_due": str(sum((balance.remaining_amount for balance in balances), Decimal("0"))),
        "balances": [{
            "id": balance.id,
            "bill_id": balance.bill_id,
            "original_amount": str(balance.original_amount),
            "remaining_amount": str(balance.remaining_amount),
            "created_at": balance.created_at,
        } for balance in balances],
    }
