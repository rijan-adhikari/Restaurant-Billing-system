import random
import string
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import get_current_user, require_roles
from app.websocket import manager

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
    table = db.query(models.DiningTable).filter(models.DiningTable.id == payload.table_id).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")

    # Reuse an existing open order on this table so multiple KOTs link to one session
    order = db.query(models.Order).filter(
        models.Order.table_id == payload.table_id,
        models.Order.status == models.OrderStatus.open,
    ).first()
    if not order:
        order = models.Order(order_number=_next_number("ORD"), table_id=payload.table_id,
                              waiter_id=user.id, status=models.OrderStatus.open)
        db.add(order)
        db.flush()
        table.status = models.TableStatus.occupied

    is_cabin_order = "cabin" in (table.name or "").lower()
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
                                  "table": table.name})

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
        if order.table and "cabin" in order.table.name.lower():
            subtotal += CABIN_FEE
        tax = Decimal("0")
        if tax_setting and tax_setting.tax_enabled:
            tax = (subtotal * Decimal(tax_setting.tax_percent) / Decimal("100")).quantize(Decimal("0.01"))
        grand_total = subtotal + tax
        result.append({
            "id": order.id,
            "order_number": order.order_number,
            "table_name": order.table.name if order.table else "",
            "subtotal": str(subtotal.quantize(Decimal("0.01"))),
            "grand_total": str(grand_total.quantize(Decimal("0.01"))),
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
        result.append({
            "id": kot.id, "kot_number": kot.kot_number, "status": kot.status,
            "created_at": kot.created_at, "order_number": order.order_number,
            "table_name": order.table.name if order.table else "",
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
