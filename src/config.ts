import { randomBytes } from "node:crypto";

export interface AppConfig {
  host: string;
  port: number;
  store: "memory" | "postgres";
  swaggerEnabled: boolean;
  corsOrigins: string[];
  auth: { secret: string; accessTtlSeconds: number; refreshTtlSeconds: number };
  queue: {
    enabled: boolean;
    url: string;
    namespace: string;
    retryDelayMs: number;
    smtpHost: string;
    smtpPort: number;
  };
  cache: {
    enabled: boolean;
    url: string;
    namespace: string;
    ttlSeconds: number;
  };
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
  if (
    env.QUEUE_ENABLED !== undefined &&
    !["true", "false"].includes(env.QUEUE_ENABLED)
  )
    throw new Error("QUEUE_ENABLED must be true or false");
  const queueEnabled = env.QUEUE_ENABLED === "true";
  if (queueEnabled && store !== "postgres")
    throw new Error("QUEUE_ENABLED requires TEMPLATE_STORE=postgres");
  const queueUrl = env.AMQP_URL ?? "amqp://eru:eru_dev_password@127.0.0.1:5672";
  try {
    if (!["amqp:", "amqps:"].includes(new URL(queueUrl).protocol))
      throw new Error();
  } catch {
    throw new Error("AMQP_URL must be an AMQP URL");
  }
  const namespace = env.QUEUE_NAMESPACE ?? "erusentia";
  if (!/^[a-z][a-z0-9_-]{0,47}$/.test(namespace))
    throw new Error("QUEUE_NAMESPACE must be a short lowercase identifier");
  if (
    env.CACHE_ENABLED !== undefined &&
    !["true", "false"].includes(env.CACHE_ENABLED)
  )
    throw new Error("CACHE_ENABLED must be true or false");
  const cacheEnabled = env.CACHE_ENABLED === "true";
  if (cacheEnabled && store !== "postgres")
    throw new Error("CACHE_ENABLED requires TEMPLATE_STORE=postgres");
  const redisUrl = env.REDIS_URL ?? "redis://127.0.0.1:6379";
  try {
    if (!["redis:", "rediss:"].includes(new URL(redisUrl).protocol))
      throw new Error();
  } catch {
    throw new Error("REDIS_URL must be a Redis URL");
  }
  const cacheNamespace = env.CACHE_NAMESPACE ?? "erusentia";
  if (!/^[a-z][a-z0-9_-]{0,47}$/.test(cacheNamespace))
    throw new Error("CACHE_NAMESPACE must be a short lowercase identifier");
  const configuredOrigins =
    env.CORS_ORIGINS === undefined
      ? env.NODE_ENV === "production"
        ? []
        : ["http://localhost:5173", "http://127.0.0.1:5173"]
      : env.CORS_ORIGINS.split(",")
          .map((origin) => origin.trim())
          .filter(Boolean);
  const corsOrigins = [
    ...new Set(
      configuredOrigins.map((origin) => {
        try {
          const url = new URL(origin);
          if (
            origin.includes("*") ||
            !["http:", "https:"].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.pathname !== "/" ||
            url.search ||
            url.hash
          )
            throw new Error();
          return url.origin;
        } catch {
          throw new Error(
            "CORS_ORIGINS must contain comma-separated HTTP(S) origins without credentials, paths or wildcards",
          );
        }
      }),
    ),
  ];
  const secret = env.JWT_SECRET || undefined;
  if (secret && Buffer.byteLength(secret, "utf8") < 32)
    throw new Error("JWT_SECRET must contain at least 32 bytes");
  if (!secret && env.NODE_ENV === "production")
    throw new Error("JWT_SECRET is required in production");
  return {
    host: env.HOST ?? "127.0.0.1",
    port: integer(env.PORT, 3001, "PORT"),
    store,
    corsOrigins,
    swaggerEnabled:
      env.SWAGGER_ENABLED === undefined
        ? env.NODE_ENV !== "production"
        : env.SWAGGER_ENABLED === "true",
    auth: {
      secret: secret ?? randomBytes(32).toString("base64url"),
      accessTtlSeconds: 900,
      refreshTtlSeconds: 7 * 24 * 60 * 60,
    },
    queue: {
      enabled: queueEnabled,
      url: queueUrl,
      namespace,
      retryDelayMs: integer(
        env.QUEUE_RETRY_DELAY_MS,
        5000,
        "QUEUE_RETRY_DELAY_MS",
      ),
      smtpHost: env.SMTP_HOST ?? "127.0.0.1",
      smtpPort: integer(env.SMTP_PORT, 1025, "SMTP_PORT"),
    },
    cache: {
      enabled: cacheEnabled,
      url: redisUrl,
      namespace: cacheNamespace,
      ttlSeconds: integer(env.CACHE_TTL_SECONDS, 60, "CACHE_TTL_SECONDS"),
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
