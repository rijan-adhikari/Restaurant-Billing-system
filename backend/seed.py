"""
Seed the database with demo data.
Run inside the backend container: `docker compose exec backend python seed.py`

Creates DEMO credentials only - force password change before real use.
"""
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
    db.add(models.DiningTable(floor_id=ground.id, name="Cabin Room", capacity=4, sort_order=0))
    for i in range(1, 8):
        db.add(models.DiningTable(floor_id=first.id, name=f"F{i}", capacity=4, sort_order=i))
    print("Seeded 2 floors and 16 tables including Cabin Room")

cabin_table = db.query(models.DiningTable).filter(models.DiningTable.name.ilike("%cabin%")) .first()
if not cabin_table:
    ground = db.query(models.Floor).filter(models.Floor.name == "Ground Floor").first()
    if ground:
        db.add(models.DiningTable(floor_id=ground.id, name="Cabin Room", capacity=4, sort_order=0))
        print("Created Cabin Room table for existing database")

if db.query(models.Category).count() == 0:
    category_names = ["Dinner", "Snacks", "Drinks", "Coffee", "Cafe"]
    for idx, category_name in enumerate(category_names):
        db.add(models.Category(name=category_name, sort_order=idx))
    print("Seeded categories only; no demo dishes were added")

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
