import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const planningMonthsTable = pgTable("planning_months", {
  id: serial("id").primaryKey(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  status: text("status").notNull().default("draft"),
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  violations: jsonb("violations"),
});

export const planningEntriesTable = pgTable("planning_entries", {
  id: serial("id").primaryKey(),
  planningMonthId: integer("planning_month_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  date: text("date").notNull(),
  shiftCode: text("shift_code"),
  deskCode: text("desk_code"),
  isPermanence: boolean("is_permanence").notNull().default(false),
  permanenceLevel: integer("permanence_level"),
  isLocked: boolean("is_locked").notNull().default(false),
  requestedOff: boolean("requested_off").notNull().default(false),
  notes: text("notes"),
});

export const insertPlanningMonthSchema = createInsertSchema(planningMonthsTable).omit({ id: true });
export const insertPlanningEntrySchema = createInsertSchema(planningEntriesTable).omit({ id: true });
export type InsertPlanningMonth = z.infer<typeof insertPlanningMonthSchema>;
export type InsertPlanningEntry = z.infer<typeof insertPlanningEntrySchema>;
export type PlanningMonth = typeof planningMonthsTable.$inferSelect;
export type PlanningEntry = typeof planningEntriesTable.$inferSelect;
