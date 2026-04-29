import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, shiftCodesTable } from "@workspace/db";
import {
  CreateShiftCodeBody,
  UpdateShiftCodeParams,
  UpdateShiftCodeBody,
  DeleteShiftCodeParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/shift-codes", async (_req, res): Promise<void> => {
  const rows = await db.select().from(shiftCodesTable).orderBy(shiftCodesTable.code);
  res.json(rows);
});

router.post("/shift-codes", async (req, res): Promise<void> => {
  const parsed = CreateShiftCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(shiftCodesTable).values({
    code: parsed.data.code,
    label: parsed.data.label,
    hours: parsed.data.hours,
    type: parsed.data.type,
    isActive: parsed.data.isActive ?? true,
  }).returning();
  res.status(201).json(row);
});

router.put("/shift-codes/:code", async (req, res): Promise<void> => {
  const params = UpdateShiftCodeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateShiftCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Partial<typeof shiftCodesTable.$inferInsert> = {};
  if (parsed.data.label !== undefined) updateData.label = parsed.data.label;
  if (parsed.data.hours !== undefined) updateData.hours = parsed.data.hours;
  if (parsed.data.type !== undefined) updateData.type = parsed.data.type;
  if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;

  const [row] = await db
    .update(shiftCodesTable)
    .set(updateData)
    .where(eq(shiftCodesTable.code, params.data.code))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Shift code not found" });
    return;
  }
  res.json(row);
});

router.delete("/shift-codes/:code", async (req, res): Promise<void> => {
  const params = DeleteShiftCodeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .delete(shiftCodesTable)
    .where(eq(shiftCodesTable.code, params.data.code))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Shift code not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
