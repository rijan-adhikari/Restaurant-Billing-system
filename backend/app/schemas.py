from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List, Literal

from pydantic import BaseModel

from app.models import RoleName, TableStatus, RouteDestination, OrderStatus, KOTStatus, PaymentMethod


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: RoleName
    full_name: str
    must_change_password: bool


class UserOut(BaseModel):
    id: str
    username: str
    full_name: str
    role: RoleName
    is_active: bool

    class Config:
        from_attributes = True


class UserCreate(BaseModel):
    username: str
    full_name: str
    password: str
    role: RoleName


class PasswordUpdate(BaseModel):
    password: str


class ExpenseCreate(BaseModel):
    category: str
    description: str
    amount: Decimal
    expense_date: datetime | None = None


class FloorOut(BaseModel):
    id: str
    name: str
    sort_order: int
    is_active: bool

    class Config:
        from_attributes = True


class FloorCreate(BaseModel):
    name: str
    sort_order: int = 0


class TableOut(BaseModel):
    id: str
    floor_id: str
    name: str
    capacity: int
    status: TableStatus
    sort_order: int
    is_active: bool

    class Config:
        from_attributes = True


class TableCreate(BaseModel):
    floor_id: str
    name: str
    capacity: int = 4


class CategoryOut(BaseModel):
    id: str
    name: str
    sort_order: int
    is_active: bool

    class Config:
        from_attributes = True


class CategoryCreate(BaseModel):
    name: str
    sort_order: int = 0


class MenuItemOut(BaseModel):
    id: str
    category_id: str
    name: str
    description: str
    price: Decimal
    destination: RouteDestination
    is_available: bool

    class Config:
        from_attributes = True


class MenuItemCreate(BaseModel):
    category_id: str
    name: str
    description: str = ""
    price: Decimal
    destination: RouteDestination
    is_available: bool = True


class OrderItemCreate(BaseModel):
    menu_item_id: str
    quantity: int
    notes: str = ""


class OrderCreate(BaseModel):
    table_id: Optional[str] = None
    service_type: Literal["dine_in", "takeaway", "delivery"] = "dine_in"
    customer_name: Optional[str] = None
    phone: Optional[str] = None
    delivery_address: Optional[str] = None
    delivery_fee: Decimal = Decimal("0")
    business_date: Optional[date] = None
    items: List[OrderItemCreate]


class OrderItemOut(BaseModel):
    id: str
    menu_item_id: str
    quantity: int
    unit_price: Decimal
    notes: str
    is_cancelled: bool

    class Config:
        from_attributes = True


class OrderOut(BaseModel):
    id: str
    order_number: str
    table_id: str
    waiter_id: str
    status: OrderStatus
    created_at: datetime
    items: List[OrderItemOut] = []

    class Config:
        from_attributes = True


class KOTStatusUpdate(BaseModel):
    status: KOTStatus


class PaymentCreate(BaseModel):
    method: PaymentMethod
    amount: Decimal


class BillCreate(BaseModel):
    order_id: str
    customer_id: Optional[str] = None
    discount_percent: Decimal = Decimal("0")
    discount_amount: Decimal = Decimal("0")
    loyalty_points_redeemed: Decimal = Decimal("0")
    payments: List[PaymentCreate] = []


class RepaymentCreate(BaseModel):
    customer_balance_id: str
    amount: Decimal


class CustomerCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    address: Optional[str] = None
    notes: str = ""


class CustomerOut(CustomerCreate):
    id: str

    class Config:
        from_attributes = True


class TaxSettingUpdate(BaseModel):
    tax_enabled: bool
    tax_percent: Decimal
    service_charge_enabled: bool
    service_charge_percent: Decimal
