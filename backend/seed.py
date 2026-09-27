"""
Seed the database with demo data.
Run inside the backend container: `docker compose exec backend python seed.py`

Creates DEMO credentials only - force password change before real use.
"""
from decimal import Decimal

from app.database import Base, engine, SessionLocal
from app import models
from app.security import hash_password

Base.metadata.create_all(bind=engine)
db = SessionLocal()

if db.query(models.User).count() == 0:
    demo_users = [
        ("admin", "Admin User", "admin123", models.RoleName.admin),
    ]
    for username, full_name, password, role in demo_users:
        db.add(models.User(username=username, full_name=full_name,
                            password_hash=hash_password(password), role=role,
                            must_change_password=True))
    print("Seeded demo users (CHANGE THESE PASSWORDS): " + ", ".join(f"{u}/{p}" for u, _, p, _ in demo_users))

if db.query(models.Floor).count() == 0:
    ground = models.Floor(name="Ground Floor", sort_order=0)
    first = models.Floor(name="First Floor", sort_order=1)
    db.add_all([ground, first])
    db.flush()
    for i in range(1, 9):
        db.add(models.DiningTable(floor_id=ground.id, name=f"G{i}", capacity=4, sort_order=i))
    for i in range(1, 8):
        db.add(models.DiningTable(floor_id=first.id, name=f"F{i}", capacity=4, sort_order=i))
    print("Seeded 2 floors and 15 tables")

if db.query(models.Category).count() == 0:
    categories = {
        "Dinner": [("Chicken Sekuwa", 350), ("Chicken Chilli", 380), ("Chicken Tikka", 360),
                   ("Mutton Sekuwa", 450), ("Mutton Curry", 420), ("Dal Bhat", 250)],
        "Snacks": [("Chowmein", 200), ("Fried Rice", 220), ("Momo", 180), ("French Fries", 150),
                   ("Chicken Wings", 300), ("Sausage", 220)],
        "Drinks": [("Coke", 80), ("Sprite", 80), ("Fanta", 80), ("Mineral Water", 40), ("Fresh Juice", 150)],
        "Coffee": [("Black Coffee", 120), ("Milk Coffee", 140), ("Cappuccino", 180),
                   ("Latte", 180), ("Espresso", 150)],
        "Cafe": [("Tea", 60), ("Masala Tea", 80), ("Hot Chocolate", 160), ("Cold Coffee", 170),
                 ("Sandwich", 220)],
    }
    kitchen_categories = {"Dinner", "Snacks"}
    for idx, (cat_name, items) in enumerate(categories.items()):
        category = models.Category(name=cat_name, sort_order=idx)
        db.add(category)
        db.flush()
        destination = models.RouteDestination.kitchen if cat_name in kitchen_categories else models.RouteDestination.bar
        for i_idx, (item_name, price) in enumerate(items):
            db.add(models.MenuItem(category_id=category.id, name=item_name, price=Decimal(price),
                                    destination=destination, sort_order=i_idx))
    print("Seeded demo categories and menu items")

if db.query(models.TaxSetting).count() == 0:
    db.add(models.TaxSetting(tax_enabled=True, tax_percent=Decimal("14.00"),
                              service_charge_enabled=False, service_charge_percent=Decimal("0.00")))
    print("Seeded tax settings (14% VAT, editable in Admin)")

if db.query(models.RestaurantSetting).count() == 0:
    db.add(models.RestaurantSetting(
        name="Royal Skye Birds Restaurant & Bar Cafe",
        email="business.rijan.np@gmail.com",
        address="Tikathali, Ward No. 05, Lalitpur District, Bagmati Province",
        currency="NPR",
        receipt_footer="Thankyou For Visiting Us.",
    ))
    print("Seeded restaurant settings")

db.commit()
db.close()
print("Done. Demo credentials are for setup only - change all passwords before production use.")
