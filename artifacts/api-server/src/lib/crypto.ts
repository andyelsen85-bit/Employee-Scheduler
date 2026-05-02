import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { logger } from "./logger.js";

const ALGORITHM = "aes-256-gcm";

function resolveEncryptionSecret(): string {
  const s = process.env["ENCRYPTION_SECRET"];
  if (!s) {
    if (process.env["NODE_ENV"] === "production") {
      throw new Error("ENCRYPTION_SECRET environment variable is required in production");
    }
    logger.warn("ENCRYPTION_SECRET not set — using insecure default (development only)");
    return "hr-planner-default-secret-key-32";
  }
  return s;
}

const SECRET_KEY = resolveEncryptionSecret().padEnd(32, "0").slice(0, 32);

export function encrypt(text: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, SECRET_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(encoded: string): string {
  const parts = encoded.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format");
  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, SECRET_KEY, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final("utf8");
}
