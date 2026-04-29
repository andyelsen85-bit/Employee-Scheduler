import { pgTable, serial, integer, real, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const monthlyConfigsTable = pgTable("monthly_configs", {
  id: serial("id").primaryKey(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  contractualHours: real("contractual_hours").notNull(),
  jlDays: integer("jl_days").notNull().default(0),
  notes: text("notes"),
});

export const insertMonthlyConfigSchema = createInsertSchema(monthlyConfigsTable).omit({ id: true });
export type InsertMonthlyConfig = z.infer<typeof insertMonthlyConfigSchema>;
export type MonthlyConfig = typeof monthlyConfigsTable.$inferSelect;
