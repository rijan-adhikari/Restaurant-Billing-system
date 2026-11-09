import random
import string
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.database import get_db
from app import models, schemas
from app.deps import get_current_user, require_roles
from app.websocket import manager
from app.billing_math import calculate_bill

router = APIRouter(prefix="/api", tags=["orders-kot"])
CABIN_SURCHARGE_RATE = Decimal("0.05")
CABIN_FEE = Decimal("500.00")


def _next_number(prefix: str) -> str:
    stamp = datetime.utcnow().strftime("%y%m%d")
    suffix = "".join(random.choices(string.digits, k=4))
    return f"{prefix}-{stamp}-{suffix}"


@router.post("/orders", response_model=schemas.OrderOut)
async def create_order(payload: schemas.OrderCreate, db: Session = Depends(get_db),
                        user=Depends(require_roles(models.RoleName.admin, models.RoleName.manager,
                                                    models.RoleName.waiter, models.RoleName.cashier))):
    service_type = payload.service_type
    if not payload.delivery_fee.is_finite() or payload.delivery_fee < 0:
        raise HTTPException(status_code=422, detail="Delivery fee must be a non-negative finite amount")
    if service_type == "dine_in":
        if not payload.table_id:
            raise HTTPException(status_code=422, detail="Choose a table for dine-in orders")
        table = db.query(models.DiningTable).filter(models.DiningTable.id == payload.table_id).first()
        if not table:
            raise HTTPException(status_code=404, detail="Table not found")
    else:
        if service_type == "delivery" and not (payload.delivery_address or "").strip():
            raise HTTPException(status_code=422, detail="Delivery address is required")
        table = db.query(models.DiningTable).filter(models.DiningTable.name == "Service Orders").first()
        if not table:
            floor = db.query(models.Floor).filter(models.Floor.is_active.is_(True)).order_by(models.Floor.sort_order).first()
            if not floor:
                raise HTTPException(status_code=409, detail="Create an active floor before taking service orders")
            table = models.DiningTable(floor_id=floor.id, name="Service Orders", capacity=0,
                                       status=models.TableStatus.available, sort_order=9999)
            db.add(table)
            db.flush()

    # Dine-in orders reuse a table session; takeaway and delivery always create separate tickets.
    order = None
    if service_type == "dine_in":
        order = db.query(models.Order).filter(
            models.Order.table_id == table.id,
            models.Order.status == models.OrderStatus.open,
        ).first()
    if not order:
        order = models.Order(order_number=_next_number("ORD"), table_id=table.id,
                              waiter_id=user.id, status=models.OrderStatus.open)
        db.add(order)
        db.flush()
        if service_type == "dine_in":
            table.status = models.TableStatus.occupied
        else:
            db.execute(text("""INSERT INTO order_service_details(order_id,service_type,customer_name,phone,delivery_address,delivery_fee)
                VALUES(:order,:type,:name,:phone,:address,:fee)"""),
                {"order": order.id, "type": service_type, "name": payload.customer_name,
                 "phone": payload.phone, "address": payload.delivery_address,
                 "fee": payload.delivery_fee if service_type == "delivery" else Decimal("0")})

    is_cabin_order = service_type == "dine_in" and "cabin" in (table.name or "").lower()
    kitchen_items, bar_items = [], []
    for line in payload.items:
        menu_item = db.query(models.MenuItem).filter(models.MenuItem.id == line.menu_item_id).first()
        if not menu_item:
            raise HTTPException(status_code=404, detail=f"Menu item {line.menu_item_id} not found")
        unit_price = menu_item.price
        if is_cabin_order:
            unit_price = (menu_item.price * (Decimal("1") + CABIN_SURCHARGE_RATE)).quantize(Decimal("0.01"))
        order_item = models.OrderItem(order_id=order.id, menu_item_id=menu_item.id,
                                       quantity=line.quantity, unit_price=unit_price, notes=line.notes)
        db.add(order_item)
        db.flush()
        target = kitchen_items if menu_item.destination == models.RouteDestination.kitchen else bar_items
        target.append((order_item, line.quantity, line.notes))

    for station, lines in ((models.RouteDestination.kitchen, kitchen_items),
                            (models.RouteDestination.bar, bar_items)):
        if not lines:
            continue
        kot = models.KOT(kot_number=_next_number("KOT"), order_id=order.id, station=station,
                          status=models.KOTStatus.new)
        db.add(kot)
        db.flush()
        for order_item, qty, notes in lines:
            db.add(models.KOTItem(kot_id=kot.id, order_item_id=order_item.id, quantity=qty, notes=notes))
        await manager.broadcast({"type": "new_kot", "station": station.value, "kot_number": kot.kot_number,
                                  "table": service_type.replace("_", " ").title() if service_type != "dine_in" else table.name})

    db.commit()
    db.refresh(order)
    return order


@router.get("/orders/open")
def list_open_orders(db: Session = Depends(get_db),
                     user=Depends(require_roles(models.RoleName.admin, models.RoleName.manager,
                                                 models.RoleName.cashier))):
    orders = db.query(models.Order).filter(models.Order.status == models.OrderStatus.open).all()
    tax_setting = db.query(models.TaxSetting).first()
    result = []
    for order in orders:
        subtotal = sum((Decimal(item.unit_price) * item.quantity for item in order.items if not item.is_cancelled), Decimal("0"))
        service_details = db.execute(text("SELECT * FROM order_service_details WHERE order_id=:id"), {"id": order.id}).mappings().first()
        if service_details:
            subtotal += Decimal(str(service_details["delivery_fee"]))
        if order.table and "cabin" in order.table.name.lower():
            subtotal += CABIN_FEE
        tax_enabled = bool(tax_setting and tax_setting.tax_enabled)
        tax_percent = Decimal(tax_setting.tax_percent) if tax_setting else Decimal("0")
        service_enabled = bool(tax_setting and tax_setting.service_charge_enabled)
        service_percent = Decimal(tax_setting.service_charge_percent) if tax_setting else Decimal("0")
        totals = calculate_bill(subtotal, Decimal("0"), tax_enabled, tax_percent,
                                service_enabled, service_percent)
        result.append({
            "id": order.id,
            "order_number": order.order_number,
            "table_name": service_details["service_type"].title() if service_details else (order.table.name if order.table else ""),
            "service_type": service_details["service_type"] if service_details else "dine_in",
            "customer_name": service_details["customer_name"] if service_details else None,
            "phone": service_details["phone"] if service_details else None,
            "delivery_address": service_details["delivery_address"] if service_details else None,
            "delivery_fee": str(service_details["delivery_fee"]) if service_details else "0.00",
            "subtotal": str(totals["subtotal"]),
            "tax_amount": str(totals["tax_amount"]),
            "tax_percent": str(tax_percent),
            "service_charge_amount": str(totals["service_charge_amount"]),
            "service_charge_percent": str(service_percent),
            "grand_total": str(totals["grand_total"]),
            "cabin_fee": str(CABIN_FEE) if order.table and "cabin" in order.table.name.lower() else "0.00",
            "items": [{
                "name": item.menu_item.name,
                "quantity": item.quantity,
                "unit_price": str(item.unit_price),
                "total": str(Decimal(item.unit_price) * item.quantity),
            } for item in order.items if not item.is_cancelled],
        })
    return result


@router.patch("/orders/{order_id}/cancel")
def cancel_order(order_id: str, db: Session = Depends(get_db),
                user=Depends(require_roles(models.RoleName.admin, models.RoleName.manager,
                                            models.RoleName.waiter))):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != models.OrderStatus.open:
        raise HTTPException(status_code=400, detail="Only open orders can be cancelled")
    order.status = models.OrderStatus.cancelled
    for item in order.items:
        item.is_cancelled = True
    for kot in order.kots:
        if kot.status not in (models.KOTStatus.served, models.KOTStatus.cancelled):
            kot.status = models.KOTStatus.cancelled
    if order.table:
        order.table.status = models.TableStatus.available
    db.commit()
    return {"ok": True, "order_id": order.id}


@router.get("/kots")
def list_kots(station: models.RouteDestination, db: Session = Depends(get_db), user=Depends(require_roles(
    models.RoleName.admin, models.RoleName.manager, models.RoleName.kitchen, models.RoleName.bar,
))):
    kots = db.query(models.KOT).filter(models.KOT.station == station).order_by(models.KOT.created_at.desc()).all()
    result = []
    for kot in kots:
        order = kot.order
        table = order.table if hasattr(order, "table") else None
        service_details = db.execute(text("SELECT * FROM order_service_details WHERE order_id=:id"), {"id": order.id}).mappings().first()
        result.append({
            "id": kot.id, "kot_number": kot.kot_number, "status": kot.status,
            "created_at": kot.created_at, "order_number": order.order_number,
            "table_name": service_details["service_type"].title() if service_details else (order.table.name if order.table else ""),
            "customer_name": service_details["customer_name"] if service_details else None,
            "phone": service_details["phone"] if service_details else None,
            "delivery_address": service_details["delivery_address"] if service_details else None,
            "items": [{"id": i.id, "quantity": i.quantity, "notes": i.notes,
                       "menu_item_name": i.order_item.menu_item.name} for i in kot.items],
        })
    return result


@router.patch("/kots/{kot_id}/status")
async def update_kot_status(kot_id: str, payload: schemas.KOTStatusUpdate, db: Session = Depends(get_db),
                             user=Depends(require_roles(models.RoleName.admin, models.RoleName.manager,
                                                         models.RoleName.kitchen, models.RoleName.bar))):
    kot = db.query(models.KOT).filter(models.KOT.id == kot_id).first()
    if not kot:
        raise HTTPException(status_code=404, detail="KOT not found")
    kot.status = payload.status
    db.commit()
    await manager.broadcast({"type": "kot_status", "kot_id": kot.id, "status": payload.status.value})
    return {"ok": True}


@router.websocket("/ws/updates")
async def ws_updates(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
