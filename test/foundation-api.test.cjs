const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createApplication } = require("../dist/src/app");
const { readConfig } = require("../dist/src/config");
const {
  migrateProject,
  seedProject,
  assertProjectDatabase,
} = require("../dist/src/infrastructure/database/project-migrations");

async function catalogContract(t, mode) {
  const settings = readConfig({
    ...process.env,
    TEMPLATE_STORE: mode,
    CACHE_ENABLED: "false",
    QUEUE_ENABLED: "false",
  });
  const app = await createApplication(settings, false);
  t.after(() => app.close());
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  async function request(method, path, body, token) {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, text: await response.text() };
  }
  async function account() {
    const input = {
      email: randomUUID() + "@example.test",
      password: "TestOnlyPass!2026",
    };
    assert.equal((await request("POST", "/auth/register", input)).status, 201);
    const login = await request("POST", "/auth/login", input);
    assert.equal(login.status, 200);
    return JSON.parse(login.text).accessToken;
  }
  const owner = await account(),
    other = await account();
  const categories = JSON.parse(
    (await request("GET", "/categories", null, owner)).text,
  );
  const slug = randomUUID();
  const body = {
    categoryId: categories[0].id,
    title: "100%_example catalog",
    slug,
    description: "Catalog contract",
    isPublic: true,
    contentJson: {
      format: "erusentia-template-html",
      schemaVersion: 1,
      html: "<section>" + "x".repeat(250_000) + "</section>",
      allowHeightResize: false,
    },
  };
  const created = await request("POST", "/templates", body, owner);
  assert.equal(created.status, 201);
  assert.equal(
    (
      await request(
        "POST",
        "/templates",
        { ...body, slug: slug + "-private", isPublic: false },
        other,
      )
    ).status,
    201,
  );
  const query =
    "?projection=summary&contentFormat=erusentia-template-html&schemaVersion=1&search=100%25_example&size=1";

  await t.test(
    "summary filters before total/pagination and omits full HTML",
    async () => {
      const response = await request("GET", "/templates" + query, null, owner);
      assert.equal(response.status, 200);
      const page = JSON.parse(response.text);
      assert.equal(page.totalElements, 1);
      assert.equal(page.totalPages, 1);
      assert.equal(page.data.length, 1);
      assert.ok(response.text.length < 10_000);
      assert.equal(page.data[0].id, JSON.parse(created.text).id);
      assert.equal(page.data[0].contentFormat, "erusentia-template-html");
      assert.equal(page.data[0].schemaVersion, 1);
      assert.equal("contentJson" in page.data[0], false);
      assert.equal("html" in page.data[0], false);
      const next = JSON.parse(
        (await request("GET", "/templates" + query + "&page=2", null, owner))
          .text,
      );
      assert.equal(next.totalElements, 1);
      assert.equal(next.data.length, 0);
    },
  );
  await t.test(
    "full/default detail contract and false metadata remain intact",
    async () => {
      const full = JSON.parse(
        (await request("GET", "/templates?search=100%25_example", null, owner))
          .text,
      );
      assert.equal(full.data[0].contentJson.allowHeightResize, false);
      assert.equal(full.data[0].contentJson.html, body.contentJson.html);
      const detail = JSON.parse(
        (
          await request(
            "GET",
            "/templates/" + JSON.parse(created.text).id,
            null,
            owner,
          )
        ).text,
      );
      assert.equal(detail.contentJson.html, body.contentJson.html);
    },
  );
  await t.test(
    "unsupported schema/format and malformed filter inputs have consistent results",
    async () => {
      for (const filter of ["schemaVersion=2", "contentFormat=unsupported"]) {
        const page = JSON.parse(
          (
            await request(
              "GET",
              "/templates?projection=summary&" + filter,
              null,
              owner,
            )
          ).text,
        );
        assert.equal(page.totalElements, 0);
        assert.deepEqual(page.data, []);
      }
      for (const filter of [
        "projection=html",
        "schemaVersion=0",
        "schemaVersion=1.5",
        "schemaVersion=1&schemaVersion=2",
        "contentFormat=",
      ]) {
        assert.equal(
          (await request("GET", "/templates?" + filter, null, owner)).status,
          400,
        );
      }
      assert.equal(
        (await request("GET", "/templates?projection=summary")).status,
        401,
      );
    },
  );
  if (mode === "postgres")
    await t.test(
      "project legacy seed is excluded only when format/schema filters are requested",
      async () => {
        const all = JSON.parse(
          (
            await request(
              "GET",
              "/templates?projection=summary&tag=integration-demo",
              null,
              owner,
            )
          ).text,
        );
        assert.equal(all.totalElements, 2);
        assert.equal(
          all.data.find((row) => row.slug === "demo-legacy-format")
            .contentFormat,
          null,
        );
        const compatible = JSON.parse(
          (
            await request(
              "GET",
              "/templates?projection=summary&tag=integration-demo&contentFormat=erusentia-template-html&schemaVersion=1",
              null,
              owner,
            )
          ).text,
        );
        assert.equal(compatible.totalElements, 1);
      },
    );
}

test("project database commands reject business/default database names", () => {
  for (const name of [
    "",
    "postgres",
    "sentia_hub_db",
    "eru_project_",
    "project_test_;drop",
  ])
    assert.throws(() => assertProjectDatabase(name));
  assert.doesNotThrow(() => assertProjectDatabase("eru_project_local"));
});

test("catalog contract with memory persistence", (t) =>
  catalogContract(t, "memory"));

test(
  "project migrations, neutral seed and PostgreSQL catalog",
  { skip: process.env.RUN_FOUNDATION_TESTS !== "1" },
  async (t) => {
    assert.match(process.env.DB_DATABASE ?? "", /^project_test_[a-z0-9_]+$/);
    const config = readConfig(process.env).database;
    const pool = new Pool({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: config.database,
      ssl: config.ssl,
    });
    t.after(() => pool.end());
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'",
        )
      ).rows[0].n,
      0,
      "Use an empty database; no reset is performed",
    );
    await t.test("untracked schema is refused without adoption", async () => {
      await pool.query("CREATE TABLE untracked_fixture(id int)");
      await assert.rejects(migrateProject(pool), /untracked tables/);
      await pool.query("DROP TABLE untracked_fixture");
    });
    await t.test(
      "a failed migration rolls back its schema changes and does not enter the journal",
      async () => {
        const root = await fs.mkdtemp(
          path.join(os.tmpdir(), "eru-migration-fixture-"),
        );
        try {
          for (const file of [
            "01_schema.sql",
            "02_indexes.sql",
            "05_auth_sessions.sql",
            "06_message_queue.sql",
            "07_template_cache_revision.sql",
            "08_template_revisions.sql",
          ]) {
            await fs.copyFile(path.resolve("sql", file), path.join(root, file));
          }
          await fs.appendFile(
            path.join(root, "05_auth_sessions.sql"),
            "\nSELECT intentionally_missing_function();\n",
          );
          await assert.rejects(
            migrateProject(pool, root),
            /intentionally_missing_function/,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT to_regclass('auth_refresh_sessions') AS name",
              )
            ).rows[0].name,
            null,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int n FROM eru_schema_migrations",
              )
            ).rows[0].n,
            2,
          );
        } finally {
          await fs.rm(root, { recursive: true, force: true });
        }
      },
    );
    await t.test(
      "parallel migration attempts apply each entry once",
      async () => {
        const results = await Promise.all([
          migrateProject(pool),
          migrateProject(pool),
        ]);
        assert.equal(results.flat().length, 4);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM eru_schema_migrations",
            )
          ).rows[0].n,
          6,
        );
        assert.deepEqual(await migrateProject(pool), []);
        assert.equal(
          (await pool.query("SELECT count(*)::int n FROM users")).rows[0].n,
          0,
        );
      },
    );
    await t.test(
      "neutral seed is idempotent and creates no login credentials",
      async () => {
        await seedProject(pool);
        await seedProject(pool);
        assert.equal(
          (await pool.query("SELECT count(*)::int n FROM templates")).rows[0].n,
          3,
        );
        assert.equal(
          (await pool.query("SELECT is_active FROM users")).rows[0].is_active,
          false,
        );
      },
    );
    await t.test("changed migration history fails visibly", async () => {
      const original = (
        await pool.query(
          "SELECT * FROM eru_schema_migrations ORDER BY id LIMIT 1",
        )
      ).rows[0];
      await pool.query(
        "UPDATE eru_schema_migrations SET checksum=$1 WHERE id=$2",
        ["0".repeat(64), original.id],
      );
      try {
        await assert.rejects(migrateProject(pool), /history mismatch/);
      } finally {
        await pool.query(
          "UPDATE eru_schema_migrations SET checksum=$1 WHERE id=$2",
          [original.checksum, original.id],
        );
      }
    });
    await catalogContract(t, "postgres");
  },
);
