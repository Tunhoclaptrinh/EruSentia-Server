import { randomBytes } from "node:crypto";

export interface AppConfig {
  host: string;
  port: number;
  store: "memory" | "postgres";
  swaggerEnabled: boolean;
  auth: { secret: string; accessTtlSeconds: number; refreshTtlSeconds: number };
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
  };
}

function integer(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be an integer from 1 to 65535`);
  }
  return parsed;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const store = env.TEMPLATE_STORE ?? "postgres";
  if (store !== "memory" && store !== "postgres")
    throw new Error("TEMPLATE_STORE must be memory or postgres");
  if (
    env.SWAGGER_ENABLED !== undefined &&
    !["true", "false"].includes(env.SWAGGER_ENABLED)
  )
    throw new Error("SWAGGER_ENABLED must be true or false");
  const secret = env.JWT_SECRET || undefined;
  if (secret && Buffer.byteLength(secret, "utf8") < 32)
    throw new Error("JWT_SECRET must contain at least 32 bytes");
  if (!secret && env.NODE_ENV === "production")
    throw new Error("JWT_SECRET is required in production");
  return {
    host: env.HOST ?? "127.0.0.1",
    port: integer(env.PORT, 3001, "PORT"),
    store,
    swaggerEnabled:
      env.SWAGGER_ENABLED === undefined
        ? env.NODE_ENV !== "production"
        : env.SWAGGER_ENABLED === "true",
    auth: {
      secret: secret ?? randomBytes(32).toString("base64url"),
      accessTtlSeconds: 900,
      refreshTtlSeconds: 7 * 24 * 60 * 60,
    },
    database: {
      host: env.DB_HOST ?? "localhost",
      port: integer(env.DB_PORT, 5432, "DB_PORT"),
      username: env.DB_USERNAME ?? "postgres",
      password: env.DB_PASSWORD ?? "postgres_dev_password",
      database: env.DB_DATABASE ?? "sentia_hub_db",
    },
  };
}
