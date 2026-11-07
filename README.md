# Royal Skye Birds Restaurant & Bar Cafe — POS System

**Status: Phase 1 scaffold.** This is a real, working foundation (auth, database,
core POS → KOT → billing → outstanding-balance flow, kitchen/bar displays), not
a mockup. It is **not yet feature-complete** against the full spec — see
"What's built" vs "What's left" below before relying on it for daily operations.

## Stack
- Frontend: React + Vite + TypeScript + Tailwind CSS
- Backend: FastAPI + SQLAlchemy + PostgreSQL
- Realtime: WebSockets (KOT broadcast to Kitchen/Bar displays)
- Deployment: Docker Compose (db, backend, frontend) — LAN-first, no internet dependency for core POS use

## Quick start (LAN deployment)

1. Install Docker and Docker Compose on the restaurant's server machine.
2. Find that machine's LAN IP (e.g. `192.168.1.100` via `ip addr` / `ipconfig`).
3. Copy `.env.example` to `.env` and set:
   - `POSTGRES_PASSWORD` — a real password
   - `JWT_SECRET` — a long random string
   - `VITE_API_BASE_URL=http://<server-ip>:8000`
   - `VITE_WS_BASE_URL=ws://<server-ip>:8000`
   - `CORS_ORIGINS=http://<server-ip>:5173`
4. Start everything:
   ```
   docker compose up -d --build
   ```
5. Seed demo data (floors, tables, categories, menu items, 14% tax, demo staff accounts):
   ```
   docker compose exec backend python seed.py
   ```
6. Staff open a browser to `http://<server-ip>:5173` on any device on the same network.

### Demo credentials (change immediately — `must_change_password` is set on all seeded accounts)
| Username | Password | Role |
|---|---|---|
| admin | admin123 | Admin |
| manager | manager123 | Manager |
| waiter1 | waiter123 | Waiter |
| cashier1 | cashier123 | Cashier |

## What's built (Phase 1)
- Individual staff logins, JWT auth, role-based route/API protection (Admin, Manager, Waiter, Cashier, Kitchen, Bar)
- Normalized Postgres schema: users, floors, tables, categories, menu_items, orders, order_items, kots, kot_items, bills, payments, customers, customer_balances, balance_transactions, tax_settings, restaurant_settings, audit_logs
- Floor/table selection UI with live status, POS screen with categories/search/cart
- Order → KOT generation with automatic Kitchen/Bar routing by item destination; multiple KOTs link to one active order per table
- Kitchen Display (`/kitchen`) and Bar Display (`/bar`) with WebSocket auto-refresh and status progression (New → Accepted → Preparing → Ready → Served)
- Billing with editable tax % (seeded at 14%, admin-editable), grand total calculation using Decimal (no floats)
- Partial payment / outstanding balance recording, linked to a customer, with a repayment endpoint
- Seed script for demo floors/tables/menu/tax/staff, clearly labeled as demo data

## What's left (do not treat as done)
This is the real gap list, not filler — build these before production use:
- **Reports** (daily/weekly/monthly, by staff/table/category/payment method, CSV/PDF export) — not yet built
- **Admin UI** for managing users, menu, categories, floors/tables, printers, QR image upload, restaurant settings (backend endpoints exist for some; most admin screens are not built yet)
- **Receipt/KOT thermal printing** (58mm/80mm layouts) — not implemented
- **Audit log writing** on sensitive actions (model exists, not yet wired into every mutating endpoint)
- **Discounts with permission limits**, order editing/void/refund flows with authorization checks
- **Local backup/restore** tooling (scheduled dumps + admin-triggered download/restore)
- **Alembic migrations** — Phase 1 uses `Base.metadata.create_all` for speed; switch to real migrations before production schema changes
- **Rate limiting, CSRF, security headers** hardening pass
- Full permission matrix per role beyond the coarse checks currently in place
- Automated tests for the full workflow described in the spec

## Suggested next steps
Tell me which of the above to build next (e.g. "build the Admin menu/floor/table management screens" or "add reports + CSV export" or "add thermal receipt printing") and I'll continue directly on this codebase.

## Author

Developed by **[Rijan Adhikari](https://github.com/rijan-adhikari)**.

- Portfolio: https://adhikari-rijan.onrender.com/
- GitHub: https://github.com/rijan-adhikari
