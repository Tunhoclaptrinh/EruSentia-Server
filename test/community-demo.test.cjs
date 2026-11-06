const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { randomUUID } = require("node:crypto");
const { mkdtemp, readdir, readFile, stat, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { plainToInstance } = require("class-transformer");
const { validate } = require("class-validator");
const {
  readCommunityDemoCatalog,
  seedCommunityDemo,
  curatedTemplateFingerprint,
} = require("../dist/src/infrastructure/database/community-demo");
const {
  migrateProject,
  seedProject,
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

    await t.test(
      "curated v1 upgrades require a backup, preserve edits/deletions and create one history revision",
      async () => {
        const original = require("./fixtures/community-v1-first.json");
        const originalHashes = require("../tools/community/previous-v1.json");
        await pool.query(
          `UPDATE templates SET author_id=$2,category_id=$3,title=$4,slug=$5,description=$6,content_json=$7::jsonb,thumbnail_url=$8,tags=$9,version=$10,is_public=true,deleted_at=NULL WHERE id=$1`,
          [
            original.id,
            original.author_id,
            original.category_id,
            original.title,
            original.slug,
            original.description,
            JSON.stringify(original.content_json),
            original.thumbnail_url,
            original.tags,
            original.version,
          ],
        );
        const read = async () =>
          (
            await pool.query("SELECT * FROM templates WHERE id=$1", [
              original.id,
            ])
          ).rows[0];
        const before = await read();
        assert.equal(
          curatedTemplateFingerprint(before),
          originalHashes.templates[0].sha256,
        );
        await assert.rejects(
          seedCommunityDemo(pool, { upgradeExisting: true }),
          /backup handler/,
        );
        await assert.rejects(
          seedCommunityDemo(pool, {
            upgradeExisting: true,
            beforeUpgrade: async () => {
              throw Error("Backup failed");
            },
          }),
          /Backup failed/,
        );
        assert.deepEqual(await read(), before);
        const dry = await seedCommunityDemo(pool, {
          upgradeExisting: true,
          dryRun: true,
        });
        assert.equal(dry.upgraded, 1);
        assert.equal(dry.dryRun, true);
        assert.deepEqual(await read(), before);
        let backups = 0;
        const results = await Promise.all(
          [1, 2].map(() =>
            seedCommunityDemo(pool, {
              upgradeExisting: true,
              beforeUpgrade: async (rows) => {
                backups++;
                assert.equal(rows.length, 1);
                assert.deepEqual(rows[0], before);
              },
            }),
          ),
        );
        assert.equal(
          results.reduce((n, result) => n + result.upgraded, 0),
          1,
        );
        assert.equal(backups, 1);
        const after = await read();
        assert.equal(after.version, "2.0.0");
        assert.equal(after.revision, before.revision + 1);
        assert.equal(after.views_count, before.views_count);
        assert.equal(after.author_id, before.author_id);
        assert.equal(after.content_json.sharing.license, "MIT");
        const history = (
          await pool.query(
            "SELECT snapshot FROM template_revisions WHERE template_id=$1 AND revision=$2",
            [original.id, before.revision],
          )
        ).rows[0];
        assert.equal(
          history.snapshot.contentJson.html,
          original.content_json.html,
        );
        await pool.query(
          "UPDATE templates SET title='My own revision' WHERE id=$1",
          [original.id],
        );
        const edited = await read();
        const noOverwrite = await seedCommunityDemo(pool, {
          upgradeExisting: true,
          beforeUpgrade: async () => {
            throw Error("No managed originals left");
          },
        });
        assert.equal(noOverwrite.upgraded, 0);
        assert.deepEqual(await read(), edited);
        // Exercise the real operator command and its protected file backup, not just a callback stub.
        await pool.query(
          `UPDATE templates SET title=$2,description=$3,content_json=$4::jsonb,tags=$5,version=$6,is_public=true WHERE id=$1`,
          [
            original.id,
            original.title,
            original.description,
            JSON.stringify(original.content_json),
            original.tags,
            original.version,
          ],
        );
        const directory = await mkdtemp(
          path.join(tmpdir(), "eru-community-backup-test-"),
        );
        try {
          const command = spawnSync(
            process.execPath,
            [
              "dist/scripts/seed-community.js",
              "--upgrade-curated",
              "--backup-dir",
              directory,
            ],
            {
              cwd: process.cwd(),
              env: process.env,
              encoding: "utf8",
              timeout: 30000,
            },
          );
          assert.equal(command.status, 0, command.stderr);
          const folders = await readdir(directory);
          assert.equal(folders.length, 1);
          const folder = path.join(directory, folders[0]),
            backupFile = path.join(folder, "before-upgrade.json");
          assert.equal((await stat(folder)).mode & 0o777, 0o700);
          assert.equal((await stat(backupFile)).mode & 0o777, 0o600);
          const backup = JSON.parse(await readFile(backupFile, "utf8"));
          assert.equal(backup.templates.length, 1);
          assert.equal(
            backup.templates[0].content_json.html,
            original.content_json.html,
          );
          assert(!("users" in backup));
          assert(!("password_hash" in backup.templates[0]));
          assert.equal((await read()).version, "2.0.0");
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
        assert.deepEqual(
          (await pool.query("SELECT * FROM eru_schema_migrations ORDER BY id"))
            .rows,
          journal,
        );
        assert.deepEqual(
          (
            await pool.query(
              "SELECT id,password_hash,role,is_active,updated_at FROM users WHERE id=ANY($1) ORDER BY id",
              [catalog.authors.map((a) => a.id)],
            )
          ).rows,
          authors,
        );
      },
    );

    await t.test(
      "curated-only hides untouched technical examples with a backup, without deleting or hiding an edited example",
      async () => {
        await seedProject(pool);
        const ids =
          require("../tools/community/previous-v1.json").foundationExamples.map(
            (entry) => entry.id,
          );
        const before = (
          await pool.query(
            "SELECT * FROM templates WHERE id=ANY($1) ORDER BY id",
            [ids],
          )
        ).rows;
        assert.equal(before.length, 2);
        await pool.query(
          "UPDATE templates SET title='A deliberately published user revision' WHERE id=$1",
          [ids[1]],
        );
        const dry = await seedCommunityDemo(pool, {
          hideFoundationExamples: true,
          dryRun: true,
        });
        assert.equal(dry.hiddenFoundationExamples, 1);
        assert.equal(
          (
            await pool.query("SELECT is_public FROM templates WHERE id=$1", [
              ids[0],
            ])
          ).rows[0].is_public,
          true,
        );
        let backedUp = 0;
        const result = await seedCommunityDemo(pool, {
          hideFoundationExamples: true,
          beforeUpgrade: async (rows) => {
            backedUp = rows.length;
            assert.equal(rows[0].id, ids[0]);
          },
        });
        assert.equal(result.hiddenFoundationExamples, 1);
        assert.equal(backedUp, 1);
        const after = (
          await pool.query(
            "SELECT id,is_public FROM templates WHERE id=ANY($1) ORDER BY id",
            [ids],
          )
        ).rows;
        assert.deepEqual(after, [
          { id: ids[0], is_public: false },
          { id: ids[1], is_public: true },
        ]);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM templates WHERE id=ANY($1)",
              [ids],
            )
          ).rows[0].n,
          2,
        );
        assert.equal(
          (await seedCommunityDemo(pool, { hideFoundationExamples: true }))
            .hiddenFoundationExamples,
          0,
        );
      },
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
    const counts = async () =>
      (
        await pool.query(
          `SELECT (SELECT count(*)::int FROM users) AS users,(SELECT count(*)::int FROM categories) AS categories,(SELECT count(*)::int FROM templates) AS templates`,
        )
      ).rows[0];
    const collisionBaseline = await counts();
    await assert.rejects(seedCommunityDemo(pool), /template collision/);
    assert.deepEqual(await counts(), collisionBaseline);
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
