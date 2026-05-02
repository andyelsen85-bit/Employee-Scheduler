import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import router from "./routes/index.js";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { requireAuth } from "./middleware/auth.js";

const PgSession = connectPgSimple(session);

const isProduction = process.env["NODE_ENV"] === "production";

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "user_sessions",
      // NOTE: user_sessions table was created manually via SQL (connect-pg-simple's
      // createTableIfMissing option fails after esbuild bundling because it can't
      // find the bundled table.sql file). Table creation SQL:
      //   CREATE TABLE IF NOT EXISTS "user_sessions" (
      //     "sid" varchar NOT NULL COLLATE "default",
      //     "sess" json NOT NULL,
      //     "expire" timestamp(6) NOT NULL,
      //     CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      //   );
      //   CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "user_sessions" ("expire");
    }),
    secret: (() => {
      const s = process.env["SESSION_SECRET"];
      if (!s) {
        if (process.env["NODE_ENV"] === "production") {
          throw new Error("SESSION_SECRET environment variable is required in production");
        }
        logger.warn("SESSION_SECRET not set — using insecure default (development only)");
        return "hr-planner-session-secret-change-me-in-production";
      }
      return s;
    })(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction,
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    },
  })
);

app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith("/auth/") || req.path === "/auth") {
    return next();
  }
  requireAuth(req, res, next);
}, router);

export default app;
