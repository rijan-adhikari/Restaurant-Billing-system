"""Add takeaway and delivery order details.

Revision ID: 20261109_02
Revises: 20261109_01
"""
from alembic import op

revision = "20261109_02"
down_revision = "20261109_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""CREATE TABLE IF NOT EXISTS order_service_details (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
        service_type VARCHAR(16) NOT NULL CHECK (service_type IN ('takeaway','delivery')),
        customer_name VARCHAR(160), phone VARCHAR(40), delivery_address TEXT,
        delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
        status VARCHAR(24) NOT NULL DEFAULT 'received'
            CHECK (status IN ('received','preparing','ready','out_for_delivery','completed','cancelled')),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_order_service_details_type_status ON order_service_details(service_type,status)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS order_service_details")
