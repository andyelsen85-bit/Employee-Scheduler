import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, monthlyConfigsTable } from "@workspace/db";
import {
  GetMonthlyConfigParams,
  UpsertMonthlyConfigParams,
  UpsertMonthlyConfigBody,
} from "@workspace/api-zod";

const router = Router();

router.get("/monthly-configs", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(monthlyConfigsTable)
    .orderBy(monthlyConfigsTable.year, monthlyConfigsTable.month);
  res.json(rows);
});

router.get("/monthly-configs/:year/:month", async (req, res): Promise<void> => {
  const params = GetMonthlyConfigParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(monthlyConfigsTable)
    .where(
      and(
        eq(monthlyConfigsTable.year, params.data.year),
        eq(monthlyConfigsTable.month, params.data.month)
      )
    );
  if (!row) {
    res.status(404).json({ error: "Monthly config not found" });
    return;
  }
  res.json(row);
});

router.put("/monthly-configs/:year/:month", async (req, res): Promise<void> => {
  const params = UpsertMonthlyConfigParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpsertMonthlyConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await db
    .select()
    .from(monthlyConfigsTable)
    .where(
      and(
        eq(monthlyConfigsTable.year, params.data.year),
        eq(monthlyConfigsTable.month, params.data.month)
      )
    );

  let row;
  if (existing.length > 0) {
    [row] = await db
      .update(monthlyConfigsTable)
      .set({
        contractualHours: parsed.data.contractualHours,
        jlDates: parsed.data.jlDates as string[],
        notes: parsed.data.notes ?? null,
      })
      .where(eq(monthlyConfigsTable.id, existing[0].id))
      .returning();
  } else {
    [row] = await db
      .insert(monthlyConfigsTable)
      .values({
        year: params.data.year,
        month: params.data.month,
        contractualHours: parsed.data.contractualHours,
        jlDates: parsed.data.jlDates as string[],
        notes: parsed.data.notes ?? null,
      })
      .returning();
  }
  res.json(row);
});

export default router;
