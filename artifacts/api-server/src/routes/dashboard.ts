import { Router } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  employeesTable,
  officesTable,
  planningMonthsTable,
  planningEntriesTable,
  shiftCodesTable,
} from "@workspace/db";
import { GetDashboardSummaryQueryParams } from "@workspace/api-zod";

const router = Router();

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

  const weekStartSet = [...new Set(entries.map((e) => {
    const d = new Date(e.date);
    const dow = d.getDay() === 0 ? 6 : d.getDay() - 1;
    const ms = new Date(d);
    ms.setDate(ms.getDate() - dow);
    return ms.toISOString().split("T")[0];
  }))].sort();

  const permanenceSchedule = weekStartSet.map((ws) => {
    const weekEnd = new Date(ws);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const permaEntries = entries.filter(
      (e) => e.isPermanence && e.date >= ws && e.date <= weekEnd.toISOString().split("T")[0]
    );
    const g1l1 = permaEntries.find((e) => {
      const emp = employees.find((em) => em.id === e.employeeId);
      return emp?.permanenceGroup === 1 && e.permanenceLevel === 1;
    });
    const g1l2 = permaEntries.find((e) => {
      const emp = employees.find((em) => em.id === e.employeeId);
      return emp?.permanenceGroup === 1 && e.permanenceLevel === 2;
    });
    const g2l1 = permaEntries.find((e) => {
      const emp = employees.find((em) => em.id === e.employeeId);
      return emp?.permanenceGroup === 2 && e.permanenceLevel === 1;
    });
    const g2l2 = permaEntries.find((e) => {
      const emp = employees.find((em) => em.id === e.employeeId);
      return emp?.permanenceGroup === 2 && e.permanenceLevel === 2;
    });
    return {
      weekStart: ws,
      weekEnd: weekEnd.toISOString().split("T")[0],
      group1Level1EmployeeId: g1l1?.employeeId ?? null,
      group1Level2EmployeeId: g1l2?.employeeId ?? null,
      group2Level1EmployeeId: g2l1?.employeeId ?? null,
      group2Level2EmployeeId: g2l2?.employeeId ?? null,
    };
  });

  res.json({
    year,
    month,
    planningStatus: pm?.status ?? "none",
    employeeStats,
    dailyOnsiteRate,
    permanenceSchedule,
    totalViolations: 0,
  });
});

export default router;
