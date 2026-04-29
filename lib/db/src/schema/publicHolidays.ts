import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const publicHolidaysTable = pgTable("public_holidays", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(),
  name: text("name").notNull(),
  country: text("country").notNull().default("lu"),
});

export const insertPublicHolidaySchema = createInsertSchema(publicHolidaysTable).omit({ id: true });
export type InsertPublicHoliday = z.infer<typeof insertPublicHolidaySchema>;
export type PublicHoliday = typeof publicHolidaysTable.$inferSelect;
