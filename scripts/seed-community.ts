import { config, parse } from "dotenv";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { readDatabaseSettings } from "../src/infrastructure/database/settings";
import { assertProjectDatabase } from "../src/infrastructure/database/project-migrations";
import { seedCommunityDemo } from "../src/infrastructure/database/community-demo";

async function main() {
  const file = process.argv[2];
  if (file === "--local-project") {
    const local = parse(await readFile("docker/.env.project.local"));
    Object.assign(process.env, {
      NODE_ENV: "development",
      DB_HOST: "127.0.0.1",
      DB_PORT: local.PROJECT_POSTGRES_PORT || "5433",
      DB_USERNAME: "eru",
      DB_PASSWORD: local.PROJECT_DB_PASSWORD || "eru_project_dev_password",
      DB_DATABASE: "eru_project_docker",
      DB_SSL: "false",
    });
  } else config({ path: file || ".env", quiet: true });
  for (const name of ["DB_HOST", "DB_USERNAME", "DB_PASSWORD", "DB_DATABASE"])
    if (!process.env[name]?.trim())
      throw new Error(`Missing ${name}; no database was changed`);
  const settings = readDatabaseSettings();
  assertProjectDatabase(settings.database);
  const loopback = ["localhost", "127.0.0.1", "::1", "postgres"].includes(
    settings.host,
  );
  if (!loopback && !settings.ssl)
    throw new Error("Hosted community seeding requires verified TLS");
  if (settings.host.includes("-pooler."))
    throw new Error("Use the direct Neon endpoint for session advisory locks");
  const pool = new Pool({
    ...settings,
    user: settings.username,
    max: 2,
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000,
    lock_timeout: 5000,
  });
  pool.on("error", () =>
    console.error("Community seed connection interrupted"),
  );
  try {
    console.log(await seedCommunityDemo(pool));
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : "Operation failed";
  // Do not dump connection objects, DSNs, query parameters or a full driver error.
  console.error(
    message.startsWith("Community") ||
      message.startsWith("Missing") ||
      message.startsWith("Use ") ||
      message.startsWith("Hosted") ||
      message.startsWith("Project commands")
      ? message
      : "Community seed failed; no partial changes committed. Check the connection and project schema.",
  );
  process.exitCode = 1;
});
