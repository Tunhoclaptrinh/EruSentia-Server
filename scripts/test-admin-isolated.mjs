import "dotenv/config";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";

const require = createRequire(import.meta.url);
const {
  readDatabaseSettings,
} = require("../dist/src/infrastructure/database/settings.js");
const settings = readDatabaseSettings();
if (!["localhost", "127.0.0.1", "::1"].includes(settings.host)) {
  throw new Error(
    "Admin integration tests only create disposable databases on a local PostgreSQL server.",
  );
}
const name =
  "project_test_admin_" + Date.now() + "_" + randomBytes(3).toString("hex");
const owner = new pg.Pool({
  host: settings.host,
  port: settings.port,
  user: settings.username,
  password: settings.password,
  database: "postgres",
  ssl: settings.ssl,
  max: 1,
});
let created = false;
try {
  await owner.query('CREATE DATABASE "' + name + '"');
  created = true;
  const env = {
    ...process.env,
    NODE_ENV: "test",
    TEMPLATE_STORE: "postgres",
    DB_DATABASE: name,
    QUEUE_ENABLED: "false",
    CACHE_ENABLED: "false",
    ACCOUNT_EMAIL_MODE: "disabled",
    PROJECT_COMMUNITY_DEMO: "false",
    PROJECT_DEMO_ACCOUNTS: "false",
    RUN_ADMIN_TESTS: "1",
  };
  for (const args of [
    ["--require", "ts-node/register", "scripts/project-db.ts", "bootstrap"],
    ["--test", "--test-concurrency=1", "test/admin.test.cjs"],
  ]) {
    const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status || 1;
      break;
    }
  }
} finally {
  if (created) await owner.query('DROP DATABASE "' + name + '" WITH (FORCE)');
  await owner.end();
}
