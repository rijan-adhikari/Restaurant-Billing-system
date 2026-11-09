from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy import text

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
    # Net sales exclude VAT/tax and service-charge collections; discounts are already
    # reflected in grand_total and must not be deducted a second time.
    def net_sales(start: datetime, end: datetime):
        return db.query(func.coalesce(func.sum(
            models.Bill.grand_total - models.Bill.tax_amount - models.Bill.service_charge_amount
        ), 0)).filter(models.Bill.created_at >= start, models.Bill.created_at < end).scalar()

    def estimated_cogs(start: datetime, end: datetime):
        value = db.execute(text("""SELECT COALESCE(SUM(ri.quantity * oi.quantity * i.average_cost /
            NULLIF(r.yield_quantity,0)),0) FROM bills b
            JOIN orders o ON o.id=b.order_id
            JOIN order_items oi ON oi.order_id=o.id AND oi.is_cancelled=FALSE
            JOIN recipes r ON r.menu_item_id=oi.menu_item_id
            JOIN recipe_items ri ON ri.recipe_id=r.id
            JOIN inventory_items i ON i.id=ri.item_id
            WHERE b.created_at >= :start AND b.created_at < :end"""),
            {"start": start, "end": end}).scalar_one()
        return value or 0

    daily_sales = net_sales(daily_start, daily_end)
    monthly_sales = net_sales(month_start, month_end)
    yearly_sales = net_sales(year_start, year_end)
    daily_cogs = estimated_cogs(daily_start, daily_end)
    monthly_cogs = estimated_cogs(month_start, month_end)
    yearly_cogs = estimated_cogs(year_start, year_end)
    daily_expenses = _sum_amount(db, models.Expense, models.Expense.amount, daily_start, daily_end, models.Expense.expense_date)
    monthly_expenses = _sum_amount(db, models.Expense, models.Expense.amount, month_start, month_end, models.Expense.expense_date)
    yearly_expenses = _sum_amount(db, models.Expense, models.Expense.amount, year_start, year_end, models.Expense.expense_date)
    def payroll_cost(start: datetime, end: datetime):
        return db.execute(text("""SELECT COALESCE(SUM(gross_pay),0) FROM payroll_entries
            WHERE period_end >= :start_date AND period_end < :end_date"""),
            {"start_date": start.date(), "end_date": end.date()}).scalar_one()

    daily_payroll = payroll_cost(daily_start, daily_end)
    monthly_payroll = payroll_cost(month_start, month_end)
    yearly_payroll = payroll_cost(year_start, year_end)
    daily_expenses += daily_payroll
    monthly_expenses += monthly_payroll
    yearly_expenses += yearly_payroll

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
        "daily_profit": str(daily_sales - daily_cogs - daily_expenses),
        "monthly_profit": str(monthly_sales - monthly_cogs - monthly_expenses),
        "yearly_profit": str(yearly_sales - yearly_cogs - yearly_expenses),
        "daily_estimated_cogs": str(daily_cogs), "monthly_estimated_cogs": str(monthly_cogs),
        "yearly_estimated_cogs": str(yearly_cogs),
        "daily_payroll_expense": str(daily_payroll), "monthly_payroll_expense": str(monthly_payroll),
        "yearly_payroll_expense": str(yearly_payroll),
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