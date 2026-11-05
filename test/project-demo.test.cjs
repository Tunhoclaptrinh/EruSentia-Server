const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { readConfig } = require("../dist/src/config");
const { createApplication } = require("../dist/src/app");
const {
  migrateProject,
  seedProject,
} = require("../dist/src/infrastructure/database/project-migrations");
const {
  seedProjectDemo,
  demoAccounts,
  demoPassword,
  demoTemplates,
} = require("../dist/src/infrastructure/database/project-demo");

test("demo credentials require explicit opt-in and refuse production before database access", async () => {
  await assert.rejects(
    seedProjectDemo(
      {},
      { NODE_ENV: "production", PROJECT_DEMO_ACCOUNTS: "true" },
    ),
    /forbidden in production/,
  );
  await assert.rejects(
    seedProjectDemo({}, { NODE_ENV: "development" }),
    /PROJECT_DEMO_ACCOUNTS=true/,
  );
});

test(
  "project demo roles and samples on a dedicated PostgreSQL database",
  { skip: process.env.RUN_PROJECT_DEMO_TESTS !== "1" },
  async (t) => {
    assert.match(process.env.DB_DATABASE || "", /^project_test_[a-z0-9_]+$/);
    const settings = readConfig({
      ...process.env,
      TEMPLATE_STORE: "postgres",
      QUEUE_ENABLED: "false",
      CACHE_ENABLED: "false",
    });
    const pool = new Pool({
      ...settings.database,
      user: settings.database.username,
    });
    t.after(() => pool.end());
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'",
        )
      ).rows[0].n,
      0,
      "Use an empty dedicated test database",
    );
    await migrateProject(pool);
    await seedProject(pool);
    const env = { NODE_ENV: "development", PROJECT_DEMO_ACCOUNTS: "true" };
    await seedProjectDemo(pool, env);
    const first = (
      await pool.query(
        "SELECT id,password_hash,role FROM users WHERE email LIKE '%@erusentia.test' ORDER BY id",
      )
    ).rows;
    await Promise.all([seedProjectDemo(pool, env), seedProjectDemo(pool, env)]);
    assert.deepEqual(
      (
        await pool.query(
          "SELECT id,password_hash,role FROM users WHERE email LIKE '%@erusentia.test' ORDER BY id",
        )
      ).rows,
      first,
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int n FROM profiles")).rows[0].n,
      3,
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int n FROM templates")).rows[0].n,
      7,
    );
    const app = await createApplication(settings, false);
    t.after(() => app.close());
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const tokens = {};
    await t.test(
      "all three demo accounts authenticate with their actual role",
      async () => {
        for (const account of demoAccounts) {
          const response = await fetch(base + "/auth/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email: account.email,
              password: demoPassword,
            }),
          });
          assert.equal(response.status, 200);
          const pair = await response.json();
          assert.equal(pair.user.role, account.role);
          tokens[account.role] = pair.accessToken;
          const admin = await fetch(base + "/admin/users", {
            headers: { authorization: `Bearer ${pair.accessToken}` },
          });
          assert.equal(admin.status, account.role === "admin" ? 200 : 403);
        }
      },
    );
    await t.test(
      "private samples enforce ownership and admin visibility",
      async () => {
        const privateNote = demoTemplates.find(
          (item) => item.owner === 0 && !item.public,
        );
        for (const role of ["user", "creator", "admin"]) {
          const response = await fetch(base + "/templates/" + privateNote.id, {
            headers: { authorization: `Bearer ${tokens[role]}` },
          });
          assert.equal(response.status, role === "creator" ? 404 : 200);
        }
      },
    );
    await t.test(
      "reseed preserves edited passwords and template content",
      async () => {
        await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
          "operator-edited-password",
          demoAccounts[0].id,
        ]);
        await pool.query("UPDATE templates SET title=$1 WHERE id=$2", [
          "Operator-edited title",
          demoTemplates[0].id,
        ]);
        await seedProjectDemo(pool, env);
        assert.equal(
          (
            await pool.query("SELECT password_hash FROM users WHERE id=$1", [
              demoAccounts[0].id,
            ])
          ).rows[0].password_hash,
          "operator-edited-password",
        );
        assert.equal(
          (
            await pool.query("SELECT title FROM templates WHERE id=$1", [
              demoTemplates[0].id,
            ])
          ).rows[0].title,
          "Operator-edited title",
        );
      },
    );
    await t.test(
      "an email collision never promotes or resets an unrelated account",
      async () => {
        await pool.query("UPDATE users SET email=$1 WHERE id=$2", [
          "renamed-user@example.test",
          demoAccounts[0].id,
        ]);
        await assert.rejects(seedProjectDemo(pool, env), /identity collision/);
        assert.equal(
          (
            await pool.query("SELECT email FROM users WHERE id=$1", [
              demoAccounts[0].id,
            ])
          ).rows[0].email,
          "renamed-user@example.test",
        );
      },
    );
  },
);
