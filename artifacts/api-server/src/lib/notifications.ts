import { eq, isNull } from "drizzle-orm";
import {
  db,
  planningDemandsTable,
  demandDecisionsTable,
  employeesTable,
  usersTable,
} from "@workspace/db";
import { createTransport } from "./mailer.js";
import { logger } from "./logger.js";

export const NOTIFICATION_INTERVAL_MS = 30 * 60 * 1000;

let lastRunAt: Date | null = null;
let nextRunAt: Date | null = null;
let timer: NodeJS.Timeout | null = null;
let running = false;

async function sendDemandDigestsToAdmins(): Promise<void> {
  const transporter = await createTransport();
  if (!transporter) return;

  const fromAddress = (transporter.options as Record<string, unknown>)?.from as string | undefined;

  const unsentDemands = await db
    .select({
      demand: planningDemandsTable,
      employee: employeesTable,
    })
    .from(planningDemandsTable)
    .innerJoin(employeesTable, eq(planningDemandsTable.employeeId, employeesTable.id))
    .where(isNull(planningDemandsTable.notifiedAt));

  if (unsentDemands.length === 0) return;

  // Send a digest to every admin user that has an email address.
  const adminUsers = await db
    .select({ user: usersTable, employee: employeesTable })
    .from(usersTable)
    .leftJoin(employeesTable, eq(usersTable.employeeId, employeesTable.id))
    .where(eq(usersTable.role, "admin"));

  const adminEmails = Array.from(
    new Set(
      adminUsers
        .map(a => a.employee?.email)
        .filter((e): e is string => !!e && e.length > 0),
    ),
  );

  if (adminEmails.length === 0) {
    logger.warn("No admin users with an email address; skipping demand digest");
    return;
  }

  const lines = unsentDemands.map(i =>
    `- ${i.employee.name}: requested ${i.demand.demandCode} on ${i.demand.year}-${String(i.demand.month).padStart(2, "0")}-${String(i.demand.day).padStart(2, "0")}`
  );

  try {
    await transporter.sendMail({
      from: fromAddress,
      to: adminEmails.join(", "),
      subject: "HR Planner — New Shift Demands Pending Approval",
      text: `The following shift demands require approval:\n\n${lines.join("\n")}\n\nPlease log in to HR Planner to approve or reject them.`,
    });
    const ids = unsentDemands.map(i => i.demand.id);
    for (const id of ids) {
      await db.update(planningDemandsTable).set({ notifiedAt: new Date() }).where(eq(planningDemandsTable.id, id));
    }
  } catch (err) {
    logger.error({ err }, "Failed to send demand digest to admins");
  }
}

async function sendDecisionDigestsToEmployees(): Promise<void> {
  const transporter = await createTransport();
  if (!transporter) return;

  const fromAddress = (transporter.options as Record<string, unknown>)?.from as string | undefined;

  const unsentDecisions = await db
    .select({
      decision: demandDecisionsTable,
      demand: planningDemandsTable,
      employee: employeesTable,
    })
    .from(demandDecisionsTable)
    .innerJoin(planningDemandsTable, eq(demandDecisionsTable.demandId, planningDemandsTable.id))
    .innerJoin(employeesTable, eq(planningDemandsTable.employeeId, employeesTable.id))
    .where(isNull(demandDecisionsTable.notifiedAt));

  if (unsentDecisions.length === 0) return;

  const byEmployee = new Map<number, typeof unsentDecisions>();
  for (const item of unsentDecisions) {
    const empId = item.employee.id;
    if (!byEmployee.has(empId)) byEmployee.set(empId, []);
    byEmployee.get(empId)!.push(item);
  }

  for (const [, items] of byEmployee.entries()) {
    const emp = items[0].employee;
    if (!emp.email) continue;

    const lines = items.map(i => {
      const dateStr = `${i.demand.year}-${String(i.demand.month).padStart(2, "0")}-${String(i.demand.day).padStart(2, "0")}`;
      const status = i.decision.decision === "approved" ? "APPROVED ✓" : "REJECTED ✗";
      return `- ${i.demand.demandCode} on ${dateStr}: ${status}`;
    });

    try {
      await transporter.sendMail({
        from: fromAddress,
        to: emp.email,
        subject: "HR Planner — Shift Demand Decisions",
        text: `Your shift demand requests have been reviewed:\n\n${lines.join("\n")}\n\nPlease log in to HR Planner to view your updated planning.`,
      });
      const ids = items.map(i => i.decision.id);
      for (const id of ids) {
        await db.update(demandDecisionsTable).set({ notifiedAt: new Date() }).where(eq(demandDecisionsTable.id, id));
      }
    } catch (err) {
      logger.error({ err }, "Failed to send decision digest to employee");
    }
  }
}

export async function runNotificationsNow(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (running) return { ok: false, error: "Notification job is already running" };
  running = true;
  try {
    await sendDemandDigestsToAdmins();
    await sendDecisionDigestsToEmployees();
    lastRunAt = new Date();
    nextRunAt = new Date(Date.now() + NOTIFICATION_INTERVAL_MS);
    return { ok: true };
  } catch (err) {
    logger.error({ err }, "Manual notification run failed");
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    running = false;
  }
}

export function getNotificationStatus(): {
  intervalMs: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  running: boolean;
} {
  return {
    intervalMs: NOTIFICATION_INTERVAL_MS,
    lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
    nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
    running,
  };
}

export function startNotificationJob(): void {
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await sendDemandDigestsToAdmins();
      await sendDecisionDigestsToEmployees();
      lastRunAt = new Date();
    } catch (err) {
      logger.error({ err }, "Notification job error");
    } finally {
      running = false;
      nextRunAt = new Date(Date.now() + NOTIFICATION_INTERVAL_MS);
    }
  };

  if (timer) clearInterval(timer);
  timer = setInterval(run, NOTIFICATION_INTERVAL_MS);
  nextRunAt = new Date(Date.now() + NOTIFICATION_INTERVAL_MS);
  logger.info("Notification background job started (30-minute interval)");
}
