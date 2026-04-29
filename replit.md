# HR Planner

A full-stack HR Planning web application for a Luxembourg-based organization.

## Architecture

### Monorepo Structure (pnpm workspaces)
- `artifacts/api-server/` — Express.js REST API backend (port 8080, proxied to `/api`)
- `artifacts/hr-planner/` — React + Vite + Tailwind frontend (proxied to `/`)
- `lib/db/` — Drizzle ORM database schema and client (`@workspace/db`)
- `lib/api-spec/` — OpenAPI specification + Orval codegen config
- `lib/api-zod/` — Generated Zod validation schemas (`@workspace/api-zod`)
- `lib/api-client-react/` — Generated React Query hooks (`@workspace/api-client-react`)
- `scripts/` — Utility scripts (seed data)

### Tech Stack
- **Backend**: Express.js (TypeScript), Drizzle ORM, PostgreSQL
- **Frontend**: React 19, Vite 7, Tailwind CSS 4, React Query, Wouter routing, shadcn/ui components
- **Codegen**: Orval (generates Zod schemas and React Query hooks from OpenAPI spec)
- **Database**: PostgreSQL via Replit's built-in DB
- **Language**: TypeScript throughout

## Database Schema
Tables: `employees`, `offices`, `office_employees`, `shift_codes`, `week_templates`, `monthly_configs`, `public_holidays`, `planning_months`, `planning_entries`, `permanence_overrides`

## Pre-loaded Data (2026)
- **Shift codes**: X78-X82 (onsite), TT2-TT9 (homework), CW4-CW9 (cowork), C0 (holiday, 7.6h), JL (CCT-FHL day, 7.6h)
- **Public holidays**: 7 Luxembourg public holidays for 2026
- **Monthly configs**: All 12 months with contractual hours (Jan 160h, Feb 160h, Mar 168h, Apr 160h, May 146h, Jun 160h, Jul 176h, Aug 160h, Sep 168h, Oct 168h, Nov 160h, Dec 160h) + JL dates

## Business Rules Implemented
- PRM counter: ±10h threshold per employee per month
- Holiday hours: 7h36 = 7.6h per day
- Homework limits: BE/DE/FR max 35 TT days/year (cowork doesn't count)
- Permanence: 2 groups, 2 levels each (L1 primary, L2 escalation), rotates weekly
- Role coverage: SPOC + Management + Perma1 + Perma2 must be on-site daily
- Desk management: employees only go on-site if an eligible desk is available
- Min 50% on-site enforcement via violations

## API Routes
- `GET/POST /api/employees` — List/create employees
- `GET/PUT/DELETE /api/employees/:id` — Employee CRUD
- `PUT /api/employees/:id/counters` — Update PRM/holiday/overtime/homework counters
- `GET/POST /api/employees/:id/templates` — Week templates
- `PUT/DELETE /api/templates/:id` — Template CRUD
- `GET/POST /api/offices` — Office management
- `PUT /api/offices/:id/employees` — Update desk eligibility
- `GET/POST/PUT/DELETE /api/shift-codes` — Shift code management
- `GET /api/monthly-configs` — List all monthly configs
- `PUT /api/monthly-configs/:year/:month` — Upsert monthly config
- `GET/POST/PUT/DELETE /api/holidays` — Public holiday management
- `GET /api/planning/:year/:month` — Get month planning grid
- `POST /api/planning/:year/:month/generate` — Generate planning (pure algorithm)
- `POST /api/planning/:year/:month/confirm` — Confirm planning
- `PUT /api/planning/entries/:id` — Update single planning entry
- `GET /api/dashboard/summary` — Dashboard statistics

## Frontend Pages
- `/` — Dashboard with month selector, stats, permanence schedule
- `/planning/:year/:month` — Planning grid (employees × working days), generate/confirm toolbar
- `/employees` — Employee list with roles, counters, search
- `/employees/:id` — Employee detail: profile, counters, week templates
- `/config/offices` — Office management with desk counts and employee eligibility
- `/config/shift-codes` — Shift code configuration
- `/config/holidays` — Public holidays calendar
- `/config/monthly` — Monthly configuration (contractual hours, JL dates)

## Codegen
Run after changing `lib/api-spec/openapi.yaml`:
```
pnpm --filter @workspace/api-spec run codegen
```

## Seed Data
```
pnpm --filter @workspace/scripts run seed
```

## Key Notes
- `lib/api-zod/src/index.ts` is manually maintained — Orval must not overwrite it
- Orval config: `mode: "single"`, `target: "api.ts"`, workspace set to generated subdirectory
- No `format: date` in OpenAPI spec (causes Orval to generate `Date` instead of `string`)
- `date-fns` is used in the planning algorithm for working day calculations
