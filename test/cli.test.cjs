const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const env = {
  ...process.env,
  DB_HOST: "127.0.0.1",
  DB_PORT: "1",
  DB_USERNAME: "cli_test",
  DB_PASSWORD: "unused",
  DB_DATABASE: "cli_test",
  TEMPLATE_STORE: "postgres",
  // These failure-path tests must not connect to services enabled in a developer's .env.
  QUEUE_ENABLED: "false",
  CACHE_ENABLED: "false",
  ACCOUNT_EMAIL_MODE: "disabled",
  ADMIN_EMAIL: "",
  ADMIN_PASSWORD: "",
};

function run(script, args = [], extraEnv = {}) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", script, ...args],
    {
      cwd: root,
      env: { ...env, ...extraEnv },
      encoding: "utf8",
      timeout: 15_000,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  return result.stdout + result.stderr;
}

test("database check fails and exits when PostgreSQL is unavailable", () => {
  const output = run("scripts/check-db.ts");
  assert.match(output, /Database check failed/);
  assert.doesNotMatch(output, /Server ready|listening on port/);
});

test("SQL runner rejects a missing argument before connecting", () => {
  assert.match(run("scripts/run-sql.ts"), /Please specify the SQL file path/);
});

test("HTTP API startup fails and exits when PostgreSQL is unavailable", () => {
  const output = run("dist/src/main.js");
  assert.match(output, /API startup failed/);
  assert.doesNotMatch(output, /Template API .* listening at/);
});

test("SQL runner rejects a nonexistent file before connecting", () => {
  assert.match(
    run("scripts/run-sql.ts", ["sql/does-not-exist.sql"]),
    /SQL file not found/,
  );
});

test("SQL runner propagates connection failure", () => {
  assert.match(
    run("scripts/run-sql.ts", ["sql/01_schema.sql"]),
    /SQL execution failed/,
  );
});

test("benchmark propagates connection failure", () => {
  assert.match(run("scripts/benchmark.ts"), /Benchmark failed/);
});

test("seed propagates connection failure", () => {
  assert.match(run("scripts/seed.ts"), /Seeding failed/);
});

test("admin provisioning rejects missing credentials without opening a database", () => {
  assert.match(run("dist/scripts/create-admin.js"), /Set ADMIN_EMAIL/);
});

test("admin provisioning propagates DB failure without printing the password", () => {
  const password = "LearningPass!2026";
  const output = run("dist/scripts/create-admin.js", [], {
    ADMIN_EMAIL: "admin@example.test",
    ADMIN_PASSWORD: password,
  });
  assert.match(output, /Admin creation failed/);
  assert(!output.includes(password));
});

test("welcome worker rejects disabled queue configuration before connecting", () => {
  const output = run("src/messaging/worker.ts", [], { QUEUE_ENABLED: "false" });
  assert.match(output, /Welcome worker startup failed/);
  assert.doesNotMatch(output, /worker ready|amqp:\/\//);
});

test("project bootstrap rejects transaction-pooler endpoints before opening a database", () => {
  const output = run("dist/scripts/project-db.js", ["bootstrap"], {
    DB_DATABASE: "eru_project_render",
    DB_HOST: "ep-example-pooler.ap-southeast-1.aws.neon.tech",
  });
  assert.match(output, /direct PostgreSQL endpoint/);
});
