import { Router } from "express";
import { db, spocRotationOverridesTable, appSettingsTable, employeesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export const spocRotationRouter = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

function getISOWeeksInYear(year: number): number {
  const dec28 = new Date(year, 11, 28);
  const jan1 = new Date(year, 0, 1);
  const dayOfWeek = (jan1.getDay() + 6) % 7;
  const dec28Iso = Math.ceil(
    ((dec28.getTime() - jan1.getTime()) / 86400000 + dayOfWeek + 1) / 7
  );
  return dec28Iso;
}

function getISOWeekStart(year: number, week: number): string {
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = (jan4.getDay() + 6) % 7;
  const weekStart = new Date(
    jan4.getTime() - dayOfWeek * 86400000 + (week - 1) * 7 * 86400000
  );
  return weekStart.toISOString().split("T")[0];
}

// ── settings: get/set the rotation office ────────────────────────────────────

spocRotationRouter.get("/settings", async (_req, res) => {
  const rows = await db.select().from(appSettingsTable);
  const settings: Record<string, string | null> = {};
  for (const row of rows) settings[row.key] = row.value ?? null;
  res.json(settings);
});

spocRotationRouter.put("/settings", async (req, res) => {
  const body = req.body as Record<string, string | null>;
  for (const [key, value] of Object.entries(body)) {
    const existing = await db
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, key));
    if (existing.length > 0) {
      await db
        .update(appSettingsTable)
        .set({ value: value ?? null })
        .where(eq(appSettingsTable.key, key));
    } else {
      await db.insert(appSettingsTable).values({ key, value: value ?? null });
    }
  }
  res.json({ ok: true });
});

// ── rotation schedule ─────────────────────────────────────────────────────────

spocRotationRouter.get("/spoc-rotation/:year", async (req, res) => {
  const year = parseInt(req.params.year, 10);
  if (isNaN(year)) return res.status(400).json({ error: "Invalid year" });

  const totalWeeks = getISOWeeksInYear(year);

  const spocs = await db
    .select({ id: employeesTable.id, name: employeesTable.name })
    .from(employeesTable)
    .where(eq(employeesTable.spocRotates, true));

  const overrides = await db
    .select()
    .from(spocRotationOverridesTable)
    .where(eq(spocRotationOverridesTable.year, year));

  const settingRows = await db.select().from(appSettingsTable);
  const rotationOfficeId =
    settingRows.find((r) => r.key === "spoc_rotation_office_id")?.value ?? null;

  function autoAssign(weekIdx: number): number | null {
    if (spocs.length === 0) return null;
    return spocs[weekIdx % spocs.length].id;
  }

  const weeks = [];
  for (let w = 1; w <= totalWeeks; w++) {
    const override = overrides.find((o) => o.weekNumber === w);
    weeks.push({
      week: w,
      weekStart: getISOWeekStart(year, w),
      employeeId: override ? override.employeeId : autoAssign(w - 1),
      isManual: !!override,
    });
  }

  return res.json({
    year,
    totalWeeks,
    weeks,
    spocs,
    rotationOfficeId: rotationOfficeId ? parseInt(rotationOfficeId, 10) : null,
  });
});

// ── manual override for one week ──────────────────────────────────────────────

spocRotationRouter.put("/spoc-rotation/:year/:week", async (req, res) => {
  const year = parseInt(req.params.year, 10);
  const week = parseInt(req.params.week, 10);
  const { employeeId } = req.body as { employeeId: number | null };

  if (isNaN(year) || isNaN(week)) {
    return res.status(400).json({ error: "Invalid params" });
  }

  if (employeeId === null) {
    await db
      .delete(spocRotationOverridesTable)
      .where(
        and(
          eq(spocRotationOverridesTable.year, year),
          eq(spocRotationOverridesTable.weekNumber, week)
        )
      );
    return res.json({ deleted: true });
  }

  const existing = await db
    .select()
    .from(spocRotationOverridesTable)
    .where(
      and(
        eq(spocRotationOverridesTable.year, year),
        eq(spocRotationOverridesTable.weekNumber, week)
      )
    );

  if (existing.length > 0) {
    await db
      .update(spocRotationOverridesTable)
      .set({ employeeId })
      .where(
        and(
          eq(spocRotationOverridesTable.year, year),
          eq(spocRotationOverridesTable.weekNumber, week)
        )
      );
  } else {
    await db
      .insert(spocRotationOverridesTable)
      .values({ year, weekNumber: week, employeeId });
  }

  return res.json({ year, week, employeeId });
});
