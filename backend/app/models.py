import enum
import uuid
from datetime import datetime, date

from sqlalchemy import (
    Column, String, Integer, Boolean, ForeignKey, DateTime, Date, Numeric,
    Text, Enum, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


def gen_uuid():
    return str(uuid.uuid4())


class RoleName(str, enum.Enum):
    admin = "admin"
    manager = "manager"
    waiter = "waiter"
    cashier = "cashier"
    kitchen = "kitchen"
    bar = "bar"


class TableStatus(str, enum.Enum):
    available = "available"
    occupied = "occupied"
    billing = "billing"
    reserved = "reserved"
    cleaning = "cleaning"


class RouteDestination(str, enum.Enum):
    kitchen = "kitchen"
    bar = "bar"


class OrderStatus(str, enum.Enum):
    open = "open"
    billing = "billing"
    completed = "completed"
    cancelled = "cancelled"


class KOTStatus(str, enum.Enum):
    new = "new"
    accepted = "accepted"
    preparing = "preparing"
    ready = "ready"
    served = "served"
    cancelled = "cancelled"


class PaymentMethod(str, enum.Enum):
    cash = "cash"
    card = "card"
    bank_transfer = "bank_transfer"
    qr = "qr"
    credit = "credit"


class User(Base):
    __tablename__ = "users"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    username = Column(String(64), unique=True, nullable=False, index=True)
    full_name = Column(String(128), nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(Enum(RoleName), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    must_change_password = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Floor(Base):
    __tablename__ = "floors"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    name = Column(String(64), nullable=False)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    tables = relationship("DiningTable", back_populates="floor")


class DiningTable(Base):
    __tablename__ = "tables"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    floor_id = Column(UUID(as_uuid=False), ForeignKey("floors.id"), nullable=False)
    name = Column(String(64), nullable=False)
    capacity = Column(Integer, default=4)
    status = Column(Enum(TableStatus), default=TableStatus.available, nullable=False)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    floor = relationship("Floor", back_populates="tables")
    orders = relationship("Order", back_populates="table")


class Category(Base):
    __tablename__ = "categories"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    name = Column(String(64), nullable=False)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    items = relationship("MenuItem", back_populates="category")


class MenuItem(Base):
    __tablename__ = "menu_items"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    category_id = Column(UUID(as_uuid=False), ForeignKey("categories.id"), nullable=False)
    name = Column(String(128), nullable=False)
    description = Column(Text, default="")
    price = Column(Numeric(10, 2), nullable=False)
    destination = Column(Enum(RouteDestination), nullable=False)
    is_available = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)
    category = relationship("Category", back_populates="items")


class Order(Base):
    __tablename__ = "orders"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    order_number = Column(String(32), unique=True, nullable=False)
    table_id = Column(UUID(as_uuid=False), ForeignKey("tables.id"), nullable=False)
    waiter_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)
    status = Column(Enum(OrderStatus), default=OrderStatus.open, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    business_date = Column(Date, nullable=False, default=date.today)
    table = relationship("DiningTable", back_populates="orders")
    items = relationship("OrderItem", back_populates="order")
    kots = relationship("KOT", back_populates="order")


class OrderItem(Base):
    __tablename__ = "order_items"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    order_id = Column(UUID(as_uuid=False), ForeignKey("orders.id"), nullable=False)
    menu_item_id = Column(UUID(as_uuid=False), ForeignKey("menu_items.id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Numeric(10, 2), nullable=False)
    notes = Column(Text, default="")
    is_cancelled = Column(Boolean, default=False)
    order = relationship("Order", back_populates="items")
    menu_item = relationship("MenuItem")


class KOT(Base):
    __tablename__ = "kots"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    kot_number = Column(String(32), unique=True, nullable=False)
    order_id = Column(UUID(as_uuid=False), ForeignKey("orders.id"), nullable=False)
    station = Column(Enum(RouteDestination), nullable=False)
    status = Column(Enum(KOTStatus), default=KOTStatus.new, nullable=False)
    priority = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    order = relationship("Order", back_populates="kots")
    items = relationship("KOTItem", back_populates="kot")


class KOTItem(Base):
    __tablename__ = "kot_items"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    kot_id = Column(UUID(as_uuid=False), ForeignKey("kots.id"), nullable=False)
    order_item_id = Column(UUID(as_uuid=False), ForeignKey("order_items.id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    notes = Column(Text, default="")
    kot = relationship("KOT", back_populates="items")
    order_item = relationship("OrderItem")


class Customer(Base):
    __tablename__ = "customers"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    name = Column(String(128), nullable=False)
    phone = Column(String(32))
    address = Column(String(255))
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class Bill(Base):
    __tablename__ = "bills"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    bill_number = Column(String(32), unique=True, nullable=False)
    order_id = Column(UUID(as_uuid=False), ForeignKey("orders.id"), nullable=False)
    customer_id = Column(UUID(as_uuid=False), ForeignKey("customers.id"), nullable=True)
    subtotal = Column(Numeric(10, 2), nullable=False)
    tax_amount = Column(Numeric(10, 2), nullable=False, default=0)
    service_charge_amount = Column(Numeric(10, 2), nullable=False, default=0)
    discount_amount = Column(Numeric(10, 2), nullable=False, default=0)
    grand_total = Column(Numeric(10, 2), nullable=False)
    amount_paid = Column(Numeric(10, 2), nullable=False, default=0)
    outstanding_amount = Column(Numeric(10, 2), nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    business_date = Column(Date, nullable=False, default=date.today)
    sale_status = Column(String(16), nullable=False, default="active")
    voided_at = Column(DateTime, nullable=True)
    voided_by = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    void_reason = Column(Text, default="")
    payments = relationship("Payment", back_populates="bill")


class Payment(Base):
    __tablename__ = "payments"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    bill_id = Column(UUID(as_uuid=False), ForeignKey("bills.id"), nullable=False)
    method = Column(Enum(PaymentMethod), nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    received_by = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    bill = relationship("Bill", back_populates="payments")


class CustomerBalance(Base):
    __tablename__ = "customer_balances"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    customer_id = Column(UUID(as_uuid=False), ForeignKey("customers.id"), nullable=False)
    bill_id = Column(UUID(as_uuid=False), ForeignKey("bills.id"), nullable=False)
    original_amount = Column(Numeric(10, 2), nullable=False)
    remaining_amount = Column(Numeric(10, 2), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class BalanceTransaction(Base):
    __tablename__ = "balance_transactions"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    customer_balance_id = Column(UUID(as_uuid=False), ForeignKey("customer_balances.id"), nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    received_by = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class TaxSetting(Base):
    __tablename__ = "tax_settings"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    tax_enabled = Column(Boolean, default=True)
    tax_percent = Column(Numeric(5, 2), default=14.00)
    service_charge_enabled = Column(Boolean, default=False)
    service_charge_percent = Column(Numeric(5, 2), default=0.00)


class RestaurantSetting(Base):
    __tablename__ = "restaurant_settings"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    name = Column(String(128), default="Royal Skye Birds Restaurant & Bar Cafe")
    email = Column(String(128), default="business.rijan.np@gmail.com")
    phone = Column(String(32), default="")
    address = Column(String(255), default="")
    pan = Column(String(32), default="")
    vat = Column(String(32), default="")
    currency = Column(String(8), default="NPR")
    logo_path = Column(String(255), default="")
    qr_image_path = Column(String(255), default="")
    receipt_footer = Column(Text, default="Thank you for visiting!")


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    action = Column(String(128), nullable=False)
    details = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class Expense(Base):
    __tablename__ = "expenses"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    category = Column(String(64), nullable=False)
    description = Column(String(255), nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    expense_date = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_by = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
