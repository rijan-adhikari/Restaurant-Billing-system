from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from io import BytesIO
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
    # Delete restrictive FK dependants before bills; otherwise PostgreSQL rejects
    # the bulk bill deletion and the whole transaction rolls back.
    db.query(models.BalanceTransaction).delete(synchronize_session=False)
    db.query(models.CustomerBalance).delete(synchronize_session=False)
    db.query(models.Payment).delete(synchronize_session=False)
    db.execute(text("DELETE FROM bill_refunds"))
    db.execute(text("DELETE FROM loyalty_transactions"))
    db.execute(text("UPDATE loyalty_accounts SET points_balance = 0, lifetime_points = 0, updated_at = NOW()"))
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


@router.get("/daily-sales")
def daily_sales_details(report_date: date | None = None, db: Session = Depends(get_db),
                        user=Depends(require_roles(models.RoleName.admin, models.RoleName.manager, models.RoleName.cashier))):
    target = report_date or datetime.utcnow().date()
    bills = db.query(models.Bill).filter(
        func.date(models.Bill.created_at) == target
    ).order_by(models.Bill.created_at.desc()).all()
    result = []
    for bill in bills:
        order = db.query(models.Order).filter(models.Order.id == bill.order_id).first()
        customer = db.query(models.Customer).filter(models.Customer.id == bill.customer_id).first() if bill.customer_id else None
        service = db.execute(text("SELECT service_type,customer_name,phone FROM order_service_details WHERE order_id=:id"),
                             {"id": bill.order_id}).mappings().first()
        items = db.execute(text("""SELECT mi.name,oi.quantity,oi.unit_price,
            (oi.quantity * oi.unit_price) total
            FROM order_items oi JOIN menu_items mi ON mi.id=oi.menu_item_id
            WHERE oi.order_id=:order_id AND oi.is_cancelled=FALSE
            ORDER BY mi.name"""), {"order_id": bill.order_id}).mappings().all()
        result.append({
            "id": bill.id, "bill_number": bill.bill_number, "created_at": bill.created_at,
            "customer_name": customer.name if customer else (service["customer_name"] if service else "Walk-in"),
            "customer_phone": customer.phone if customer else (service["phone"] if service else None),
            "service_type": service["service_type"] if service else "dine_in",
            "table_name": order.table.name if order and order.table else (service["service_type"].title() if service else ""),
            "grand_total": str(bill.grand_total), "amount_paid": str(bill.amount_paid),
            "outstanding_amount": str(bill.outstanding_amount),
            "items": [{**dict(item), "unit_price": str(item["unit_price"]), "total": str(item["total"])} for item in items],
        })
    return result


@router.get("/summary.pdf")
def dashboard_summary_pdf(report_date: date | None = None, db: Session = Depends(get_db),
                           user=Depends(require_roles(models.RoleName.admin, models.RoleName.manager, models.RoleName.cashier))):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

    target = report_date or datetime.utcnow().date()
    summary = dashboard_summary(target, db, user)
    sales = daily_sales_details(target, db, user)
    output = BytesIO()
    document = SimpleDocTemplate(output, pagesize=A4, title="Dashboard Report")
    styles = getSampleStyleSheet()
    story = [Paragraph("Royal Skye Birds · Dashboard Report", styles["Title"]),
             Paragraph(f"Report date: {target.isoformat()}", styles["Normal"]), Spacer(1, 12)]
    metrics = [
        ["Metric", "Value"],
        ["Daily sales", f"NPR {summary['daily_sales']}"],
        ["Daily expenses", f"NPR {summary['daily_expenses']}"],
        ["Estimated daily profit / loss", f"NPR {summary['daily_profit']}"],
        ["Estimated daily COGS", f"NPR {summary['daily_estimated_cogs']}"],
        ["Outstanding credit", f"NPR {summary['outstanding']}"],
        ["Pending KOTs", str(summary["pending_kots"])],
        ["Occupied tables", str(summary["occupied_tables"])],
    ]
    story.extend([Paragraph("Dashboard overview", styles["Heading2"]), Table(metrics, repeatRows=1), Spacer(1, 14),
                  Paragraph("Daily sales detail", styles["Heading2"])])
    rows = [["Bill", "Time", "Customer", "Items", "Total", "Paid"]]
    for bill in sales:
        item_text = ", ".join(f"{item['quantity']} x {item['name']}" for item in bill["items"])
        rows.append([bill["bill_number"], bill["created_at"].strftime("%H:%M"), bill["customer_name"],
                     item_text, f"NPR {bill['grand_total']}", f"NPR {bill['amount_paid']}"])
    if len(rows) == 1:
        rows.append(["—", "—", "No sales", "—", "—", "—"])
    table = Table(rows, repeatRows=1, colWidths=[70, 42, 85, 145, 65, 65])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#5e1010")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#dddddd")),
        ("FONTSIZE", (0, 0), (-1, -1), 7), ("PADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(table)
    document.build(story)
    output.seek(0)
    return StreamingResponse(output, media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=dashboard-{target.isoformat()}.pdf"})
