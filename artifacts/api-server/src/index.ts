import app from "./app";
import { logger } from "./lib/logger";
import { ensureSchema, seedAdminUser, ensureUserSessionsTable, ensureHolidayTables } from "./lib/seed.js";
import { startNotificationJob } from "./lib/notifications.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function main() {
  await ensureSchema();
  await ensureUserSessionsTable();
  await ensureHolidayTables();
  await seedAdminUser();

  await new Promise<void>((resolve, reject) => {
    app.listen(port, (err?: Error) => {
      if (err) {
        reject(err);
      } else {
        logger.info({ port }, "Server listening");
        resolve();
      }
    });
  });

  startNotificationJob();
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
