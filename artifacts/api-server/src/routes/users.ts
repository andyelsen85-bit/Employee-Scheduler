import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import bcrypt from "bcryptjs";
import { requireAdmin } from "../middleware/auth.js";

const router = Router();

router.get("/users", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select({
    id: usersTable.id,
    username: usersTable.username,
    role: usersTable.role,
    employeeId: usersTable.employeeId,
    isLegacy: usersTable.isLegacy,
    createdAt: usersTable.createdAt,
  }).from(usersTable).orderBy(usersTable.username);
  res.json(rows);
});

router.post("/users", requireAdmin, async (req, res): Promise<void> => {
  const { username, password, role, employeeId } = req.body as {
    username?: string;
    password?: string;
    role?: string;
    employeeId?: number | null;
  };

  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(usersTable).values({
    username,
    passwordHash: hash,
    isLegacy: false,
    role: role ?? "user",
    employeeId: employeeId ?? null,
  }).returning({
    id: usersTable.id,
    username: usersTable.username,
    role: usersTable.role,
    employeeId: usersTable.employeeId,
    isLegacy: usersTable.isLegacy,
  });
  res.status(201).json(user);
});

router.patch("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  const { username, password, role, employeeId } = req.body as {
    username?: string;
    password?: string;
    role?: string;
    employeeId?: number | null;
  };

  const updateData: Partial<typeof usersTable.$inferInsert> = {};
  if (username !== undefined) updateData.username = username;
  if (role !== undefined) updateData.role = role;
  if (employeeId !== undefined) updateData.employeeId = employeeId ?? null;
  if (password !== undefined) {
    updateData.passwordHash = await bcrypt.hash(password, 10);
    updateData.isLegacy = false;
  }

  const [row] = await db.update(usersTable).set(updateData).where(eq(usersTable.id, id)).returning({
    id: usersTable.id,
    username: usersTable.username,
    role: usersTable.role,
    employeeId: usersTable.employeeId,
    isLegacy: usersTable.isLegacy,
  });
  if (!row) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(row);
});

router.delete("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  const [row] = await db.delete(usersTable).where(eq(usersTable.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
