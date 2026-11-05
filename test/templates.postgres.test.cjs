const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { Client } = require("pg");
const { readConfig } = require("../dist/src/config");
const { createApplication } = require("../dist/src/app");
const { contract } = require("./templates.contract.cjs");
const { authContract } = require("./auth.contract.cjs");
const { spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");

test(
  "Template/auth contracts and persistence on PostgreSQL",
  {
    skip:
      process.env.RUN_DB_TESTS !== "1"
        ? "Set RUN_DB_TESTS=1 and a dedicated week3_test_* database"
        : false,
  },
  async (t) => {
    assert.match(
      process.env.DB_DATABASE ?? "",
      /^week3_test_[a-z0-9_]+$/,
      "Use a dedicated test database",
    );
    const settings = readConfig();
    const client = new Client({
      ...settings.database,
      user: settings.database.username,
    });
    await client.connect();
    t.after(() => client.end());
    const existing = await client.query(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'",
    );
    assert.equal(
      existing.rows[0].count,
      0,
      "Test requires an empty database; never reset an existing schema",
    );
    for (const file of [
      "01_schema.sql",
      "02_indexes.sql",
      "03_seed.sql",
      "05_auth_sessions.sql",
      "08_template_revisions.sql",
    ]) {
      await client.query(
        (
          await fs.readFile(path.join(__dirname, "../sql", file), "utf8")
        ).replace(/^\uFEFF/, ""),
      );
    }
    await client.query(
      await fs.readFile(
        path.join(__dirname, "../sql/05_auth_sessions.sql"),
        "utf8",
      ),
    );
    const schemaBefore = await client.query(
      "SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
    );
    const { ids } = await contract(t, "postgres");
    for (const id of ids) {
      const result = await client.query(
        "SELECT deleted_at,views_count FROM templates WHERE id=$1",
        [id],
      );
      assert.equal(result.rowCount, 1, "DELETE must preserve the database row");
      assert(result.rows[0].deleted_at);
      assert.equal(result.rows[0].views_count, 0);
    }
    await authContract(t, "postgres");
    await t.test(
      "admin CLI creates a hashed account and refuses to overwrite an existing email",
      async () => {
        const password = randomBytes(24).toString("base64url");
        const email = "provisioned-admin@example.test";
        const command = () =>
          spawnSync(
            process.execPath,
            [path.join(__dirname, "../dist/scripts/create-admin.js")],
            {
              env: {
                ...process.env,
                ADMIN_EMAIL: email,
                ADMIN_PASSWORD: password,
              },
              encoding: "utf8",
              timeout: 10000,
            },
          );
        const created = command();
        assert.equal(created.status, 0, created.stdout + created.stderr);
        const before = (
          await client.query(
            "SELECT id,password_hash,role FROM users WHERE email=$1",
            [email],
          )
        ).rows[0];
        assert.equal(before.role, "admin");
        assert.match(before.password_hash, /^\$argon2id\$/);
        assert(!(created.stdout + created.stderr).includes(password));
        const duplicate = command();
        assert.equal(duplicate.status, 1);
        const after = (
          await client.query(
            "SELECT id,password_hash,role FROM users WHERE email=$1",
            [email],
          )
        ).rows[0];
        assert.deepEqual(after, before);
      },
    );
    const storedTokens = await client.query(
      "SELECT token_hash FROM auth_refresh_sessions",
    );
    assert(storedTokens.rowCount > 0);
    assert(storedTokens.rows.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash)));
    const schemaAfter = await client.query(
      "SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
    );
    assert.deepEqual(
      schemaAfter.rows,
      schemaBefore.rows,
      "ORM startup/CRUD must not alter the week-1 schema",
    );
    // Write through HTTP, close the application, then read through a fresh instance.
    const writer = await createApplication(
      { ...settings, store: "postgres" },
      false,
    );
    let saved, pair;
    try {
      await writer.listen(0, "127.0.0.1");
      const credentials = {
        email: "restart@example.test",
        password: "LearningPass!2026",
      };
      await fetch(`${await writer.getUrl()}/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credentials),
      });
      const login = await fetch(`${await writer.getUrl()}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credentials),
      });
      pair = await login.json();
      const response = await fetch(`${await writer.getUrl()}/templates`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${pair.accessToken}`,
        },
        body: JSON.stringify({
          categoryId: "c0000000-0000-0000-0000-000000000001",
          title: "Survives restart",
          slug: "week2-restart-proof",
          description: "Persistence check",
          contentJson: require("../tools/examples/create-template.json")
            .contentJson,
        }),
      });
      assert.equal(response.status, 201);
      saved = await response.json();
    } finally {
      await writer.close();
    }
    const reader = await createApplication(
      { ...settings, store: "postgres" },
      false,
    );
    try {
      await reader.listen(0, "127.0.0.1");
      const response = await fetch(
        `${await reader.getUrl()}/templates/${saved.id}`,
        { headers: { authorization: `Bearer ${pair.accessToken}` } },
      );
      assert.equal(response.status, 200);
      const reloaded = await response.json();
      assert.equal(reloaded.title, "Survives restart");
      assert.deepEqual(
        reloaded.contentJson,
        require("../tools/examples/create-template.json").contentJson,
      );
      await fetch(`${await reader.getUrl()}/templates/${saved.id}`, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${pair.accessToken}`,
          "if-match": response.headers.get("etag"),
        },
      });
      const refreshed = await fetch(`${await reader.getUrl()}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: pair.refreshToken }),
      });
      assert.equal(
        refreshed.status,
        200,
        "Refresh token survives application restart",
      );
    } finally {
      await reader.close();
    }
  },
);
