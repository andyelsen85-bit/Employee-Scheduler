import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, officesTable, officeEmployeesTable } from "@workspace/db";
import {
  CreateOfficeBody,
  UpdateOfficeParams,
  UpdateOfficeBody,
  DeleteOfficeParams,
  UpdateOfficeEmployeesParams,
  UpdateOfficeEmployeesBody,
} from "@workspace/api-zod";

const router = Router();

async function getOfficesWithEmployees() {
  const offices = await db.select().from(officesTable).orderBy(officesTable.name);
  const assignments = await db.select().from(officeEmployeesTable);

  return offices.map((o) => ({
    id: o.id,
    name: o.name,
    deskCount: o.deskCount,
    deskCodes: (o.deskCodes as string[]) ?? [],
    employeeIds: assignments.filter((a) => a.officeId === o.id).map((a) => a.employeeId),
  }));
}

router.get("/offices", async (_req, res): Promise<void> => {
  res.json(await getOfficesWithEmployees());
});

router.post("/offices", async (req, res): Promise<void> => {
  const parsed = CreateOfficeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [office] = await db
    .insert(officesTable)
    .values({
      name: parsed.data.name,
      deskCount: parsed.data.deskCount,
      deskCodes: parsed.data.deskCodes ?? [],
    })
    .returning();

  if (parsed.data.employeeIds && parsed.data.employeeIds.length > 0) {
    await db.insert(officeEmployeesTable).values(
      parsed.data.employeeIds.map((eid) => ({ officeId: office.id, employeeId: eid }))
    );
  }

  res.status(201).json({
    id: office.id,
    name: office.name,
    deskCount: office.deskCount,
    deskCodes: (office.deskCodes as string[]) ?? [],
    employeeIds: parsed.data.employeeIds ?? [],
  });
});

router.put("/offices/:id", async (req, res): Promise<void> => {
  const params = UpdateOfficeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateOfficeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Partial<typeof officesTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.deskCount !== undefined) updateData.deskCount = parsed.data.deskCount;
  if (parsed.data.deskCodes !== undefined) updateData.deskCodes = parsed.data.deskCodes;

  const [office] = await db
    .update(officesTable)
    .set(updateData)
    .where(eq(officesTable.id, params.data.id))
    .returning();
  if (!office) {
    res.status(404).json({ error: "Office not found" });
    return;
  }
  const oeRows = await db
    .select()
    .from(officeEmployeesTable)
    .where(eq(officeEmployeesTable.officeId, office.id));
  res.json({
    id: office.id,
    name: office.name,
    deskCount: office.deskCount,
    deskCodes: (office.deskCodes as string[]) ?? [],
    employeeIds: oeRows.map((a) => a.employeeId),
  });
});

router.delete("/offices/:id", async (req, res): Promise<void> => {
  const params = UpdateOfficeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(officeEmployeesTable).where(eq(officeEmployeesTable.officeId, params.data.id));
  const [row] = await db
    .delete(officesTable)
    .where(eq(officesTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Office not found" });
    return;
  }
  res.sendStatus(204);
});

router.put("/offices/:id/employees", async (req, res): Promise<void> => {
  const params = UpdateOfficeEmployeesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateOfficeEmployeesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await db.delete(officeEmployeesTable).where(eq(officeEmployeesTable.officeId, params.data.id));
  const empIds = parsed.data.employeeIds;
  if (empIds.length > 0) {
    await db.insert(officeEmployeesTable).values(
      empIds.map((eid) => ({ officeId: params.data.id, employeeId: eid }))
    );
  }
  const [office] = await db.select().from(officesTable).where(eq(officesTable.id, params.data.id));
  if (!office) {
    res.status(404).json({ error: "Office not found" });
    return;
  }
  res.json({
    id: office.id,
    name: office.name,
    deskCount: office.deskCount,
    deskCodes: (office.deskCodes as string[]) ?? [],
    employeeIds: empIds,
  });
});

export default router;
