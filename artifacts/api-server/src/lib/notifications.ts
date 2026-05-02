import { eq, isNull, and } from "drizzle-orm";
import {
  db,
  planningDemandsTable,
  demandDecisionsTable,
  employeesTable,
  usersTable,
} from "@workspace/db";
import { createTransport } from "./mailer.js";
import { logger } from "./logger.js";

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

  const byApprover = new Map<number | null, typeof unsentDemands>();
  for (const item of unsentDemands) {
    const approverId = item.employee.approverAdminId ?? null;
    if (!byApprover.has(approverId)) byApprover.set(approverId, []);
    byApprover.get(approverId)!.push(item);
  }

  for (const [approverId, items] of byApprover.entries()) {
    if (!approverId) continue;

    const [approverEmp] = await db.select().from(employeesTable).where(eq(employeesTable.id, approverId));
    if (!approverEmp?.email) continue;

    const lines = items.map(i =>
      `- ${i.employee.name}: requested ${i.demand.demandCode} on ${i.demand.year}-${String(i.demand.month).padStart(2, "0")}-${String(i.demand.day).padStart(2, "0")}`
    );

    try {
      await transporter.sendMail({
        from: fromAddress,
        to: approverEmp.email,
        subject: "HR Planner — New Shift Demands Pending Approval",
        text: `The following shift demands require your approval:\n\n${lines.join("\n")}\n\nPlease log in to HR Planner to approve or reject them.`,
      });
      const ids = items.map(i => i.demand.id);
      for (const id of ids) {
        await db.update(planningDemandsTable).set({ notifiedAt: new Date() }).where(eq(planningDemandsTable.id, id));
      }
    } catch (err) {
      logger.error({ err, approverId }, "Failed to send demand digest to approver");
    }
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

export function startNotificationJob(): void {
  const INTERVAL_MS = 30 * 60 * 1000;

  const run = async () => {
    try {
      await sendDemandDigestsToAdmins();
      await sendDecisionDigestsToEmployees();
    } catch (err) {
      logger.error({ err }, "Notification job error");
    }
  };

  setInterval(run, INTERVAL_MS);
  logger.info("Notification background job started (30-minute interval)");
}
