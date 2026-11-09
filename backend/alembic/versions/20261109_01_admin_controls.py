"""Add administration controls, cash sessions, refunds, supplier ledger and loyalty.

Revision ID: 20261109_01
Revises: 20261109_00
"""
from alembic import op

revision = "20261109_01"
down_revision = "20261109_00"
branch_labels = None
depends_on = None


def upgrade() -> None:
    statements = [
        """CREATE TABLE IF NOT EXISTS cash_drawer_shifts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            opened_by UUID NOT NULL REFERENCES users(id), closed_by UUID REFERENCES users(id),
            opening_float NUMERIC(14,2) NOT NULL CHECK (opening_float >= 0),
            expected_cash NUMERIC(14,2), counted_cash NUMERIC(14,2), cash_difference NUMERIC(14,2),
            status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
            notes TEXT, opened_at TIMESTAMP NOT NULL DEFAULT NOW(), closed_at TIMESTAMP)""",
        """CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_drawer_one_open_shift
            ON cash_drawer_shifts ((status)) WHERE status='open'""",
        """CREATE TABLE IF NOT EXISTS cash_drawer_entries (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            shift_id UUID NOT NULL REFERENCES cash_drawer_shifts(id),
            entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('sale','refund','cash_in','cash_out','payout')),
            amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0), reference VARCHAR(120), notes TEXT,
            created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
        """CREATE TABLE IF NOT EXISTS bill_refunds (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bill_id UUID NOT NULL REFERENCES bills(id),
            amount NUMERIC(14,2) NOT NULL CHECK (amount > 0), reason TEXT NOT NULL,
            method VARCHAR(24) NOT NULL, created_by UUID NOT NULL REFERENCES users(id),
            created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
        """CREATE TABLE IF NOT EXISTS supplier_ledger (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), supplier_id UUID NOT NULL REFERENCES suppliers(id),
            entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('purchase','payment','return','adjustment')),
            amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0), reference VARCHAR(120), notes TEXT,
            created_by UUID REFERENCES users(id), created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
        """CREATE TABLE IF NOT EXISTS loyalty_settings (
            id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id=1),
            spend_per_point NUMERIC(14,2) NOT NULL DEFAULT 100 CHECK (spend_per_point > 0),
            point_value NUMERIC(14,2) NOT NULL DEFAULT 1 CHECK (point_value >= 0),
            enabled BOOLEAN NOT NULL DEFAULT TRUE)""",
        "INSERT INTO loyalty_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING",
        """CREATE TABLE IF NOT EXISTS loyalty_accounts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), customer_id UUID NOT NULL UNIQUE REFERENCES customers(id),
            points_balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
            lifetime_points NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (lifetime_points >= 0),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW())""",
        """CREATE TABLE IF NOT EXISTS loyalty_transactions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), customer_id UUID NOT NULL REFERENCES customers(id),
            bill_id UUID REFERENCES bills(id), points NUMERIC(14,2) NOT NULL,
            transaction_type VARCHAR(16) NOT NULL CHECK (transaction_type IN ('earn','redeem','adjust')),
            notes TEXT, created_by UUID REFERENCES users(id), created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
        "CREATE INDEX IF NOT EXISTS ix_cash_shifts_opened_at ON cash_drawer_shifts(opened_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_refunds_bill_id ON bill_refunds(bill_id)",
        "CREATE INDEX IF NOT EXISTS ix_supplier_ledger_supplier_date ON supplier_ledger(supplier_id,created_at DESC)",
    ]
    for statement in statements:
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS loyalty_transactions")
    op.execute("DROP TABLE IF EXISTS loyalty_accounts")
    op.execute("DROP TABLE IF EXISTS loyalty_settings")
    op.execute("DROP TABLE IF EXISTS supplier_ledger")
    op.execute("DROP TABLE IF EXISTS bill_refunds")
    op.execute("DROP TABLE IF EXISTS cash_drawer_entries")
    op.execute("DROP TABLE IF EXISTS cash_drawer_shifts")
