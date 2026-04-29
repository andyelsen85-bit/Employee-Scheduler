import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const officesTable = pgTable("offices", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  deskCount: integer("desk_count").notNull().default(1),
  deskCodes: jsonb("desk_codes").notNull().default([]),
  heightAdjustableDesks: jsonb("height_adjustable_desks")
    .notNull()
    .$type<string[]>()
    .default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const officeEmployeesTable = pgTable("office_employees", {
  officeId: integer("office_id").notNull(),
  employeeId: integer("employee_id").notNull(),
});

export const insertOfficeSchema = createInsertSchema(officesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertOffice = z.infer<typeof insertOfficeSchema>;
export type Office = typeof officesTable.$inferSelect;
