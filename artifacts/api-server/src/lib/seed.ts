import { execSync } from "child_process";
import { db, usersTable, pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Push the Drizzle schema to the database (creates all tables on a fresh DB).
 * Uses --force to skip interactive prompts. Safe to run on an existing DB too —
 * it is idempotent when the schema already matches.
 */
export async function ensureSchema(): Promise<void> {
  try {
    logger.info("Pushing DB schema (drizzle-kit push --force)…");
    execSync("pnpm --filter @workspace/db run push-force", {
      cwd: process.cwd(),
      env: process.env,
      stdio: "pipe",
    });
    logger.info("DB schema up to date");
  } catch (err) {
    logger.error({ err }, "Failed to push DB schema — tables may be missing");
  }
}

export async function ensureUserSessionsTable(): Promise<void> {
  try {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS "user_sessions" (
          "sid" varchar NOT NULL COLLATE "default",
          "sess" json NOT NULL,
          "expire" timestamp(6) NOT NULL,
          CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
        );
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "user_sessions" ("expire");
      `);
    } finally {
      client.release();
    }
    logger.info("user_sessions table ensured");
  } catch (err) {
    logger.error({ err }, "Failed to ensure user_sessions table");
  }
}

export async function seedAdminUser(): Promise<void> {
  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.username, "admin"));
    if (!existing) {
      await db.insert(usersTable).values({
        username: "admin",
        passwordHash: "admin123",
        isLegacy: true,
        role: "admin",
        employeeId: null,
      });
      logger.info("Seeded initial admin user (legacy password)");
    }
  } catch (err) {
    logger.error({ err }, "Failed to seed admin user");
  }
}
