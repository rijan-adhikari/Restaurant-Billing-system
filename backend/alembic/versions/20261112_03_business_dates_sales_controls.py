"""Add business dates and individual sale lifecycle controls.

Revision ID: 20261112_03
Revises: 20261109_02
"""
from alembic import op

revision = "20261112_03"
down_revision = "20261109_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS business_date DATE")
    op.execute("UPDATE orders SET business_date=created_at::date WHERE business_date IS NULL")
    op.execute("ALTER TABLE orders ALTER COLUMN business_date SET DEFAULT CURRENT_DATE")
    op.execute("ALTER TABLE orders ALTER COLUMN business_date SET NOT NULL")
    op.execute("ALTER TABLE bills ADD COLUMN IF NOT EXISTS business_date DATE")
    op.execute("""UPDATE bills b SET business_date=COALESCE(
        (SELECT o.business_date FROM orders o WHERE o.id=b.order_id), b.created_at::date)
        WHERE b.business_date IS NULL""")
    op.execute("ALTER TABLE bills ALTER COLUMN business_date SET DEFAULT CURRENT_DATE")
    op.execute("ALTER TABLE bills ALTER COLUMN business_date SET NOT NULL")
    op.execute("ALTER TABLE bills ADD COLUMN IF NOT EXISTS sale_status VARCHAR(16) NOT NULL DEFAULT 'active'")
    op.execute("ALTER TABLE bills ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP")
    op.execute("ALTER TABLE bills ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id)")
    op.execute("ALTER TABLE bills ADD COLUMN IF NOT EXISTS void_reason TEXT NOT NULL DEFAULT ''")
    op.execute("CREATE INDEX IF NOT EXISTS ix_bills_business_date_status ON bills(business_date,sale_status)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_bills_business_date_status")
    op.execute("ALTER TABLE bills DROP COLUMN IF EXISTS void_reason")
    op.execute("ALTER TABLE bills DROP COLUMN IF EXISTS voided_by")
    op.execute("ALTER TABLE bills DROP COLUMN IF EXISTS voided_at")
    op.execute("ALTER TABLE bills DROP COLUMN IF EXISTS sale_status")
    op.execute("ALTER TABLE bills DROP COLUMN IF EXISTS business_date")
    op.execute("ALTER TABLE orders DROP COLUMN IF EXISTS business_date")
