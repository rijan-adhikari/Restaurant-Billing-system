from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import Base, engine
from app.routers import auth, floors, menu, orders, billing, customers, credit, dashboard, expenses, settings as settings_router, operations, admin_control

app = FastAPI(title="Royal Skye Birds POS API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(floors.router)
app.include_router(menu.router)
app.include_router(orders.router)
app.include_router(billing.router)
app.include_router(customers.router)
app.include_router(credit.router)
app.include_router(dashboard.router)
app.include_router(expenses.router)
app.include_router(settings_router.router)
app.include_router(operations.router)
app.include_router(admin_control.router)


@app.on_event("startup")
def on_startup():
    # Phase 1: create tables directly. Move to Alembic migrations before production use.
    Base.metadata.create_all(bind=engine)
    backend_dir = Path(__file__).resolve().parents[1]
    migration_config = Config(str(backend_dir / "alembic.ini"))
    migration_config.set_main_option("script_location", str(backend_dir / "alembic"))
    migration_config.set_main_option("sqlalchemy.url", settings.DATABASE_URL.replace("%", "%%"))
    command.upgrade(migration_config, "head")


@app.get("/api/health")
def health():
    return {"status": "ok"}
