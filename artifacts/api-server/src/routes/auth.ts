import { Router } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import type { Request } from "express";
import { requireAuth } from "../middleware/auth.js";

declare module "express-session" {
  interface SessionData {
    userId: number;
    role: string;
  }
}

const router = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));
  if (!user) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  let valid = false;
  if (user.isLegacy) {
    valid = user.passwordHash === password;
  } else {
    valid = await bcrypt.compare(password, user.passwordHash);
  }

  if (!valid) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.save((err) => {
    if (err) {
      res.status(500).json({ error: "Failed to save session" });
      return;
    }
    res.json({ id: user.id, username: user.username, role: user.role, employeeId: user.employeeId });
  });
});

router.post("/auth/change-password", requireAuth, async (req: Request, res): Promise<void> => {
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Current password and new password are required" });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: "New password must be at least 6 characters" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId!));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  let valid = false;
  if (user.isLegacy) {
    valid = user.passwordHash === currentPassword;
  } else {
    valid = await bcrypt.compare(currentPassword, user.passwordHash);
  }

  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await db.update(usersTable).set({ passwordHash: hash, isLegacy: false }).where(eq(usersTable.id, user.id));
  res.json({ message: "Password changed successfully" });
});

router.post("/auth/logout", (req, res): void => {
  req.session.destroy(() => {
    res.sendStatus(204);
  });
});

router.get("/auth/me", async (req: Request, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({ id: user.id, username: user.username, role: user.role, employeeId: user.employeeId });
});

export default router;
