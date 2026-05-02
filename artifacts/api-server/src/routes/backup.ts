import { requireAdmin } from "../middleware/auth.js";
import { Router } from "express";
import { db, pool } from "@workspace/db";
import {
  departmentsTable,
  officesTable,
  officeEmployeesTable,
  shiftCodesTable,
  publicHolidaysTable,
  monthlyConfigsTable,
  employeesTable,
  weekTemplatesTable,
  planningMonthsTable,
  planningEntriesTable,
  permanenceOverridesTable,
  spocRotationOverridesTable,
  appSettingsTable,
} from "@workspace/db";
import { asc } from "drizzle-orm";

const router = Router();

// ── EXPORT ───────────────────────────────────────────────────────────────────

router.get("/backup/export", requireAdmin, async (req, res): Promise<void> => {
  const [
    departments,
    offices,
    officeEmployees,
    shiftCodes,
    publicHolidays,
    monthlyConfigs,
    employees,
    weekTemplates,
    planningMonths,
    planningEntries,
    permanenceOverrides,
    spocRotationOverrides,
    appSettings,
  ] = await Promise.all([
    db.select().from(departmentsTable).orderBy(asc(departmentsTable.id)),
    db.select().from(officesTable).orderBy(asc(officesTable.id)),
    db.select().from(officeEmployeesTable),
    db.select().from(shiftCodesTable).orderBy(asc(shiftCodesTable.code)),
    db.select().from(publicHolidaysTable).orderBy(asc(publicHolidaysTable.id)),
    db.select().from(monthlyConfigsTable).orderBy(asc(monthlyConfigsTable.id)),
    db.select().from(employeesTable).orderBy(asc(employeesTable.id)),
    db.select().from(weekTemplatesTable).orderBy(asc(weekTemplatesTable.id)),
    db.select().from(planningMonthsTable).orderBy(asc(planningMonthsTable.id)),
    db.select().from(planningEntriesTable).orderBy(asc(planningEntriesTable.id)),
    db.select().from(permanenceOverridesTable).orderBy(asc(permanenceOverridesTable.id)),
    db.select().from(spocRotationOverridesTable).orderBy(asc(spocRotationOverridesTable.id)),
    db.select().from(appSettingsTable),
  ]);

  const backup = {
    version: 2,
    exportedAt: new Date().toISOString(),
    tables: {
      departments,
      offices,
      officeEmployees,
      shiftCodes,
      publicHolidays,
      monthlyConfigs,
      employees,
      weekTemplates,
      planningMonths,
      planningEntries,
      permanenceOverrides,
      spocRotationOverrides,
      appSettings,
    },
  };

  const dateStr = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="hr-backup-${dateStr}.json"`);
  res.json(backup);
});

// ── RESTORE ──────────────────────────────────────────────────────────────────

router.post("/backup/restore", requireAdmin, async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;

  // Accept version 1 (legacy) and version 2 (adds spocRotationOverrides + appSettings)
  if (!body || (body.version !== 1 && body.version !== 2) || typeof body.tables !== "object" || !body.tables) {
    res.status(400).json({ error: "Invalid backup file format" });
    return;
  }

  const tables = body.tables as Record<string, unknown[]>;

  const required = [
    "departments", "offices", "officeEmployees", "shiftCodes",
    "publicHolidays", "monthlyConfigs", "employees", "weekTemplates",
    "planningMonths", "planningEntries", "permanenceOverrides",
  ];
  for (const key of required) {
    if (!Array.isArray(tables[key])) {
      res.status(400).json({ error: `Missing or invalid table: ${key}` });
      return;
    }
  }
  // v2 tables — optional so old v1 backups can still be restored without error
  const spocRotationOverrideRows = Array.isArray(tables.spocRotationOverrides) ? tables.spocRotationOverrides as Record<string, unknown>[] : [];
  const appSettingRows = Array.isArray(tables.appSettings) ? tables.appSettings as Record<string, unknown>[] : [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Truncate all tables in one shot; CASCADE handles FK order;
    // RESTART IDENTITY resets all serial sequences back to 1.
    await client.query(`
      TRUNCATE
        spoc_rotation_overrides,
        permanence_overrides,
        planning_entries,
        planning_months,
        week_templates,
        office_employees,
        employees,
        monthly_configs,
        public_holidays,
        shift_codes,
        offices,
        departments
      RESTART IDENTITY CASCADE
    `);
    // app_settings uses a text PK (no serial); clear it separately
    await client.query(`DELETE FROM "app_settings"`);

    // Ensure a value is a proper JSON string for JSONB columns.
    // pg serializes JS arrays as PostgreSQL array literals ({"a","b"}) instead of
    // JSON arrays (["a","b"]) unless we stringify first.
    function toJsonb(val: unknown): string {
      if (typeof val === "string") {
        // Already a JSON string (e.g. from an old export that stored text)
        try { JSON.parse(val); return val; } catch { /* fall through */ }
      }
      return JSON.stringify(val);
    }

    // Helper to insert rows into a table with explicit IDs (OVERRIDING SYSTEM VALUE)
    async function insertRows(
      tableName: string,
      rows: Record<string, unknown>[],
      columns: string[],
      hasSerial: boolean
    ) {
      if (rows.length === 0) return;
      for (const row of rows) {
        const cols = columns.map((c) => `"${c}"`).join(", ");
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
        const values = columns.map((c) => row[c] ?? null);
        const override = hasSerial ? "OVERRIDING SYSTEM VALUE" : "";
        await client.query(
          `INSERT INTO "${tableName}" (${cols}) ${override} VALUES (${placeholders})`,
          values
        );
      }
    }

    const depts = tables.departments as Record<string, unknown>[];
    await insertRows("departments", depts, ["id", "name", "order"], true);

    const offs = tables.offices as Record<string, unknown>[];
    if (offs.length > 0) {
      for (const row of offs) {
        await client.query(
          `INSERT INTO "offices" ("id","name","desk_count","desk_codes","height_adjustable_desks","color","created_at")
           OVERRIDING SYSTEM VALUE VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            row.id,
            row.name,
            row.deskCount ?? row.desk_count ?? 0,
            toJsonb(row.deskCodes ?? row.desk_codes ?? []),
            toJsonb(row.heightAdjustableDesks ?? row.height_adjustable_desks ?? []),
            row.color ?? null,
            row.createdAt ?? row.created_at ?? new Date().toISOString(),
          ]
        );
      }
    }

    const sc = tables.shiftCodes as Record<string, unknown>[];
    // shift_codes PK is text (code), no serial
    if (sc.length > 0) {
      for (const row of sc) {
        await client.query(
          `INSERT INTO "shift_codes" ("code", "label", "hours", "type", "is_active", "color") VALUES ($1,$2,$3,$4,$5,$6)`,
          [row.code, row.label, row.hours, row.type, row.isActive ?? row.is_active ?? true, row.color ?? null]
        );
      }
    }

    const ph = tables.publicHolidays as Record<string, unknown>[];
    await insertRows("public_holidays", ph, ["id", "date", "name", "country"], true);

    const mc = tables.monthlyConfigs as Record<string, unknown>[];
    if (mc.length > 0) {
      for (const row of mc) {
        await client.query(
          `INSERT INTO "monthly_configs" ("id","year","month","contractual_hours","jl_days","notes")
           OVERRIDING SYSTEM VALUE VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            row.id,
            row.year,
            row.month,
            row.contractualHours ?? row.contractual_hours ?? 0,
            row.jlDays ?? row.jl_days ?? 0,
            row.notes ?? null,
          ]
        );
      }
    }

    const emps = tables.employees as Record<string, unknown>[];
    if (emps.length > 0) {
      for (const row of emps) {
        await client.query(
          `INSERT INTO "employees" (
            "id","name","country","contract_percent","weekly_contract_hours",
            "homework_eligible","cowork_eligible","allowed_shift_codes",
            "permanence_group","permanence_level","is_spoc","spoc_rotates","is_management",
            "prm_counter","holiday_hours_remaining","overtime_hours",
            "homework_days_used_this_year","preferred_jl_weekday",
            "day_code_preferences","prefers_height_adjustable_desk",
            "department_id","preferred_office_id","onsite_week_ratio","display_order",
            "notes","created_at","updated_at"
          ) OVERRIDING SYSTEM VALUE VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
          )`,
          [
            row.id, row.name, row.country ?? "lu",
            row.contractPercent ?? row.contract_percent ?? 100,
            row.weeklyContractHours ?? row.weekly_contract_hours ?? 40,
            row.homeworkEligible ?? row.homework_eligible ?? true,
            row.coworkEligible ?? row.cowork_eligible ?? true,
            JSON.stringify(row.allowedShiftCodes ?? row.allowed_shift_codes ?? []),
            row.permanenceGroup ?? row.permanence_group ?? null,
            row.permanenceLevel ?? row.permanence_level ?? null,
            row.isSpoc ?? row.is_spoc ?? false,
            row.spocRotates ?? row.spoc_rotates ?? false,
            row.isManagement ?? row.is_management ?? false,
            row.prmCounter ?? row.prm_counter ?? 0,
            row.holidayHoursRemaining ?? row.holiday_hours_remaining ?? 273.6,
            row.overtimeHours ?? row.overtime_hours ?? 0,
            row.homeworkDaysUsedThisYear ?? row.homework_days_used_this_year ?? 0,
            row.preferredJlWeekday ?? row.preferred_jl_weekday ?? null,
            JSON.stringify(row.dayCodePreferences ?? row.day_code_preferences ?? {}),
            row.prefersHeightAdjustableDesk ?? row.prefers_height_adjustable_desk ?? false,
            row.departmentId ?? row.department_id ?? null,
            row.preferredOfficeId ?? row.preferred_office_id ?? null,
            row.onsiteWeekRatio ?? row.onsite_week_ratio ?? null,
            row.displayOrder ?? row.display_order ?? 0,
            row.notes ?? null,
            row.createdAt ?? row.created_at ?? new Date().toISOString(),
            row.updatedAt ?? row.updated_at ?? new Date().toISOString(),
          ]
        );
      }
    }

    // office_employees: composite PK, no serial
    const oe = tables.officeEmployees as Record<string, unknown>[];
    for (const row of oe) {
      await client.query(
        `INSERT INTO "office_employees" ("office_id","employee_id") VALUES ($1,$2)`,
        [row.officeId ?? row.office_id, row.employeeId ?? row.employee_id]
      );
    }

    const wt = tables.weekTemplates as Record<string, unknown>[];
    if (wt.length > 0) {
      for (const row of wt) {
        await client.query(
          `INSERT INTO "week_templates" ("id","employee_id","name","days") OVERRIDING SYSTEM VALUE VALUES ($1,$2,$3,$4)`,
          [row.id, row.employeeId ?? row.employee_id, row.name, JSON.stringify(row.days ?? [])]
        );
      }
    }

    const pm = tables.planningMonths as Record<string, unknown>[];
    if (pm.length > 0) {
      for (const row of pm) {
        await client.query(
          `INSERT INTO "planning_months" ("id","year","month","status","generated_at","confirmed_at","violations") OVERRIDING SYSTEM VALUE VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            row.id, row.year, row.month,
            row.status ?? "draft",
            row.generatedAt ?? row.generated_at ?? null,
            row.confirmedAt ?? row.confirmed_at ?? null,
            row.violations ? JSON.stringify(row.violations) : null,
          ]
        );
      }
    }

    const pe = tables.planningEntries as Record<string, unknown>[];
    if (pe.length > 0) {
      for (const row of pe) {
        await client.query(
          `INSERT INTO "planning_entries" (
            "id","planning_month_id","employee_id","date","shift_code",
            "desk_code","is_permanence","permanence_level","is_locked",
            "requested_off","notes"
          ) OVERRIDING SYSTEM VALUE VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            row.id,
            row.planningMonthId ?? row.planning_month_id,
            row.employeeId ?? row.employee_id,
            row.date,
            row.shiftCode ?? row.shift_code ?? null,
            row.deskCode ?? row.desk_code ?? null,
            row.isPermanence ?? row.is_permanence ?? false,
            row.permanenceLevel ?? row.permanence_level ?? null,
            row.isLocked ?? row.is_locked ?? false,
            row.requestedOff ?? row.requested_off ?? false,
            row.notes ?? null,
          ]
        );
      }
    }

    const po = tables.permanenceOverrides as Record<string, unknown>[];
    if (po.length > 0) {
      for (const row of po) {
        await client.query(
          `INSERT INTO "permanence_overrides" ("id","year","week_number","group","employee_id","is_manual") OVERRIDING SYSTEM VALUE VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            row.id, row.year,
            row.weekNumber ?? row.week_number,
            row.group,
            row.employeeId ?? row.employee_id,
            row.isManual ?? row.is_manual ?? true,
          ]
        );
      }
    }

    // v2: SPOC rotation manual overrides
    for (const row of spocRotationOverrideRows) {
      await client.query(
        `INSERT INTO "spoc_rotation_overrides" ("id","year","week_number","employee_id","is_manual") OVERRIDING SYSTEM VALUE VALUES ($1,$2,$3,$4,$5)`,
        [
          row.id, row.year,
          row.weekNumber ?? row.week_number,
          row.employeeId ?? row.employee_id,
          row.isManual ?? row.is_manual ?? true,
        ]
      );
    }

    // v2: App settings (text PK, no serial — INSERT OR REPLACE pattern)
    for (const row of appSettingRows) {
      await client.query(
        `INSERT INTO "app_settings" ("key","value") VALUES ($1,$2)`,
        [row.key, row.value ?? null]
      );
    }

    // Reset all serial sequences to avoid PK collisions on future inserts
    const serialTables = [
      "departments", "offices", "monthly_configs", "public_holidays",
      "employees", "week_templates", "planning_months",
      "planning_entries", "permanence_overrides", "spoc_rotation_overrides",
    ];
    for (const tbl of serialTables) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence('"${tbl}"', 'id'), COALESCE((SELECT MAX(id) FROM "${tbl}"), 0) + 1, false)`
      );
    }

    await client.query("COMMIT");

    req.log.info("Database restored from backup");
    res.json({ ok: true, restoredAt: new Date().toISOString() });
  } catch (err) {
    await client.query("ROLLBACK");
    req.log.error({ err }, "Restore failed");
    res.status(500).json({ error: "Restore failed", detail: String(err) });
  } finally {
    client.release();
  }
});

export default router;
