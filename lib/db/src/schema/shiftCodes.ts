import { pgTable, text, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const shiftCodesTable = pgTable("shift_codes", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  hours: real("hours").notNull(),
  type: text("type").notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

export const insertShiftCodeSchema = createInsertSchema(shiftCodesTable);
export type InsertShiftCode = z.infer<typeof insertShiftCodeSchema>;
export type ShiftCode = typeof shiftCodesTable.$inferSelect;
