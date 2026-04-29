import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, weekTemplatesTable } from "@workspace/db";
import {
  ListEmployeeTemplatesParams,
  CreateWeekTemplateParams,
  CreateWeekTemplateBody,
  UpdateWeekTemplateParams,
  UpdateWeekTemplateBody,
  DeleteWeekTemplateParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/employees/:id/templates", async (req, res): Promise<void> => {
  const params = ListEmployeeTemplatesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(weekTemplatesTable)
    .where(eq(weekTemplatesTable.employeeId, params.data.id))
    .orderBy(weekTemplatesTable.id);
  res.json(rows);
});

router.post("/employees/:id/templates", async (req, res): Promise<void> => {
  const params = CreateWeekTemplateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateWeekTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(weekTemplatesTable)
    .values({
      employeeId: params.data.id,
      name: parsed.data.name,
      days: parsed.data.days as Array<{ dayOfWeek: number; shiftCode: string | null }>,
    })
    .returning();
  res.status(201).json(row);
});

router.put("/templates/:id", async (req, res): Promise<void> => {
  const params = UpdateWeekTemplateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateWeekTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Partial<typeof weekTemplatesTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.days !== undefined) updateData.days = parsed.data.days as Array<{ dayOfWeek: number; shiftCode: string | null }>;

  const [row] = await db
    .update(weekTemplatesTable)
    .set(updateData)
    .where(eq(weekTemplatesTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.json(row);
});

router.delete("/templates/:id", async (req, res): Promise<void> => {
  const params = DeleteWeekTemplateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .delete(weekTemplatesTable)
    .where(eq(weekTemplatesTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
