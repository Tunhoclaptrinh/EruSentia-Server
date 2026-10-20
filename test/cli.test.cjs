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
};

function run(script, args = []) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", script, ...args],
    {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  return result.stdout + result.stderr;
}

test("database check fails and exits when PostgreSQL is unavailable", () => {
  const output = run("src/main.ts");
  assert.match(output, /Database check failed/);
  assert.doesNotMatch(output, /Server ready|listening on port/);
});

test("SQL runner rejects a missing argument before connecting", () => {
  assert.match(run("scripts/run-sql.ts"), /Please specify the SQL file path/);
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
