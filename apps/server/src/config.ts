import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const srcDir = dirname(currentFilePath);
const serverRoot = resolve(srcDir, "..");
const workspaceRoot = resolve(serverRoot, "..", "..");

loadEnv({ path: resolve(workspaceRoot, ".env") });
loadEnv({ path: resolve(serverRoot, ".env") });

const parseOrigins = (value: string | undefined) => {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => Boolean(entry));
};

const configuredClientOrigins = parseOrigins(process.env.CLIENT_ORIGIN);
const defaultClientOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];
const clientOrigins = configuredClientOrigins.length
  ? configuredClientOrigins
  : defaultClientOrigins;

const parseOptionalNumber = (value: string | undefined) => {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (!value) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
};

export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 4000),
  clientOrigins,
  allowDevOrigins: parseBoolean(process.env.ALLOW_DEV_ORIGINS, process.env.NODE_ENV !== "production"),
  databaseUrl: process.env.DATABASE_URL ?? `file:${resolve(serverRoot, "dev.db")}`,
  mediaRoot: process.env.MEDIA_ROOT
    ? resolve(workspaceRoot, process.env.MEDIA_ROOT)
    : resolve(workspaceRoot, "media"),
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "change-me",
  maxUploadBytes: parseOptionalNumber(process.env.MAX_UPLOAD_BYTES)
};

export const uploadTempDir = resolve(config.mediaRoot, ".uploads");
