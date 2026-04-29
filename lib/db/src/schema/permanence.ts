import { pgTable, serial, integer, boolean } from "drizzle-orm/pg-core";

export const permanenceOverridesTable = pgTable("permanence_overrides", {
  id: serial("id").primaryKey(),
  year: integer("year").notNull(),
  weekNumber: integer("week_number").notNull(),
  group: integer("group").notNull(),
  employeeId: integer("employee_id").notNull(),
  isManual: boolean("is_manual").notNull().default(true),
});

export type PermanenceOverride = typeof permanenceOverridesTable.$inferSelect;
