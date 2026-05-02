import { requireAdmin } from "../middleware/auth.js";
import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db, employeesTable, employeeHolidayBalancesTable, holidayBalanceLogTable, shiftCodesTable } from "@workspace/db";
import {
  CreateEmployeeBody,
  UpdateEmployeeBody,
  GetEmployeeParams,
  UpdateEmployeeParams,
  DeleteEmployeeParams,
  UpdateEmployeeCountersParams,
  UpdateEmployeeCountersBody,
  BulkResetBalancesBody,
} from "@workspace/api-zod";

const router = Router();

async function getEmployeeWithBalances(id: number) {
  const [row] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.id, id));
  if (!row) return null;
  const balances = await db
    .select()
    .from(employeeHolidayBalancesTable)
    .where(eq(employeeHolidayBalancesTable.employeeId, id));
  return {
    ...row,
    holidayBalances: balances.map((b) => ({
      shiftCode: b.shiftCodeCode,
      balanceHours: b.balanceHours,
    })),
  };
}

router.get("/employees", async (req, res): Promise<void> => {
  const rows = await db.select().from(employeesTable).orderBy(employeesTable.name);

  const balancesByEmp: Record<number, { shiftCode: string; balanceHours: number }[]> = {};
  try {
    const balanceRows = await db.select().from(employeeHolidayBalancesTable);
    for (const b of balanceRows) {
      if (!balancesByEmp[b.employeeId]) balancesByEmp[b.employeeId] = [];
      balancesByEmp[b.employeeId].push({ shiftCode: b.shiftCodeCode, balanceHours: b.balanceHours });
    }
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    const pgCode = e?.code ?? e?.cause?.code;
    if (pgCode === "42P01") {
      req.log.warn(
        { err },
        "employee_holiday_balances table missing — returning employees without balances",
      );
    } else {
      req.log.error({ err }, "Failed to load employee holiday balances");
      res.status(500).json({ error: "Failed to load employees" });
      return;
    }
  }

  res.json(
    rows.map((r) => ({
      ...r,
      holidayBalances: balancesByEmp[r.id] ?? [],
    }))
  );
});

router.post("/employees", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateEmployeeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const [row] = await db
    .insert(employeesTable)
    .values({
      name: data.name,
      country: data.country,
      contractPercent: data.contractPercent,
      weeklyContractHours: data.weeklyContractHours,
      homeworkEligible: data.homeworkEligible,
      coworkEligible: data.coworkEligible,
      allowedShiftCodes: data.allowedShiftCodes as string[],
      permanenceGroup: data.permanenceGroup ?? null,
      permanenceLevel: data.permanenceLevel ?? null,
      isSpoc: data.isSpoc,
      spocRotates: data.spocRotates ?? false,
      isManagement: data.isManagement,
      prmCounter: data.prmCounter ?? 0,
      holidayHoursRemaining: data.holidayHoursRemaining ?? 273.6,
      overtimeHours: data.overtimeHours ?? 0,
      homeworkDaysUsedThisYear: data.homeworkDaysUsedThisYear ?? 0,
      departmentId: data.departmentId ?? null,
      preferredOfficeId: data.preferredOfficeId ?? null,
      notes: data.notes ?? null,
    })
    .returning();
  res.status(201).json({ ...row, holidayBalances: [] });
});

router.get("/employees/:id", async (req, res): Promise<void> => {
  const params = GetEmployeeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const emp = await getEmployeeWithBalances(params.data.id);
  if (!emp) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }
  res.json(emp);
});

router.put("/employees/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateEmployeeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateEmployeeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const updateData: Partial<typeof employeesTable.$inferInsert> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.country !== undefined) updateData.country = data.country;
  if (data.contractPercent !== undefined) updateData.contractPercent = data.contractPercent;
  if (data.weeklyContractHours !== undefined) updateData.weeklyContractHours = data.weeklyContractHours;
  if (data.homeworkEligible !== undefined) updateData.homeworkEligible = data.homeworkEligible;
  if (data.coworkEligible !== undefined) updateData.coworkEligible = data.coworkEligible;
  if (data.allowedShiftCodes !== undefined) updateData.allowedShiftCodes = data.allowedShiftCodes as string[];
  if (data.permanenceGroup !== undefined) updateData.permanenceGroup = data.permanenceGroup ?? null;
  if (data.permanenceLevel !== undefined) updateData.permanenceLevel = data.permanenceLevel ?? null;
  if (data.isSpoc !== undefined) updateData.isSpoc = data.isSpoc;
  if (data.spocRotates !== undefined) updateData.spocRotates = data.spocRotates;
  if (data.isManagement !== undefined) updateData.isManagement = data.isManagement;
  if (data.dayCodePreferences !== undefined) updateData.dayCodePreferences = (data.dayCodePreferences ?? null) as unknown as Record<string, string> | null;
  if (data.prefersHeightAdjustableDesk !== undefined) updateData.prefersHeightAdjustableDesk = data.prefersHeightAdjustableDesk ?? undefined;
  if (data.departmentId !== undefined) updateData.departmentId = data.departmentId ?? null;
  if (data.preferredOfficeId !== undefined) updateData.preferredOfficeId = data.preferredOfficeId ?? null;
  if (data.onsiteWeekRatio !== undefined) updateData.onsiteWeekRatio = data.onsiteWeekRatio ?? null;
  if (data.displayOrder !== undefined) updateData.displayOrder = data.displayOrder;
  if (data.notes !== undefined) updateData.notes = data.notes ?? null;
  if (data.role !== undefined) updateData.role = data.role ?? null;
  if (data.email !== undefined) updateData.email = data.email ?? null;
  if (data.approverAdminId !== undefined) updateData.approverAdminId = data.approverAdminId ?? null;

  const [row] = await db
    .update(employeesTable)
    .set(updateData)
    .where(eq(employeesTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }
  const emp = await getEmployeeWithBalances(row.id);
  res.json(emp);
});

router.delete("/employees/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteEmployeeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .delete(employeesTable)
    .where(eq(employeesTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/employees/:id/balance-history", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid employee id" });
    return;
  }
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  const rows = await db
    .select()
    .from(holidayBalanceLogTable)
    .where(eq(holidayBalanceLogTable.employeeId, id))
    .orderBy(desc(holidayBalanceLogTable.createdAt))
    .limit(limit);
  res.json(rows.map((r) => ({
    id: r.id,
    shiftCode: r.shiftCode,
    delta: r.delta,
    previousValue: r.previousValue,
    newValue: r.newValue,
    triggeredBy: r.triggeredBy,
    createdAt: r.createdAt.toISOString(),
  })));
});

router.put("/employees/:id/counters", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateEmployeeCountersParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateEmployeeCountersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;

  // Fetch current values before update so we can compute deltas for the log
  const [currentEmp] = await db
    .select({ holidayHoursRemaining: employeesTable.holidayHoursRemaining })
    .from(employeesTable)
    .where(eq(employeesTable.id, params.data.id));
  if (!currentEmp) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }
  const currentBalances = await db
    .select()
    .from(employeeHolidayBalancesTable)
    .where(eq(employeeHolidayBalancesTable.employeeId, params.data.id));
  const currentBalanceMap: Record<string, number> = {};
  for (const b of currentBalances) currentBalanceMap[b.shiftCodeCode] = b.balanceHours;

  const updateData: Partial<typeof employeesTable.$inferInsert> = {};
  if (data.prmCounter !== undefined) updateData.prmCounter = data.prmCounter;
  if (data.holidayHoursRemaining !== undefined) updateData.holidayHoursRemaining = data.holidayHoursRemaining;
  if (data.overtimeHours !== undefined) updateData.overtimeHours = data.overtimeHours;
  if (data.homeworkDaysUsedThisYear !== undefined) updateData.homeworkDaysUsedThisYear = data.homeworkDaysUsedThisYear;

  const [row] = await db
    .update(employeesTable)
    .set(updateData)
    .where(eq(employeesTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  // Log C0 change if holidayHoursRemaining was updated
  if (data.holidayHoursRemaining !== undefined) {
    const prevValue = currentEmp.holidayHoursRemaining;
    const newValue = data.holidayHoursRemaining;
    const delta = Math.round((newValue - prevValue) * 10) / 10;
    if (delta !== 0) {
      await db.insert(holidayBalanceLogTable).values({
        employeeId: params.data.id,
        shiftCode: "C0",
        delta,
        previousValue: prevValue,
        newValue,
        triggeredBy: "manual_edit",
      });
    }
  }

  // Handle holiday balances upsert for other holiday codes
  if (data.holidayBalances && typeof data.holidayBalances === "object") {
    for (const [code, balance] of Object.entries(data.holidayBalances as Record<string, number>)) {
      const prevValue = currentBalanceMap[code] ?? 0;
      const newValue = balance;
      await db
        .insert(employeeHolidayBalancesTable)
        .values({ employeeId: params.data.id, shiftCodeCode: code, balanceHours: balance })
        .onConflictDoUpdate({
          target: [employeeHolidayBalancesTable.employeeId, employeeHolidayBalancesTable.shiftCodeCode],
          set: { balanceHours: balance, updatedAt: new Date() },
        });
      const delta = Math.round((newValue - prevValue) * 10) / 10;
      if (delta !== 0) {
        await db.insert(holidayBalanceLogTable).values({
          employeeId: params.data.id,
          shiftCode: code,
          delta,
          previousValue: prevValue,
          newValue,
          triggeredBy: "manual_edit",
        });
      }
    }
  }

  const emp = await getEmployeeWithBalances(params.data.id);
  res.json(emp);
});

router.post("/employees/bulk-reset-balances", requireAdmin, async (req, res): Promise<void> => {
  const parsed = BulkResetBalancesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { year = new Date().getFullYear() } = parsed.data;

  // Load shift code defaults from DB to use as fallback when not explicitly provided
  const allShiftCodes = await db.select().from(shiftCodesTable);
  const c0ShiftCode = allShiftCodes.find((sc) => sc.code === "C0");
  const c0Hours = parsed.data.c0Hours ?? (c0ShiftCode?.yearRolloverDefault ?? 273.6);

  // For other holiday codes, use their stored yearRolloverDefault (fall back to 0)
  let balanceDefaults = parsed.data.balanceDefaults ?? {};
  if (parsed.data.balanceDefaults === undefined || parsed.data.balanceDefaults === null) {
    const storedDefaults: Record<string, number> = {};
    for (const sc of allShiftCodes) {
      if (sc.type === "holiday" && sc.code !== "C0" && sc.isActive) {
        storedDefaults[sc.code] = sc.yearRolloverDefault ?? 0;
      }
    }
    balanceDefaults = storedDefaults;
  }

  const allEmployees = await db.select({ id: employeesTable.id, holidayHoursRemaining: employeesTable.holidayHoursRemaining }).from(employeesTable);

  const allBalances = await db.select().from(employeeHolidayBalancesTable);
  const balanceMapByEmp: Record<number, Record<string, number>> = {};
  for (const b of allBalances) {
    if (!balanceMapByEmp[b.employeeId]) balanceMapByEmp[b.employeeId] = {};
    balanceMapByEmp[b.employeeId][b.shiftCodeCode] = b.balanceHours;
  }

  const logEntries: (typeof holidayBalanceLogTable.$inferInsert)[] = [];

  for (const emp of allEmployees) {
    const prevC0 = emp.holidayHoursRemaining;
    const newC0 = c0Hours;
    if (prevC0 !== newC0) {
      logEntries.push({
        employeeId: emp.id,
        shiftCode: "C0",
        delta: Math.round((newC0 - prevC0) * 10) / 10,
        previousValue: prevC0,
        newValue: newC0,
        triggeredBy: `year_rollover_${year}`,
      });
    }

    const empCurrentBalances = balanceMapByEmp[emp.id] ?? {};
    for (const [code, defaultHours] of Object.entries(balanceDefaults as Record<string, number>)) {
      const prev = empCurrentBalances[code] ?? 0;
      if (prev !== defaultHours) {
        logEntries.push({
          employeeId: emp.id,
          shiftCode: code,
          delta: Math.round((defaultHours - prev) * 10) / 10,
          previousValue: prev,
          newValue: defaultHours,
          triggeredBy: `year_rollover_${year}`,
        });
      }
    }

    // Reset balances for codes currently tracked but not in balanceDefaults → set to 0
    for (const [code, prev] of Object.entries(empCurrentBalances)) {
      if (!(code in (balanceDefaults as Record<string, number>)) && prev !== 0) {
        logEntries.push({
          employeeId: emp.id,
          shiftCode: code,
          delta: Math.round((0 - prev) * 10) / 10,
          previousValue: prev,
          newValue: 0,
          triggeredBy: `year_rollover_${year}`,
        });
      }
    }
  }

  // Apply resets
  await db.update(employeesTable).set({ holidayHoursRemaining: c0Hours });

  // Reset all existing employee_holiday_balances to 0 first
  await db.update(employeeHolidayBalancesTable).set({ balanceHours: 0, updatedAt: new Date() });

  // Then upsert configured defaults
  for (const [code, defaultHours] of Object.entries(balanceDefaults as Record<string, number>)) {
    for (const emp of allEmployees) {
      await db
        .insert(employeeHolidayBalancesTable)
        .values({ employeeId: emp.id, shiftCodeCode: code, balanceHours: defaultHours })
        .onConflictDoUpdate({
          target: [employeeHolidayBalancesTable.employeeId, employeeHolidayBalancesTable.shiftCodeCode],
          set: { balanceHours: defaultHours, updatedAt: new Date() },
        });
    }
  }

  if (logEntries.length > 0) {
    await db.insert(holidayBalanceLogTable).values(logEntries);
  }

  req.log.info({ year, employeesReset: allEmployees.length }, "Bulk holiday balance reset completed");

  res.json({ employeesReset: allEmployees.length, year });
});

export default router;
