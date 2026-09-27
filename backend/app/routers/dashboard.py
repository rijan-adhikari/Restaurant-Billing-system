from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app import models
from app.deps import require_roles

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _sum_amount(db: Session, model, column, start: datetime, end: datetime, date_column=None):
    date_column = date_column or model.created_at
    return db.query(func.coalesce(func.sum(column), 0)).filter(
        date_column >= start, date_column < end
    ).scalar()


@router.get("/summary")
def dashboard_summary(report_date: date | None = None, db: Session = Depends(get_db), user=Depends(require_roles(
    models.RoleName.admin, models.RoleName.manager, models.RoleName.cashier,
))):
    target = report_date or datetime.utcnow().date()
    daily_start = datetime.combine(target, time.min)
    daily_end = daily_start + timedelta(days=1)
    month_start = daily_start.replace(day=1)
    month_end = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
    year_start = daily_start.replace(month=1, day=1)
    year_end = year_start.replace(year=year_start.year + 1)
    daily_sales = _sum_amount(db, models.Bill, models.Bill.grand_total, daily_start, daily_end)
    monthly_sales = _sum_amount(db, models.Bill, models.Bill.grand_total, month_start, month_end)
    yearly_sales = _sum_amount(db, models.Bill, models.Bill.grand_total, year_start, year_end)
    daily_expenses = _sum_amount(db, models.Expense, models.Expense.amount, daily_start, daily_end, models.Expense.expense_date)
    monthly_expenses = _sum_amount(db, models.Expense, models.Expense.amount, month_start, month_end, models.Expense.expense_date)
    yearly_expenses = _sum_amount(db, models.Expense, models.Expense.amount, year_start, year_end, models.Expense.expense_date)
    outstanding = db.query(func.coalesce(func.sum(models.CustomerBalance.remaining_amount), 0)).filter(
        models.CustomerBalance.remaining_amount > 0
    ).scalar()
    pending_kots = db.query(models.KOT).filter(
        models.KOT.status.notin_([models.KOTStatus.served, models.KOTStatus.cancelled])
    ).count()
    occupied_tables = db.query(models.DiningTable).filter(
        models.DiningTable.status == models.TableStatus.occupied
    ).count()
    return {
        "report_date": target.isoformat(),
        "daily_sales": str(daily_sales), "monthly_sales": str(monthly_sales), "yearly_sales": str(yearly_sales),
        "daily_expenses": str(daily_expenses), "monthly_expenses": str(monthly_expenses), "yearly_expenses": str(yearly_expenses),
        "daily_profit": str(daily_sales - daily_expenses), "monthly_profit": str(monthly_sales - monthly_expenses),
        "yearly_profit": str(yearly_sales - yearly_expenses),
        "outstanding": str(outstanding),
        "pending_kots": pending_kots,
        "occupied_tables": occupied_tables,
    }


@router.delete("/sales")
def clear_sales(db: Session = Depends(get_db), user=Depends(require_roles(models.RoleName.admin))):
    db.query(models.BalanceTransaction).delete(synchronize_session=False)
    db.query(models.CustomerBalance).delete(synchronize_session=False)
    db.query(models.Payment).delete(synchronize_session=False)
    deleted_bills = db.query(models.Bill).delete(synchronize_session=False)
    db.query(models.KOT).filter(models.KOT.status.notin_([models.KOTStatus.served, models.KOTStatus.cancelled])).update(
        {models.KOT.status: models.KOTStatus.cancelled}, synchronize_session=False
    )
    db.query(models.Order).filter(models.Order.status != models.OrderStatus.cancelled).update(
        {models.Order.status: models.OrderStatus.cancelled}, synchronize_session=False
    )
    db.query(models.DiningTable).update({models.DiningTable.status: models.TableStatus.available}, synchronize_session=False)
    db.commit()
    return {"ok": True, "deleted_bills": deleted_bills}