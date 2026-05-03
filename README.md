# HR Planner

A self-hostable, full-stack HR planning and shift-rostering web application built for a Luxembourg-based organization. It automates monthly schedule generation under Luxembourg labour rules (CCT-FHL public-holiday compensation, 7h36 working days, 50% on-site minimum, etc.), tracks per-employee balances (PRM, holidays, overtime, homework quotas), and exposes a fast keyboard-friendly grid editor.

> Production deployment: **planner.hostzone.lu**

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Repository Layout](#repository-layout)
- [Quick Start (Docker)](#quick-start-docker)
- [Local Development](#local-development)
- [Database](#database)
- [Authentication & Roles](#authentication--roles)
- [Planning Engine](#planning-engine)
- [Business Rules](#business-rules)
- [REST API Reference](#rest-api-reference)
- [Frontend Pages](#frontend-pages)
- [Background Jobs](#background-jobs)
- [Backup, Restore & Excel I/O](#backup-restore--excel-io)
- [Email Notifications](#email-notifications)
- [Code Generation Workflow](#code-generation-workflow)
- [Configuration & Environment Variables](#configuration--environment-variables)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features

### Scheduling
- **Automatic monthly plan generation** — assigns one shift code per employee per working day, respecting personal weekly templates, day-off requests, holidays, role coverage, on-site/home-work mix and desk capacity.
- **Per-employee weekly templates** — preferred shift code per weekday, with priority weighting.
- **Locked entries** — pinned shifts (e.g. previous-month overflow days) survive re-generation.
- **Single-employee re-generation** — re-plan one employee without touching the rest of the grid.
- **Manual cell editing** — admins can override any cell; the grid revalidates totals live.
- **PDF / Excel export** of the final plan.
- **Permanence rotation** — automatic 2-group / 2-level (L1, L2) weekly rotation across the year, with manual overrides.
- **SPOC rotation** — yearly SPOC duty rotation per office.

### Balance Tracking
- **PRM counter** — running over/under against contractual hours, ±10h target band, updated automatically when a plan is confirmed.
- **Holiday counters** — initial balance, taken so far, remaining (auto-decremented from C0 entries).
- **Overtime / homework day counters** — annual quotas (35 TT days/year for BE/DE/FR coworkers).
- **Balance history** — audit trail of every PRM/holiday change with reason.

### Demands (shift requests)
- Regular users can submit shift-change demands for themselves.
- Admins approve/reject; approved demands are pinned as locked entries on regeneration.
- Approver routing is per-employee (each employee has a designated admin approver).

### Administration
- Office, department, shift-code and public-holiday configuration UIs.
- Monthly contractual-hours config (with JL = compensation day dates).
- User management (admin / regular roles).
- SMTP mail settings + test email + manual notification trigger.
- Full database backup / restore (JSON dump).
- Excel import/export of an entire month.

---

## Architecture

```
┌──────────────────┐     HTTPS     ┌──────────────────┐
│   nginx (frontend │  ──────────►  │  Express API     │
│   container)      │   /api/*      │  (Node 22)       │
│                   │               │                  │
│  Vite SPA build   │               │  ├─ Drizzle ORM  │
│  (React 19)       │               │  ├─ Planner      │
│                   │               │  ├─ Mailer       │
│  Static + /api    │               │  └─ Notifier     │
│  reverse-proxy    │               │      (cron)      │
└──────────────────┘               └────────┬─────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │  PostgreSQL 16   │
                                   │  (named volume)  │
                                   └──────────────────┘
```

The frontend is a static SPA served by nginx; nginx reverse-proxies `/api/*` to the Express API container. Both containers run alongside a PostgreSQL 16 container in `docker-compose.yml`. Session cookies and database credentials never leave the internal Docker network.

---

## Tech Stack

| Layer        | Technology                                                                 |
|--------------|----------------------------------------------------------------------------|
| Runtime      | Node.js 22, pnpm 9 workspaces                                              |
| Backend      | Express 4, TypeScript, Drizzle ORM, `express-session` + `connect-pg-simple`|
| Frontend     | React 19, Vite 7, Tailwind CSS 4, shadcn/ui, TanStack Query, Wouter        |
| Database     | PostgreSQL 16                                                              |
| API contract | OpenAPI 3.1 + Orval codegen (Zod schemas + React Query hooks)              |
| Mail         | Nodemailer (SMTP)                                                          |
| Excel        | ExcelJS                                                                    |
| PDF          | Browser print-to-PDF (CSS print stylesheet)                                |
| Testing      | TypeScript strict-mode typechecking, Playwright e2e                        |
| Container    | Multi-stage Docker, nginx 1.27 alpine, postgres 16 alpine                  |

---

## Repository Layout

```
.
├── artifacts/
│   ├── api-server/          # Express REST API (port 3000 in prod)
│   │   └── src/
│   │       ├── routes/      # Route handlers (one file per resource)
│   │       ├── lib/         # planner.ts, mailer.ts, notifications.ts, crypto.ts, ...
│   │       ├── middleware/  # requireAuth, requireAdmin, error handler
│   │       ├── app.ts       # Express app builder
│   │       └── index.ts     # bootstrap (server.listen + cron)
│   └── hr-planner/          # React + Vite SPA (port 80 in prod via nginx)
│       └── src/
│           ├── pages/       # Route components
│           ├── components/  # Layout + shadcn/ui primitives
│           ├── context/     # auth-context
│           ├── hooks/       # custom hooks
│           └── App.tsx      # Wouter route table
├── lib/
│   ├── db/                  # Drizzle schema + client (@workspace/db)
│   ├── api-spec/            # openapi.yaml + Orval config (@workspace/api-spec)
│   ├── api-zod/             # Generated Zod validators (@workspace/api-zod)
│   └── api-client-react/    # Generated TanStack Query hooks (@workspace/api-client-react)
├── scripts/                 # Seed and maintenance scripts
├── docker-compose.yml       # 3-service stack (postgres, api, frontend)
├── Dockerfile.api           # Builds the API image
├── Dockerfile.frontend      # Builds the nginx-served SPA image
├── docker-entrypoint.sh     # Generates secrets + runs migrations on boot
├── nginx.conf               # SPA fallback + /api reverse proxy
├── pnpm-workspace.yaml      # Workspace + dependency catalog
├── tsconfig.json            # Solution-style TS config (lib references)
└── tsconfig.base.json       # Shared strict TS defaults
```

---

## Quick Start (Docker)

The fastest way to run a production-grade instance:

```bash
git clone https://github.com/<your-org>/hr-planner.git
cd hr-planner

docker compose up -d --build
```

What happens on first boot:

1. PostgreSQL 16 starts and waits for `pg_isready`.
2. The API container’s entrypoint generates `ENCRYPTION_SECRET` and `SESSION_SECRET` (32 random bytes, hex-encoded) and persists them to the named `api_data` volume (`/app/data/secrets.env`). They are reused on subsequent starts.
3. Drizzle pushes the schema to the database (`pnpm --filter @workspace/db run push-force`).
4. The API server starts on port 3000 inside the network.
5. nginx serves the SPA on host port **80** and proxies `/api/*` to `api:3000`.

Then visit **http://localhost** and log in:

| Username | Password   | Role   |
|----------|------------|--------|
| `admin`  | `admin123` | admin  |

> **Change the default password immediately** via the user menu → *Change password*. The default admin uses a legacy plaintext flag for first-boot bootstrapping; once changed, the password is hashed with bcrypt.

### Updating

```bash
git pull
docker compose build --no-cache api frontend
docker compose up -d api frontend
```

The schema is reconciled automatically on container boot.

### Production reverse proxy (TLS)

Put a TLS-terminating proxy (Caddy, Traefik, nginx, Cloudflare Tunnel…) in front of port 80. The application sets `secure` and `sameSite=lax` cookies when `NODE_ENV=production`.

---

## Local Development

Requirements: Node 22, pnpm 9, a running PostgreSQL instance.

```bash
# 1. Install workspace dependencies
pnpm install

# 2. Provide a DB and a session secret
export DATABASE_URL="postgresql://user:pass@localhost:5432/hr_planner"
export SESSION_SECRET="$(openssl rand -hex 32)"
export ENCRYPTION_SECRET="$(openssl rand -hex 32)"

# 3. Push schema
pnpm --filter @workspace/db run push

# 4. (Optional) Seed reference data
pnpm --filter @workspace/scripts run seed

# 5. Run servers (two terminals)
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/hr-planner run dev
```

Useful root scripts:

| Command                          | Purpose                                                  |
|----------------------------------|----------------------------------------------------------|
| `pnpm run typecheck`             | Build composite libs + typecheck every leaf package      |
| `pnpm run typecheck:libs`        | Only `tsc --build` on `lib/*`                            |
| `pnpm run build`                 | Typecheck + build every package                          |

> **Never run `pnpm dev` at the repo root** — Replit-style workflows or Docker compose are the supported entry points. Each artifact requires `PORT` and `BASE_PATH` env vars that the workflow/container provides.

---

## Database

PostgreSQL schema is declared with Drizzle in `lib/db/src/schema.ts` and pushed (no migration files) by `drizzle-kit push`.

### Tables

| Table                  | Purpose                                                                |
|------------------------|------------------------------------------------------------------------|
| `users`                | Auth: username, bcrypt password hash, role (`admin` / `user`), legacy flag |
| `user_sessions`        | Session store (managed by `connect-pg-simple`)                         |
| `employees`            | Staff records: name, email, contract %, role, balances, PRM, approver  |
| `departments`          | Department names referenced by employees                               |
| `offices`              | Physical sites (capacity, name)                                        |
| `office_employees`     | Many-to-many desk eligibility                                          |
| `shift_codes`          | Code definitions (hours, type, color, scales-with-contract flag)       |
| `week_templates`       | Per-employee preferred code per weekday + priority                     |
| `monthly_configs`      | Per (year, month) contractual hours + JL dates                         |
| `public_holidays`      | National holidays (auto-mapped to C0)                                  |
| `planning_months`      | One row per generated/confirmed month                                  |
| `planning_entries`     | One row per (employee, day, month) with shift code + locked flag       |
| `permanence_overrides` | Manual swaps to the auto-rotation                                      |
| `planning_demands`     | Shift change requests submitted by users                               |
| `demand_decisions`     | Approve/reject decisions and comments                                  |
| `mail_settings`        | SMTP host, port, auth, from address (encrypted at rest)                |
| `balance_history`      | Audit log of PRM/holiday/overtime/homework changes                     |

### Pre-loaded reference data (seed script)

- **Shift codes**: `X78`–`X82` (onsite, 7.8–8.2h), `TT2`–`TT9` (homework), `CW4`–`CW9` (cowork), `C0` (holiday, 7.6h), `JL` (CCT-FHL compensation, 7.6h).
- **Public holidays**: 7 Luxembourg holidays for 2026.
- **Monthly configs (2026)**: contractual hours per month (Jan 160, Feb 160, Mar 168, Apr 160, May 146, Jun 160, Jul 176, Aug 160, Sep 168, Oct 168, Nov 160, Dec 160) with JL dates per month.

---

## Authentication & Roles

- **Session-based auth** via `express-session` + `connect-pg-simple`. Sessions persist in the `user_sessions` PostgreSQL table.
- **Cookie**: `httpOnly`, `sameSite=lax`, `secure` in production.
- **Roles**:
  - **admin** — full access: configuration, user management, mail settings, plan generation/confirm, demand decisions.
  - **user** — restricted to the planning grid (read) and demand submission for their own employee record.
- **Legacy admin** — the seeded `admin/admin123` user is flagged `is_legacy=true`. Plaintext comparison is used until the password is changed via `/api/auth/change-password`, which migrates the row to bcrypt.
- **Setup mode** — when no admin exists, `/setup` is shown and `POST /api/auth/setup` provisions the first admin.

Middleware:

| Middleware     | Behaviour                                                          |
|----------------|--------------------------------------------------------------------|
| `requireAuth`  | 401 if no session                                                  |
| `requireAdmin` | 401/403 unless `req.session.user.role === "admin"`                 |

Sensitive fields (SMTP password) are encrypted at rest using AES-256-GCM keyed off `ENCRYPTION_SECRET` (`lib/crypto.ts`).

---

## Planning Engine

The core of the application is `artifacts/api-server/src/lib/planner.ts`. Given a (year, month) it:

1. Loads employees, weekly templates, locked entries, requested days off, public holidays, monthly config, shift codes, offices and desk eligibility.
2. Computes per-employee monthly target = `contractualHours × contractPercent`.
3. Pre-fills:
   - Weekends → empty.
   - Public holidays → `C0` (pro-rated by contract% — see [holiday-scaling rule](#holiday-scaling-rule)).
   - Locked entries (manual pins, approved demands, previous-month overflow).
   - Configured `JL` (CCT-FHL compensation) days from the monthly config.
4. For every remaining working day per employee, picks the highest-priority eligible code from the weekly template under the constraints below.
5. Distributes additional `JL` substitution days when the employee's working-day count yields too few hours to reach the monthly target.
6. Enforces role coverage every day (SPOC + Management + Permanence L1 + Permanence L2 must be on-site).
7. Caps on-site assignments by office desk capacity (and per-employee desk eligibility).
8. Records violations (`< 50% onsite`, overtime overshoot, missing role coverage…) attached to the month.

Key helpers in `planner.ts`:

| Function                      | Responsibility                                                 |
|-------------------------------|----------------------------------------------------------------|
| `generatePlanning`            | Top-level entry point used by `POST /planning/:y/:m/generate`  |
| `generateEmployeePlanning`    | Single-employee re-generation, preserves coverage of others    |
| `hoursForCode`                | Returns hours for a code, applying contract-% scaling          |
| `pickShiftCodeForDay`         | Constraint-satisfying picker (template priority + caps)        |
| `distributeJlDays`            | Adds JL substitution days when monthly hours fall short        |
| `checkViolations`             | Builds the per-month violation list returned by the API        |

### Holiday-scaling rule

Holiday-type codes (`type='holiday'`, e.g. `C0`) are always pro-rated by contract percentage, **even when** `scales_with_contract=false`. An 80% employee taking a public holiday is credited 6.08h, not 7.6h. This rule is enforced consistently in three places to keep the planner, the PRM update at confirm time and the frontend totals in sync:

- `artifacts/api-server/src/lib/planner.ts` → `hoursForCode()`
- `artifacts/api-server/src/routes/planning.ts` → confirm route PRM diff
- `artifacts/hr-planner/src/pages/planning.tsx` → `getEmployeePlannedHours()`

### Confirming a plan

`POST /api/planning/:year/:month/confirm` is destructive in a controlled way:

1. Sums planned hours per employee (with the holiday-scaling rule).
2. Updates each employee's `prm_counter` by `(planned − target)`.
3. Decrements `holidays_taken` for every `C0` entry.
4. Increments `homework_taken` for every TT day used by BE/DE/FR coworkers.
5. Marks the month `confirmed=true` (further edits require unlock).

---

## Business Rules

- **Working day** = 7h36 = **7.6h**.
- **PRM band** = ±10h. Outside the band, the planner attempts to bring the employee back inside next month.
- **Homework cap** = max **35 TT days/year** for BE/DE/FR coworkers; cowork (CW*) days do **not** count toward the cap.
- **Permanence** = 2 groups, 2 levels (L1 primary, L2 escalation), rotates **weekly**, with manual overrides per week.
- **Role coverage** — every working day must have at least: 1 SPOC + 1 Management + 1 Perma L1 + 1 Perma L2 on-site.
- **Desk capacity** — the planner only schedules an employee on-site if a desk eligible to them is free that day.
- **50% on-site minimum** — recorded as a violation when broken.
- **JL = CCT-FHL** — additional paid leave day per the Luxembourg collective agreement; configured per month.

---

## REST API Reference

All routes are mounted under `/api`. Auth is required unless noted.

### Auth (`routes/auth.ts`)
| Method | Path                       | Auth   | Description                              |
|--------|----------------------------|--------|------------------------------------------|
| GET    | `/auth/setup-status`       | public | Returns `{ needsSetup }`                 |
| POST   | `/auth/setup`              | public | Provision first admin (only when empty)  |
| POST   | `/auth/login`              | public | Set session cookie                       |
| POST   | `/auth/logout`             | auth   | Destroy session                          |
| POST   | `/auth/change-password`    | auth   | Change own password (migrates to bcrypt) |
| GET    | `/auth/me`                 | auth   | Current session user                     |

### Users (`routes/users.ts`) — admin only
| Method | Path           | Description                              |
|--------|----------------|------------------------------------------|
| GET    | `/users`       | List users                               |
| POST   | `/users`       | Create user (bcrypt hash)                |
| PATCH  | `/users/:id`   | Update username / role / password        |
| DELETE | `/users/:id`   | Delete user                              |

### Employees (`routes/employees.ts`)
| Method | Path                                  | Auth  | Description                              |
|--------|---------------------------------------|-------|------------------------------------------|
| GET    | `/employees`                          | auth  | List employees                           |
| POST   | `/employees`                          | admin | Create                                   |
| GET    | `/employees/:id`                      | auth  | Detail                                   |
| PUT    | `/employees/:id`                      | admin | Update profile                           |
| DELETE | `/employees/:id`                      | admin | Delete                                   |
| GET    | `/employees/:id/balance-history`      | admin | Audit log of balance changes             |
| PUT    | `/employees/:id/counters`             | admin | Edit PRM / holiday / overtime / homework |
| POST   | `/employees/bulk-reset-balances`      | admin | Yearly counter reset                     |

### Week templates (`routes/weekTemplates.ts`)
| Method | Path                              | Auth  | Description                          |
|--------|-----------------------------------|-------|--------------------------------------|
| GET    | `/employees/:id/templates`        | auth  | List per-employee weekly templates   |
| POST   | `/employees/:id/templates`        | admin | Add template entry                   |
| PUT    | `/templates/:id`                  | admin | Update                               |
| DELETE | `/templates/:id`                  | admin | Delete                               |

### Departments / Offices / Shift codes / Holidays
| Resource     | GET                       | POST/PUT/DELETE             |
|--------------|---------------------------|-----------------------------|
| Departments  | `/departments`            | admin only                  |
| Offices      | `/offices`, `/offices/:id`| admin only; `PUT /offices/:id/employees` updates desk eligibility |
| Shift codes  | `/shift-codes`            | admin only (`/:code` for PUT/DELETE) |
| Holidays     | `/holidays`               | admin only                  |

### Monthly configs (`routes/monthlyConfigs.ts`)
| Method | Path                                  | Auth  | Description                         |
|--------|---------------------------------------|-------|-------------------------------------|
| GET    | `/monthly-configs`                    | auth  | All months                          |
| GET    | `/monthly-configs/:year/:month`       | auth  | One month                           |
| PUT    | `/monthly-configs/:year/:month`       | admin | Upsert contractual hours + JL dates |

### Planning (`routes/planning.ts`)
| Method | Path                                                  | Auth  | Description                             |
|--------|-------------------------------------------------------|-------|-----------------------------------------|
| GET    | `/planning/:year/:month`                              | auth  | Full month grid + violations + totals   |
| POST   | `/planning/:year/:month/generate`                     | admin | Generate full month                     |
| POST   | `/planning/:year/:month/generate/employee/:employeeId`| admin | Re-generate one employee                |
| POST   | `/planning/:year/:month/confirm`                      | admin | Confirm: update PRM/balances, lock      |
| POST   | `/planning/:year/:month/entries`                      | admin | Bulk replace entries                    |
| PUT    | `/planning/entries/:id`                               | admin | Update single cell                      |
| DELETE | `/planning/:year/:month`                              | admin | Wipe a month                            |

### Demands (`routes/demands.ts`)
| Method | Path                            | Auth  | Description                         |
|--------|---------------------------------|-------|-------------------------------------|
| GET    | `/demands`                      | auth  | List own (or all for admin)         |
| POST   | `/demands`                      | auth  | Submit demand                       |
| DELETE | `/demands/:id`                  | auth  | Withdraw own pending demand         |
| PATCH  | `/demands/:id/decision`         | admin | Approve / reject (writes decision)  |

### Mail / Notifications (`routes/mailSettings.ts`) — admin only
| Method | Path                                         | Description                              |
|--------|----------------------------------------------|------------------------------------------|
| GET    | `/settings/mail`                             | Current SMTP settings                    |
| PUT    | `/settings/mail`                             | Update (re-encrypts password)            |
| POST   | `/settings/mail/test`                        | Send test email                          |
| GET    | `/settings/mail/notifications/status`        | Next scheduled run timestamp             |
| POST   | `/settings/mail/notifications/run-now`       | Trigger digest immediately               |

### Backup / Excel
| Method | Path                            | Auth  | Description                                  |
|--------|---------------------------------|-------|----------------------------------------------|
| GET    | `/backup/export`                | admin | Download full DB JSON dump                   |
| POST   | `/backup/restore`               | admin | Upload + restore JSON dump                   |
| GET    | `/planning/excel-export`        | admin | XLSX of selected month(s)                    |
| POST   | `/planning/excel-import`        | admin | Multipart upload to import a month from XLSX |

### Misc
| Method | Path                  | Description                |
|--------|-----------------------|----------------------------|
| GET    | `/healthz`            | Liveness probe             |
| GET    | `/dashboard/summary`  | Aggregate stats for home   |

---

## Frontend Pages

Routing uses [Wouter](https://github.com/molefrog/wouter). Authenticated users land on `/planning/:year/:month`.

| Path                                  | Audience  | Page                                            |
|---------------------------------------|-----------|-------------------------------------------------|
| `/login`                              | public    | Login form                                      |
| `/setup`                              | public    | First-time admin provisioning                   |
| `/`, `/planning`                      | auth      | Redirects to current `/planning/:year/:month`   |
| `/planning/:year/:month`              | auth      | Editable monthly grid, totals, violations       |
| `/dashboard`                          | admin     | KPIs (employees, hours, balances, alerts)       |
| `/employees`                          | admin     | Employee list                                   |
| `/employees/:id`                      | admin     | Profile, templates, balances, history           |
| `/config/offices`                     | admin     | Offices & desk eligibility                      |
| `/config/departments`                 | admin     | Department CRUD                                 |
| `/config/shift-codes`                 | admin     | Shift code CRUD                                 |
| `/config/holidays`                    | admin     | Public holidays                                 |
| `/config/monthly`                     | admin     | Monthly contractual hours + JL dates            |
| `/config/backup`                      | admin     | Download / restore JSON backup                  |
| `/config/excel`                       | admin     | Excel export / import                           |
| `/config/mail`                        | admin     | SMTP configuration + manual notification run    |
| `/permanence/:year`                   | admin     | Yearly permanence (L1/L2) rotation              |
| `/spoc-rotation/:year`                | admin     | Yearly SPOC rotation                            |
| `/users`                              | admin     | User management                                 |

UI primitives come from **shadcn/ui** (`components/ui/*.tsx`) and are styled with **Tailwind CSS 4**. Data fetching uses **TanStack Query** hooks generated by Orval from the OpenAPI spec.

---

## Background Jobs

The API process runs an in-process scheduler (`lib/notifications.ts`) that:

- Wakes every **30 minutes**.
- Groups pending demands by approver.
- Emails each approver a digest (HTML template) using the configured SMTP settings.
- Skips silently when no SMTP settings are configured.
- Is also triggerable on-demand by `POST /settings/mail/notifications/run-now`.

The `/settings/mail/notifications/status` endpoint returns the next scheduled run, surfaced as a countdown in the Mail Settings page.

---

## Backup, Restore & Excel I/O

- **Backup**: `GET /backup/export` streams a JSON dump of every relevant table (employees, configs, planning months/entries, balance history…). Sensitive fields are redacted.
- **Restore**: `POST /backup/restore` accepts a JSON dump and replaces the contents of those tables in a single transaction.
- **Excel export**: `GET /planning/excel-export?year=YYYY&month=MM` returns a styled XLSX matching the legacy spreadsheet format.
- **Excel import**: `POST /planning/excel-import` accepts a multipart upload of an XLSX (same shape as the export) and bulk-loads it as planning entries.

---

## Email Notifications

SMTP configuration is stored in the `mail_settings` table; the password is AES-256-GCM encrypted at rest (`ENCRYPTION_SECRET`).

- Test mail: `POST /settings/mail/test` with `{ "to": "you@example.com" }`.
- Each employee can have a designated **approver admin** (their `approver_id`); demand notifications target that admin only. If unset, the system falls back to all admins.

---

## Code Generation Workflow

The OpenAPI spec at `lib/api-spec/openapi.yaml` is the single source of truth for the API contract. After editing it:

```bash
pnpm --filter @workspace/api-spec run codegen
```

This:

1. Runs **Orval** to regenerate `lib/api-zod` (Zod validators) and `lib/api-client-react` (React Query hooks).
2. Re-builds composite TS declarations (`tsc --build`).

> **Do not overwrite manual fixes** in `lib/api-client-react/src/generated/api.ts` (e.g. `encodeURIComponent` for path params). Re-apply them if a regeneration removes them.

The Express route handlers should validate request/response payloads with the matching Zod schema from `@workspace/api-zod` to keep the contract honest.

---

## Configuration & Environment Variables

| Variable             | Used by         | Purpose                                                     |
|----------------------|-----------------|-------------------------------------------------------------|
| `DATABASE_URL`       | API             | PostgreSQL connection string                                |
| `SESSION_SECRET`     | API             | Session cookie signing key (auto-generated in Docker)       |
| `ENCRYPTION_SECRET`  | API             | AES-256-GCM key for SMTP password (auto-generated in Docker)|
| `PORT`               | API + frontend  | HTTP listen port (3000 in Docker)                           |
| `BASE_PATH`          | frontend build  | SPA base path (default `/`)                                 |
| `NODE_ENV`           | both            | `production` enables secure cookies and minified builds     |

In Docker, `ENCRYPTION_SECRET` and `SESSION_SECRET` are generated once on first boot and persisted to the `api_data` named volume (`/app/data/secrets.env`). Backing up that volume is required to keep encrypted SMTP passwords readable across deployments.

---

## Troubleshooting

**Login returns 401 with the right credentials.**
The default admin uses a legacy plaintext flag. If you previously changed the password, the row was migrated to bcrypt — re-use the new password. To force-reset, run on the API container:

```sql
UPDATE users SET password = '$2b$10$le6k9VSKYvtNzN8GDtIxaOvNSBT.tjNnhfsKkrF2Csy01l.3OehOW',
                 is_legacy = false
 WHERE username = 'admin';
```
(That hash corresponds to `admin123`.)

**`relation "user_sessions" does not exist`** on first start.
The Docker entrypoint runs `drizzle-kit push --force` before starting the API, which provisions every table. If you run outside Docker, run `pnpm --filter @workspace/db run push` first.

**Plan generation returns 400 — `requestedDaysOff is required`.**
The endpoint always expects a body, even when empty:

```bash
curl -X POST .../api/planning/2026/7/generate \
  -H 'Content-Type: application/json' \
  -d '{"requestedDaysOff":[]}'
```

**An employee shows the wrong total after a holiday.**
Holiday-type codes (e.g. `C0`) are pro-rated by contract% regardless of `scales_with_contract`. If you added a custom holiday code, set `type='holiday'` so the rule applies.

**SMTP password is unreadable after restoring a backup on a new host.**
Re-enter SMTP credentials in `/config/mail`. Encryption is keyed off the `api_data` volume; copying only the database is not enough.

**Too many JL days / hours mismatch after generation.**
Re-confirm a previous month so PRM is up to date, then regenerate. The planner uses the live PRM only for display; it no longer compensates the monthly target by PRM band (this used to cause "double JL" assignments).

---

## License

MIT — see `LICENSE`. Copyright © Hostzone.
