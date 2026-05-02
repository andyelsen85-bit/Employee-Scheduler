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

export async function ensureHolidayTables(): Promise<void> {
  try {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS "employee_holiday_balances" (
          "id" serial PRIMARY KEY NOT NULL,
          "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
          "shift_code_code" varchar(16) NOT NULL,
          "balance_hours" real NOT NULL DEFAULT 0,
          "updated_at" timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT "uniq_emp_holiday_code" UNIQUE("employee_id", "shift_code_code")
        );
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS "holiday_balance_log" (
          "id" serial PRIMARY KEY NOT NULL,
          "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
          "shift_code" text NOT NULL,
          "delta" real NOT NULL,
          "previous_value" real NOT NULL,
          "new_value" real NOT NULL,
          "triggered_by" text NOT NULL,
          "created_at" timestamptz NOT NULL DEFAULT now()
        );
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS "holiday_balance_log_emp_idx"
        ON "holiday_balance_log" ("employee_id", "created_at" DESC);
      `);
    } finally {
      client.release();
    }
    logger.info("holiday tables ensured");
  } catch (err) {
    logger.error({ err }, "Failed to ensure holiday tables");
  }
}

export async function ensureShiftCodeRolloverColumn(): Promise<void> {
  try {
    const client = await pool.connect();
    try {
      await client.query(`
        ALTER TABLE "shift_codes" ADD COLUMN IF NOT EXISTS "year_rollover_default" real;
      `);
    } finally {
      client.release();
    }
    logger.info("shift_codes.year_rollover_default column ensured");
  } catch (err) {
    logger.error({ err }, "Failed to ensure shift_codes.year_rollover_default column");
  }
}

export const SETUP_REQUIRED_MARKER = "__NEEDS_SETUP__";

export async function seedAdminUser(): Promise<void> {
  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.username, "admin"));
    if (!existing) {
      await db.insert(usersTable).values({
        username: "admin",
        passwordHash: SETUP_REQUIRED_MARKER,
        isLegacy: false,
        role: "admin",
        employeeId: null,
      });
      logger.info("Seeded initial admin user (setup required)");
    }
  } catch (err) {
    logger.error({ err }, "Failed to seed admin user");
  }
}
