import {
  pgTable,
  serial,
  text,
  integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const mailSettingsTable = pgTable("mail_settings", {
  id: serial("id").primaryKey(),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port").default(587),
  smtpUser: text("smtp_user"),
  smtpPasswordEncrypted: text("smtp_password_encrypted"),
  fromAddress: text("from_address"),
  smtpSecure: text("smtp_secure").default("starttls"),
});

export const insertMailSettingsSchema = createInsertSchema(mailSettingsTable).omit({ id: true });
export type InsertMailSettings = z.infer<typeof insertMailSettingsSchema>;
export type MailSettings = typeof mailSettingsTable.$inferSelect;
