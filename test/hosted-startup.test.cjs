const assert = require("node:assert/strict");
const test = require("node:test");
const { spawn } = require("node:child_process");
const { createServer } = require("node:net");
const { setTimeout: delay } = require("node:timers/promises");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const {
  readDatabaseSettings,
} = require("../dist/src/infrastructure/database/settings");

test(
  "Render entrypoint migrates over verified TLS, preserves accounts across restart and refuses an untrusted CA",
  {
    skip: process.env.RUN_HOSTED_TESTS !== "1",
    timeout: 90000,
  },
  async (t) => {
    // This database is created only by scripts/test-hosted-db.sh, separately from foundation tests.
    assert.match(process.env.DB_DATABASE ?? "", /^project_test_/);
    assert.equal(process.env.DB_SSL, "true");
    const env = {
      ...process.env,
      DB_DATABASE: "project_test_hosted",
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PROJECT_BOOTSTRAP: "true",
      PROJECT_DEMO_ACCOUNTS: "false",
      JWT_SECRET: "test-only-hosted-signing-key-at-least-32-bytes",
      SWAGGER_ENABLED: "true",
    };
    const database = readDatabaseSettings(env);
    const pool = new Pool({ ...database, user: database.username });
    t.after(() => pool.end());
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()",
        )
      ).rows[0].ssl,
      true,
    );
    async function start() {
      const socket = createServer();
      await new Promise((resolve, reject) =>
        socket.once("error", reject).listen(0, "127.0.0.1", resolve),
      );
      const port = socket.address().port;
      await new Promise((resolve) => socket.close(resolve));
      const child = spawn(
        "sh",
        ["docker/project-entrypoint.sh", process.execPath, "dist/src/main.js"],
        {
          env: { ...env, PORT: String(port) },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.on("data", (data) => {
        output += data;
      });
      child.stderr.on("data", (data) => {
        output += data;
      });
      const exited = new Promise((resolve) => child.once("exit", resolve));
      let stopped = false;
      async function stop() {
        if (stopped) return;
        stopped = true;
        child.kill("SIGTERM");
        const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
        await exited;
        clearTimeout(timer);
        assert(!output.includes(env.DB_PASSWORD));
        assert(!output.includes(env.JWT_SECRET));
      }
      t.after(stop);
      const base = "http://127.0.0.1:" + port;
      for (let attempt = 0; attempt < 150; attempt++) {
        if (child.exitCode !== null)
          throw new Error("Hosted startup failed: " + output);
        try {
          const response = await fetch(base + "/health", {
            signal: AbortSignal.timeout(1000),
          });
          if (response.ok) return { base, stop };
        } catch {}
        await delay(200);
      }
      throw new Error("Hosted startup timed out: " + output);
    }
    const first = await start();
    assert.equal(
      (await pool.query("SELECT count(*)::int n FROM eru_schema_migrations"))
        .rows[0].n,
      12,
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int n FROM users WHERE is_active"))
        .rows[0].n,
      0,
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int n FROM templates")).rows[0].n,
      17,
    );
    assert.equal((await fetch(first.base + "/auth/me")).status, 401);
    assert.equal((await fetch(first.base + "/docs")).status, 200);
    const credentials = {
      email: randomUUID() + "@example.test",
      password: "HostedTestOnly!2026",
    };
    async function post(base, path, body) {
      return fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    assert.equal(
      (await post(first.base, "/auth/register", credentials)).status,
      201,
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int n FROM message_outbox")).rows[0]
        .n,
      0,
    );
    const login = await post(first.base, "/auth/login", credentials);
    assert.equal(login.status, 200);
    const tokens = await login.json();
    await first.stop();
    const second = await start();
    const me = await fetch(second.base + "/auth/me", {
      headers: { authorization: "Bearer " + tokens.accessToken },
    });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).email, credentials.email);
    assert.equal(
      (
        await post(second.base, "/auth/refresh", {
          refreshToken: tokens.refreshToken,
        })
      ).status,
      200,
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int n FROM templates")).rows[0].n,
      17,
    );
    await second.stop();
    const untrusted = spawn(
      process.execPath,
      ["dist/scripts/project-db.js", "bootstrap"],
      {
        env: { ...env, NODE_EXTRA_CA_CERTS: "" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let diagnostic = "";
    untrusted.stdout.on("data", (data) => {
      diagnostic += data;
    });
    untrusted.stderr.on("data", (data) => {
      diagnostic += data;
    });
    const exitCode = await new Promise((resolve) =>
      untrusted.once("exit", resolve),
    );
    assert.equal(exitCode, 1);
    assert.match(diagnostic, /certificate|self.signed|issuer/i);
    assert(!diagnostic.includes(env.DB_PASSWORD));
  },
);
