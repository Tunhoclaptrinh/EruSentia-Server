const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { randomUUID } = require("node:crypto");
const { plainToInstance } = require("class-transformer");
const { validate } = require("class-validator");
const {
  readCommunityDemoCatalog,
  seedCommunityDemo,
} = require("../dist/src/infrastructure/database/community-demo");
const {
  migrateProject,
} = require("../dist/src/infrastructure/database/project-migrations");
const { CreateTemplateDto } = require("../dist/src/templates/dto/template.dto");
const { readConfig } = require("../dist/src/config");
const { createApplication } = require("../dist/src/app");

test("community demo has 14 independent HTML templates accepted by the real API DTO", async () => {
  const catalog = await readCommunityDemoCatalog();
  assert.equal(new Set(catalog.templates.map((item) => item.id)).size, 14);
  assert.equal(new Set(catalog.templates.map((item) => item.slug)).size, 14);
  for (const item of catalog.templates) {
    const category = catalog.categories.find(
      (category) => category.key === item.category,
    );
    const { id, author, category: key, ...body } = item;
    assert.deepEqual(
      await validate(
        plainToInstance(CreateTemplateDto, {
          ...body,
          categoryId: category.id,
          isPublic: true,
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      ),
      [],
    );
    assert(
      !/<script[^>]+src\s*=|https?:\/\/|\/src\/|sourceMappingURL|electronAPI|fetch\(|XMLHttpRequest|localStorage|indexedDB/i.test(
        item.contentJson.html,
      ),
    );
  }
});

test(
  "community seed is additive, concurrent-safe and preserves accounts, edits and deletions",
  { skip: process.env.RUN_COMMUNITY_TESTS !== "1" },
  async (t) => {
    assert.match(
      process.env.DB_DATABASE || "",
      /^project_test_community[a-z0-9_]*$/,
    );
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
    );
    await migrateProject(pool);
    const journal = (
      await pool.query("SELECT * FROM eru_schema_migrations ORDER BY id")
    ).rows;
    const first = await seedCommunityDemo(pool);
    assert.equal(first.inserted, 14);
    assert.equal(first.loginAccountsCreated, 0);
    const authors = (
      await pool.query(
        "SELECT id,password_hash,role,is_active,updated_at FROM users ORDER BY id",
      )
    ).rows;
    assert(
      authors.every((author) => author.role === "creator" && !author.is_active),
    );
    const before = (
      await pool.query(
        "SELECT id,updated_at,cache_revision,views_count FROM templates ORDER BY id",
      )
    ).rows;
    const repeated = await Promise.all([
      seedCommunityDemo(pool),
      seedCommunityDemo(pool),
    ]);
    assert(
      repeated.every(
        (result) => result.inserted === 0 && result.preserved === 14,
      ),
    );
    assert.deepEqual(
      (
        await pool.query(
          "SELECT id,updated_at,cache_revision,views_count FROM templates ORDER BY id",
        )
      ).rows,
      before,
    );
    assert.deepEqual(
      (
        await pool.query(
          "SELECT id,password_hash,role,is_active,updated_at FROM users ORDER BY id",
        )
      ).rows,
      authors,
    );
    assert.deepEqual(
      (await pool.query("SELECT * FROM eru_schema_migrations ORDER BY id"))
        .rows,
      journal,
    );

    const app = await createApplication(settings, false);
    t.after(() => app.close());
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const credentials = {
      email: randomUUID() + "@example.test",
      password: "CommunityTestOnly!2026",
    };
    const post = (url, body) =>
      fetch(base + url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    assert.equal((await post("/auth/register", credentials)).status, 201);
    const login = await post("/auth/login", credentials);
    const token = (await login.json()).accessToken;
    const headers = { authorization: "Bearer " + token };
    const query =
      "/templates?projection=summary&isPublic=true&contentFormat=erusentia-template-html&schemaVersion=1&tag=community-demo&size=12";
    assert.equal((await fetch(base + query)).status, 401);
    const page1 = await (await fetch(base + query, { headers })).json();
    const page2 = await (
      await fetch(base + query + "&page=2", { headers })
    ).json();
    assert.equal(page1.totalElements, 14);
    assert.equal(page1.totalPages, 2);
    assert.equal(page1.data.length, 12);
    assert.equal(page2.data.length, 2);
    assert.equal(
      new Set([...page1.data, ...page2.data].map((row) => row.id)).size,
      14,
    );
    assert(
      page1.data.every((item) => !("contentJson" in item) && !("html" in item)),
    );
    const catalog = await readCommunityDemoCatalog();
    for (const template of catalog.templates) {
      const detail = await (
        await fetch(base + "/templates/" + template.id, { headers })
      ).json();
      assert.equal(detail.contentJson.html, template.contentJson.html);
    }
    const selected = catalog.templates[0];
    await pool.query(
      "UPDATE templates SET title='Bản người dùng đã sửa',is_public=false,views_count=7 WHERE id=$1",
      [selected.id],
    );
    await pool.query("UPDATE templates SET deleted_at=now() WHERE id=$1", [
      catalog.templates[1].id,
    ]);
    const preserved = (
      await pool.query("SELECT * FROM templates WHERE id=ANY($1) ORDER BY id", [
        [selected.id, catalog.templates[1].id],
      ])
    ).rows;
    await seedCommunityDemo(pool);
    assert.deepEqual(
      (
        await pool.query(
          "SELECT * FROM templates WHERE id=ANY($1) ORDER BY id",
          [[selected.id, catalog.templates[1].id]],
        )
      ).rows,
      preserved,
    );
    assert.equal(
      (await (await fetch(base + query, { headers })).json()).totalElements,
      12,
    );

    // A conflicting user-owned slug must roll back the whole seed, including newly inserted authors/categories.
    // Reset only this test's disposable fixtures; production history blocks hard deletion.
    await pool.query(
      "DELETE FROM template_revisions WHERE template_id IN (SELECT id FROM templates WHERE author_id=ANY($1))",
      [catalog.authors.map((author) => author.id)],
    );
    await pool.query("DELETE FROM templates WHERE author_id=ANY($1)", [
      catalog.authors.map((author) => author.id),
    ]);
    await pool.query("DELETE FROM profiles WHERE user_id=ANY($1)", [
      catalog.authors.map((author) => author.id),
    ]);
    await pool.query("DELETE FROM users WHERE id=ANY($1)", [
      catalog.authors.map((author) => author.id),
    ]);
    await pool.query("DELETE FROM categories WHERE id=ANY($1)", [
      catalog.categories.map((category) => category.id),
    ]);
    const real = (
      await pool.query(
        "SELECT id,password_hash,role FROM users WHERE email=$1",
        [credentials.email],
      )
    ).rows[0];
    await pool.query(
      "INSERT INTO categories(id,name,slug) VALUES($1,'User category','user-category')",
      [randomUUID()],
    );
    const category = (
      await pool.query("SELECT id FROM categories WHERE slug='user-category'")
    ).rows[0].id;
    await pool.query(
      "INSERT INTO templates(author_id,category_id,title,slug,description,content_json) VALUES($1,$2,'User-owned content',$3,'Preserve me','{}')",
      [real.id, category, selected.slug],
    );
    await assert.rejects(seedCommunityDemo(pool), /template collision/);
    assert.equal(
      (await pool.query("SELECT count(*)::int n FROM users")).rows[0].n,
      1,
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int n FROM categories")).rows[0].n,
      1,
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int n FROM templates")).rows[0].n,
      1,
    );
    assert.deepEqual(
      (
        await pool.query(
          "SELECT id,password_hash,role FROM users WHERE id=$1",
          [real.id],
        )
      ).rows[0],
      real,
    );
  },
);
