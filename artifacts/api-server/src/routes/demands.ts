import { Router } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  planningDemandsTable,
  demandDecisionsTable,
  planningEntriesTable,
  planningMonthsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = Router();

router.get("/demands", requireAuth, async (req, res): Promise<void> => {
  const { year, month } = req.query as { year?: string; month?: string };
  if (!year || !month) {
    res.status(400).json({ error: "year and month are required" });
    return;
  }
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);

  const sessionUserId = req.session.userId!;
  const [sessionUser] = await db.select().from(usersTable).where(eq(usersTable.id, sessionUserId));

  if (!sessionUser) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const isAdmin = sessionUser.role === "admin";

  if (!isAdmin && sessionUser.employeeId == null) {
    res.json([]);
    return;
  }

  const baseCondition = and(eq(planningDemandsTable.year, y), eq(planningDemandsTable.month, m));
  const filterCondition = isAdmin
    ? baseCondition
    : and(baseCondition, eq(planningDemandsTable.employeeId, sessionUser.employeeId!));

  const demands = await db
    .select()
    .from(planningDemandsTable)
    .where(filterCondition);

  const decisionsMap = new Map<number, typeof demandDecisionsTable.$inferSelect>();

  if (demands.length > 0) {
    const demandIds = demands.map(d => d.id);
    const allDecisions = await db.select().from(demandDecisionsTable);
    for (const d of allDecisions) {
      if (demandIds.includes(d.demandId)) {
        decisionsMap.set(d.demandId, d);
      }
    }
  }

  const result = demands.map(d => ({
    ...d,
    decision: decisionsMap.get(d.id) ?? null,
  }));

  res.json(result);
});

router.post("/demands", requireAuth, async (req, res): Promise<void> => {
  const { employeeId, year, month, day, demandCode } = req.body as {
    employeeId?: number;
    year?: number;
    month?: number;
    day?: number;
    demandCode?: string;
  };

  if (!employeeId || !year || !month || !day || !demandCode) {
    res.status(400).json({ error: "employeeId, year, month, day, demandCode are required" });
    return;
  }

  // Reject demands for past months
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    res.status(400).json({ error: "Cannot create demands for past months" });
    return;
  }

  // Reject demands for locked planning months
  const [planningMonth] = await db
    .select()
    .from(planningMonthsTable)
    .where(and(eq(planningMonthsTable.year, year), eq(planningMonthsTable.month, month)));
  if (planningMonth?.status === "confirmed") {
    res.status(400).json({ error: "Cannot create demands for a confirmed/locked month" });
    return;
  }

  // Reject if the specific day entry is individually locked
  if (planningMonth) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const [entry] = await db
      .select()
      .from(planningEntriesTable)
      .where(
        and(
          eq(planningEntriesTable.planningMonthId, planningMonth.id),
          eq(planningEntriesTable.employeeId, employeeId),
          eq(planningEntriesTable.date, dateStr)
        )
      );
    if (entry?.isLocked) {
      res.status(400).json({ error: "Cannot create demand for a locked day" });
      return;
    }
  }

  const sessionUserId = req.session.userId!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, sessionUserId));

  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  if (user.role !== "admin" && user.employeeId !== employeeId) {
    res.status(403).json({ error: "Cannot add demands for other employees" });
    return;
  }

  const [existing] = await db
    .select()
    .from(planningDemandsTable)
    .where(
      and(
        eq(planningDemandsTable.employeeId, employeeId),
        eq(planningDemandsTable.year, year),
        eq(planningDemandsTable.month, month),
        eq(planningDemandsTable.day, day)
      )
    );

  let demand;
  if (existing) {
    [demand] = await db
      .update(planningDemandsTable)
      .set({ demandCode, status: "pending", notifiedAt: null })
      .where(eq(planningDemandsTable.id, existing.id))
      .returning();
  } else {
    [demand] = await db
      .insert(planningDemandsTable)
      .values({ employeeId, year, month, day, demandCode, status: "pending" })
      .returning();
  }

  res.status(201).json(demand);
});

router.delete("/demands/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid demand ID" });
    return;
  }

  const sessionUserId = req.session.userId!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, sessionUserId));
  const [demand] = await db.select().from(planningDemandsTable).where(eq(planningDemandsTable.id, id));

  if (!demand) {
    res.status(404).json({ error: "Demand not found" });
    return;
  }

  if (user?.role !== "admin" && user?.employeeId !== demand.employeeId) {
    res.status(403).json({ error: "Cannot delete demands for other employees" });
    return;
  }

  await db.delete(planningDemandsTable).where(eq(planningDemandsTable.id, id));
  res.sendStatus(204);
});

router.patch("/demands/:id/decision", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid demand ID" });
    return;
  }

  const { decision } = req.body as { decision?: string };
  if (!decision || !["approved", "rejected"].includes(decision)) {
    res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
    return;
  }

  const [demand] = await db.select().from(planningDemandsTable).where(eq(planningDemandsTable.id, id));
  if (!demand) {
    res.status(404).json({ error: "Demand not found" });
    return;
  }

  const sessionUserId = req.session.userId!;
  const [adminUser] = await db.select().from(usersTable).where(eq(usersTable.id, sessionUserId));
  const adminEmployeeId = adminUser?.employeeId ?? null;

  const [existingDecision] = await db
    .select()
    .from(demandDecisionsTable)
    .where(eq(demandDecisionsTable.demandId, id));

  let decisionRow;
  if (existingDecision) {
    [decisionRow] = await db
      .update(demandDecisionsTable)
      .set({ decision, adminId: adminEmployeeId, notifiedAt: null })
      .where(eq(demandDecisionsTable.id, existingDecision.id))
      .returning();
  } else {
    [decisionRow] = await db
      .insert(demandDecisionsTable)
      .values({ demandId: id, adminId: adminEmployeeId, decision, notifiedAt: null })
      .returning();
  }

  const status = decision === "approved" ? "approved" : "rejected";
  const [updatedDemand] = await db
    .update(planningDemandsTable)
    .set({ status })
    .where(eq(planningDemandsTable.id, id))
    .returning();

  if (decision === "approved") {
    const dateStr = `${updatedDemand.year}-${String(updatedDemand.month).padStart(2, "0")}-${String(updatedDemand.day).padStart(2, "0")}`;
    let [pm] = await db
      .select()
      .from(planningMonthsTable)
      .where(and(eq(planningMonthsTable.year, updatedDemand.year), eq(planningMonthsTable.month, updatedDemand.month)));

    if (!pm) {
      [pm] = await db
        .insert(planningMonthsTable)
        .values({ year: updatedDemand.year, month: updatedDemand.month, status: "draft" })
        .returning();
    }

    const [existingEntry] = await db
      .select()
      .from(planningEntriesTable)
      .where(
        and(
          eq(planningEntriesTable.planningMonthId, pm.id),
          eq(planningEntriesTable.employeeId, updatedDemand.employeeId),
          eq(planningEntriesTable.date, dateStr)
        )
      );

    if (existingEntry) {
      await db
        .update(planningEntriesTable)
        .set({ shiftCode: updatedDemand.demandCode, isLocked: true })
        .where(eq(planningEntriesTable.id, existingEntry.id));
    } else {
      await db.insert(planningEntriesTable).values({
        planningMonthId: pm.id,
        employeeId: updatedDemand.employeeId,
        date: dateStr,
        shiftCode: updatedDemand.demandCode,
        isLocked: true,
      });
    }
  }

  res.json({ demand: updatedDemand, decision: decisionRow });
});

export default router;
