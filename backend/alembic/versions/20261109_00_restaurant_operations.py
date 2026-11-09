"""Create restaurant operations tables.

Revision ID: 20261109_00
Revises:
"""
from alembic import op

revision = "20261109_00"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    statements = [
        """CREATE TABLE IF NOT EXISTS suppliers (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(160) NOT NULL,
            phone VARCHAR(40), email VARCHAR(160), address TEXT, tax_number VARCHAR(64),
            notes TEXT, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
        """CREATE TABLE IF NOT EXISTS inventory_items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(160) NOT NULL UNIQUE,
            sku VARCHAR(64) UNIQUE, category VARCHAR(80) NOT NULL DEFAULT 'General', unit VARCHAR(24) NOT NULL,
            quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
            reorder_level NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
            average_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (average_cost >= 0),
            supplier_id UUID REFERENCES suppliers(id), expiry_date DATE, is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW())""",
        """CREATE TABLE IF NOT EXISTS stock_movements (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), item_id UUID NOT NULL REFERENCES inventory_items(id),
            movement_type VARCHAR(24) NOT NULL CHECK (movement_type IN ('opening','purchase','consumption','waste','adjustment','return','supplier_return')),
            quantity NUMERIC(14,3) NOT NULL, unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
            reference VARCHAR(120), notes TEXT, created_by UUID REFERENCES users(id), created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
        """CREATE TABLE IF NOT EXISTS purchase_orders (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_number VARCHAR(40) NOT NULL UNIQUE,
            supplier_id UUID NOT NULL REFERENCES suppliers(id), status VARCHAR(20) NOT NULL DEFAULT 'draft',
            subtotal NUMERIC(14,2) NOT NULL DEFAULT 0, notes TEXT, ordered_at TIMESTAMP NOT NULL DEFAULT NOW(),
            received_at TIMESTAMP, created_by UUID REFERENCES users(id))""",
        """CREATE TABLE IF NOT EXISTS purchase_order_items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
            item_id UUID NOT NULL REFERENCES inventory_items(id),
            quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
            unit_cost NUMERIC(14,2) NOT NULL CHECK (unit_cost >= 0), line_total NUMERIC(14,2) NOT NULL)""",
        """CREATE TABLE IF NOT EXISTS recipes (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            menu_item_id UUID NOT NULL UNIQUE REFERENCES menu_items(id) ON DELETE CASCADE,
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
        "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS department VARCHAR(80) NOT NULL DEFAULT 'General'",
        "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'paid'",
        "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id)",
        "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_reference VARCHAR(255)",
        "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS notes TEXT",
        "CREATE INDEX IF NOT EXISTS ix_stock_movements_item_date ON stock_movements(item_id,created_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_purchase_orders_date ON purchase_orders(ordered_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_reservations_date ON reservations(reserved_for)",
        "CREATE INDEX IF NOT EXISTS ix_bill_cost_snapshots_bill ON bill_cost_snapshots(bill_id)",
    ]
    for statement in statements:
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS bill_cost_snapshots")
    op.execute("DROP TABLE IF EXISTS reservations")
    op.execute("DROP TABLE IF EXISTS payroll_entries")
    op.execute("DROP TABLE IF EXISTS staff_attendance")
    op.execute("DROP TABLE IF EXISTS recipe_items")
    op.execute("DROP TABLE IF EXISTS recipes")
    op.execute("DROP TABLE IF EXISTS purchase_order_items")
    op.execute("DROP TABLE IF EXISTS purchase_orders")
    op.execute("DROP TABLE IF EXISTS stock_movements")
    op.execute("DROP TABLE IF EXISTS inventory_items")
    op.execute("DROP TABLE IF EXISTS suppliers")
