import { requireAdmin } from "../middleware/auth.js";
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, employeesTable, employeeHolidayBalancesTable } from "@workspace/db";
import {
  CreateEmployeeBody,
  UpdateEmployeeBody,
  GetEmployeeParams,
  UpdateEmployeeParams,
  DeleteEmployeeParams,
  UpdateEmployeeCountersParams,
  UpdateEmployeeCountersBody,
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

  // Handle holiday balances upsert for other holiday codes
  if (data.holidayBalances && typeof data.holidayBalances === "object") {
    for (const [code, balance] of Object.entries(data.holidayBalances as Record<string, number>)) {
      await db
        .insert(employeeHolidayBalancesTable)
        .values({ employeeId: params.data.id, shiftCodeCode: code, balanceHours: balance })
        .onConflictDoUpdate({
          target: [employeeHolidayBalancesTable.employeeId, employeeHolidayBalancesTable.shiftCodeCode],
          set: { balanceHours: balance, updatedAt: new Date() },
        });
    }
  }

  const emp = await getEmployeeWithBalances(params.data.id);
  res.json(emp);
});

export default router;
