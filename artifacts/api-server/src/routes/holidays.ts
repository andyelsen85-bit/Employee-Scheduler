import { requireAdmin } from "../middleware/auth.js";
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, publicHolidaysTable } from "@workspace/db";
import {
  ListHolidaysQueryParams,
  CreateHolidayBody,
  UpdateHolidayParams,
  UpdateHolidayBody,
  DeleteHolidayParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/holidays", async (req, res): Promise<void> => {
  const qp = ListHolidaysQueryParams.safeParse(req.query);
  let rows = await db.select().from(publicHolidaysTable).orderBy(publicHolidaysTable.date);
  if (qp.success && qp.data.year) {
    const yearStr = String(qp.data.year);
    rows = rows.filter((r) => r.date.startsWith(yearStr));
  }
  res.json(rows);
});

router.post("/holidays", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateHolidayBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(publicHolidaysTable)
    .values({ date: parsed.data.date, name: parsed.data.name, country: parsed.data.country })
    .returning();
  res.status(201).json(row);
});

router.put("/holidays/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateHolidayParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateHolidayBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .update(publicHolidaysTable)
    .set({ date: parsed.data.date, name: parsed.data.name, country: parsed.data.country })
    .where(eq(publicHolidaysTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Holiday not found" });
    return;
  }
  res.json(row);
});

router.delete("/holidays/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteHolidayParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .delete(publicHolidaysTable)
    .where(eq(publicHolidaysTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Holiday not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
