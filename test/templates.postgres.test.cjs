const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { Client } = require("pg");
const { readConfig } = require("../dist/src/config");
const { createApplication } = require("../dist/src/app");
const { contract } = require("./templates.contract.cjs");

test(
  "Template HTTP contract and persistence on PostgreSQL",
  {
    skip:
      process.env.RUN_DB_TESTS !== "1"
        ? "Set RUN_DB_TESTS=1 and a dedicated week2_test_* database"
        : false,
  },
  async (t) => {
    assert.match(
      process.env.DB_DATABASE ?? "",
      /^week2_test_[a-z0-9_]+$/,
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
    for (const file of ["01_schema.sql", "02_indexes.sql", "03_seed.sql"]) {
      await client.query(
        (
          await fs.readFile(path.join(__dirname, "../sql", file), "utf8")
        ).replace(/^\uFEFF/, ""),
      );
    }
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
    let saved;
    try {
      await writer.listen(0, "127.0.0.1");
      const response = await fetch(`${await writer.getUrl()}/templates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          authorId: "a0000000-0000-0000-0000-000000000002",
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
      });
    } finally {
      await reader.close();
    }
  },
);
