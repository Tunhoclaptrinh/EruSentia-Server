const assert = require("node:assert/strict");
const test = require("node:test");
const { randomUUID, createHash } = require("node:crypto");
const { readFile } = require("node:fs/promises");
const { Pool } = require("pg");
const { DataSource } = require("typeorm");
const { createApplication } = require("../dist/src/app");
const { readConfig } = require("../dist/src/config");
const { AUTH_STORE } = require("../dist/src/auth/auth-store");
const { AuthorEntity } = require("../dist/src/templates/persistence/entities");
const {
  migrateProject,
} = require("../dist/src/infrastructure/database/project-migrations");
const { example } = require("./publication-fixture.cjs");

async function revisionContract(t, mode) {
  const database = process.env.C3_TEST_DATABASE;
  const settings = readConfig({
    ...process.env,
    TEMPLATE_STORE: mode,
    QUEUE_ENABLED: "false",
    CACHE_ENABLED: "false",
    CORS_ORIGINS: "http://localhost:5173",
    ...(mode === "postgres" ? { DB_DATABASE: database } : {}),
  });
  let pool;
  if (mode === "postgres") {
    assert.match(database ?? "", /^project_test_[a-z0-9_]+$/);
    pool = new Pool({ ...settings.database, user: settings.database.username });
    t.after(() => pool.end());
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'",
        )
      ).rows[0].n,
      0,
    );
    await t.test(
      "upgrade adds one migration and a truthful baseline without changing legacy content",
      async () => {
        await pool.query(
          "CREATE TABLE eru_schema_migrations(id text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
        );
        for (const id of [
          "01_schema.sql",
          "02_indexes.sql",
          "05_auth_sessions.sql",
          "06_message_queue.sql",
          "07_template_cache_revision.sql",
        ]) {
          const source = (await readFile("sql/" + id, "utf8")).replace(
            /\r\n/g,
            "\n",
          );
          await pool.query(source);
          await pool.query(
            "INSERT INTO eru_schema_migrations(id,checksum) VALUES($1,$2)",
            [id, createHash("sha256").update(source).digest("hex")],
          );
        }
        const ownerId = randomUUID(),
          templateId = randomUUID();
        await pool.query(
          "INSERT INTO users(id,email,password_hash,is_active) VALUES($1,'baseline@example.test','not-a-login-hash',false)",
          [ownerId],
        );
        await pool.query(
          "INSERT INTO categories(id,name,slug) VALUES('c0000000-0000-0000-0000-000000000001','Learning','learning'),('c0000000-0000-0000-0000-000000000002','Planning','planning')",
        );
        const content = {
          ...example.contentJson,
          html: "<p>Giữ nguyên nội dung cũ</p>",
          allowHeightResize: false,
        };
        await pool.query(
          "INSERT INTO templates(id,author_id,category_id,title,slug,description,content_json,is_public,views_count) VALUES($1,$2,'c0000000-0000-0000-0000-000000000001','Existing template','existing-baseline','Original description',$3,false,42)",
          [templateId, ownerId, content],
        );
        assert.deepEqual(await migrateProject(pool), [
          "08_template_revisions.sql",
          "10_service_controls.sql",
        ]);
        assert.deepEqual(await migrateProject(pool), []);
        const existing = (
          await pool.query(
            "SELECT content_json,is_public,views_count,revision FROM templates WHERE id=$1",
            [templateId],
          )
        ).rows[0];
        assert.deepEqual(existing, {
          content_json: content,
          is_public: false,
          views_count: 42,
          revision: 1,
        });
        const history = (
          await pool.query(
            "SELECT operation, actor_id,snapshot FROM template_revisions WHERE template_id=$1",
            [templateId],
          )
        ).rows;
        assert.equal(history.length, 1);
        assert.equal(history[0].operation, "baseline");
        assert.equal(history[0].actor_id, null);
        assert.deepEqual(history[0].snapshot.contentJson, content);
      },
    );
  }
  const app = await createApplication(settings, false);
  t.after(() => app.close());
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  async function request(method, path, token, body, match) {
    const response = await fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: "Bearer " + token } : {}),
        ...(match !== undefined ? { "if-match": match } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      etag: response.headers.get("etag"),
      body: response.status === 204 ? null : await response.json(),
    };
  }
  async function account(role = "user") {
    const credentials = {
      email: randomUUID() + "@example.test",
      password: "RevisionsTest!2026",
    };
    const registered = await request(
      "POST",
      "/auth/register",
      null,
      credentials,
    );
    assert.equal(registered.status, 201);
    if (role === "admin") {
      if (mode === "memory")
        app.get(AUTH_STORE).users.get(registered.body.id).role = "admin";
      else
        await app
          .get(DataSource)
          .getRepository(AuthorEntity)
          .update(registered.body.id, { role: "admin" });
    }
    const login = await request("POST", "/auth/login", null, credentials);
    assert.equal(login.status, 200);
    return { id: registered.body.id, token: login.body.accessToken };
  }
  const owner = await account(),
    other = await account(),
    admin = await account("admin");
  const payload = {
    ...example,
    slug: "history-" + randomUUID(),
    isPublic: false,
    contentJson: {
      ...example.contentJson,
      html: "<section><h2>Unicode Việt</h2></section>",
      allowHeightResize: false,
    },
  };
  const created = await request("POST", "/templates", owner.token, payload);
  assert.equal(created.status, 201);
  const id = created.body.id,
    route = "/templates/" + id;
  let current = created;
  await t.test(
    "create/detail expose a strong concurrency ETag independently of the version label",
    async () => {
      assert.equal(created.body.revision, 1);
      assert.equal(created.etag, `"template:${id}:1"`);
      assert.equal(
        (await request("GET", route, owner.token)).etag,
        created.etag,
      );
      const history = await request("GET", route + "/revisions", owner.token);
      assert.equal(history.body.totalElements, 1);
      assert.equal(history.body.data[0].actorId, owner.id);
      assert(!JSON.stringify(history.body).includes("contentJson"));
    },
  );
  await t.test(
    "missing, weak, wildcard and wrong-resource preconditions cannot mutate content",
    async () => {
      for (const body of [
        { revision: 999 },
        { expectedRevision: 1 },
        { actorId: other.id },
      ])
        assert.equal(
          (await request("PATCH", route, owner.token, body, current.etag))
            .status,
          400,
        );
      assert.equal(
        (
          await request(
            "POST",
            route + "/restore",
            owner.token,
            { revision: 1, authorId: other.id },
            current.etag,
          )
        ).status,
        400,
      );
      for (const method of ["PATCH", "DELETE"]) {
        const result = await request(
          method,
          route,
          owner.token,
          method === "PATCH" ? { title: "Unsaved draft" } : undefined,
        );
        assert.equal(result.status, 428);
        assert.equal(result.body.code, "PRECONDITION_REQUIRED");
      }
      for (const header of [
        "*",
        "W/" + current.etag,
        current.etag + ", " + current.etag,
      ])
        assert.equal(
          (
            await request(
              "PATCH",
              route,
              owner.token,
              { title: "Bad condition" },
              header,
            )
          ).status,
          400,
        );
      assert.equal(
        (
          await request(
            "PATCH",
            route,
            owner.token,
            { title: "Wrong resource" },
            `"template:${randomUUID()}:1"`,
          )
        ).status,
        412,
      );
      assert.equal((await request("GET", route, owner.token)).body.revision, 1);
    },
  );
  await t.test(
    "two writes from the same revision have one winner and one 412 without a duplicate history entry",
    async () => {
      const results = await Promise.all(
        ["First draft", "Second draft"].map((title) =>
          request("PATCH", route, owner.token, { title }, current.etag),
        ),
      );
      assert.deepEqual(results.map((row) => row.status).sort(), [200, 412]);
      current = results.find((row) => row.status === 200);
      assert.equal(current.body.revision, 2);
      assert.equal(current.body.version, created.body.version);
      const rejected = results.find((row) => row.status === 412);
      assert.equal(rejected.body.code, "PRECONDITION_FAILED");
      assert.equal(
        (await request("GET", route + "/revisions", owner.token)).body
          .totalElements,
        2,
      );
    },
  );
  await t.test("slug conflict rolls back revision and history", async () => {
    const duplicate = await request("POST", "/templates", owner.token, {
      ...payload,
      slug: "reserved-" + randomUUID(),
    });
    assert.equal(duplicate.status, 201);
    assert.equal(
      (
        await request(
          "PATCH",
          route,
          owner.token,
          { slug: duplicate.body.slug },
          current.etag,
        )
      ).status,
      409,
    );
    assert.equal((await request("GET", route, owner.token)).etag, current.etag);
    assert.equal(
      (await request("GET", route + "/revisions", owner.token)).body
        .totalElements,
      2,
    );
  });
  await t.test(
    "making a template public never exposes its private history to another reader",
    async () => {
      current = await request(
        "PATCH",
        route,
        owner.token,
        { isPublic: true },
        current.etag,
      );
      assert.equal(current.status, 200);
      assert.equal((await request("GET", route, other.token)).status, 200);
      for (const suffix of ["/revisions", "/revisions/1"])
        assert.equal(
          (await request("GET", route + suffix, other.token)).status,
          404,
        );
      assert.equal(
        (
          await request(
            "POST",
            route + "/restore",
            other.token,
            { revision: 1 },
            current.etag,
          )
        ).status,
        404,
      );
      assert.equal(
        (await request("GET", route + "/revisions", admin.token)).status,
        200,
      );
      const first = await request("GET", route + "/revisions/1", owner.token);
      assert.deepEqual(first.body.snapshot.contentJson, payload.contentJson);
    },
  );
  await t.test(
    "restore makes a new private revision, preserves source/layout and never resets ownership or history",
    async () => {
      current = await request(
        "PATCH",
        route,
        owner.token,
        {
          contentJson: { ...payload.contentJson, html: "<p>Later content</p>" },
        },
        current.etag,
      );
      assert.equal(current.status, 200);
      assert.equal(current.body.revision, 4);
      current = await request(
        "POST",
        route + "/restore",
        owner.token,
        { revision: 1 },
        current.etag,
      );
      assert.equal(current.status, 200);
      assert.equal(current.body.revision, 5);
      assert.equal(current.body.isPublic, false);
      assert.equal(current.body.authorId, owner.id);
      assert.deepEqual(current.body.contentJson, payload.contentJson);
      assert.equal((await request("GET", route, other.token)).status, 404);
    },
  );
  await t.test(
    "soft deletion and conditional restoration retain the complete lineage",
    async () => {
      const stale = current.etag;
      current = await request(
        "DELETE",
        route,
        owner.token,
        undefined,
        current.etag,
      );
      assert.equal(current.status, 204);
      assert.equal(current.etag, `"template:${id}:6"`);
      assert.equal((await request("GET", route, owner.token)).status, 404);
      const trash = await request(
        "GET",
        `/templates?projection=summary&deleted=true&authorId=${owner.id}`,
        owner.token,
      );
      assert.equal(trash.status, 200);
      assert(trash.body.data.some((row) => row.id === id && row.deletedAt));
      assert(!JSON.stringify(trash.body).includes("contentJson"));
      assert.equal(
        (
          await request(
            "GET",
            `/templates?projection=summary&deleted=true&authorId=${owner.id}`,
            other.token,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            "GET",
            "/templates?projection=summary&deleted=true",
            owner.token,
          )
        ).status,
        403,
      );
      const history = await request("GET", route + "/revisions", owner.token);
      assert.equal(history.body.deleted, true);
      assert.equal(history.body.currentEtag, current.etag);
      assert.equal(
        (
          await request(
            "POST",
            route + "/restore",
            owner.token,
            { revision: 4 },
            stale,
          )
        ).status,
        412,
      );
      current = await request(
        "POST",
        route + "/restore",
        owner.token,
        { revision: 4 },
        current.etag,
      );
      assert.equal(current.status, 200);
      assert.equal(current.body.revision, 7);
      assert.equal(current.body.deletedAt, null);
      assert.equal(current.body.isPublic, false);
      assert.equal(current.body.contentJson.html, "<p>Later content</p>");
      const page = await request(
        "GET",
        route + "/revisions?page=2&size=2",
        owner.token,
      );
      assert.deepEqual(
        page.body.data.map((row) => row.revision),
        [5, 4],
      );
      assert.equal(page.body.totalElements, 7);
      assert.equal(page.body.totalPages, 4);
      for (const suffix of [
        "/revisions?page=0",
        "/revisions?size=51",
        "/revisions/0",
        "/revisions/-1",
      ])
        assert.equal(
          (await request("GET", route + suffix, owner.token)).status,
          400,
        );
    },
  );
  if (pool)
    await t.test(
      "a history insertion failure rolls back content, revision and cache revision in the same transaction",
      async () => {
        const before = (
          await pool.query(
            "SELECT title,revision,cache_revision FROM templates WHERE id=$1",
            [id],
          )
        ).rows[0];
        await pool.query(
          "ALTER TABLE template_revisions ADD CONSTRAINT test_reject_history CHECK(snapshot->>'title' <> 'reject-history-fixture')",
        );
        try {
          assert.equal(
            (
              await request(
                "PATCH",
                route,
                owner.token,
                { title: "reject-history-fixture" },
                current.etag,
              )
            ).status,
            500,
          );
          assert.deepEqual(
            (
              await pool.query(
                "SELECT title,revision,cache_revision FROM templates WHERE id=$1",
                [id],
              )
            ).rows[0],
            before,
          );
          assert.equal(
            (await request("GET", route + "/revisions", owner.token)).body
              .totalElements,
            7,
          );
        } finally {
          await pool.query(
            "ALTER TABLE template_revisions DROP CONSTRAINT test_reject_history",
          );
        }
      },
    );
  await t.test(
    "restore refuses an old slug now owned by another template without losing the current draft",
    async () => {
      current = await request(
        "PATCH",
        route,
        owner.token,
        { slug: "new-slug-" + randomUUID() },
        current.etag,
      );
      assert.equal(current.status, 200);
      const occupied = await request("POST", "/templates", other.token, {
        ...payload,
        title: "Another template",
      });
      assert.equal(occupied.status, 201);
      const previous = current.etag;
      const count = (await request("GET", route + "/revisions", owner.token))
        .body.totalElements;
      assert.equal(
        (
          await request(
            "POST",
            route + "/restore",
            owner.token,
            { revision: 1 },
            current.etag,
          )
        ).status,
        409,
      );
      assert.equal((await request("GET", route, owner.token)).etag, previous);
      assert.equal(
        (await request("GET", route + "/revisions", owner.token)).body
          .totalElements,
        count,
      );
    },
  );
  await t.test(
    "admin writes retain the author and record the actual actor; CORS allows If-Match and exposes ETag",
    async () => {
      current = await request(
        "PATCH",
        route,
        admin.token,
        { title: "Admin correction" },
        current.etag,
      );
      assert.equal(current.status, 200);
      assert.equal(current.body.authorId, owner.id);
      const history = await request("GET", route + "/revisions", owner.token);
      assert.equal(history.body.data[0].actorId, admin.id);
      const preflight = await fetch(base + route, {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "PATCH",
          "Access-Control-Request-Headers":
            "authorization,content-type,if-match",
        },
      });
      assert.equal(preflight.status, 204);
      assert.match(
        preflight.headers.get("access-control-allow-headers"),
        /if-match/i,
      );
      const detail = await fetch(base + route, {
        headers: {
          Origin: "http://localhost:5173",
          authorization: "Bearer " + owner.token,
        },
      });
      assert.match(
        detail.headers.get("access-control-expose-headers"),
        /etag/i,
      );
    },
  );
}

test("C3 conditional writes and revision history with memory persistence", (t) =>
  revisionContract(t, "memory"));
test(
  "C3 migration, concurrent writes and atomic history on PostgreSQL",
  { skip: process.env.RUN_VERSIONING_TESTS !== "1" },
  (t) => revisionContract(t, "postgres"),
);
