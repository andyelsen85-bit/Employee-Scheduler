import { db, usersTable, pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

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
