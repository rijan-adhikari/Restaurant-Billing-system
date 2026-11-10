from __future__ import annotations

from datetime import datetime, date
from io import BytesIO
from pathlib import Path
import subprocess
import uuid
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import models
from app.database import get_db, engine
from app.config import settings
from sqlalchemy.engine import make_url
from app.deps import require_roles

router = APIRouter(prefix="/api/admin", tags=["administration"])
ADMIN = (models.RoleName.admin,)
MANAGERS = (models.RoleName.admin, models.RoleName.manager)
CASHIERS = (models.RoleName.admin, models.RoleName.manager, models.RoleName.cashier)


def _pg_args() -> tuple[list[str], dict[str, str]]:
    url = make_url(settings.DATABASE_URL)
    if not url.host or not url.database or not url.username:
        raise HTTPException(500, "Database connection settings are incomplete")
    args = ["--host", url.host, "--port", str(url.port or 5432),
            "--username", url.username, "--dbname", url.database]
    env = {}
    if url.password:
        env["PGPASSWORD"] = url.password
    return args, env


def _create_database_backup(destination: Path) -> None:
    args, env = _pg_args()
    try:
        with destination.open("wb") as output:
            subprocess.run(["pg_dump", *args, "--format=custom", "--no-owner", "--no-acl"],
                           stdout=output, stderr=subprocess.PIPE, env={**__import__("os").environ, **env},
                           check=True, timeout=900)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        destination.unlink(missing_ok=True)
        raise HTTPException(500, "Database backup failed. Check database connectivity and server logs.")


@router.get("/backup")
def download_database_backup(user=Depends(require_roles(*ADMIN))):
    backup_dir = Path(__file__).resolve().parents[2] / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    filename = "royal-skye-" + datetime.utcnow().strftime("%Y%m%d-%H%M%S") + ".dump"
    destination = backup_dir / filename
    _create_database_backup(destination)
    return FileResponse(destination, filename=filename, media_type="application/octet-stream")


@router.post("/restore")
def restore_database_backup(backup_file: UploadFile = File(...),
                            confirmation: str = Form(...),
                            db: Session = Depends(get_db), user=Depends(require_roles(*ADMIN))):
    if confirmation != "RESTORE ROYAL SKYE DATABASE":
        raise HTTPException(400, "Type the exact restore confirmation phrase")
    if not backup_file.filename or not backup_file.filename.lower().endswith(".dump"):
        raise HTTPException(415, "Upload a PostgreSQL custom-format .dump backup")
    open_orders = db.execute(text("SELECT COUNT(*) FROM orders WHERE status='open'")).scalar_one()
    open_shifts = db.execute(text("SELECT COUNT(*) FROM cash_drawer_shifts WHERE status='open'")).scalar_one()
    if open_orders or open_shifts:
        raise HTTPException(409, "Close all open orders and cash drawer shifts before restoring a database")
    db.commit()
    db.close()
    backup_dir = Path(__file__).resolve().parents[2] / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    upload_path = backup_dir / ("restore-upload-" + uuid.uuid4().hex + ".dump")
    with upload_path.open("wb") as output:
        total = 0
        while chunk := backup_file.file.read(1024 * 1024):
            total += len(chunk)
            if total > 500 * 1024 * 1024:
                upload_path.unlink(missing_ok=True)
                raise HTTPException(413, "Backup file exceeds the 500 MB upload limit")
            output.write(chunk)
    args, env = _pg_args()
    process_env = {**__import__("os").environ, **env}
    safety_backup = backup_dir / ("pre-restore-" + datetime.utcnow().strftime("%Y%m%d-%H%M%S") + ".dump")
    _create_database_backup(safety_backup)
    try:
        subprocess.run(["pg_restore", "--list", str(upload_path)], capture_output=True,
                       env=process_env, check=True, timeout=120)
        subprocess.run(["pg_restore", *args, "--clean", "--if-exists", "--no-owner",
                        "--no-acl", "--single-transaction", "--exit-on-error", str(upload_path)],
                       capture_output=True, env=process_env, check=True, timeout=1800)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        raise HTTPException(500, f"Restore failed. A safety backup was retained as {safety_backup.name}.")
    finally:
        upload_path.unlink(missing_ok=True)
    engine.dispose()
    return {"ok": True, "message": "Database restored. Sign in again using an account from the restored backup.",
            "safety_backup": safety_backup.name}


def audit(db: Session, user_id: str, action: str, details: str = "") -> None:
    # Raw SQL bypasses SQLAlchemy's Python-side AuditLog.id default, so generate
    # the UUID explicitly rather than relying on a database-side default.
    db.execute(
        text("INSERT INTO audit_logs(id,user_id,action,details) VALUES(:id,:user,:action,:details)"),
        {"id": str(uuid.uuid4()), "user": user_id, "action": action, "details": details},
    )


class ShiftOpen(BaseModel):
    opening_float: Decimal = Field(ge=0)
    notes: str | None = None


class ShiftClose(BaseModel):
    counted_cash: Decimal = Field(ge=0)
    notes: str | None = None


class CashEntry(BaseModel):
    entry_type: Literal["cash_in", "cash_out", "payout"]
    amount: Decimal = Field(gt=0)
    reference: str | None = None
    notes: str | None = None


class RefundCreate(BaseModel):
    bill_id: str
    amount: Decimal = Field(gt=0)
    reason: str = Field(min_length=3, max_length=500)
    method: Literal["cash", "card", "bank_transfer", "qr"] = "cash"


class SupplierEntry(BaseModel):
    supplier_id: str
    entry_type: Literal["payment", "return", "adjustment"]
    amount: Decimal = Field(gt=0)
    reference: str | None = None
    notes: str | None = None


class ServiceOrderStatusUpdate(BaseModel):
    status: Literal["received", "preparing", "ready", "out_for_delivery", "completed", "cancelled"]


class LoyaltySettings(BaseModel):
    enabled: bool = True
    spend_per_point: Decimal = Field(gt=0)
    point_value: Decimal = Field(ge=0)


class LoyaltyAdjustment(BaseModel):
    customer_id: str
    points: Decimal
    notes: str = Field(min_length=3, max_length=500)


def _report_data(start: date, end: date, db: Session):
    if end < start:
        raise HTTPException(422, "End date must not precede start date")
    summary = db.execute(text("""SELECT COUNT(*) bill_count,
        COALESCE(SUM(b.subtotal),0) gross_sales, COALESCE(SUM(b.discount_amount),0) discounts,
        COALESCE(SUM(b.tax_amount),0) tax, COALESCE(SUM(b.service_charge_amount),0) service_charge,
        COALESCE(SUM(b.grand_total),0) billed_total, COALESCE(SUM(b.amount_paid),0) received
        FROM bills b WHERE b.created_at::date BETWEEN :start AND :end"""),
        {"start": start, "end": end}).mappings().one()
    refunds = db.execute(text("""SELECT COALESCE(SUM(r.amount),0) FROM bill_refunds r
        JOIN bills b ON b.id=r.bill_id WHERE b.created_at::date BETWEEN :start AND :end"""),
        {"start": start, "end": end}).scalar_one()
    payments = db.execute(text("""SELECT p.method,COALESCE(SUM(p.amount),0) amount,COUNT(*) transactions
        FROM payments p JOIN bills b ON b.id=p.bill_id
        WHERE b.created_at::date BETWEEN :start AND :end GROUP BY p.method ORDER BY p.method"""),
        {"start": start, "end": end}).mappings().all()
    items = db.execute(text("""SELECT m.name,SUM(oi.quantity) quantity,
        SUM(oi.quantity*oi.unit_price) gross_amount
        FROM bills b JOIN orders o ON o.id=b.order_id
        JOIN order_items oi ON oi.order_id=o.id AND oi.is_cancelled=FALSE
        JOIN menu_items m ON m.id=oi.menu_item_id
        WHERE b.created_at::date BETWEEN :start AND :end
        GROUP BY m.name ORDER BY quantity DESC"""), {"start": start, "end": end}).mappings().all()
    staff = db.execute(text("""SELECT u.full_name,COUNT(b.id) bills,
        COALESCE(SUM(b.grand_total),0) billed_total,COALESCE(SUM(b.amount_paid),0) received
        FROM bills b JOIN orders o ON o.id=b.order_id JOIN users u ON u.id=o.waiter_id
        WHERE b.created_at::date BETWEEN :start AND :end
        GROUP BY u.id,u.full_name ORDER BY billed_total DESC"""),
        {"start": start, "end": end}).mappings().all()
    return summary, Decimal(str(refunds)), payments, items, staff


@router.get("/reports/sales.csv")
def export_sales_csv(start: date, end: date, db: Session = Depends(get_db),
                     user=Depends(require_roles(*MANAGERS))):
    summary, refunds, payments, items, staff = _report_data(start, end, db)
    import csv
    import io
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Royal Skye sales report", start.isoformat(), end.isoformat()])
    writer.writerow(["Bills", summary["bill_count"]])
    writer.writerow(["Gross sales", summary["gross_sales"]])
    writer.writerow(["Discounts", summary["discounts"]])
    writer.writerow(["Refunds", refunds])
    writer.writerow(["Net sales", Decimal(str(summary["gross_sales"])) - Decimal(str(summary["discounts"])) - refunds])
    writer.writerow([])
    writer.writerow(["Payment method", "Amount", "Transactions"])
    for row in payments:
        writer.writerow([row["method"], row["amount"], row["transactions"]])
    writer.writerow([])
    writer.writerow(["Item", "Quantity", "Gross amount"])
    for row in items:
        writer.writerow([row["name"], row["quantity"], row["gross_amount"]])
    writer.writerow([])
    writer.writerow(["Staff", "Bills", "Billed total", "Received"])
    for row in staff:
        writer.writerow([row["full_name"], row["bills"], row["billed_total"], row["received"]])
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=royal-skye-sales-{start}-{end}.csv"})


@router.get("/reports/sales.xlsx")
def export_sales_xlsx(start: date, end: date, db: Session = Depends(get_db),
                      user=Depends(require_roles(*MANAGERS))):
    from openpyxl import Workbook
    summary, refunds, payments, items, staff = _report_data(start, end, db)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Summary"
    sheet.append(["Royal Skye sales report", f"{start} to {end}"])
    sheet.append(["Bills", summary["bill_count"]])
    sheet.append(["Gross sales", float(summary["gross_sales"])])
    sheet.append(["Discounts", float(summary["discounts"])])
    sheet.append(["Refunds", float(refunds)])
    sheet.append(["Net sales", float(Decimal(str(summary["gross_sales"])) - Decimal(str(summary["discounts"])) - refunds)])
    sheet.append(["Tax collected", float(summary["tax"])])
    sheet.append(["Service charge", float(summary["service_charge"])])
    for title, headers, rows in [
        ("Payments", ["Method", "Amount", "Transactions"], [[r["method"], float(r["amount"]), r["transactions"]] for r in payments]),
        ("Items", ["Item", "Quantity", "Gross amount"], [[r["name"], float(r["quantity"]), float(r["gross_amount"])] for r in items]),
        ("Staff", ["Staff", "Bills", "Billed total", "Received"], [[r["full_name"], r["bills"], float(r["billed_total"]), float(r["received"])] for r in staff]),
    ]:
        ws = workbook.create_sheet(title)
        ws.append(headers)
        for row in rows:
            ws.append(row)
    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=royal-skye-sales-{start}-{end}.xlsx"})


@router.get("/reports/sales.pdf")
def export_sales_pdf(start: date, end: date, db: Session = Depends(get_db),
                     user=Depends(require_roles(*MANAGERS))):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    summary, refunds, payments, items, staff = _report_data(start, end, db)
    output = BytesIO()
    document = SimpleDocTemplate(output, pagesize=A4, title="Royal Skye Sales Report")
    styles = getSampleStyleSheet()
    story = [Paragraph("Royal Skye · Sales Report", styles["Title"]),
             Paragraph(f"Period: {start} to {end}", styles["Normal"]), Spacer(1, 14)]
    net_sales = Decimal(str(summary["gross_sales"])) - Decimal(str(summary["discounts"])) - refunds
    summary_rows = [["Metric", "Amount / Count"], ["Bills", str(summary["bill_count"])],
        ["Gross sales", f"NPR {summary['gross_sales']}"], ["Discounts", f"NPR {summary['discounts']}"],
        ["Refunds", f"NPR {refunds}"], ["Net sales", f"NPR {net_sales}"],
        ["Tax collected", f"NPR {summary['tax']}"], ["Service charge", f"NPR {summary['service_charge']}"]]
    for title, rows in [
        ("Summary", summary_rows),
        ("Payment methods", [["Method", "Amount", "Transactions"]] + [[r["method"], str(r["amount"]), str(r["transactions"])] for r in payments]),
        ("Top selling items", [["Item", "Quantity", "Gross"]] + [[r["name"], str(r["quantity"]), str(r["gross_amount"])] for r in items[:20]]),
        ("Staff performance", [["Staff", "Bills", "Billed", "Received"]] + [[r["full_name"], str(r["bills"]), str(r["billed_total"]), str(r["received"])] for r in staff]),
    ]:
        story.append(Paragraph(title, styles["Heading2"]))
        table = Table(rows, repeatRows=1, hAlign="LEFT")
        table.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#5e1010")),
            ("TEXTCOLOR", (0,0), (-1,0), colors.white),
            ("GRID", (0,0), (-1,-1), 0.35, colors.HexColor("#dddddd")),
            ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#f7f7f7")]),
            ("FONTSIZE", (0,0), (-1,-1), 8), ("PADDING", (0,0), (-1,-1), 5),
        ]))
        story.extend([table, Spacer(1, 12)])
    document.build(story)
    output.seek(0)
    return StreamingResponse(output, media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=royal-skye-sales-{start}-{end}.pdf"})


@router.get("/service-orders")
def list_service_orders(status: str | None = None, db: Session = Depends(get_db),
                        user=Depends(require_roles(*MANAGERS))):
    rows = db.execute(text("""SELECT d.*,o.order_number,o.status order_status,
        b.bill_number,b.grand_total,b.amount_paid
        FROM order_service_details d JOIN orders o ON o.id=d.order_id
        LEFT JOIN bills b ON b.order_id=o.id
        WHERE (:status IS NULL OR d.status=:status)
        ORDER BY d.created_at DESC LIMIT 500"""), {"status": status}).mappings().all()
    return [dict(row) for row in rows]


@router.patch("/service-orders/{order_id}/status")
def update_service_order_status(order_id: str, payload: ServiceOrderStatusUpdate,
                                db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    detail = db.execute(text("""SELECT d.*,o.status order_status FROM order_service_details d
        JOIN orders o ON o.id=d.order_id WHERE d.order_id=:id FOR UPDATE OF d,o"""),
        {"id": order_id}).mappings().first()
    if not detail:
        raise HTTPException(404, "Service order not found")
    if payload.status == "out_for_delivery" and detail["service_type"] != "delivery":
        raise HTTPException(422, "Only delivery orders can be dispatched")
    if payload.status in ("out_for_delivery", "completed") and detail["order_status"] != "completed":
        raise HTTPException(409, "Generate the bill before dispatching or completing this service order")
    if payload.status == "cancelled":
        if detail["order_status"] != "open":
            raise HTTPException(409, "A billed order cannot be cancelled here; record a refund instead")
        db.execute(text("UPDATE orders SET status='cancelled' WHERE id=:id"), {"id": order_id})
        db.execute(text("UPDATE order_items SET is_cancelled=TRUE WHERE order_id=:id"), {"id": order_id})
        db.execute(text("UPDATE kots SET status='cancelled' WHERE order_id=:id AND status NOT IN ('served','cancelled')"),
                   {"id": order_id})
    db.execute(text("UPDATE order_service_details SET status=:status,updated_at=NOW() WHERE order_id=:id"),
               {"status": payload.status, "id": order_id})
    audit(db, user.id, "service_order.status", f"Order {order_id} status changed to {payload.status}")
    db.commit()
    return {"ok": True, "order_id": order_id, "status": payload.status}


@router.get("/audit")
def list_audit_logs(limit: int = Query(100, ge=1, le=500),
                    db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    rows = db.execute(text("""SELECT a.id,a.action,a.details,a.created_at,u.username,u.full_name
        FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
        ORDER BY a.created_at DESC LIMIT :limit"""), {"limit": limit}).mappings().all()
    return [dict(row) for row in rows]


@router.get("/cash-shifts")
def list_cash_shifts(limit: int = Query(50, ge=1, le=200),
                     db: Session = Depends(get_db), user=Depends(require_roles(*CASHIERS))):
    rows = db.execute(text("""SELECT s.*,u.full_name opened_by_name,c.full_name closed_by_name
        FROM cash_drawer_shifts s JOIN users u ON u.id=s.opened_by
        LEFT JOIN users c ON c.id=s.closed_by ORDER BY s.opened_at DESC LIMIT :limit"""),
        {"limit": limit}).mappings().all()
    return [dict(row) for row in rows]


@router.get("/cash-shifts/current")
def current_cash_shift(db: Session = Depends(get_db), user=Depends(require_roles(*CASHIERS))):
    row = db.execute(text("""SELECT s.*,u.full_name opened_by_name FROM cash_drawer_shifts s
        JOIN users u ON u.id=s.opened_by WHERE s.status='open' ORDER BY s.opened_at DESC LIMIT 1""")).mappings().first()
    if not row:
        return None
    entries = db.execute(text("""SELECT entry_type,COALESCE(SUM(amount),0) amount
        FROM cash_drawer_entries WHERE shift_id=:id GROUP BY entry_type"""), {"id": row["id"]}).mappings().all()
    totals = {r["entry_type"]: Decimal(str(r["amount"])) for r in entries}
    expected = Decimal(str(row["opening_float"])) + totals.get("sale", Decimal(0)) + totals.get("cash_in", Decimal(0)) - totals.get("refund", Decimal(0)) - totals.get("cash_out", Decimal(0)) - totals.get("payout", Decimal(0))
    return dict(row) | {"entries": {k: str(v) for k,v in totals.items()}, "expected_cash": str(expected)}


@router.post("/cash-shifts/open")
def open_cash_shift(payload: ShiftOpen, db: Session = Depends(get_db), user=Depends(require_roles(*CASHIERS))):
    existing = db.execute(text("SELECT id FROM cash_drawer_shifts WHERE status='open' FOR UPDATE")).first()
    if existing:
        raise HTTPException(409, "A cash drawer shift is already open")
    row = db.execute(text("""INSERT INTO cash_drawer_shifts(opened_by,opening_float,notes)
        VALUES(:user,:float,:notes) RETURNING *"""),
        {"user": user.id, "float": payload.opening_float, "notes": payload.notes}).mappings().first()
    audit(db, user.id, "cash_shift.open", f"Shift {row['id']} opened with NPR {payload.opening_float}")
    db.commit()
    return dict(row)


@router.post("/cash-shifts/{shift_id}/entries")
def add_cash_entry(shift_id: str, payload: CashEntry, db: Session = Depends(get_db),
                   user=Depends(require_roles(*CASHIERS))):
    shift = db.execute(text("SELECT id FROM cash_drawer_shifts WHERE id=:id AND status='open' FOR UPDATE"),
                       {"id": shift_id}).first()
    if not shift:
        raise HTTPException(409, "Cash shift is not open")
    row = db.execute(text("""INSERT INTO cash_drawer_entries(shift_id,entry_type,amount,reference,notes,created_by)
        VALUES(:shift,:type,:amount,:reference,:notes,:user) RETURNING *"""),
        {"shift": shift_id, "type": payload.entry_type, "amount": payload.amount,
         "reference": payload.reference, "notes": payload.notes, "user": user.id}).mappings().first()
    audit(db, user.id, f"cash_shift.{payload.entry_type}", f"Shift {shift_id}: NPR {payload.amount}")
    db.commit()
    return dict(row)


@router.post("/cash-shifts/{shift_id}/close")
def close_cash_shift(shift_id: str, payload: ShiftClose, db: Session = Depends(get_db),
                    user=Depends(require_roles(*CASHIERS))):
    shift = db.execute(text("SELECT * FROM cash_drawer_shifts WHERE id=:id AND status='open' FOR UPDATE"),
                       {"id": shift_id}).mappings().first()
    if not shift:
        raise HTTPException(409, "Cash shift is already closed or does not exist")
    totals = db.execute(text("""SELECT entry_type,COALESCE(SUM(amount),0) amount
        FROM cash_drawer_entries WHERE shift_id=:id GROUP BY entry_type"""), {"id": shift_id}).mappings().all()
    values = {r["entry_type"]: Decimal(str(r["amount"])) for r in totals}
    expected = Decimal(str(shift["opening_float"])) + values.get("sale", Decimal(0)) + values.get("cash_in", Decimal(0)) - values.get("refund", Decimal(0)) - values.get("cash_out", Decimal(0)) - values.get("payout", Decimal(0))
    difference = payload.counted_cash - expected
    row = db.execute(text("""UPDATE cash_drawer_shifts SET status='closed',closed_by=:user,
        expected_cash=:expected,counted_cash=:counted,cash_difference=:difference,
        notes=COALESCE(notes,'') || CASE WHEN :notes IS NULL OR :notes='' THEN '' ELSE E'\\n' || :notes END,
        closed_at=NOW() WHERE id=:id RETURNING *"""),
        {"user": user.id, "expected": expected, "counted": payload.counted_cash,
         "difference": difference, "notes": payload.notes, "id": shift_id}).mappings().first()
    audit(db, user.id, "cash_shift.close", f"Shift {shift_id}: expected NPR {expected}, counted NPR {payload.counted_cash}, difference NPR {difference}")
    db.commit()
    return dict(row)


@router.get("/refundable-bills")
def refundable_bills(db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    rows = db.execute(text("""SELECT b.id,b.bill_number,b.created_at,b.grand_total,b.amount_paid,
        b.amount_paid-COALESCE(SUM(r.amount),0) refundable_amount
        FROM bills b LEFT JOIN bill_refunds r ON r.bill_id=b.id
        GROUP BY b.id HAVING b.amount_paid-COALESCE(SUM(r.amount),0)>0
        ORDER BY b.created_at DESC LIMIT 300""")).mappings().all()
    return [dict(row) for row in rows]


@router.get("/refunds")
def list_refunds(start: date | None = None, end: date | None = None,
                 db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    if start and end and end < start:
        raise HTTPException(422, "End date must not precede start date")
    rows = db.execute(text("""SELECT r.*,b.bill_number,u.full_name refunded_by
        FROM bill_refunds r JOIN bills b ON b.id=r.bill_id JOIN users u ON u.id=r.created_by
        WHERE (:start IS NULL OR r.created_at::date>=:start)
          AND (:end IS NULL OR r.created_at::date<=:end)
        ORDER BY r.created_at DESC LIMIT 500"""), {"start": start, "end": end}).mappings().all()
    return [dict(row) for row in rows]


@router.post("/refunds")
def create_refund(payload: RefundCreate, db: Session = Depends(get_db),
                  user=Depends(require_roles(*MANAGERS))):
    bill = db.execute(text("SELECT * FROM bills WHERE id=:id FOR UPDATE"), {"id": payload.bill_id}).mappings().first()
    if not bill:
        raise HTTPException(404, "Bill not found")
    refunded = db.execute(text("SELECT COALESCE(SUM(amount),0) FROM bill_refunds WHERE bill_id=:id"),
                          {"id": payload.bill_id}).scalar_one()
    refundable = Decimal(str(bill["amount_paid"])) - Decimal(str(refunded))
    if payload.amount > refundable:
        raise HTTPException(409, f"Refund exceeds refundable paid amount ({refundable})")
    row = db.execute(text("""INSERT INTO bill_refunds(bill_id,amount,reason,method,created_by)
        VALUES(:bill,:amount,:reason,:method,:user) RETURNING *"""),
        {"bill": payload.bill_id, "amount": payload.amount, "reason": payload.reason,
         "method": payload.method, "user": user.id}).mappings().first()
    if payload.method == "cash":
        open_shift = db.execute(text("SELECT id FROM cash_drawer_shifts WHERE status='open' ORDER BY opened_at DESC LIMIT 1 FOR UPDATE")).first()
        if open_shift:
            db.execute(text("""INSERT INTO cash_drawer_entries(shift_id,entry_type,amount,reference,notes,created_by)
                VALUES(:shift,'refund',:amount,:reference,:notes,:user)"""),
                {"shift": open_shift.id, "amount": payload.amount, "reference": bill["bill_number"],
                 "notes": payload.reason, "user": user.id})
    audit(db, user.id, "bill.refund", f"Bill {bill['bill_number']}: NPR {payload.amount}; {payload.reason}")
    db.commit()
    return dict(row)


@router.get("/suppliers/ledger")
def supplier_ledger(supplier_id: str | None = None, db: Session = Depends(get_db),
                    user=Depends(require_roles(*MANAGERS))):
    rows = db.execute(text("""SELECT l.*,s.name supplier_name FROM supplier_ledger l
        JOIN suppliers s ON s.id=l.supplier_id
        WHERE (:supplier IS NULL OR l.supplier_id=:supplier)
        ORDER BY l.created_at DESC LIMIT 1000"""), {"supplier": supplier_id}).mappings().all()
    return [dict(row) for row in rows]


@router.get("/suppliers/balances")
def supplier_balances(db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    rows = db.execute(text("""SELECT s.id,s.name,s.phone,
        COALESCE(SUM(CASE WHEN l.entry_type IN ('purchase','adjustment') THEN l.amount
                          WHEN l.entry_type IN ('payment','return') THEN -l.amount ELSE 0 END),0) balance
        FROM suppliers s LEFT JOIN supplier_ledger l ON l.supplier_id=s.id
        WHERE s.is_active=TRUE GROUP BY s.id,s.name,s.phone ORDER BY balance DESC,s.name""")).mappings().all()
    return [dict(row) for row in rows]


@router.post("/suppliers/ledger")
def add_supplier_ledger_entry(payload: SupplierEntry, db: Session = Depends(get_db),
                              user=Depends(require_roles(*MANAGERS))):
    supplier = db.execute(text("SELECT id FROM suppliers WHERE id=:id AND is_active=TRUE"),
                           {"id": payload.supplier_id}).first()
    if not supplier:
        raise HTTPException(404, "Supplier not found")
    row = db.execute(text("""INSERT INTO supplier_ledger(supplier_id,entry_type,amount,reference,notes,created_by)
        VALUES(:supplier,:type,:amount,:reference,:notes,:user) RETURNING *"""),
        {"supplier": payload.supplier_id, "type": payload.entry_type, "amount": payload.amount,
         "reference": payload.reference, "notes": payload.notes, "user": user.id}).mappings().first()
    audit(db, user.id, f"supplier.{payload.entry_type}", f"Supplier {payload.supplier_id}: NPR {payload.amount}")
    db.commit()
    return dict(row)


@router.get("/loyalty/settings")
def get_loyalty_settings(db: Session = Depends(get_db), user=Depends(require_roles(*CASHIERS))):
    row = db.execute(text("SELECT * FROM loyalty_settings WHERE id=1")).mappings().one()
    return dict(row)


@router.put("/loyalty/settings")
def update_loyalty_settings(payload: LoyaltySettings, db: Session = Depends(get_db),
                            user=Depends(require_roles(*ADMIN))):
    db.execute(text("""UPDATE loyalty_settings SET enabled=:enabled,spend_per_point=:spend,
        point_value=:value WHERE id=1"""),
        {"enabled": payload.enabled, "spend": payload.spend_per_point, "value": payload.point_value})
    audit(db, user.id, "loyalty.settings.update", f"Enabled={payload.enabled}, spend_per_point={payload.spend_per_point}, point_value={payload.point_value}")
    db.commit()
    return {"ok": True}


@router.get("/loyalty/accounts")
def loyalty_accounts(db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    rows = db.execute(text("""SELECT a.*,c.name,c.phone FROM loyalty_accounts a
        JOIN customers c ON c.id=a.customer_id ORDER BY a.points_balance DESC LIMIT 500""")).mappings().all()
    return [dict(row) for row in rows]


@router.post("/loyalty/adjust")
def adjust_loyalty(payload: LoyaltyAdjustment, db: Session = Depends(get_db),
                    user=Depends(require_roles(*MANAGERS))):
    account = db.execute(text("""INSERT INTO loyalty_accounts(customer_id) VALUES(:customer)
        ON CONFLICT(customer_id) DO UPDATE SET updated_at=NOW() RETURNING *"""),
        {"customer": payload.customer_id}).mappings().first()
    current = Decimal(str(account["points_balance"]))
    new_balance = current + payload.points
    if new_balance < 0:
        raise HTTPException(409, "Adjustment would make the points balance negative")
    db.execute(text("""UPDATE loyalty_accounts SET points_balance=:balance,
        lifetime_points=lifetime_points+GREATEST(:points,0),updated_at=NOW() WHERE id=:id"""),
        {"balance": new_balance, "points": payload.points, "id": account["id"]})
    db.execute(text("""INSERT INTO loyalty_transactions(customer_id,points,transaction_type,notes,created_by)
        VALUES(:customer,:points,'adjust',:notes,:user)"""),
        {"customer": payload.customer_id, "points": payload.points, "notes": payload.notes, "user": user.id})
    audit(db, user.id, "loyalty.adjust", f"Customer {payload.customer_id}: {payload.points} points")
    db.commit()
    return {"points_balance": str(new_balance)}


@router.get("/loyalty/customers/{customer_id}")
def customer_loyalty(customer_id: str, db: Session = Depends(get_db),
                      user=Depends(require_roles(*CASHIERS))):
    account = db.execute(text("""SELECT a.*,c.name,c.phone FROM loyalty_accounts a
        JOIN customers c ON c.id=a.customer_id WHERE a.customer_id=:id"""), {"id": customer_id}).mappings().first()
    if not account:
        return {"customer_id": customer_id, "points_balance": "0", "lifetime_points": "0", "transactions": []}
    transactions = db.execute(text("""SELECT * FROM loyalty_transactions WHERE customer_id=:id
        ORDER BY created_at DESC LIMIT 100"""), {"id": customer_id}).mappings().all()
    return dict(account) | {"transactions": [dict(row) for row in transactions]}
