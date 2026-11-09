from __future__ import annotations

from datetime import datetime, date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import models
from app.database import get_db, engine
from app.deps import require_roles

router = APIRouter(prefix="/api/admin", tags=["administration"])
ADMIN = (models.RoleName.admin,)
MANAGERS = (models.RoleName.admin, models.RoleName.manager)
CASHIERS = (models.RoleName.admin, models.RoleName.manager, models.RoleName.cashier)


def init_admin_schema() -> None:
    statements = [
        """CREATE TABLE IF NOT EXISTS cash_drawer_shifts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            opened_by UUID NOT NULL REFERENCES users(id),
            closed_by UUID REFERENCES users(id),
            opening_float NUMERIC(14,2) NOT NULL CHECK (opening_float >= 0),
            expected_cash NUMERIC(14,2),
            counted_cash NUMERIC(14,2),
            cash_difference NUMERIC(14,2),
            status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
            notes TEXT,
            opened_at TIMESTAMP NOT NULL DEFAULT NOW(),
            closed_at TIMESTAMP
        )""",
        """CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_drawer_one_open_shift
            ON cash_drawer_shifts ((status)) WHERE status='open'""",
        """CREATE TABLE IF NOT EXISTS cash_drawer_entries (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            shift_id UUID NOT NULL REFERENCES cash_drawer_shifts(id),
            entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('sale','refund','cash_in','cash_out','payout')),
            amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
            reference VARCHAR(120), notes TEXT,
            created_by UUID NOT NULL REFERENCES users(id),
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )""",
        """CREATE TABLE IF NOT EXISTS bill_refunds (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            bill_id UUID NOT NULL REFERENCES bills(id),
            amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
            reason TEXT NOT NULL,
            method VARCHAR(24) NOT NULL,
            created_by UUID NOT NULL REFERENCES users(id),
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )""",
        """CREATE TABLE IF NOT EXISTS supplier_ledger (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            supplier_id UUID NOT NULL REFERENCES suppliers(id),
            entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('purchase','payment','return','adjustment')),
            amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
            reference VARCHAR(120), notes TEXT,
            created_by UUID REFERENCES users(id),
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )""",
        """CREATE TABLE IF NOT EXISTS loyalty_settings (
            id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id=1),
            spend_per_point NUMERIC(14,2) NOT NULL DEFAULT 100 CHECK (spend_per_point > 0),
            point_value NUMERIC(14,2) NOT NULL DEFAULT 1 CHECK (point_value >= 0),
            enabled BOOLEAN NOT NULL DEFAULT TRUE
        )""",
        """INSERT INTO loyalty_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING""",
        """CREATE TABLE IF NOT EXISTS loyalty_accounts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            customer_id UUID NOT NULL UNIQUE REFERENCES customers(id),
            points_balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
            lifetime_points NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (lifetime_points >= 0),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )""",
        """CREATE TABLE IF NOT EXISTS loyalty_transactions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            customer_id UUID NOT NULL REFERENCES customers(id),
            bill_id UUID REFERENCES bills(id),
            points NUMERIC(14,2) NOT NULL,
            transaction_type VARCHAR(16) NOT NULL CHECK (transaction_type IN ('earn','redeem','adjust')),
            notes TEXT, created_by UUID REFERENCES users(id),
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_cash_shifts_opened_at ON cash_drawer_shifts(opened_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_refunds_bill_id ON bill_refunds(bill_id)",
        "CREATE INDEX IF NOT EXISTS ix_supplier_ledger_supplier_date ON supplier_ledger(supplier_id,created_at DESC)",
    ]
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def audit(db: Session, user_id: str, action: str, details: str = "") -> None:
    db.execute(text("INSERT INTO audit_logs(user_id,action,details) VALUES(:user,:action,:details)"),
               {"user": user_id, "action": action, "details": details})


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


class LoyaltySettings(BaseModel):
    enabled: bool = True
    spend_per_point: Decimal = Field(gt=0)
    point_value: Decimal = Field(ge=0)


class LoyaltyAdjustment(BaseModel):
    customer_id: str
    points: Decimal
    notes: str = Field(min_length=3, max_length=500)


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
def get_loyalty_settings(db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
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
                      user=Depends(require_roles(*MANAGERS))):
    account = db.execute(text("""SELECT a.*,c.name,c.phone FROM loyalty_accounts a
        JOIN customers c ON c.id=a.customer_id WHERE a.customer_id=:id"""), {"id": customer_id}).mappings().first()
    if not account:
        return {"customer_id": customer_id, "points_balance": "0", "lifetime_points": "0", "transactions": []}
    transactions = db.execute(text("""SELECT * FROM loyalty_transactions WHERE customer_id=:id
        ORDER BY created_at DESC LIMIT 100"""), {"id": customer_id}).mappings().all()
    return dict(account) | {"transactions": [dict(row) for row in transactions]}
