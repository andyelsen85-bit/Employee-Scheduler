import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  real,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const employeesTable = pgTable("employees", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  country: text("country").notNull().default("lu"),
  contractPercent: real("contract_percent").notNull().default(100),
  weeklyContractHours: real("weekly_contract_hours").notNull().default(40),
  homeworkEligible: boolean("homework_eligible").notNull().default(true),
  coworkEligible: boolean("cowork_eligible").notNull().default(true),
  allowedShiftCodes: jsonb("allowed_shift_codes")
    .notNull()
    .$type<string[]>()
    .default([]),
  permanenceGroup: integer("permanence_group"),
  permanenceLevel: integer("permanence_level"),
  isSpoc: boolean("is_spoc").notNull().default(false),
  isManagement: boolean("is_management").notNull().default(false),
  prmCounter: real("prm_counter").notNull().default(0),
  holidayHoursRemaining: real("holiday_hours_remaining").notNull().default(273.6),
  overtimeHours: real("overtime_hours").notNull().default(0),
  homeworkDaysUsedThisYear: integer("homework_days_used_this_year")
    .notNull()
    .default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertEmployeeSchema = createInsertSchema(employeesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employeesTable.$inferSelect;
