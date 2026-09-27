from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import get_current_user, require_roles

router = APIRouter(prefix="/api", tags=["floors-tables"])


@router.get("/floors", response_model=list[schemas.FloorOut])
def list_floors(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return db.query(models.Floor).order_by(models.Floor.sort_order).all()


@router.post("/floors", response_model=schemas.FloorOut)
def create_floor(payload: schemas.FloorCreate, db: Session = Depends(get_db),
                  user=Depends(require_roles(models.RoleName.admin))):
    floor = models.Floor(name=payload.name, sort_order=payload.sort_order)
    db.add(floor)
    db.commit()
    db.refresh(floor)
    return floor


@router.get("/tables", response_model=list[schemas.TableOut])
def list_tables(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return db.query(models.DiningTable).order_by(models.DiningTable.sort_order).all()


@router.post("/tables", response_model=schemas.TableOut)
def create_table(payload: schemas.TableCreate, db: Session = Depends(get_db),
                  user=Depends(require_roles(models.RoleName.admin))):
    table = models.DiningTable(floor_id=payload.floor_id, name=payload.name, capacity=payload.capacity)
    db.add(table)
    db.commit()
    db.refresh(table)
    return table


@router.patch("/tables/{table_id}/status", response_model=schemas.TableOut)
def update_table_status(table_id: str, status: models.TableStatus, db: Session = Depends(get_db),
                         user=Depends(require_roles(models.RoleName.admin, models.RoleName.manager,
                                                     models.RoleName.waiter, models.RoleName.cashier))):
    table = db.query(models.DiningTable).filter(models.DiningTable.id == table_id).first()
    table.status = status
    db.commit()
    db.refresh(table)
    return table
