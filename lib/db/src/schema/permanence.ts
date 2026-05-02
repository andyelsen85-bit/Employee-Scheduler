import { pgTable, serial, integer, boolean, unique } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";

export const permanenceOverridesTable = pgTable("permanence_overrides", {
  id: serial("id").primaryKey(),
  year: integer("year").notNull(),
  weekNumber: integer("week_number").notNull(),
  group: integer("group").notNull(),
  employeeId: integer("employee_id").notNull(),
  isManual: boolean("is_manual").notNull().default(true),
});

export const permanenceRotationOrderTable = pgTable("permanence_rotation_order", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  rotationOrder: integer("rotation_order").notNull().default(0),
}, (t) => [unique("permanence_rotation_order_employee_unique").on(t.employeeId)]);

export type PermanenceOverride = typeof permanenceOverridesTable.$inferSelect;
export type PermanenceRotationOrder = typeof permanenceRotationOrderTable.$inferSelect;
