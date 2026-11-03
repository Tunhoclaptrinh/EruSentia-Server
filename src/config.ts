import { randomBytes } from "node:crypto";

export interface AppConfig {
  host: string;
  port: number;
  store: "memory" | "postgres";
  swaggerEnabled: boolean;
  auth: { secret: string; accessTtlSeconds: number; refreshTtlSeconds: number };
  queue: {
    enabled: boolean;
    url: string;
    namespace: string;
    retryDelayMs: number;
    smtpHost: string;
    smtpPort: number;
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
    database: {
      host: env.DB_HOST ?? "localhost",
      port: integer(env.DB_PORT, 5432, "DB_PORT"),
      username: env.DB_USERNAME ?? "postgres",
      password: env.DB_PASSWORD ?? "postgres_dev_password",
      database: env.DB_DATABASE ?? "sentia_hub_db",
    },
  };
}
