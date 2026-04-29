import { Router } from "express";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  employeesTable,
  officesTable,
  officeEmployeesTable,
  shiftCodesTable,
  weekTemplatesTable,
  monthlyConfigsTable,
  publicHolidaysTable,
  planningMonthsTable,
  planningEntriesTable,
} from "@workspace/db";
import {
  GetMonthPlanningParams,
  GeneratePlanningParams,
  GeneratePlanningBody,
  ConfirmPlanningParams,
  UpdatePlanningEntryParams,
  UpdatePlanningEntryBody,
} from "@workspace/api-zod";
import { generatePlanning } from "../lib/planner.js";

const router = Router();

async function getOrCreateMonth(year: number, month: number) {
  const [existing] = await db
    .select()
    .from(planningMonthsTable)
    .where(and(eq(planningMonthsTable.year, year), eq(planningMonthsTable.month, month)));
  if (existing) return existing;
  const [created] = await db
    .insert(planningMonthsTable)
    .values({ year, month, status: "draft" })
    .returning();
  return created;
}

async function buildMonthResponse(year: number, month: number) {
  const pm = await getOrCreateMonth(year, month);
  const entries = await db
    .select()
    .from(planningEntriesTable)
    .where(eq(planningEntriesTable.planningMonthId, pm.id))
    .orderBy(planningEntriesTable.date, planningEntriesTable.employeeId);

  return {
    year,
    month,
    status: pm.status,
    entries: entries.map((e) => ({
      id: e.id,
      employeeId: e.employeeId,
      date: e.date,
      shiftCode: e.shiftCode,
      deskCode: e.deskCode ?? null,
      isPermanence: e.isPermanence,
      permanenceLevel: e.permanenceLevel,
      isLocked: e.isLocked,
      requestedOff: e.requestedOff,
      notes: e.notes,
    })),
    violations: [] as { date: string; type: string; message: string; employeeId: number | null }[],
    generatedAt: pm.generatedAt?.toISOString() ?? null,
  };
}

router.get("/planning/:year/:month", async (req, res): Promise<void> => {
  const params = GetMonthPlanningParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  res.json(await buildMonthResponse(params.data.year, params.data.month));
});

router.post("/planning/:year/:month/generate", async (req, res): Promise<void> => {
  const params = GeneratePlanningParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = GeneratePlanningBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { year, month } = params.data;

  const config = await db
    .select()
    .from(monthlyConfigsTable)
    .where(and(eq(monthlyConfigsTable.year, year), eq(monthlyConfigsTable.month, month)));
  if (config.length === 0) {
    res.status(400).json({ error: "Monthly config not found. Please configure the monthly hours first." });
    return;
  }
  const mc = config[0];

  const employees = await db.select().from(employeesTable);
  const offices = await db.select().from(officesTable);
  const oeRows = await db.select().from(officeEmployeesTable);
  const shiftCodeRows = await db.select().from(shiftCodesTable).where(eq(shiftCodesTable.isActive, true));
  const templates = await db.select().from(weekTemplatesTable);
  const holidays = await db
    .select()
    .from(publicHolidaysTable)
    .then((rows) => rows.filter((r) => r.date.startsWith(String(year))));

  const shiftCodes: Record<string, { code: string; hours: number; type: string }> = {};
  for (const sc of shiftCodeRows) shiftCodes[sc.code] = sc;

  const officesWithEmps: import("../lib/planner.js").OfficeRecord[] = offices.map((o) => ({
    id: o.id,
    deskCount: o.deskCount,
    deskCodes: (o.deskCodes as string[]) ?? [],
    heightAdjustableDesks: (o.heightAdjustableDesks as string[]) ?? [],
    employeeIds: oeRows.filter((oe) => oe.officeId === o.id).map((oe) => oe.employeeId),
  }));

  const publicHolidayDates = holidays.filter((h) => h.country === "lu" || h.country === "all").map((h) => h.date);
  const jlDays = mc.jlDays ?? 0;

  const { entries, violations } = generatePlanning({
    year,
    month,
    employees: employees.map((e) => ({
      id: e.id,
      country: e.country,
      contractPercent: e.contractPercent,
      weeklyContractHours: e.weeklyContractHours,
      homeworkEligible: e.homeworkEligible,
      coworkEligible: e.coworkEligible,
      allowedShiftCodes: (e.allowedShiftCodes as string[]) ?? [],
      permanenceGroup: e.permanenceGroup,
      permanenceLevel: e.permanenceLevel,
      isSpoc: e.isSpoc,
      isManagement: e.isManagement,
      prmCounter: e.prmCounter,
      homeworkDaysUsedThisYear: e.homeworkDaysUsedThisYear,
      preferredJlWeekday: e.preferredJlWeekday ?? null,
      dayCodePreferences: (e.dayCodePreferences as Record<string, string>) ?? {},
      prefersHeightAdjustableDesk: e.prefersHeightAdjustableDesk ?? false,
    })),
    offices: officesWithEmps,
    shiftCodes,
    templates: templates.map((t) => ({
      id: t.id,
      employeeId: t.employeeId,
      days: (t.days as Array<{ dayOfWeek: number; shiftCode: string | null }>) ?? [],
    })),
    publicHolidayDates,
    jlDays,
    contractualHours: mc.contractualHours,
    requestedDaysOff: (parsed.data.requestedDaysOff ?? []).map((r) => ({
      employeeId: r.employeeId,
      dates: r.dates,
    })),
  });

  const pm = await getOrCreateMonth(year, month);

  if (parsed.data.overwriteExisting !== false) {
    await db.delete(planningEntriesTable).where(eq(planningEntriesTable.planningMonthId, pm.id));
  }

  if (entries.length > 0) {
    await db.insert(planningEntriesTable).values(
      entries.map((e) => ({
        planningMonthId: pm.id,
        employeeId: e.employeeId,
        date: e.date,
        shiftCode: e.shiftCode,
        deskCode: e.deskCode ?? null,
        isPermanence: e.isPermanence,
        permanenceLevel: e.permanenceLevel,
        isLocked: e.isLocked,
        requestedOff: e.requestedOff,
        notes: null,
      }))
    );
  }

  await db
    .update(planningMonthsTable)
    .set({ status: "draft", generatedAt: new Date() })
    .where(eq(planningMonthsTable.id, pm.id));

  const result = await buildMonthResponse(year, month);
  result.violations = violations;
  res.json(result);
});

router.post("/planning/:year/:month/confirm", async (req, res): Promise<void> => {
  const params = ConfirmPlanningParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const { year, month } = params.data;
  const pm = await getOrCreateMonth(year, month);

  await db
    .update(planningMonthsTable)
    .set({ status: "confirmed", confirmedAt: new Date() })
    .where(eq(planningMonthsTable.id, pm.id));

  const mc = await db
    .select()
    .from(monthlyConfigsTable)
    .where(and(eq(monthlyConfigsTable.year, year), eq(monthlyConfigsTable.month, month)));

  if (mc.length > 0) {
    const baseContractualHours = mc[0].contractualHours;
    const entries = await db
      .select()
      .from(planningEntriesTable)
      .where(eq(planningEntriesTable.planningMonthId, pm.id));
    const shiftCodeRows = await db.select().from(shiftCodesTable);
    const shiftHoursMap = new Map(shiftCodeRows.map((sc) => [sc.code, sc.hours]));
    const empRows = await db.select().from(employeesTable);
    const empContractPct: Record<number, number> = {};
    for (const e of empRows) empContractPct[e.id] = e.contractPercent ?? 100;

    const plannedByEmployee: Record<number, number> = {};
    for (const entry of entries) {
      if (!entry.shiftCode) continue;
      const hours = shiftHoursMap.get(entry.shiftCode) ?? 0;
      plannedByEmployee[entry.employeeId] = (plannedByEmployee[entry.employeeId] ?? 0) + hours;
    }

    for (const [empIdStr, planned] of Object.entries(plannedByEmployee)) {
      const empId = Number(empIdStr);
      const pct = empContractPct[empId] ?? 100;
      const empContractualHours = Math.round(baseContractualHours * (pct / 100) * 10) / 10;
      const diff = planned - empContractualHours;
      if (diff !== 0) {
        await db
          .update(employeesTable)
          .set({ prmCounter: sql`${employeesTable.prmCounter} + ${diff}` })
          .where(eq(employeesTable.id, empId));
      }
    }
  }

  res.json(await buildMonthResponse(year, month));
});

router.put("/planning/entries/:id", async (req, res): Promise<void> => {
  const params = UpdatePlanningEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePlanningEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Partial<typeof planningEntriesTable.$inferInsert> = {};
  if (parsed.data.shiftCode !== undefined) updateData.shiftCode = parsed.data.shiftCode ?? null;
  if (parsed.data.isPermanence !== undefined) updateData.isPermanence = parsed.data.isPermanence;
  if (parsed.data.permanenceLevel !== undefined) updateData.permanenceLevel = parsed.data.permanenceLevel ?? null;
  if (parsed.data.requestedOff !== undefined) updateData.requestedOff = parsed.data.requestedOff;
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes ?? null;
  updateData.isLocked = true;

  const [row] = await db
    .update(planningEntriesTable)
    .set(updateData)
    .where(eq(planningEntriesTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Planning entry not found" });
    return;
  }
  res.json({
    id: row.id,
    employeeId: row.employeeId,
    date: row.date,
    shiftCode: row.shiftCode,
    isPermanence: row.isPermanence,
    permanenceLevel: row.permanenceLevel,
    isLocked: row.isLocked,
    requestedOff: row.requestedOff,
    notes: row.notes,
  });
});

// DELETE /api/planning/:year/:month — clear planning back to draft
router.delete("/planning/:year/:month", async (req, res): Promise<void> => {
  const year = parseInt(req.params.year, 10);
  const month = parseInt(req.params.month, 10);
  if (isNaN(year) || isNaN(month)) {
    res.status(400).json({ error: "Invalid year/month" });
    return;
  }
  const [pm] = await db
    .select()
    .from(planningMonthsTable)
    .where(and(eq(planningMonthsTable.year, year), eq(planningMonthsTable.month, month)));
  if (!pm) {
    res.status(404).json({ error: "Planning not found" });
    return;
  }
  await db.delete(planningEntriesTable).where(eq(planningEntriesTable.planningMonthId, pm.id));
  const [updated] = await db
    .update(planningMonthsTable)
    .set({ status: "draft", generatedAt: null, confirmedAt: null })
    .where(eq(planningMonthsTable.id, pm.id))
    .returning();
  res.json({ cleared: true, status: updated?.status ?? "draft" });
});

export default router;
