import { Router } from "express";
import { db, mailSettingsTable } from "@workspace/db";
import { requireAdmin } from "../middleware/auth.js";
import { createTransport } from "../lib/mailer.js";
import { getNotificationStatus, runNotificationsNow } from "../lib/notifications.js";

const router = Router();

router.get("/settings/mail", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select().from(mailSettingsTable);
  const settings = rows[0] ?? null;
  if (!settings) {
    res.json(null);
    return;
  }
  res.json({
    id: settings.id,
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpUser: settings.smtpUser,
    fromAddress: settings.fromAddress,
    smtpSecure: settings.smtpSecure,
    hasPassword: !!(settings.smtpPasswordEncrypted),
  });
});

router.put("/settings/mail", requireAdmin, async (req, res): Promise<void> => {
  const { smtpHost, smtpPort, smtpUser, smtpPassword, fromAddress, smtpSecure } = req.body as {
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
    smtpPassword?: string;
    fromAddress?: string;
    smtpSecure?: string;
  };

  const { encrypt } = await import("../lib/crypto.js");
  const rows = await db.select().from(mailSettingsTable);
  const existing = rows[0];

  const encrypted = smtpPassword ? encrypt(smtpPassword) : (existing?.smtpPasswordEncrypted ?? null);

  const data = {
    smtpHost: smtpHost ?? null,
    smtpPort: smtpPort ?? 587,
    smtpUser: smtpUser ?? null,
    smtpPasswordEncrypted: encrypted,
    fromAddress: fromAddress ?? null,
    smtpSecure: smtpSecure ?? "starttls",
  };

  let row;
  if (existing) {
    [row] = await db.update(mailSettingsTable).set(data).returning();
  } else {
    [row] = await db.insert(mailSettingsTable).values(data).returning();
  }

  res.json({
    id: row!.id,
    smtpHost: row!.smtpHost,
    smtpPort: row!.smtpPort,
    smtpUser: row!.smtpUser,
    fromAddress: row!.fromAddress,
    smtpSecure: row!.smtpSecure,
    hasPassword: !!(row!.smtpPasswordEncrypted),
  });
});

router.get("/settings/mail/notifications/status", requireAdmin, async (_req, res): Promise<void> => {
  res.json(getNotificationStatus());
});

router.post("/settings/mail/notifications/run-now", requireAdmin, async (_req, res): Promise<void> => {
  const result = await runNotificationsNow();
  if (result.ok) {
    res.json({ ok: true, status: getNotificationStatus() });
  } else {
    res.status(500).json({ ok: false, error: result.error });
  }
});

router.post("/settings/mail/test", requireAdmin, async (req, res): Promise<void> => {
  const { to } = req.body as { to?: string };
  if (!to) {
    res.status(400).json({ error: "to is required" });
    return;
  }

  try {
    const transporter = await createTransport();
    if (!transporter) {
      res.status(400).json({ error: "SMTP not configured" });
      return;
    }
    await transporter.sendMail({
      from: transporter.options ? (transporter.options as Record<string, unknown>).from as string : undefined,
      to,
      subject: "HR Planner — Test Email",
      text: "This is a test email from your HR Planner mail configuration.",
    });
    res.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
