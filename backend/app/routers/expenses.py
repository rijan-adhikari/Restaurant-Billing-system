from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import require_roles

router = APIRouter(prefix="/api/expenses", tags=["expenses"])


@router.get("")
def list_expenses(db: Session = Depends(get_db), user=Depends(require_roles(models.RoleName.admin, models.RoleName.manager))):
    expenses = db.query(models.Expense).order_by(models.Expense.expense_date.desc()).all()
    return [{
        "id": expense.id,
        "category": expense.category,
        "description": expense.description,
        "amount": str(expense.amount),
        "expense_date": expense.expense_date,
    } for expense in expenses]


@router.post("")
def create_expense(payload: schemas.ExpenseCreate, db: Session = Depends(get_db),
                   user=Depends(require_roles(models.RoleName.admin, models.RoleName.manager))):
    expense = models.Expense(
        category=payload.category.strip(),
        description=payload.description.strip(),
        amount=Decimal(payload.amount),
        expense_date=payload.expense_date or datetime.utcnow(),
        created_by=user.id,
    )
    db.add(expense)
    db.commit()
    db.refresh(expense)
    return {"id": expense.id, "category": expense.category, "description": expense.description,
            "amount": str(expense.amount), "expense_date": expense.expense_date}


@router.delete("/{expense_id}")
def delete_expense(expense_id: str, db: Session = Depends(get_db),
                   user=Depends(require_roles(models.RoleName.admin))):
    expense = db.query(models.Expense).filter(models.Expense.id == expense_id).first()
    if not expense:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Expense not found")
    db.delete(expense)
    db.commit()
    return {"ok": True}
