import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { employeesTable } from "./employees";

export const planningDemandsTable = pgTable("planning_demands", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  day: integer("day").notNull(),
  demandCode: text("demand_code").notNull(),
  status: text("status").notNull().default("pending"),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const demandDecisionsTable = pgTable("demand_decisions", {
  id: serial("id").primaryKey(),
  demandId: integer("demand_id").notNull().references(() => planningDemandsTable.id, { onDelete: "cascade" }),
  adminId: integer("admin_id").references(() => employeesTable.id, { onDelete: "set null" }),
  decision: text("decision").notNull(),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPlanningDemandSchema = createInsertSchema(planningDemandsTable).omit({ id: true, createdAt: true });
export const insertDemandDecisionSchema = createInsertSchema(demandDecisionsTable).omit({ id: true, createdAt: true });
export type InsertPlanningDemand = z.infer<typeof insertPlanningDemandSchema>;
export type InsertDemandDecision = z.infer<typeof insertDemandDecisionSchema>;
export type PlanningDemand = typeof planningDemandsTable.$inferSelect;
export type DemandDecision = typeof demandDecisionsTable.$inferSelect;
