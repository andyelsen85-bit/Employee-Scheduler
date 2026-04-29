import { pgTable, serial, text, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const weekTemplatesTable = pgTable("week_templates", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  name: text("name").notNull(),
  days: jsonb("days")
    .notNull()
    .$type<Array<{ dayOfWeek: number; shiftCode: string | null }>>()
    .default([]),
});

export const insertWeekTemplateSchema = createInsertSchema(weekTemplatesTable).omit({ id: true });
export type InsertWeekTemplate = z.infer<typeof insertWeekTemplateSchema>;
export type WeekTemplate = typeof weekTemplatesTable.$inferSelect;
