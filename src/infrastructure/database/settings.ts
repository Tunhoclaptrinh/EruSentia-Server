/** Shared by TypeORM and the SQL/migration CLI; never log these settings. */
export function readDatabaseSettings(env: NodeJS.ProcessEnv = process.env) {
  if (env.DB_SSL !== undefined && !["true", "false"].includes(env.DB_SSL))
    throw new Error("DB_SSL must be true or false");
  const port = Number(env.DB_PORT ?? 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("DB_PORT must be an integer from 1 to 65535");
  const poolSize = Number(env.DB_POOL_MAX ?? 10);
  if (!Number.isInteger(poolSize) || poolSize < 1 || poolSize > 100)
    throw new Error("DB_POOL_MAX must be an integer from 1 to 100");
  return {
    host: env.DB_HOST ?? "localhost",
    port,
    username: env.DB_USERNAME ?? "postgres",
    password: env.DB_PASSWORD ?? "postgres_dev_password",
    database: env.DB_DATABASE ?? "sentia_hub_db",
    // Certificate and hostname verification stay enabled on hosted databases.
    ssl:
      env.DB_SSL === "true"
        ? { rejectUnauthorized: true as const }
        : (false as const),
    poolSize,
  };
}
