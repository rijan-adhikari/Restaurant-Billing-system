from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from io import BytesIO
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import get_current_user, require_roles

router = APIRouter(prefix="/api", tags=["menu"])


@router.get("/categories", response_model=list[schemas.CategoryOut])
def list_categories(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return db.query(models.Category).order_by(models.Category.sort_order).all()


@router.post("/categories", response_model=schemas.CategoryOut)
def create_category(payload: schemas.CategoryCreate, db: Session = Depends(get_db),
                    user=Depends(require_roles(models.RoleName.admin))):
    category = models.Category(name=payload.name.strip(), sort_order=payload.sort_order)
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@router.get("/menu-items", response_model=list[schemas.MenuItemOut])
def list_menu_items(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return db.query(models.MenuItem).order_by(models.MenuItem.sort_order).all()


@router.post("/menu-items", response_model=schemas.MenuItemOut)
def create_menu_item(payload: schemas.MenuItemCreate, db: Session = Depends(get_db),
                      user=Depends(require_roles(models.RoleName.admin))):
    item = models.MenuItem(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/menu-items/{item_id}", response_model=schemas.MenuItemOut)
def update_menu_item(item_id: str, payload: schemas.MenuItemCreate, db: Session = Depends(get_db),
                      user=Depends(require_roles(models.RoleName.admin))):
    item = db.query(models.MenuItem).filter(models.MenuItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    for k, v in payload.model_dump().items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/categories/{category_id}")
def delete_category(category_id: str, db: Session = Depends(get_db),
                    user=Depends(require_roles(models.RoleName.admin))):
    category = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not category:
        raise HTTPException(404, "Category not found")
    if db.query(models.MenuItem).filter(models.MenuItem.category_id == category_id).first():
        raise HTTPException(409, "This category still contains menu items. Move or remove those items first.")
    db.add(models.AuditLog(user_id=user.id, action="category.deleted", details=f"Deleted category {category.name}"))
    db.delete(category)
    db.commit()
    return {"ok": True}


@router.delete("/menu-items/{item_id}")
def delete_menu_item(item_id: str, db: Session = Depends(get_db),
                     user=Depends(require_roles(models.RoleName.admin))):
    item = db.query(models.MenuItem).filter(models.MenuItem.id == item_id).first()
    if not item:
        raise HTTPException(404, "Menu item not found")
    historical_use = db.query(models.OrderItem).filter(models.OrderItem.menu_item_id == item_id).first()
    if historical_use:
        item.is_available = False
        action = "menu_item.archived"
        result = {"ok": True, "archived": True, "message": "This item has order history, so it was hidden from POS instead of being permanently deleted."}
    else:
        db.delete(item)
        action = "menu_item.deleted"
        result = {"ok": True, "archived": False}
    db.add(models.AuditLog(user_id=user.id, action=action, details=f"Removed menu item {item.name}"))
    db.commit()
    return result


@router.delete("/menu-items")
def delete_all_menu_items(db: Session = Depends(get_db),
                          user=Depends(require_roles(models.RoleName.admin))):
    items = db.query(models.MenuItem).all()
    removed = 0
    archived = 0
    for item in items:
        has_history = db.query(models.OrderItem.id).filter(models.OrderItem.menu_item_id == item.id).first() is not None
        if has_history:
            item.is_available = False
            archived += 1
        else:
            db.delete(item)
            removed += 1
    db.add(models.AuditLog(
        user_id=user.id,
        action="menu.bulk_cleared",
        details=f"Removed {removed} menu items and archived {archived} items with order history",
    ))
    db.commit()
    return {"ok": True, "removed": removed, "archived": archived}


@router.get("/menu-items/export.pdf")
def export_food_menu_pdf(db: Session = Depends(get_db), user=Depends(get_current_user)):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

    categories = db.query(models.Category).filter(models.Category.is_active.is_(True)).order_by(models.Category.sort_order, models.Category.name).all()
    output = BytesIO()
    document = SimpleDocTemplate(output, pagesize=A4, title="Royal Skye Food Menu")
    styles = getSampleStyleSheet()
    story = [Paragraph("Royal Skye Birds · Food Menu", styles["Title"]), Spacer(1, 12)]
    for category in categories:
        items = db.query(models.MenuItem).filter(
            models.MenuItem.category_id == category.id,
            models.MenuItem.is_available.is_(True)
        ).order_by(models.MenuItem.sort_order, models.MenuItem.name).all()
        if not items:
            continue
        story.append(Paragraph(category.name, styles["Heading2"]))
        rows = [["Food item", "Description", "Price (NPR)"]] + [
            [item.name, item.description or "", f"{item.price:.2f}"] for item in items
        ]
        table = Table(rows, colWidths=[150, 270, 75], repeatRows=1, hAlign="LEFT")
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#5e1010")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#dddddd")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f7f7f7")]),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("PADDING", (0, 0), (-1, -1), 6),
        ]))
        story.extend([table, Spacer(1, 14)])
    if len(story) == 2:
        story.append(Paragraph("No available food items have been added yet.", styles["Normal"]))
    document.build(story)
    output.seek(0)
    return StreamingResponse(output, media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=royal-skye-food-menu.pdf"})
