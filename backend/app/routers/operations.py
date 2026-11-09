from __future__ import annotations

import csv
import io
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import models
from app.database import get_db, engine
from app.deps import require_roles

router = APIRouter(prefix="/api/operations", tags=["restaurant operations"])
MANAGERS = (models.RoleName.admin, models.RoleName.manager)
UNITS = {"kg": ("weight", Decimal("1000")), "g": ("weight", Decimal("1")),
         "litre": ("volume", Decimal("1000")), "ml": ("volume", Decimal("1")),
         "dozen": ("count", Decimal("12")), "pcs": ("count", Decimal("1")),
         "bottle": ("pack", Decimal("1")), "packet": ("pack", Decimal("1")),
         "box": ("pack", Decimal("1"))}


def init_operations_schema() -> None:
    statements = [
        """CREATE TABLE IF NOT EXISTS suppliers (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(160) NOT NULL,
            phone VARCHAR(40), email VARCHAR(160), address TEXT, tax_number VARCHAR(64),
            notes TEXT, is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
        """CREATE TABLE IF NOT EXISTS inventory_items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(160) NOT NULL UNIQUE,
            sku VARCHAR(64) UNIQUE, category VARCHAR(80) NOT NULL DEFAULT 'General',
            unit VARCHAR(24) NOT NULL, quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
            reorder_level NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
            average_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (average_cost >= 0),
            supplier_id UUID REFERENCES suppliers(id), expiry_date DATE, is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW())""",
        """CREATE TABLE IF NOT EXISTS stock_movements (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), item_id UUID NOT NULL REFERENCES inventory_items(id),
            movement_type VARCHAR(24) NOT NULL CHECK (movement_type IN ('opening','purchase','consumption','waste','adjustment','return')),
            quantity NUMERIC(14,3) NOT NULL, unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
            reference VARCHAR(120), notes TEXT, created_by UUID REFERENCES users(id),
            created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
        """CREATE TABLE IF NOT EXISTS purchase_orders (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_number VARCHAR(40) NOT NULL UNIQUE,
            supplier_id UUID NOT NULL REFERENCES suppliers(id), status VARCHAR(20) NOT NULL DEFAULT 'draft',
            subtotal NUMERIC(14,2) NOT NULL DEFAULT 0, notes TEXT, ordered_at TIMESTAMP NOT NULL DEFAULT NOW(),
            received_at TIMESTAMP, created_by UUID REFERENCES users(id))""",
        """CREATE TABLE IF NOT EXISTS purchase_order_items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
            item_id UUID NOT NULL REFERENCES inventory_items(id), quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
            unit_cost NUMERIC(14,2) NOT NULL CHECK (unit_cost >= 0), line_total NUMERIC(14,2) NOT NULL)""",
        """CREATE TABLE IF NOT EXISTS recipes (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), menu_item_id UUID NOT NULL UNIQUE REFERENCES menu_items(id) ON DELETE CASCADE,
            yield_quantity NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (yield_quantity > 0),
            instructions TEXT, updated_at TIMESTAMP NOT NULL DEFAULT NOW())""",
        """CREATE TABLE IF NOT EXISTS recipe_items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
            item_id UUID NOT NULL REFERENCES inventory_items(id), quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
            UNIQUE(recipe_id,item_id))""",
        """CREATE TABLE IF NOT EXISTS bill_cost_snapshots (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
            order_item_id UUID NOT NULL REFERENCES order_items(id), inventory_item_id UUID NOT NULL REFERENCES inventory_items(id),
            quantity NUMERIC(14,3) NOT NULL, unit_cost NUMERIC(14,2) NOT NULL, total_cost NUMERIC(14,2) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
        "CREATE INDEX IF NOT EXISTS ix_bill_cost_snapshots_bill ON bill_cost_snapshots(bill_id)",
        """CREATE TABLE IF NOT EXISTS staff_attendance (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id),
            clock_in TIMESTAMP NOT NULL DEFAULT NOW(), clock_out TIMESTAMP, notes TEXT)""",
        """CREATE TABLE IF NOT EXISTS payroll_entries (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id),
            period_start DATE NOT NULL, period_end DATE NOT NULL, gross_pay NUMERIC(14,2) NOT NULL,
            deductions NUMERIC(14,2) NOT NULL DEFAULT 0, paid_at TIMESTAMP, notes TEXT,
            UNIQUE(user_id,period_start,period_end))""",
        """CREATE TABLE IF NOT EXISTS reservations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), customer_name VARCHAR(160) NOT NULL,
            phone VARCHAR(40), party_size INTEGER NOT NULL CHECK (party_size > 0),
            reserved_for TIMESTAMP NOT NULL, table_id UUID REFERENCES tables(id),
            status VARCHAR(20) NOT NULL DEFAULT 'booked', notes TEXT, created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
        """ALTER TABLE expenses ADD COLUMN IF NOT EXISTS department VARCHAR(80) NOT NULL DEFAULT 'General'""",
        """ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'paid'""",
        """ALTER TABLE expenses ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id)""",
        """ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_reference VARCHAR(255)""",
        """ALTER TABLE expenses ADD COLUMN IF NOT EXISTS notes TEXT""",
        "ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check",
        "ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check CHECK (movement_type IN ('opening','purchase','consumption','waste','adjustment','return','supplier_return'))",
        "CREATE INDEX IF NOT EXISTS ix_stock_movements_item_date ON stock_movements(item_id,created_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_purchase_orders_date ON purchase_orders(ordered_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_reservations_date ON reservations(reserved_for)"
    ]
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def decimal_value(value: Any, label: str = "value") -> Decimal:
    try:
        result = Decimal(str(value))
    except (InvalidOperation, TypeError):
        raise HTTPException(422, f"Invalid {label}")
    if not result.is_finite():
        raise HTTPException(422, f"Invalid {label}")
    return result


def convert_quantity(quantity: Decimal, source: str, target: str) -> Decimal:
    if source not in UNITS or target not in UNITS:
        raise HTTPException(422, "Unsupported unit")
    if UNITS[source][0] != UNITS[target][0]:
        raise HTTPException(422, f"Cannot convert {source} to {target}")
    return quantity * UNITS[source][1] / UNITS[target][1]


class InventoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    sku: str | None = None
    category: str = "General"
    unit: str
    quantity: Decimal = Decimal("0")
    reorder_level: Decimal = Decimal("0")
    average_cost: Decimal = Decimal("0")
    supplier_id: str | None = None
    expiry_date: date | None = None


class MovementCreate(BaseModel):
    movement_type: str
    quantity: Decimal
    unit_cost: Decimal = Decimal("0")
    reference: str | None = None
    notes: str | None = None


class SupplierCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    tax_number: str | None = None
    notes: str | None = None


class PurchaseLine(BaseModel):
    item_id: str
    quantity: Decimal = Field(gt=0)
    unit_cost: Decimal = Field(ge=0)


class PurchaseCreate(BaseModel):
    supplier_id: str
    items: list[PurchaseLine] = Field(min_length=1)
    notes: str | None = None


class SupplierReturnCreate(BaseModel):
    supplier_id: str
    item_id: str
    quantity: Decimal = Field(gt=0)
    unit_cost: Decimal = Field(ge=0)
    reference: str | None = None
    notes: str | None = None


class RecipeLine(BaseModel):
    item_id: str
    quantity: Decimal = Field(gt=0)


class RecipeUpdate(BaseModel):
    menu_item_id: str
    yield_quantity: Decimal = Field(default=Decimal("1"), gt=0)
    instructions: str | None = None
    items: list[RecipeLine] = Field(min_length=1)


class ExpenseCreate(BaseModel):
    category: str = Field(min_length=1, max_length=64)
    description: str = Field(min_length=1, max_length=255)
    amount: Decimal = Field(gt=0)
    expense_date: datetime | None = None
    department: str = "General"
    payment_status: str = "paid"
    supplier_id: str | None = None
    receipt_reference: str | None = None
    notes: str | None = None


class AttendanceCreate(BaseModel):
    user_id: str
    notes: str | None = None


class PayrollCreate(BaseModel):
    user_id: str
    period_start: date
    period_end: date
    gross_pay: Decimal = Field(ge=0)
    deductions: Decimal = Field(default=Decimal("0"), ge=0)
    notes: str | None = None


class ReservationCreate(BaseModel):
    customer_name: str
    phone: str | None = None
    party_size: int = Field(gt=0)
    reserved_for: datetime
    table_id: str | None = None
    notes: str | None = None


@router.get("/units")
def units(user=Depends(require_roles(*MANAGERS))):
    return {"units": list(UNITS), "conversions": ["kg<->g", "litre<->ml", "dozen<->pcs"]}


@router.get("/inventory")
def list_inventory(db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    rows = db.execute(text("""SELECT i.*, s.name supplier_name FROM inventory_items i
        LEFT JOIN suppliers s ON s.id=i.supplier_id WHERE i.is_active=TRUE ORDER BY i.name""")).mappings().all()
    return [dict(row) | {"low_stock": row["quantity"] <= row["reorder_level"],
                         "stock_value": str(row["quantity"] * row["average_cost"])} for row in rows]


@router.post("/inventory")
def create_inventory(payload: InventoryCreate, db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    if payload.unit not in UNITS:
        raise HTTPException(422, "Unsupported unit")
    if payload.quantity < 0 or payload.reorder_level < 0 or payload.average_cost < 0:
        raise HTTPException(422, "Stock, reorder level and cost cannot be negative")
    row = db.execute(text("""INSERT INTO inventory_items(name,sku,category,unit,quantity,reorder_level,average_cost,supplier_id,expiry_date)
        VALUES(:name,:sku,:category,:unit,:quantity,:reorder,:cost,:supplier,:expiry) RETURNING *"""),
        {"name": payload.name.strip(), "sku": payload.sku.strip() or None if payload.sku else None, "category": payload.category,
         "unit": payload.unit, "quantity": payload.quantity, "reorder": payload.reorder_level,
         "cost": payload.average_cost, "supplier": payload.supplier_id, "expiry": payload.expiry_date}).mappings().first()
    if payload.quantity:
        db.execute(text("""INSERT INTO stock_movements(item_id,movement_type,quantity,unit_cost,notes,created_by)
            VALUES(:id,'opening',:qty,:cost,'Opening stock',:user)"""),
            {"id": row["id"], "qty": payload.quantity, "cost": payload.average_cost, "user": user.id})
    db.commit()
    return dict(row)


@router.post("/inventory/{item_id}/movements")
def stock_movement(item_id: str, payload: MovementCreate, db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    if payload.movement_type not in {"purchase", "consumption", "waste", "adjustment", "return"}:
        raise HTTPException(422, "Invalid stock movement type")
    qty = decimal_value(payload.quantity, "quantity")
    if qty < 0 or (qty == 0 and payload.movement_type != "adjustment"):
        raise HTTPException(422, "Quantity must be positive (zero is allowed only for an adjustment)")
    if payload.unit_cost < 0:
        raise HTTPException(422, "Unit cost cannot be negative")
    item = db.execute(text("SELECT * FROM inventory_items WHERE id=:id AND is_active=TRUE FOR UPDATE"), {"id": item_id}).mappings().first()
    if not item:
        raise HTTPException(404, "Inventory item not found")
    delta = -qty if payload.movement_type in {"consumption", "waste"} else qty
    if payload.movement_type == "adjustment":
        delta = qty - Decimal(str(item["quantity"]))
    new_qty = Decimal(str(item["quantity"])) + delta
    if new_qty < 0:
        raise HTTPException(409, "Insufficient stock")
    if payload.movement_type == "purchase":
        old_qty = Decimal(str(item["quantity"]))
        old_value = old_qty * Decimal(str(item["average_cost"]))
        new_average = (old_value + qty * payload.unit_cost) / new_qty if new_qty else payload.unit_cost
        db.execute(text("UPDATE inventory_items SET quantity=:qty,average_cost=:cost,updated_at=NOW() WHERE id=:id"),
                   {"qty": new_qty, "cost": new_average, "id": item_id})
    else:
        db.execute(text("UPDATE inventory_items SET quantity=:qty,updated_at=NOW() WHERE id=:id"), {"qty": new_qty, "id": item_id})
    db.execute(text("""INSERT INTO stock_movements(item_id,movement_type,quantity,unit_cost,reference,notes,created_by)
        VALUES(:id,:type,:qty,:cost,:reference,:notes,:user)"""),
        {"id": item_id, "type": payload.movement_type, "qty": abs(delta), "cost": payload.unit_cost,
         "reference": payload.reference, "notes": payload.notes, "user": user.id})
    db.commit()
    return {"item_id": item_id, "previous_quantity": str(item["quantity"]), "quantity": str(new_qty), "delta": str(delta)}


@router.get("/inventory/{item_id}/movements")
def inventory_history(item_id: str, db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    rows = db.execute(text("SELECT * FROM stock_movements WHERE item_id=:id ORDER BY created_at DESC LIMIT 250"), {"id": item_id}).mappings().all()
    return [dict(r) for r in rows]


@router.get("/suppliers")
def list_suppliers(db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    rows = db.execute(text("SELECT * FROM suppliers WHERE is_active=TRUE ORDER BY name")).mappings().all()
    return [dict(r) for r in rows]


@router.post("/suppliers")
def create_supplier(payload: SupplierCreate, db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    row = db.execute(text("""INSERT INTO suppliers(name,phone,email,address,tax_number,notes)
        VALUES(:name,:phone,:email,:address,:tax,:notes) RETURNING *"""),
        {"name": payload.name.strip(), "phone": payload.phone, "email": payload.email,
         "address": payload.address, "tax": payload.tax_number, "notes": payload.notes}).mappings().first()
    db.commit()
    return dict(row)


@router.post("/purchases")
def create_purchase(payload: PurchaseCreate, db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    if not db.execute(text("SELECT id FROM suppliers WHERE id=:id AND is_active=TRUE"), {"id": payload.supplier_id}).first():
        raise HTTPException(404, "Supplier not found")
    total = sum((line.quantity * line.unit_cost for line in payload.items), Decimal("0"))
    number = "PO-" + datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
    po = db.execute(text("""INSERT INTO purchase_orders(order_number,supplier_id,status,subtotal,notes,created_by)
        VALUES(:number,:supplier,'received',:total,:notes,:user) RETURNING *"""),
        {"number": number, "supplier": payload.supplier_id, "total": total, "notes": payload.notes, "user": user.id}).mappings().first()
    for line in payload.items:
        item = db.execute(text("SELECT * FROM inventory_items WHERE id=:id AND is_active=TRUE FOR UPDATE"), {"id": line.item_id}).mappings().first()
        if not item:
            raise HTTPException(404, f"Inventory item {line.item_id} not found")
        old_qty = Decimal(str(item["quantity"]))
        new_qty = old_qty + line.quantity
        old_value = old_qty * Decimal(str(item["average_cost"]))
        new_average = (old_value + line.quantity * line.unit_cost) / new_qty if new_qty else line.unit_cost
        db.execute(text("UPDATE inventory_items SET quantity=:qty,average_cost=:cost,updated_at=NOW() WHERE id=:id"),
                   {"qty": new_qty, "cost": new_average, "id": line.item_id})
        db.execute(text("""INSERT INTO purchase_order_items(purchase_order_id,item_id,quantity,unit_cost,line_total)
            VALUES(:po,:item,:qty,:cost,:total)"""),
            {"po": po["id"], "item": line.item_id, "qty": line.quantity, "cost": line.unit_cost, "total": line.quantity * line.unit_cost})
        db.execute(text("""INSERT INTO stock_movements(item_id,movement_type,quantity,unit_cost,reference,created_by)
            VALUES(:item,'purchase',:qty,:cost,:ref,:user)"""),
            {"item": line.item_id, "qty": line.quantity, "cost": line.unit_cost, "ref": number, "user": user.id})
    db.execute(text("UPDATE purchase_orders SET received_at=NOW() WHERE id=:id"), {"id": po["id"]})
    db.execute(text("""INSERT INTO supplier_ledger(supplier_id,entry_type,amount,reference,notes,created_by)
        VALUES(:supplier,'purchase',:amount,:reference,:notes,:user)"""),
        {"supplier": payload.supplier_id, "amount": total, "reference": number,
         "notes": "Stock purchase received", "user": user.id})
    db.commit()
    return {"id": po["id"], "order_number": number, "status": "received", "subtotal": str(total)}


@router.post("/supplier-returns")
def create_supplier_return(payload: SupplierReturnCreate, db: Session = Depends(get_db),
                           user=Depends(require_roles(*MANAGERS))):
    supplier = db.execute(text("SELECT id FROM suppliers WHERE id=:id AND is_active=TRUE"),
                           {"id": payload.supplier_id}).first()
    if not supplier:
        raise HTTPException(404, "Supplier not found")
    item = db.execute(text("SELECT * FROM inventory_items WHERE id=:id AND is_active=TRUE FOR UPDATE"),
                      {"id": payload.item_id}).mappings().first()
    if not item:
        raise HTTPException(404, "Inventory item not found")
    current = Decimal(str(item["quantity"]))
    if payload.quantity > current:
        raise HTTPException(409, f"Cannot return {payload.quantity}; only {current} {item['unit']} is in stock")
    new_quantity = current - payload.quantity
    amount = payload.quantity * payload.unit_cost
    db.execute(text("UPDATE inventory_items SET quantity=:quantity,updated_at=NOW() WHERE id=:id"),
               {"quantity": new_quantity, "id": payload.item_id})
    reference = payload.reference or "SUP-RET-" + datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
    db.execute(text("""INSERT INTO stock_movements(item_id,movement_type,quantity,unit_cost,reference,notes,created_by)
        VALUES(:item,'supplier_return',:quantity,:cost,:reference,:notes,:user)"""),
        {"item": payload.item_id, "quantity": payload.quantity, "cost": payload.unit_cost,
         "reference": reference, "notes": payload.notes or "Returned stock to supplier", "user": user.id})
    db.execute(text("""INSERT INTO supplier_ledger(supplier_id,entry_type,amount,reference,notes,created_by)
        VALUES(:supplier,'return',:amount,:reference,:notes,:user)"""),
        {"supplier": payload.supplier_id, "amount": amount, "reference": reference,
         "notes": payload.notes or f"Returned {payload.quantity} {item['unit']} of {item['name']}", "user": user.id})
    db.commit()
    return {"reference": reference, "item_id": payload.item_id, "previous_quantity": str(current),
            "quantity": str(new_quantity), "return_amount": str(amount)}


@router.get("/purchases")
def list_purchases(db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    rows = db.execute(text("""SELECT p.*,s.name supplier_name FROM purchase_orders p
        JOIN suppliers s ON s.id=p.supplier_id ORDER BY p.ordered_at DESC LIMIT 300""")).mappings().all()
    return [dict(r) for r in rows]


@router.get("/recipes")
def list_recipes(db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    rows = db.execute(text("""SELECT r.id,r.menu_item_id,m.name menu_item_name,r.yield_quantity,r.instructions,
        COALESCE(SUM(ri.quantity*i.average_cost),0) recipe_cost,
        COALESCE(json_agg(json_build_object('item_id',i.id,'item_name',i.name,'quantity',ri.quantity,'unit',i.unit,'cost',ri.quantity*i.average_cost))
            FILTER (WHERE ri.id IS NOT NULL),'[]'::json) ingredients
        FROM recipes r JOIN menu_items m ON m.id=r.menu_item_id
        LEFT JOIN recipe_items ri ON ri.recipe_id=r.id LEFT JOIN inventory_items i ON i.id=ri.item_id
        GROUP BY r.id,m.name ORDER BY m.name""")).mappings().all()
    return [dict(r) for r in rows]


@router.post("/recipes")
def save_recipe(payload: RecipeUpdate, db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    if not db.execute(text("SELECT id FROM menu_items WHERE id=:id"), {"id": payload.menu_item_id}).first():
        raise HTTPException(404, "Menu item not found")
    for line in payload.items:
        if not db.execute(text("SELECT id FROM inventory_items WHERE id=:id AND is_active=TRUE"), {"id": line.item_id}).first():
            raise HTTPException(404, "Ingredient not found")
    recipe = db.execute(text("""INSERT INTO recipes(menu_item_id,yield_quantity,instructions)
        VALUES(:menu,:yield,:instructions) ON CONFLICT(menu_item_id) DO UPDATE SET
        yield_quantity=EXCLUDED.yield_quantity,instructions=EXCLUDED.instructions,updated_at=NOW() RETURNING id"""),
        {"menu": payload.menu_item_id, "yield": payload.yield_quantity, "instructions": payload.instructions}).first()
    db.execute(text("DELETE FROM recipe_items WHERE recipe_id=:id"), {"id": recipe.id})
    ingredient_quantities: dict[str, Decimal] = {}
    for line in payload.items:
        ingredient_quantities[line.item_id] = ingredient_quantities.get(line.item_id, Decimal("0")) + line.quantity
    for item_id, quantity in ingredient_quantities.items():
        db.execute(text("INSERT INTO recipe_items(recipe_id,item_id,quantity) VALUES(:recipe,:item,:qty)"),
                   {"recipe": recipe.id, "item": item_id, "qty": quantity})
    db.commit()
    return {"id": recipe.id, "ingredients": len(ingredient_quantities)}


@router.get("/expenses")
def list_detailed_expenses(db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    rows = db.execute(text("""SELECT e.*,s.name supplier_name FROM expenses e LEFT JOIN suppliers s ON s.id=e.supplier_id
        ORDER BY e.expense_date DESC LIMIT 500""")).mappings().all()
    return [dict(r) for r in rows]


@router.post("/expenses")
def create_detailed_expense(payload: ExpenseCreate, db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    if payload.payment_status not in {"paid", "unpaid", "partial"}:
        raise HTTPException(422, "Invalid payment status")
    row = db.execute(text("""INSERT INTO expenses(category,description,amount,expense_date,created_by,department,
        payment_status,supplier_id,receipt_reference,notes)
        VALUES(:category,:description,:amount,:date,:user,:department,:status,:supplier,:receipt,:notes) RETURNING *"""),
        {"category": payload.category, "description": payload.description, "amount": payload.amount,
         "date": payload.expense_date or datetime.utcnow(), "user": user.id, "department": payload.department,
         "status": payload.payment_status, "supplier": payload.supplier_id,
         "receipt": payload.receipt_reference, "notes": payload.notes}).mappings().first()
    db.commit()
    return dict(row)


@router.get("/reports/profit-loss")
def profit_loss(start: date = Query(default_factory=lambda: date.today().replace(day=1)),
                end: date = Query(default_factory=date.today), db: Session = Depends(get_db),
                user=Depends(require_roles(*MANAGERS))):
    if end < start:
        raise HTTPException(422, "End date must not be before start date")
    sales = db.execute(text("""SELECT COALESCE(SUM(grand_total),0) total,
        COALESCE(SUM(subtotal),0) gross_sales, COALESCE(SUM(discount_amount),0) discounts,
        COALESCE(SUM(tax_amount),0) tax, COALESCE(SUM(service_charge_amount),0) service_charge,
        COUNT(*) bill_count FROM bills WHERE created_at::date BETWEEN :start AND :end"""),
        {"start": start, "end": end}).mappings().one()
    expenses = db.execute(text("""SELECT COALESCE(SUM(amount),0) total,
        COALESCE(json_agg(json_build_object('category',category,'amount',amount,'department',department)),'[]'::json) breakdown
        FROM expenses WHERE expense_date::date BETWEEN :start AND :end"""), {"start": start, "end": end}).mappings().one()
    payroll = db.execute(text("""SELECT COALESCE(SUM(gross_pay),0) FROM payroll_entries
        WHERE period_end BETWEEN :start AND :end"""), {"start": start, "end": end}).scalar_one()
    snapshot_cogs = db.execute(text("""SELECT COALESCE(SUM(s.total_cost),0)
        FROM bill_cost_snapshots s JOIN bills b ON b.id=s.bill_id
        WHERE b.created_at::date BETWEEN :start AND :end"""),
        {"start": start, "end": end}).scalar_one()
    # Older bills created before snapshots existed retain a clearly labelled current-cost estimate.
    legacy_cogs = db.execute(text("""SELECT COALESCE(SUM(ri.quantity * oi.quantity * i.average_cost / r.yield_quantity),0)
        FROM bills b JOIN orders o ON o.id=b.order_id
        JOIN order_items oi ON oi.order_id=o.id AND oi.is_cancelled=FALSE
        JOIN recipes r ON r.menu_item_id=oi.menu_item_id
        JOIN recipe_items ri ON ri.recipe_id=r.id
        JOIN inventory_items i ON i.id=ri.item_id
        WHERE b.created_at::date BETWEEN :start AND :end
          AND NOT EXISTS (SELECT 1 FROM bill_cost_snapshots s WHERE s.bill_id=b.id)"""),
        {"start": start, "end": end}).scalar_one()
    cogs = Decimal(str(snapshot_cogs)) + Decimal(str(legacy_cogs))
    refunds = db.execute(text("""SELECT COALESCE(SUM(r.amount),0) FROM bill_refunds r
        JOIN bills b ON b.id=r.bill_id WHERE b.created_at::date BETWEEN :start AND :end"""),
        {"start": start, "end": end}).scalar_one()
    # Bill grand_total already has discounts deducted and tax/service added.
    # Revenue excludes tax collected; do not subtract the discount a second time.
    net_sales = Decimal(str(sales["gross_sales"])) - Decimal(str(sales["discounts"])) - Decimal(str(refunds))
    gross_profit = net_sales - Decimal(str(cogs))
    payroll_expense = Decimal(str(payroll))
    total_operating_expenses = Decimal(str(expenses["total"])) + payroll_expense
    operating_profit = gross_profit - total_operating_expenses
    return {"period": {"start": start, "end": end}, "bill_count": sales["bill_count"],
        "gross_billed": str(sales["total"]), "gross_sales_before_discount": str(sales["gross_sales"]),
        "discounts": str(sales["discounts"]), "refunds": str(refunds), "tax_collected": str(sales["tax"]),
        "service_charge": str(sales["service_charge"]), "net_sales": str(net_sales),
        "cost_of_goods_sold_estimate": str(cogs), "gross_profit_estimate": str(gross_profit),
        "operating_expenses": str(expenses["total"]), "payroll_expense": str(payroll_expense),
        "total_operating_expenses": str(total_operating_expenses),
        "operating_profit_estimate": str(operating_profit),
        "expense_breakdown": expenses["breakdown"],
        "note": "New bills use ingredient cost snapshots captured at finalization. Older bills without snapshots use current average costs as estimates; this is not an audited financial statement."}


@router.get("/reports/stock")
def stock_report(db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    rows = db.execute(text("""SELECT name,category,unit,quantity,reorder_level,average_cost,
        quantity*average_cost stock_value,(quantity<=reorder_level) low_stock,expiry_date
        FROM inventory_items WHERE is_active=TRUE ORDER BY category,name""")).mappings().all()
    return {"items": [dict(r) for r in rows], "total_stock_value": str(sum((r["stock_value"] for r in rows), Decimal("0"))),
            "low_stock_count": sum(1 for r in rows if r["low_stock"])}


@router.get("/reports/stock.csv")
def stock_csv(db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    rows = db.execute(text("SELECT name,sku,category,unit,quantity,reorder_level,average_cost,quantity*average_cost stock_value FROM inventory_items WHERE is_active=TRUE ORDER BY name")).mappings().all()
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["name","sku","category","unit","quantity","reorder_level","average_cost","stock_value"])
    writer.writeheader()
    for row in rows:
        writer.writerow({k: str(v) if v is not None else "" for k,v in row.items()})
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=royal-skye-stock-report.csv"})


@router.get("/staff/attendance")
def attendance(db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    rows = db.execute(text("""SELECT a.*,u.full_name,u.username FROM staff_attendance a JOIN users u ON u.id=a.user_id
        ORDER BY a.clock_in DESC LIMIT 300""")).mappings().all()
    return [dict(r) for r in rows]


@router.post("/staff/clock-in")
def clock_in(payload: AttendanceCreate, db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    active = db.execute(text("SELECT id FROM staff_attendance WHERE user_id=:id AND clock_out IS NULL"), {"id": payload.user_id}).first()
    if active:
        raise HTTPException(409, "Staff member already has an open shift")
    row = db.execute(text("INSERT INTO staff_attendance(user_id,notes) VALUES(:id,:notes) RETURNING *"),
                     {"id": payload.user_id, "notes": payload.notes}).mappings().first()
    db.commit()
    return dict(row)


@router.post("/staff/{attendance_id}/clock-out")
def clock_out(attendance_id: str, db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    row = db.execute(text("UPDATE staff_attendance SET clock_out=NOW() WHERE id=:id AND clock_out IS NULL RETURNING *"),
                     {"id": attendance_id}).mappings().first()
    if not row:
        raise HTTPException(404, "Open attendance record not found")
    db.commit()
    return dict(row)


@router.get("/staff/payroll")
def list_payroll(db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    rows = db.execute(text("""SELECT p.*,u.full_name FROM payroll_entries p JOIN users u ON u.id=p.user_id
        ORDER BY p.period_end DESC LIMIT 300""")).mappings().all()
    return [dict(r) for r in rows]


@router.post("/staff/payroll")
def create_payroll(payload: PayrollCreate, db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    if payload.period_end < payload.period_start or payload.deductions > payload.gross_pay:
        raise HTTPException(422, "Invalid payroll period or deductions")
    row = db.execute(text("""INSERT INTO payroll_entries(user_id,period_start,period_end,gross_pay,deductions,notes)
        VALUES(:user,:start,:end,:gross,:deductions,:notes) RETURNING *"""),
        {"user": payload.user_id, "start": payload.period_start, "end": payload.period_end,
         "gross": payload.gross_pay, "deductions": payload.deductions, "notes": payload.notes}).mappings().first()
    db.commit()
    return dict(row)


@router.post("/staff/payroll/{payroll_id}/pay")
def mark_payroll_paid(payroll_id: str, db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    row = db.execute(text("""UPDATE payroll_entries SET paid_at=NOW()
        WHERE id=:id AND paid_at IS NULL RETURNING *"""), {"id": payroll_id}).mappings().first()
    if not row:
        existing = db.execute(text("SELECT paid_at FROM payroll_entries WHERE id=:id"), {"id": payroll_id}).mappings().first()
        if not existing:
            raise HTTPException(404, "Payroll entry not found")
        raise HTTPException(409, "Payroll entry is already marked as paid")
    db.commit()
    return dict(row)


@router.post("/reservations")
def create_reservation(payload: ReservationCreate, db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    reserved_for = payload.reserved_for
    if reserved_for.tzinfo is not None:
        from datetime import timezone
        reserved_for = reserved_for.astimezone(timezone.utc).replace(tzinfo=None)
    if reserved_for < datetime.utcnow():
        raise HTTPException(422, "Reservation must be in the future")
    if payload.table_id and not db.execute(text("SELECT id FROM tables WHERE id=:id AND is_active=TRUE"), {"id": payload.table_id}).first():
        raise HTTPException(404, "Selected table not found")
    row = db.execute(text("""INSERT INTO reservations(customer_name,phone,party_size,reserved_for,table_id,notes)
        VALUES(:name,:phone,:size,:date,:table,:notes) RETURNING *"""),
        {"name": payload.customer_name, "phone": payload.phone, "size": payload.party_size,
         "date": reserved_for, "table": payload.table_id, "notes": payload.notes}).mappings().first()
    db.commit()
    return dict(row)


@router.get("/reservations")
def list_reservations(db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    rows = db.execute(text("SELECT * FROM reservations ORDER BY reserved_for DESC LIMIT 300")).mappings().all()
    return [dict(r) for r in rows]


@router.patch("/reservations/{reservation_id}/status")
def update_reservation(reservation_id: str, status: str = Query(pattern="^(booked|seated|cancelled|completed)$"),
                       db: Session = Depends(get_db), user=Depends(require_roles(*MANAGERS))):
    row = db.execute(text("UPDATE reservations SET status=:status WHERE id=:id RETURNING *"),
                     {"status": status, "id": reservation_id}).mappings().first()
    if not row:
        raise HTTPException(404, "Reservation not found")
    db.commit()
    return dict(row)
