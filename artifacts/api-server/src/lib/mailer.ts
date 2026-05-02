import nodemailer from "nodemailer";
import { db, mailSettingsTable } from "@workspace/db";
import { decrypt } from "./crypto.js";

export async function createTransport(): Promise<nodemailer.Transporter | null> {
  const rows = await db.select().from(mailSettingsTable);
  const settings = rows[0];
  if (!settings?.smtpHost || !settings?.smtpUser || !settings?.smtpPasswordEncrypted || !settings?.fromAddress) {
    return null;
  }

  let password: string;
  try {
    password = decrypt(settings.smtpPasswordEncrypted);
  } catch {
    return null;
  }

  const secure = settings.smtpSecure === "ssl";
  const transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort ?? 587,
    secure,
    auth: {
      user: settings.smtpUser,
      pass: password,
    },
    from: settings.fromAddress,
  } as nodemailer.TransportOptions);

  return transporter;
}
