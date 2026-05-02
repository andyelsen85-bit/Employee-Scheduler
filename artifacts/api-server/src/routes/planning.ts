import { Router } from "express";
import { eq, and, ne, isNotNull, sql, inArray } from "drizzle-orm";
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
  spocRotationOverridesTable,
  appSettingsTable,
  employeeHolidayBalancesTable,
  holidayBalanceLogTable,
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
import { requireAdmin } from "../middleware/auth.js";

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

async function buildSpocRotationAssignments(
  year: number,
  month: number
): Promise<{ assignments: Record<string, number | null>; officeId: number | null }> {
  const spocs = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.spocRotates, true));

  const overrides = await db
    .select()
    .from(spocRotationOverridesTable)
    .where(eq(spocRotationOverridesTable.year, year));

  const settingRows = await db.select().from(appSettingsTable);
  const rotationOfficeIdStr = settingRows.find((r) => r.key === "spoc_rotation_office_id")?.value ?? null;
  const officeId = rotationOfficeIdStr ? parseInt(rotationOfficeIdStr, 10) : null;

  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEndDate = new Date(year, month, 0);
  const monthEnd = monthEndDate.toISOString().split("T")[0];

  const totalWeeks = getISOWeeksInYear(year);
  const assignments: Record<string, number | null> = {};

  for (let w = 1; w <= totalWeeks; w++) {
    const ws = getISOWeekStart(year, w);
    const weDate = new Date(ws);
    weDate.setDate(weDate.getDate() + 6);
    const we = weDate.toISOString().split("T")[0];
    if (we < monthStart || ws > monthEnd) continue;

    const override = overrides.find((o) => o.weekNumber === w);
    if (override) {
      assignments[ws] = override.employeeId;
    } else if (spocs.length > 0) {
      assignments[ws] = spocs[(w - 1) % spocs.length].id;
    } else {
      assignments[ws] = null;
    }
  }

  return { assignments, officeId };
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

/** Week key: ISO week start date (Monday) as YYYY-MM-DD */
function weekStartKey(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const dow = d.getUTCDay(); // 0=Sun 6=Sat
  const diff = dow === 0 ? -6 : 1 - dow; // days to Monday
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() + diff);
  return mon.toISOString().slice(0, 10);
}

type OfficeRec = { id: number; deskCodes: string[]; heightAdjustableDesks: string[]; employeeIds: number[] };
type ShiftCodeMap = Record<string, { code: string; hours: number; type: string; scalesWithContract?: boolean }>;
type EmpRec = { id: number; preferredOfficeId: number | null; prefersHeightAdjustableDesk: boolean };

/**
 * After generation, assign desks to locked planning entries that have an onsite
 * shift code but no desk code (common when imported from Excel with only the
 * shift row filled in).
 *
 * Strategy: same desk per employee per week, mirroring the main planner.
 *   – If the employee already received a desk for that ISO week (tracked in
 *     weeklyDeskByEmp), reuse it immediately.
 *   – Otherwise build a "used this week" set from:
 *       1. The initial snapshot (allEntries) filtered to the Mon–Fri window.
 *       2. Desks already assigned during this loop (weeklyDeskByEmp values).
 *     Then pick a free desk from the employee's offices.
 */
async function assignDesksToLockedNoDeskEntries(
  planningMonthId: number,
  offices: OfficeRec[],
  shiftCodes: ShiftCodeMap,
  employees: EmpRec[]
): Promise<void> {
  const allEntries = await db
    .select()
    .from(planningEntriesTable)
    .where(eq(planningEntriesTable.planningMonthId, planningMonthId));

  const empMap = new Map(employees.map((e) => [e.id, e]));

  const needDesk = allEntries
    .filter((e) => e.isLocked && !e.deskCode && e.shiftCode && shiftCodes[e.shiftCode]?.type === "onsite")
    .sort((a, b) => a.date.localeCompare(b.date));

  if (needDesk.length === 0) return;

  // empId → weekKey → desk code assigned in this loop
  const weeklyDeskByEmp: Record<number, Record<string, string>> = {};

  for (const entry of needDesk) {
    const emp = empMap.get(entry.employeeId);
    if (!emp) continue;

    const wk = weekStartKey(entry.date);

    // Same employee, same week → reuse the desk decided earlier
    const alreadyThisWeek = weeklyDeskByEmp[emp.id]?.[wk];
    if (alreadyThisWeek) {
      await db
        .update(planningEntriesTable)
        .set({ deskCode: alreadyThisWeek })
        .where(eq(planningEntriesTable.id, entry.id));
      continue;
    }

    // Build used-desk set for this specific Mon–Fri window
    const wkEnd = (() => {
      const d = new Date(wk + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + 4); // Friday
      return d.toISOString().slice(0, 10);
    })();

    const usedInWeek = new Set<string>();

    // 1. Desks from the initial snapshot that fall in this week
    for (const r of allEntries) {
      if (r.deskCode && r.date >= wk && r.date <= wkEnd) usedInWeek.add(r.deskCode);
    }
    // 2. Desks assigned by earlier iterations of this loop for the same week
    for (const weeks of Object.values(weeklyDeskByEmp)) {
      const d = weeks[wk];
      if (d) usedInWeek.add(d);
    }

    const empOffices = offices.filter((o) => o.employeeIds.includes(emp.id));
    const ordered = emp.preferredOfficeId
      ? [
          ...empOffices.filter((o) => o.id === emp.preferredOfficeId),
          ...empOffices.filter((o) => o.id !== emp.preferredOfficeId),
        ]
      : empOffices;

    let assigned: string | null = null;
    for (const o of ordered) {
      const available = o.deskCodes.filter((dc) => !usedInWeek.has(dc));
      if (available.length === 0) continue;
      const ha = o.heightAdjustableDesks ?? [];
      let pool = available;
      if (emp.prefersHeightAdjustableDesk) {
        const haAvail = available.filter((dc) => ha.includes(dc));
        if (haAvail.length > 0) pool = haAvail;
      } else {
        const nonHa = available.filter((dc) => !ha.includes(dc));
        if (nonHa.length > 0) pool = nonHa;
      }
      assigned = pool[Math.floor(Math.random() * pool.length)];
      break;
    }

    if (!assigned) continue;

    (weeklyDeskByEmp[emp.id] ??= {})[wk] = assigned;

    await db
      .update(planningEntriesTable)
      .set({ deskCode: assigned })
      .where(eq(planningEntriesTable.id, entry.id));
  }
}

async function buildMonthResponse(year: number, month: number) {
  const pm = await getOrCreateMonth(year, month);
  const entries = await db
    .select()
    .from(planningEntriesTable)
    .where(eq(planningEntriesTable.planningMonthId, pm.id))
    .orderBy(planningEntriesTable.date, planningEntriesTable.employeeId);

  // Also fetch entries for the initial partial-week days: days in this month whose ISO week
  // started in the previous month. These were generated and stored as part of the previous
  // month's planning run (overflow days) and must be shown here too.
  const firstDayOfMonth = new Date(`${year}-${String(month).padStart(2, "0")}-01T12:00:00Z`);
  const w = firstDayOfMonth.getUTCDay(); // 0=Sun, 1=Mon, …, 6=Sat
  // Number of days at the start of this month that complete a week started in the previous month
  const numPartialDays = w === 1 ? 0 : w === 0 ? 1 : 8 - w;
  let overflowEntries: typeof entries = [];
  if (numPartialDays > 0) {
    const partialWeekDays: string[] = [];
    for (let i = 0; i < numPartialDays; i++) {
      partialWeekDays.push(
        `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`
      );
    }
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevPmRows = await db
      .select()
      .from(planningMonthsTable)
      .where(and(eq(planningMonthsTable.year, prevYear), eq(planningMonthsTable.month, prevMonth)));
    if (prevPmRows.length > 0) {
      overflowEntries = await db
        .select()
        .from(planningEntriesTable)
        .where(
          and(
            eq(planningEntriesTable.planningMonthId, prevPmRows[0].id),
            inArray(planningEntriesTable.date, partialWeekDays)
          )
        )
        .orderBy(planningEntriesTable.date, planningEntriesTable.employeeId);
    }
  }

  // Deduplicate: if this month's plan already has an entry for an (employeeId, date) pair
  // that also appears in the overflow (prev month's plan), the current month's entry wins.
  // This happens when the user manually locks a code for a partial-week overflow day —
  // both the prev month's auto-generated overflow and the new locked entry would be present
  // without deduplication, causing double-counting in the hours total and duplicate cells.
  const currentMonthSlots = new Set(entries.map((e) => `${e.employeeId}-${e.date}`));
  const filteredOverflow = overflowEntries.filter(
    (e) => !currentMonthSlots.has(`${e.employeeId}-${e.date}`)
  );

  const overflowIds = new Set(filteredOverflow.map((e) => e.id));
  const allEntries = [...filteredOverflow, ...entries];
  const storedViolations = Array.isArray(pm.violations) ? (pm.violations as PlanningViolation[]) : [];

  return {
    year,
    month,
    status: pm.status,
    entries: allEntries.map((e) => ({
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
      isFromPrevMonth: overflowIds.has(e.id),
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

router.post("/planning/:year/:month/generate", requireAdmin, async (req, res): Promise<void> => {
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

  // Build permanence assignments and fetch previous month's overflow JL entries in parallel.
  const firstDay = new Date(`${year}-${String(month).padStart(2, "0")}-01T12:00:00Z`);
  const firstDayDow = firstDay.getUTCDay(); // 0=Sun … 6=Sat
  const numInitialPartialDays = firstDayDow === 1 ? 0 : firstDayDow === 0 ? 1 : 8 - firstDayDow;

  const [precomputedPermanence, spocRotation, prevMonthOverflow] = await Promise.all([
    buildPermanenceAssignments(year, month),
    buildSpocRotationAssignments(year, month),
    (async (): Promise<{ jlCounts: Record<number, number>; shiftHours: Record<number, number> }> => {
      if (numInitialPartialDays === 0) return { jlCounts: {}, shiftHours: {} };
      const partialDays: string[] = [];
      for (let i = 0; i < numInitialPartialDays; i++) {
        partialDays.push(
          `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`
        );
      }
      const prevY = month === 1 ? year - 1 : year;
      const prevM = month === 1 ? 12 : month - 1;
      const prevPmRows = await db
        .select()
        .from(planningMonthsTable)
        .where(and(eq(planningMonthsTable.year, prevY), eq(planningMonthsTable.month, prevM)));
      if (prevPmRows.length === 0) return { jlCounts: {}, shiftHours: {} };
      const prevEntries = await db
        .select()
        .from(planningEntriesTable)
        .where(
          and(
            eq(planningEntriesTable.planningMonthId, prevPmRows[0].id),
            inArray(planningEntriesTable.date, partialDays)
          )
        );
      // Skip dates where the current month's plan already has its own entry for that
      // employee — those overflow entries will be hidden by deduplication in buildMonthResponse,
      // so their hours must NOT be subtracted from the effective target a second time
      // (lockedCurrentShiftHours in the planner already handles the current-month side).
      const currentMonthSlotsFull = new Set(
        existingEntries.map((e) => `${e.employeeId}-${e.date}`)
      );
      const jlCounts: Record<number, number> = {};
      const shiftHours: Record<number, number> = {};
      for (const e of prevEntries) {
        if (currentMonthSlotsFull.has(`${e.employeeId}-${e.date}`)) continue;
        if (e.shiftCode === "JL") {
          jlCounts[e.employeeId] = (jlCounts[e.employeeId] ?? 0) + 1;
        } else if (e.shiftCode && e.shiftCode !== "C0") {
          shiftHours[e.employeeId] = (shiftHours[e.employeeId] ?? 0) + (shiftCodes[e.shiftCode]?.hours ?? 0);
        }
      }
      return { jlCounts, shiftHours };
    })(),
  ]);
  const prevMonthOverflowJlCountByEmployee = prevMonthOverflow.jlCounts;
  const prevMonthOverflowShiftHoursByEmployee = prevMonthOverflow.shiftHours;

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
      spocRotates: e.spocRotates,
      isManagement: e.isManagement,
      prmCounter: e.prmCounter,
      homeworkDaysUsedThisYear: e.homeworkDaysUsedThisYear,
      dayCodePreferences: Array.isArray(e.dayCodePreferences) ? (e.dayCodePreferences as import("../lib/planner.js").DayCodePreference[]) : [],
      prefersHeightAdjustableDesk: e.prefersHeightAdjustableDesk ?? false,
      preferredOfficeId: e.preferredOfficeId ?? null,
      onsiteWeekRatio: e.onsiteWeekRatio ?? null,
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
    spocRotationAssignments: spocRotation.assignments,
    spocRotationOfficeId: spocRotation.officeId,
    prevMonthOverflowJlCountByEmployee,
    prevMonthOverflowShiftHoursByEmployee,
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

  // Assign desks to locked entries that have a shift code but no desk code
  // (e.g. imported via Excel where only the shift row was filled in)
  await assignDesksToLockedNoDeskEntries(pm.id, officesWithEmps, shiftCodes, employees);

  // Persist violations so the GET endpoint and dashboard can show them
  await db
    .update(planningMonthsTable)
    .set({ status: "draft", generatedAt: new Date(), violations: violations as unknown as Record<string, unknown>[] })
    .where(eq(planningMonthsTable.id, pm.id));

  const result = await buildMonthResponse(year, month);
  result.violations = violations;
  res.json(result);
});

router.post("/planning/:year/:month/generate/employee/:employeeId", requireAdmin, async (req, res): Promise<void> => {
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

  const firstDaySingle = new Date(`${year}-${String(month).padStart(2, "0")}-01T12:00:00Z`);
  const firstDayDowSingle = firstDaySingle.getUTCDay();
  const numInitialPartialDaysSingle = firstDayDowSingle === 1 ? 0 : firstDayDowSingle === 0 ? 1 : 8 - firstDayDowSingle;

  const [precomputedPermanence, prevMonthOverflowSingle] = await Promise.all([
    buildPermanenceAssignments(year, month),
    (async (): Promise<{ jlCounts: Record<number, number>; shiftHours: Record<number, number> }> => {
      if (numInitialPartialDaysSingle === 0) return { jlCounts: {}, shiftHours: {} };
      const partialDays: string[] = [];
      for (let i = 0; i < numInitialPartialDaysSingle; i++) {
        partialDays.push(
          `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`
        );
      }
      const prevY = month === 1 ? year - 1 : year;
      const prevM = month === 1 ? 12 : month - 1;
      const prevPmRows = await db
        .select()
        .from(planningMonthsTable)
        .where(and(eq(planningMonthsTable.year, prevY), eq(planningMonthsTable.month, prevM)));
      if (prevPmRows.length === 0) return { jlCounts: {}, shiftHours: {} };
      const prevEntries = await db
        .select()
        .from(planningEntriesTable)
        .where(
          and(
            eq(planningEntriesTable.planningMonthId, prevPmRows[0].id),
            inArray(planningEntriesTable.date, partialDays)
          )
        );
      const currentMonthSlotsSingle = new Set(
        existingEntries.map((e) => `${e.employeeId}-${e.date}`)
      );
      const jlCounts: Record<number, number> = {};
      const shiftHours: Record<number, number> = {};
      for (const e of prevEntries) {
        if (currentMonthSlotsSingle.has(`${e.employeeId}-${e.date}`)) continue;
        if (e.shiftCode === "JL") {
          jlCounts[e.employeeId] = (jlCounts[e.employeeId] ?? 0) + 1;
        } else if (e.shiftCode && e.shiftCode !== "C0") {
          shiftHours[e.employeeId] = (shiftHours[e.employeeId] ?? 0) + (shiftCodes[e.shiftCode]?.hours ?? 0);
        }
      }
      return { jlCounts, shiftHours };
    })(),
  ]);
  const prevMonthOverflowJlCountByEmployeeSingle = prevMonthOverflowSingle.jlCounts;
  const prevMonthOverflowShiftHoursByEmployeeSingle = prevMonthOverflowSingle.shiftHours;

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
      spocRotates: e.spocRotates,
      isManagement: e.isManagement,
      prmCounter: e.prmCounter,
      homeworkDaysUsedThisYear: e.homeworkDaysUsedThisYear,
      dayCodePreferences: Array.isArray(e.dayCodePreferences) ? (e.dayCodePreferences as import("../lib/planner.js").DayCodePreference[]) : [],
      prefersHeightAdjustableDesk: e.prefersHeightAdjustableDesk ?? false,
      preferredOfficeId: e.preferredOfficeId ?? null,
      onsiteWeekRatio: e.onsiteWeekRatio ?? null,
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
    prevMonthOverflowJlCountByEmployee: prevMonthOverflowJlCountByEmployeeSingle,
    prevMonthOverflowShiftHoursByEmployee: prevMonthOverflowShiftHoursByEmployeeSingle,
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

router.post("/planning/:year/:month/confirm", requireAdmin, async (req, res): Promise<void> => {
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
    const shiftCodeMap = new Map(shiftCodeRows.map((sc) => [sc.code, sc]));
    const empRows = await db.select().from(employeesTable);
    const empContractPct: Record<number, number> = {};
    for (const e of empRows) empContractPct[e.id] = e.contractPercent ?? 100;

    // Sum planned hours per employee (all shift codes count toward PRM)
    const plannedByEmployee: Record<number, number> = {};
    // Track hours consumed per employee per holiday-type shift code (for balance decrements)
    const holidayHoursConsumed: Record<number, Record<string, number>> = {};

    for (const entry of entries) {
      if (!entry.shiftCode) continue;
      const sc = shiftCodeMap.get(entry.shiftCode);
      if (!sc) continue;
      const pct = empContractPct[entry.employeeId] ?? 100;
      const hours = sc.scalesWithContract && pct !== 100 ? sc.hours * (pct / 100) : sc.hours;
      plannedByEmployee[entry.employeeId] = (plannedByEmployee[entry.employeeId] ?? 0) + hours;

      // Track holiday code consumption for balance decrements
      if (sc.type === "holiday" && sc.hours > 0) {
        if (!holidayHoursConsumed[entry.employeeId]) {
          holidayHoursConsumed[entry.employeeId] = {};
        }
        holidayHoursConsumed[entry.employeeId][entry.shiftCode] =
          (holidayHoursConsumed[entry.employeeId][entry.shiftCode] ?? 0) + sc.hours;
      }
    }

    // PRM update: include ALL active employees — those with 0 entries still get a negative delta
    for (const e of empRows) {
      const pct = e.contractPercent ?? 100;
      const empContractualHours = Math.round(baseContractualHours * (pct / 100) * 10) / 10;
      const planned = Math.round((plannedByEmployee[e.id] ?? 0) * 10) / 10;
      const diff = Math.round((planned - empContractualHours) * 10) / 10;
      if (diff !== 0) {
        await db
          .update(employeesTable)
          .set({ prmCounter: sql`${employeesTable.prmCounter} + ${diff}` })
          .where(eq(employeesTable.id, e.id));
      }
    }

    // Holiday balance decrements
    const triggeredBy = `planning_confirm:${year}-${String(month).padStart(2, "0")}`;
    for (const [empIdStr, codeHours] of Object.entries(holidayHoursConsumed)) {
      const empId = Number(empIdStr);
      for (const [code, consumed] of Object.entries(codeHours)) {
        if (code === "C0") {
          // C0 is tracked via holidayHoursRemaining on the employees table
          const [empRow] = await db
            .select({ holidayHoursRemaining: employeesTable.holidayHoursRemaining })
            .from(employeesTable)
            .where(eq(employeesTable.id, empId));
          const prevValue = empRow?.holidayHoursRemaining ?? 0;
          const newValue = Math.round((prevValue - consumed) * 10) / 10;
          await db
            .update(employeesTable)
            .set({ holidayHoursRemaining: sql`${employeesTable.holidayHoursRemaining} - ${consumed}` })
            .where(eq(employeesTable.id, empId));
          await db.insert(holidayBalanceLogTable).values({
            employeeId: empId,
            shiftCode: code,
            delta: -consumed,
            previousValue: prevValue,
            newValue,
            triggeredBy,
          });
        } else {
          // All other holiday codes go into employee_holiday_balances (create row if missing)
          const [existingBalance] = await db
            .select({ balanceHours: employeeHolidayBalancesTable.balanceHours })
            .from(employeeHolidayBalancesTable)
            .where(
              and(
                eq(employeeHolidayBalancesTable.employeeId, empId),
                eq(employeeHolidayBalancesTable.shiftCodeCode, code)
              )
            );
          const prevValue = existingBalance?.balanceHours ?? 0;
          const newValue = Math.round((prevValue - consumed) * 10) / 10;
          await db
            .insert(employeeHolidayBalancesTable)
            .values({ employeeId: empId, shiftCodeCode: code, balanceHours: -consumed })
            .onConflictDoUpdate({
              target: [employeeHolidayBalancesTable.employeeId, employeeHolidayBalancesTable.shiftCodeCode],
              set: {
                balanceHours: sql`${employeeHolidayBalancesTable.balanceHours} - ${consumed}`,
                updatedAt: new Date(),
              },
            });
          await db.insert(holidayBalanceLogTable).values({
            employeeId: empId,
            shiftCode: code,
            delta: -consumed,
            previousValue: prevValue,
            newValue,
            triggeredBy,
          });
        }
      }
    }
  }

  res.json(await buildMonthResponse(year, month));
});

// POST /api/planning/:year/:month/entries — upsert a locked entry for an empty or generated month
router.post("/planning/:year/:month/entries", requireAdmin, async (req, res): Promise<void> => {
  const year = parseInt(String(req.params.year), 10);
  const month = parseInt(String(req.params.month), 10);
  if (isNaN(year) || isNaN(month)) {
    res.status(400).json({ error: "Invalid year/month" });
    return;
  }
  const { employeeId, date, shiftCode, deskCode } = req.body as {
    employeeId: number;
    date: string;
    shiftCode?: string | null;
    deskCode?: string | null;
  };
  if (!employeeId || !date) {
    res.status(400).json({ error: "employeeId and date are required" });
    return;
  }

  const pm = await getOrCreateMonth(year, month);

  // Upsert: find existing entry for this employee+date in this planning month
  const [existing] = await db
    .select()
    .from(planningEntriesTable)
    .where(
      and(
        eq(planningEntriesTable.planningMonthId, pm.id),
        eq(planningEntriesTable.employeeId, employeeId),
        eq(planningEntriesTable.date, date),
      ),
    );

  // A null shiftCode means the user is explicitly clearing this day back to "unplanned".
  // In that case we unlock the entry so the next generation can auto-fill it.
  const clearingShift = shiftCode === null;
  const shouldLock = !clearingShift;

  let row;
  if (existing) {
    const update: Partial<typeof planningEntriesTable.$inferInsert> = { isLocked: shouldLock };
    if (shiftCode !== undefined) update.shiftCode = shiftCode ?? null;
    if (deskCode !== undefined) update.deskCode = deskCode ?? null;
    [row] = await db
      .update(planningEntriesTable)
      .set(update)
      .where(eq(planningEntriesTable.id, existing.id))
      .returning();
  } else {
    [row] = await db
      .insert(planningEntriesTable)
      .values({
        planningMonthId: pm.id,
        employeeId,
        date,
        shiftCode: shiftCode ?? null,
        deskCode: deskCode ?? null,
        isLocked: shouldLock,
        isPermanence: false,
        permanenceLevel: null,
        requestedOff: false,
      })
      .returning();
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

router.put("/planning/entries/:id", requireAdmin, async (req, res): Promise<void> => {
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
  // Explicitly clearing the shift code (null) means the user wants this day auto-planned
  // on the next generation. Unlock it so the planner can fill it in.
  // If shiftCode is not part of this update (desk, notes, etc.), always lock — any manual
  // touch to an entry's metadata is an intentional override.
  if (parsed.data.shiftCode !== undefined) {
    updateData.isLocked = parsed.data.shiftCode !== null;
  } else {
    updateData.isLocked = true;
  }

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
// ?keepLocked=true  → delete only unlocked entries (preserves locked/imported entries)
router.delete("/planning/:year/:month", requireAdmin, async (req, res): Promise<void> => {
  const year = parseInt(String(req.params.year), 10);
  const month = parseInt(String(req.params.month), 10);
  if (isNaN(year) || isNaN(month)) {
    res.status(400).json({ error: "Invalid year/month" });
    return;
  }
  const keepLocked = req.query.keepLocked === "true";
  const [pm] = await db
    .select()
    .from(planningMonthsTable)
    .where(and(eq(planningMonthsTable.year, year), eq(planningMonthsTable.month, month)));
  if (!pm) {
    res.status(404).json({ error: "Planning not found" });
    return;
  }
  if (keepLocked) {
    await db
      .delete(planningEntriesTable)
      .where(and(eq(planningEntriesTable.planningMonthId, pm.id), eq(planningEntriesTable.isLocked, false)));
  } else {
    await db.delete(planningEntriesTable).where(eq(planningEntriesTable.planningMonthId, pm.id));
  }
  const [updated] = await db
    .update(planningMonthsTable)
    .set({ status: "draft", generatedAt: null, confirmedAt: null, violations: null })
    .where(eq(planningMonthsTable.id, pm.id))
    .returning();
  res.json({ cleared: true, keepLocked, status: updated?.status ?? "draft" });
});

export default router;
