import { Router } from "express";
import { db, permanenceOverridesTable, employeesTable } from "@workspace/db";
import { and, eq, isNotNull } from "drizzle-orm";

export const permanenceRouter = Router();

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

permanenceRouter.get("/:year", async (req, res) => {
  const year = parseInt(req.params.year, 10);
  if (isNaN(year)) return res.status(400).json({ error: "Invalid year" });

  const totalWeeks = getISOWeeksInYear(year);

  const employees = await db.select({
    id: employeesTable.id,
    name: employeesTable.name,
    permanenceGroup: employeesTable.permanenceGroup,
  }).from(employeesTable).where(isNotNull(employeesTable.permanenceGroup));

  const overrides = await db.select().from(permanenceOverridesTable)
    .where(eq(permanenceOverridesTable.year, year));

  const group1 = employees.filter(e => e.permanenceGroup === 1);
  const group2 = employees.filter(e => e.permanenceGroup === 2);

  function rotateAssign(group: typeof group1, weekIdx: number): number | null {
    if (group.length === 0) return null;
    return group[weekIdx % group.length].id;
  }

  const weeks = [];
  for (let w = 1; w <= totalWeeks; w++) {
    const g1Override = overrides.find(o => o.weekNumber === w && o.group === 1);
    const g2Override = overrides.find(o => o.weekNumber === w && o.group === 2);
    weeks.push({
      week: w,
      weekStart: getISOWeekStart(year, w),
      g1EmployeeId: g1Override ? g1Override.employeeId : rotateAssign(group1, w - 1),
      g2EmployeeId: g2Override ? g2Override.employeeId : rotateAssign(group2, w - 1),
      g1Manual: !!g1Override,
      g2Manual: !!g2Override,
    });
  }

  return res.json({ year, totalWeeks, weeks, employees });
});

permanenceRouter.put("/:year/:week/:group", async (req, res) => {
  const year = parseInt(req.params.year, 10);
  const week = parseInt(req.params.week, 10);
  const group = parseInt(req.params.group, 10);
  const { employeeId } = req.body as { employeeId: number | null };

  if (isNaN(year) || isNaN(week) || isNaN(group) || (group !== 1 && group !== 2)) {
    return res.status(400).json({ error: "Invalid params" });
  }

  if (employeeId === null) {
    await db.delete(permanenceOverridesTable)
      .where(and(
        eq(permanenceOverridesTable.year, year),
        eq(permanenceOverridesTable.weekNumber, week),
        eq(permanenceOverridesTable.group, group)
      ));
    return res.json({ deleted: true });
  }

  const existing = await db.select().from(permanenceOverridesTable)
    .where(and(
      eq(permanenceOverridesTable.year, year),
      eq(permanenceOverridesTable.weekNumber, week),
      eq(permanenceOverridesTable.group, group)
    ));

  if (existing.length > 0) {
    await db.update(permanenceOverridesTable)
      .set({ employeeId })
      .where(and(
        eq(permanenceOverridesTable.year, year),
        eq(permanenceOverridesTable.weekNumber, week),
        eq(permanenceOverridesTable.group, group)
      ));
  } else {
    await db.insert(permanenceOverridesTable).values({ year, weekNumber: week, group, employeeId });
  }

  return res.json({ year, week, group, employeeId });
});
