import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, departmentsTable } from "@workspace/db";
import {
  CreateDepartmentBody,
  UpdateDepartmentBody,
  DeleteDepartmentParams,
  UpdateDepartmentParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/departments", async (_req, res): Promise<void> => {
  const rows = await db.select().from(departmentsTable).orderBy(departmentsTable.order, departmentsTable.name);
  res.json(rows);
});

router.post("/departments", async (req, res): Promise<void> => {
  const parsed = CreateDepartmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(departmentsTable)
    .values({ name: parsed.data.name, order: parsed.data.order ?? 0 })
    .returning();
  res.status(201).json(row);
});

router.put("/departments/:id", async (req, res): Promise<void> => {
  const params = UpdateDepartmentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateDepartmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db
    .update(departmentsTable)
    .set({ ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}), ...(parsed.data.order !== undefined ? { order: parsed.data.order } : {}) })
    .where(eq(departmentsTable.id, params.data.id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/departments/:id", async (req, res): Promise<void> => {
  const params = DeleteDepartmentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(departmentsTable).where(eq(departmentsTable.id, params.data.id));
  res.status(204).end();
});

export default router;
