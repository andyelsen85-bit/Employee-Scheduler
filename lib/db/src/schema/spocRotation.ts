import { pgTable, serial, integer, boolean, text } from "drizzle-orm/pg-core";

export const spocRotationOverridesTable = pgTable("spoc_rotation_overrides", {
  id: serial("id").primaryKey(),
  year: integer("year").notNull(),
  weekNumber: integer("week_number").notNull(),
  employeeId: integer("employee_id").notNull(),
  isManual: boolean("is_manual").notNull().default(true),
});

export type SpocRotationOverride = typeof spocRotationOverridesTable.$inferSelect;

export const appSettingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
});

export type AppSetting = typeof appSettingsTable.$inferSelect;
