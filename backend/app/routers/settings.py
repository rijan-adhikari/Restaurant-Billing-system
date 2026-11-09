from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import get_current_user, require_roles
from app.security import hash_password

router = APIRouter(prefix="/api", tags=["settings-users"])


class UserAdminUpdate(BaseModel):
    role: Optional[models.RoleName] = None
    is_active: Optional[bool] = None


class RestaurantSettingsUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    email: str = ""
    phone: str = ""
    address: str = ""
    pan: str = ""
    vat: str = ""
    currency: str = "NPR"
    logo_path: str = ""
    qr_image_path: str = ""
    receipt_footer: str = "Thank you for visiting!"


@router.get("/settings/tax")
def get_tax_setting(db: Session = Depends(get_db), user=Depends(get_current_user)):
    t = db.query(models.TaxSetting).first()
    return {"tax_enabled": t.tax_enabled, "tax_percent": str(t.tax_percent),
            "service_charge_enabled": t.service_charge_enabled,
            "service_charge_percent": str(t.service_charge_percent)}


@router.put("/settings/tax")
def update_tax_setting(payload: schemas.TaxSettingUpdate, db: Session = Depends(get_db),
                        user=Depends(require_roles(models.RoleName.admin))):
    t = db.query(models.TaxSetting).first()
    if (not payload.tax_percent.is_finite() or not payload.service_charge_percent.is_finite()
            or not (0 <= payload.tax_percent <= 100)
            or not (0 <= payload.service_charge_percent <= 100)):
        raise HTTPException(status_code=422, detail="Tax and service charge percentages must be between 0 and 100")
    t.tax_enabled = payload.tax_enabled
    t.tax_percent = payload.tax_percent
    t.service_charge_enabled = payload.service_charge_enabled
    t.service_charge_percent = payload.service_charge_percent
    db.commit()
    return {"ok": True}


@router.get("/settings/restaurant")
def get_restaurant_setting(db: Session = Depends(get_db), user=Depends(get_current_user)):
    r = db.query(models.RestaurantSetting).first()
    return {
        "name": r.name, "email": r.email, "phone": r.phone, "address": r.address,
        "pan": r.pan, "vat": r.vat, "currency": r.currency,
        "logo_path": r.logo_path, "qr_image_path": r.qr_image_path, "receipt_footer": r.receipt_footer,
    }


@router.put("/settings/restaurant")
def update_restaurant_setting(payload: RestaurantSettingsUpdate, db: Session = Depends(get_db),
                              user=Depends(require_roles(models.RoleName.admin))):
    setting = db.query(models.RestaurantSetting).first()
    if not setting:
        setting = models.RestaurantSetting()
        db.add(setting)
    for key, value in payload.model_dump().items():
        setattr(setting, key, value.strip() if isinstance(value, str) else value)
    db.commit()
    return {"ok": True}


@router.get("/users", response_model=list[schemas.UserOut])
def list_users(db: Session = Depends(get_db), user=Depends(require_roles(models.RoleName.admin))):
    return db.query(models.User).order_by(models.User.created_at.desc()).all()


@router.post("/users", response_model=schemas.UserOut)
def create_user(payload: schemas.UserCreate, db: Session = Depends(get_db),
                 user=Depends(require_roles(models.RoleName.admin))):
    new_user = models.User(
        username=payload.username, full_name=payload.full_name,
        password_hash=hash_password(payload.password), role=payload.role,
        must_change_password=True,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@router.patch("/users/{user_id}/password")
def change_user_password(user_id: str, payload: schemas.PasswordUpdate, db: Session = Depends(get_db),
                         user=Depends(require_roles(models.RoleName.admin))):
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    target = db.query(models.User).filter(models.User.id == user_id, models.User.is_active.is_(True)).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target.password_hash = hash_password(payload.password)
    target.must_change_password = True
    db.commit()
    return {"ok": True}


@router.delete("/users/{user_id}")
def remove_user(user_id: str, db: Session = Depends(get_db),
               user=Depends(require_roles(models.RoleName.admin))):
    if user_id == user.id:
        raise HTTPException(status_code=400, detail="You cannot remove the current admin account")
    target = db.query(models.User).filter(models.User.id == user_id, models.User.is_active.is_(True)).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target.is_active = False
    db.commit()
    return {"ok": True}
