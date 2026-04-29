import { Router } from "express";
import { eq, and, ne, isNotNull, sql } from "drizzle-orm";
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
  permanenceOverridesTable,
} from "@workspace/db";
import {
  GetMonthPlanningParams,
  GeneratePlanningParams,
  GeneratePlanningBody,
  GenerateEmployeePlanningParams,
  ConfirmPlanningParams,
  UpdatePlanningEntryParams,
  UpdatePlanningEntryBody,
} from "@workspace/api-zod";
import { generatePlanning, type PlanningViolation } from "../lib/planner.js";

const router = Router();

// ── Permanence helpers (same logic as permanence.ts route) ──────────────────

function getISOWeeksInYear(year: number): number {
  const dec28 = new Date(year, 11, 28);
  const jan1 = new Date(year, 0, 1);
  const dayOfWeek = (jan1.getDay() + 6) % 7;
  return Math.ceil((((dec28.getTime() - jan1.getTime()) / 86400000) + dayOfWeek + 1) / 7);
}

function getISOWeekStart(year: number, week: number): string {
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = (jan4.getDay() + 6) % 7;
  const ws = new Date(jan4.getTime() - dayOfWeek * 86400000 + (week - 1) * 7 * 86400000);
  return ws.toISOString().split("T")[0];
}

async function buildPermanenceAssignments(
  year: number,
  month: number
): Promise<Record<string, { g1: number | null; g2: number | null }>> {
  const permanenceEmployees = await db
    .select({ id: employeesTable.id, permanenceGroup: employeesTable.permanenceGroup })
    .from(employeesTable)
    .where(isNotNull(employeesTable.permanenceGroup));

  const overrides = await db
    .select()
    .from(permanenceOverridesTable)
    .where(eq(permanenceOverridesTable.year, year));

  const group1 = permanenceEmployees.filter((e) => e.permanenceGroup === 1);
  const group2 = permanenceEmployees.filter((e) => e.permanenceGroup === 2);

  function rotateAssign(group: typeof group1, weekIdx: number): number | null {
    if (group.length === 0) return null;
    return group[weekIdx % group.length].id;
  }

  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEndDate = new Date(year, month, 0);
  const monthEnd = monthEndDate.toISOString().split("T")[0];

  const result: Record<string, { g1: number | null; g2: number | null }> = {};
  const totalWeeks = getISOWeeksInYear(year);

  for (let w = 1; w <= totalWeeks; w++) {
    const ws = getISOWeekStart(year, w);
    // Week end is ws + 6 days
    const weDate = new Date(ws);
    weDate.setDate(weDate.getDate() + 6);
    const we = weDate.toISOString().split("T")[0];
    // Only include weeks that overlap with this month
    if (we < monthStart || ws > monthEnd) continue;

    const g1Override = overrides.find((o) => o.weekNumber === w && o.group === 1);
    const g2Override = overrides.find((o) => o.weekNumber === w && o.group === 2);

    result[ws] = {
      g1: g1Override ? g1Override.employeeId : rotateAssign(group1, w - 1),
      g2: g2Override ? g2Override.employeeId : rotateAssign(group2, w - 1),
    };
  }

  return result;
}

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

  const storedViolations = Array.isArray(pm.violations) ? (pm.violations as PlanningViolation[]) : [];

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
    violations: storedViolations,
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

  const pm = await getOrCreateMonth(year, month);

  // Load existing locked entries so the algorithm works around them
  const existingEntries = await db
    .select()
    .from(planningEntriesTable)
    .where(eq(planningEntriesTable.planningMonthId, pm.id));

  const lockedEntries = existingEntries
    .filter((e) => e.isLocked)
    .map((e) => ({
      employeeId: e.employeeId,
      date: e.date,
      shiftCode: e.shiftCode,
      deskCode: e.deskCode ?? null,
      isPermanence: e.isPermanence,
      permanenceLevel: e.permanenceLevel,
      isLocked: true,
      requestedOff: e.requestedOff,
    }));

  // Build permanence assignments using ISO week numbers + manual overrides,
  // matching exactly what the Permanence page shows.
  const precomputedPermanence = await buildPermanenceAssignments(year, month);

  const { entries, violations } = generatePlanning({
    year,
    month,
    employees: employees.map((e) => ({
      id: e.id,
      name: e.name,
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
      dayCodePreferences: Array.isArray(e.dayCodePreferences) ? (e.dayCodePreferences as import("../lib/planner.js").DayCodePreference[]) : [],
      prefersHeightAdjustableDesk: e.prefersHeightAdjustableDesk ?? false,
      preferredOfficeId: e.preferredOfficeId ?? null,
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
    lockedEntries,
    permanenceAssignments: precomputedPermanence,
  });

  // Delete all non-locked entries, then insert newly generated ones
  if (existingEntries.filter((e) => !e.isLocked).length > 0) {
    await db
      .delete(planningEntriesTable)
      .where(and(eq(planningEntriesTable.planningMonthId, pm.id), ne(planningEntriesTable.isLocked, true)));
  }

  // Filter out locked entries from the generated set (they already exist in DB)
  const newEntries = entries.filter((e) => !e.isLocked);

  if (newEntries.length > 0) {
    await db.insert(planningEntriesTable).values(
      newEntries.map((e) => ({
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

  // Persist violations so the GET endpoint and dashboard can show them
  await db
    .update(planningMonthsTable)
    .set({ status: "draft", generatedAt: new Date(), violations: violations as unknown as Record<string, unknown>[] })
    .where(eq(planningMonthsTable.id, pm.id));

  const result = await buildMonthResponse(year, month);
  result.violations = violations;
  res.json(result);
});

router.post("/planning/:year/:month/generate/employee/:employeeId", async (req, res): Promise<void> => {
  const params = GenerateEmployeePlanningParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = GeneratePlanningBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { year, month, employeeId } = params.data;

  const config = await db
    .select()
    .from(monthlyConfigsTable)
    .where(and(eq(monthlyConfigsTable.year, year), eq(monthlyConfigsTable.month, month)));
  if (config.length === 0) {
    res.status(400).json({ error: "Monthly config not found." });
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

  const pm = await getOrCreateMonth(year, month);
  const existingEntries = await db
    .select()
    .from(planningEntriesTable)
    .where(eq(planningEntriesTable.planningMonthId, pm.id));

  // All OTHER employees' entries become locked context — their planning is preserved unchanged.
  // Only the target employee's non-locked entries are regenerated.
  const lockedEntries = existingEntries
    .filter((e) => e.employeeId !== employeeId || e.isLocked)
    .map((e) => ({
      employeeId: e.employeeId,
      date: e.date,
      shiftCode: e.shiftCode,
      deskCode: e.deskCode ?? null,
      isPermanence: e.isPermanence,
      permanenceLevel: e.permanenceLevel,
      isLocked: true,
      requestedOff: e.requestedOff,
    }));

  const precomputedPermanence = await buildPermanenceAssignments(year, month);

  const { entries, violations } = generatePlanning({
    year,
    month,
    employees: employees.map((e) => ({
      id: e.id,
      name: e.name,
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
      dayCodePreferences: Array.isArray(e.dayCodePreferences) ? (e.dayCodePreferences as import("../lib/planner.js").DayCodePreference[]) : [],
      prefersHeightAdjustableDesk: e.prefersHeightAdjustableDesk ?? false,
      preferredOfficeId: e.preferredOfficeId ?? null,
    })),
    offices: officesWithEmps,
    shiftCodes,
    templates: templates.map((t) => ({
      id: t.id,
      employeeId: t.employeeId,
      days: (t.days as Array<{ dayOfWeek: number; shiftCode: string | null }>) ?? [],
    })),
    publicHolidayDates,
    jlDays: mc.jlDays ?? 0,
    contractualHours: mc.contractualHours,
    requestedDaysOff: (parsed.data.requestedDaysOff ?? []).map((r) => ({
      employeeId: r.employeeId,
      dates: r.dates,
    })),
    lockedEntries,
    permanenceAssignments: precomputedPermanence,
  });

  // Delete only the target employee's non-locked entries, then insert their new ones
  await db
    .delete(planningEntriesTable)
    .where(
      and(
        eq(planningEntriesTable.planningMonthId, pm.id),
        eq(planningEntriesTable.employeeId, employeeId),
        ne(planningEntriesTable.isLocked, true)
      )
    );

  const newEntries = entries.filter((e) => e.employeeId === employeeId && !e.isLocked);
  if (newEntries.length > 0) {
    await db.insert(planningEntriesTable).values(
      newEntries.map((e) => ({
        planningMonthId: pm.id,
        employeeId: e.employeeId,
        date: e.date,
        shiftCode: e.shiftCode,
        deskCode: e.deskCode ?? null,
        isPermanence: e.isPermanence,
        permanenceLevel: e.permanenceLevel,
        isLocked: false,
        requestedOff: e.requestedOff,
      }))
    );
  }

  // Persist updated violations for the whole month
  await db
    .update(planningMonthsTable)
    .set({ violations: violations as unknown as Record<string, unknown>[] })
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
  if (parsed.data.deskCode !== undefined) updateData.deskCode = parsed.data.deskCode ?? null;
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
    deskCode: row.deskCode ?? null,
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
    .set({ status: "draft", generatedAt: null, confirmedAt: null, violations: null })
    .where(eq(planningMonthsTable.id, pm.id))
    .returning();
  res.json({ cleared: true, status: updated?.status ?? "draft" });
});

export default router;
