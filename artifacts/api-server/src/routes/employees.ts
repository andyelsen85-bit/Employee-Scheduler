import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, employeesTable } from "@workspace/db";
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

router.get("/employees", async (_req, res): Promise<void> => {
  const rows = await db.select().from(employeesTable).orderBy(employeesTable.name);
  res.json(rows);
});

router.post("/employees", async (req, res): Promise<void> => {
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
      isManagement: data.isManagement,
      prmCounter: data.prmCounter ?? 0,
      holidayHoursRemaining: data.holidayHoursRemaining ?? 273.6,
      overtimeHours: data.overtimeHours ?? 0,
      homeworkDaysUsedThisYear: data.homeworkDaysUsedThisYear ?? 0,
      notes: data.notes ?? null,
    })
    .returning();
  res.status(201).json(row);
});

router.get("/employees/:id", async (req, res): Promise<void> => {
  const params = GetEmployeeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }
  res.json(row);
});

router.put("/employees/:id", async (req, res): Promise<void> => {
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
  if (data.isManagement !== undefined) updateData.isManagement = data.isManagement;
  if (data.dayCodePreferences !== undefined) updateData.dayCodePreferences = (data.dayCodePreferences ?? null) as unknown as Record<string, string> | null;
  if (data.prefersHeightAdjustableDesk !== undefined) updateData.prefersHeightAdjustableDesk = data.prefersHeightAdjustableDesk ?? undefined;
  if (data.notes !== undefined) updateData.notes = data.notes ?? null;

  const [row] = await db
    .update(employeesTable)
    .set(updateData)
    .where(eq(employeesTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }
  res.json(row);
});

router.delete("/employees/:id", async (req, res): Promise<void> => {
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

router.put("/employees/:id/counters", async (req, res): Promise<void> => {
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
  res.json(row);
});

export default router;
