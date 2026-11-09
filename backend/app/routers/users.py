from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.deps import require_roles
from app.security import hash_password

router = APIRouter(prefix="/api/users", tags=["users"])
ADMIN = (models.RoleName.admin,)


class UserUpdate(BaseModel):
    role: models.RoleName | None = None
    is_active: bool | None = None


@router.get("", response_model=list[schemas.UserOut])
def list_users(db: Session = Depends(get_db), user=Depends(require_roles(*ADMIN))):
    return db.query(models.User).order_by(models.User.full_name).all()


@router.post("", response_model=schemas.UserOut)
def create_user(payload: schemas.UserCreate, db: Session = Depends(get_db),
                user=Depends(require_roles(*ADMIN))):
    username = payload.username.strip()
    if len(payload.password) < 8:
        raise HTTPException(422, "Temporary password must contain at least 8 characters")
    if db.query(models.User).filter(models.User.username == username).first():
        raise HTTPException(409, "Username is already in use")
    member = models.User(username=username, full_name=payload.full_name.strip(),
                         password_hash=hash_password(payload.password), role=payload.role,
                         is_active=True, must_change_password=True)
    db.add(member)
    db.flush()
    db.add(models.AuditLog(user_id=user.id, action="staff.created",
                           details=f"Created staff account {username} ({payload.role.value})"))
    db.commit()
    db.refresh(member)
    return member


@router.patch("/{user_id}", response_model=schemas.UserOut)
def update_user(user_id: str, payload: UserUpdate, db: Session = Depends(get_db),
                user=Depends(require_roles(*ADMIN))):
    member = db.query(models.User).filter(models.User.id == user_id).first()
    if not member:
        raise HTTPException(404, "Staff account not found")
    changes = payload.model_dump(exclude_unset=True)
    if member.id == user.id and changes.get("is_active") is False:
        raise HTTPException(409, "You cannot disable your own account")
    if changes.get("is_active") is False and member.role == models.RoleName.admin:
        active_admins = db.query(models.User).filter(
            models.User.role == models.RoleName.admin, models.User.is_active.is_(True)).count()
        if active_admins <= 1:
            raise HTTPException(409, "The last active administrator cannot be disabled")
    for key, value in changes.items():
        setattr(member, key, value)
    db.add(models.AuditLog(user_id=user.id, action="staff.updated",
                           details=f"Updated staff account {member.username}: {', '.join(changes.keys())}"))
    db.commit()
    db.refresh(member)
    return member


@router.patch("/{user_id}/password")
def change_user_password(user_id: str, payload: schemas.PasswordUpdate,
                         db: Session = Depends(get_db), user=Depends(require_roles(*ADMIN))):
    if len(payload.password) < 8:
        raise HTTPException(422, "Password must contain at least 8 characters")
    member = db.query(models.User).filter(models.User.id == user_id).first()
    if not member:
        raise HTTPException(404, "Staff account not found")
    member.password_hash = hash_password(payload.password)
    member.must_change_password = True
    db.add(models.AuditLog(user_id=user.id, action="staff.password_changed",
                           details=f"Changed password for {member.username}"))
    db.commit()
    return {"ok": True}


@router.delete("/{user_id}")
def disable_user(user_id: str, db: Session = Depends(get_db),
                 user=Depends(require_roles(*ADMIN))):
    member = db.query(models.User).filter(models.User.id == user_id).first()
    if not member:
        raise HTTPException(404, "Staff account not found")
    if member.id == user.id:
        raise HTTPException(409, "You cannot disable your own account")
    if member.role == models.RoleName.admin and member.is_active:
        active_admins = db.query(models.User).filter(
            models.User.role == models.RoleName.admin, models.User.is_active.is_(True)).count()
        if active_admins <= 1:
            raise HTTPException(409, "The last active administrator cannot be disabled")
    member.is_active = False
    db.add(models.AuditLog(user_id=user.id, action="staff.disabled",
                           details=f"Disabled staff account {member.username}; historical records retained"))
    db.commit()
    return {"ok": True, "disabled": True}
