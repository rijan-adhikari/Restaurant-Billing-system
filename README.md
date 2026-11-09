# Royal Skye POS

Restaurant point-of-sale and operations platform built with React, TypeScript, FastAPI, SQLAlchemy, PostgreSQL, and Docker Compose.

## Local setup

The default Compose configuration is isolated to this project and binds the browser and API to loopback only:

- POS: http://localhost:5174
- API health: http://localhost:8001/api/health
- Frontend API proxy: http://localhost:5174/api/health
- PostgreSQL: private to the Docker network; no host port is published.

### Requirements

- Docker Engine
- Docker Compose v2

### Start

1. Create your local environment file:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env`. Set a strong `POSTGRES_PASSWORD` and a long, random `JWT_SECRET`. Keep the default local ports unless they are already in use.

3. Build and start the application:

   ```bash
   docker compose up -d --build
   ```

4. Check service health:

   ```bash
   docker compose ps
   curl http://localhost:5174/api/health
   ```

5. Open http://localhost:5174.

### Seed demo data

Only on a fresh database, run:

```bash
docker compose exec backend python seed.py
```

Seeded demo credentials are for local evaluation only. Change or remove them before any real restaurant use.

## Persistent data and daily operation

PostgreSQL stores its data in the named Docker volume `pgdata`. Restarting containers or running `docker compose down` does not delete that volume.

Useful commands:

```bash
# View service status
docker compose ps

# Follow application logs
docker compose logs -f backend frontend

# Restart the application
docker compose restart

# Stop containers while preserving the database
docker compose down
```

**Do not use `docker compose down -v` unless you intentionally want to delete the database volume.** Keep `.env` and database backups private; never commit them to Git.

## Implemented application areas

- Staff authentication and role-based access for admin, manager, waiter, cashier, kitchen, and bar workflows.
- Floor and table service, menu browsing, order entry, kitchen/bar KOT routing, and order fulfilment status.
- Billing, partial payments, customer balances, discounts, tax/service-charge calculations, and payment validation.
- Restaurant settings, staff administration, cash drawer and shift reconciliation controls.
- Inventory, stock movements, purchasing, recipes, ingredient costing, expenses, reservations, attendance, and payroll workflows.
- Customer loyalty, refunds, supplier balances/returns, selected audit events, and sales exports.
- PostgreSQL schema versioning with Alembic migrations.

Feature coverage and permissions must still be validated against the restaurant's actual operating procedures. A successful build is not proof that every workflow is production-ready.

## Verification

GitHub Actions validates backend compilation and tests, the frontend production build, both Docker images, and a Compose startup/API smoke test. Physical POS hardware, receipt printers, barcode scanners, and the restaurant's existing database require separate acceptance testing.

## Current release limitations

Before using this system as the restaurant's sole production POS, complete and verify:

- Branch-level data isolation and reporting if multiple outlets are required.
- Full staff profiles, contracts, leave management, and payroll edge cases.
- Fine-grained permissions and a complete audit trail for sensitive actions.
- Supplier invoice lifecycle, partial settlement, due dates, and statement reconciliation.
- Scheduled backup retention and a tested restore procedure.
- Comprehensive financial/cash-flow reports and end-to-end tests for all critical workflows.
- Real-device testing for the POS terminal, receipt/KOT printers, and barcode scanners.

## Project

Maintainer: [Rijan Adhikari](https://github.com/rijan-adhikari)

Repository: https://github.com/rijan-adhikari/Restaurant-Billing-system
