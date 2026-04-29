import { Router } from "express";
import { eq, and, isNotNull } from "drizzle-orm";
import {
  db,
  employeesTable,
  officesTable,
  planningMonthsTable,
  planningEntriesTable,
  shiftCodesTable,
  permanenceOverridesTable,
} from "@workspace/db";
import { GetDashboardSummaryQueryParams } from "@workspace/api-zod";

const router = Router();

function getISOWeeksInYear(year: number): number {
  const dec28 = new Date(year, 11, 28);
  const jan1 = new Date(year, 0, 1);
  const dayOfWeek = (jan1.getDay() + 6) % 7;
  const dec28Iso = Math.ceil((((dec28.getTime() - jan1.getTime()) / 86400000) + dayOfWeek + 1) / 7);
  return dec28Iso;
}

function getISOWeekStart(year: number, week: number): string {
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = (jan4.getDay() + 6) % 7;
  const weekStart = new Date(jan4.getTime() - dayOfWeek * 86400000 + (week - 1) * 7 * 86400000);
  return weekStart.toISOString().split("T")[0];
}

function getWeekEnd(weekStart: string): string {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  return d.toISOString().split("T")[0];
}

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const qp = GetDashboardSummaryQueryParams.safeParse(req.query);
  const now = new Date();
  const year = qp.success && qp.data.year ? qp.data.year : now.getFullYear();
  const month = qp.success && qp.data.month ? qp.data.month : now.getMonth() + 1;

  const employees = await db.select().from(employeesTable);
  const offices = await db.select().from(officesTable);
  const shiftCodes = await db.select().from(shiftCodesTable);

  const scMap: Record<string, { hours: number; type: string }> = {};
  for (const sc of shiftCodes) scMap[sc.code] = { hours: sc.hours, type: sc.type };

  const totalDesks = offices.reduce((sum, o) => sum + o.deskCount, 0);

  const [pm] = await db
    .select()
    .from(planningMonthsTable)
    .where(and(eq(planningMonthsTable.year, year), eq(planningMonthsTable.month, month)));

  const entries = pm
    ? await db.select().from(planningEntriesTable).where(eq(planningEntriesTable.planningMonthId, pm.id))
    : [];

  const employeeStats = employees.map((emp) => {
    const empEntries = entries.filter((e) => e.employeeId === emp.id);
    const onsiteEntries = empEntries.filter((e) => e.shiftCode && scMap[e.shiftCode]?.type === "onsite");
    const homeworkEntries = empEntries.filter((e) => e.shiftCode && scMap[e.shiftCode]?.type === "homework");
    const coworkEntries = empEntries.filter((e) => e.shiftCode && scMap[e.shiftCode]?.type === "cowork");
    const holidayEntries = empEntries.filter(
      (e) => e.shiftCode && (scMap[e.shiftCode]?.type === "holiday" || scMap[e.shiftCode]?.type === "jl")
    );
    const totalPlannedHours = empEntries.reduce(
      (sum, e) => sum + (e.shiftCode ? scMap[e.shiftCode]?.hours ?? 0 : 0),
      0
    );
    return {
      employeeId: emp.id,
      name: emp.name,
      prmCounter: emp.prmCounter,
      holidayHoursRemaining: emp.holidayHoursRemaining,
      homeworkDaysUsedThisYear: emp.homeworkDaysUsedThisYear,
      plannedOnsiteDays: onsiteEntries.length,
      plannedHomeworkDays: homeworkEntries.length,
      plannedCoworkDays: coworkEntries.length,
      plannedHolidayDays: holidayEntries.length,
      totalPlannedHours,
    };
  });

  const dateSet = [...new Set(entries.map((e) => e.date))].sort();
  const dailyOnsiteRate = dateSet.map((date) => {
    const onsiteCount = entries.filter(
      (e) => e.date === date && e.shiftCode && scMap[e.shiftCode]?.type === "onsite"
    ).length;
    return { date, onsiteCount, totalDesks };
  });

  // Permanence schedule — same rotation logic as permanence page, filtered to this month's weeks
  const permanenceEmployees = await db
    .select({ id: employeesTable.id, name: employeesTable.name, permanenceGroup: employeesTable.permanenceGroup })
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

  // Build week list for the whole year, then filter to weeks overlapping this month
  const totalWeeks = getISOWeeksInYear(year);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEndDate = new Date(year, month, 0);
  const monthEnd = monthEndDate.toISOString().split("T")[0];

  const permanenceSchedule = [];
  for (let w = 1; w <= totalWeeks; w++) {
    const ws = getISOWeekStart(year, w);
    const we = getWeekEnd(ws);
    // Include week if it overlaps with the current month
    if (we < monthStart || ws > monthEnd) continue;
    const g1Override = overrides.find((o) => o.weekNumber === w && o.group === 1);
    const g2Override = overrides.find((o) => o.weekNumber === w && o.group === 2);
    permanenceSchedule.push({
      weekStart: ws,
      weekEnd: we,
      weekNumber: w,
      g1EmployeeId: g1Override ? g1Override.employeeId : rotateAssign(group1, w - 1),
      g2EmployeeId: g2Override ? g2Override.employeeId : rotateAssign(group2, w - 1),
      g1Manual: !!g1Override,
      g2Manual: !!g2Override,
    });
  }

  // Real violations — read from persisted data stored during last generation
  const storedViolations = Array.isArray(pm?.violations) ? (pm.violations as Array<{ type: string; message: string }>) : [];
  const totalViolations = storedViolations.length;

  res.json({
    year,
    month,
    planningStatus: pm?.status ?? "none",
    employeeStats,
    dailyOnsiteRate,
    permanenceSchedule,
    totalViolations,
    violations: storedViolations,
    totalDesks,
  });
});

export default router;
