const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto"),
  { Pool } = require("pg");
const { createApplication } = require("../dist/src/app"),
  { readConfig } = require("../dist/src/config"),
  { AUTH_STORE } = require("../dist/src/auth/auth-store"),
  { Passwords } = require("../dist/src/auth/passwords"),
  {
    migrateProject,
    seedProject,
  } = require("../dist/src/infrastructure/database/project-migrations");
const password = "RetainedTestOnly!2026",
  baseContent = {
    format: "erusentia-template-html",
    schemaVersion: 1,
    html: "<p>Học Web</p>",
    sharing: {
      license: "MIT",
      attribution: "Test author",
      permissionConfirmed: true,
    },
  };
async function fixture(t, mode) {
  const settings = readConfig({
    ...process.env,
    NODE_ENV: "test",
    TEMPLATE_STORE: mode,
    JWT_SECRET: "retained-test-only-at-least-32-characters",
    QUEUE_ENABLED: "false",
    CACHE_ENABLED: "false",
    ACCOUNT_EMAIL_MODE: "disabled",
    API_RATE_LIMITS_ENABLED: "false",
    TEMPLATE_QUOTA_COUNT: "100",
    TEMPLATE_QUOTA_CONTENT_BYTES: "8192",
    TEMPLATE_RETAINED_COUNT: "3",
    TEMPLATE_RETAINED_REVISIONS: "8",
    TEMPLATE_RETAINED_BYTES: "8192",
    REPORT_RETAINED_COUNT: "2",
  });
  let pool;
  if (mode === "postgres") {
    assert.match(settings.database.database, /^project_test_retained/);
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
    await migrateProject(pool);
    await seedProject(pool);
  }
  const app = await createApplication(settings, false);
  t.after(() => app.close());
  await app.listen(0, "127.0.0.1");
  const origin = await app.getUrl();
  async function call(method, path, body, token, tag) {
    const r = await fetch(origin + path, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(tag ? { "If-Match": tag } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const raw = await r.text();
    return {
      status: r.status,
      body: raw ? JSON.parse(raw) : null,
      etag: r.headers.get("etag"),
    };
  }
  async function account(role = "user") {
    const email = randomUUID() + "@example.test";
    await app.get(AUTH_STORE).createUser({
      email,
      passwordHash: await app.get(Passwords).hash(password),
      role,
    });
    const r = await call("POST", "/auth/login", { email, password });
    assert.equal(r.status, 200);
    return { ...r.body.user, token: r.body.accessToken };
  }
  const create = (user, content = baseContent, isPublic = false) =>
    call(
      "POST",
      "/templates",
      {
        title: "Kế hoạch học Web",
        slug: "retained-" + randomUUID(),
        description: "HTML CSS JS practice.",
        categoryId: "c0000000-0000-0000-0000-000000000001",
        contentJson: content,
        isPublic,
      },
      user.token,
    );
  return { app, call, account, create, pool, settings, origin };
}
async function contract(t, mode) {
  const f = await fixture(t, mode),
    { call, account, create, pool } = f,
    owner = await account(),
    other = await account(),
    admin = await account("admin");
  const usage = async (user = owner) =>
    (await call("GET", "/account/usage", null, user.token)).body;
  let deleted;
  await t.test(
    "create/delete cycles still consume retained resources; a rejected write has no extra history",
    async () => {
      for (let i = 0; i < 3; i++) {
        const r = await create(owner);
        assert.equal(r.status, 201);
        const d = await call(
          "DELETE",
          "/templates/" + r.body.id,
          null,
          owner.token,
          r.etag,
        );
        assert.equal(d.status, 204);
        deleted = { ...r, etag: d.etag };
      }
      const u = await usage();
      assert.equal(u.used.templates, 0);
      assert.equal(u.retained.used.templates, 3);
      assert.equal(u.retained.used.revisions, 6);
      assert(u.retained.used.contentBytes > 0);
      const denied = await create(owner);
      assert.equal(denied.status, 409);
      assert.equal(denied.body.code, "TEMPLATE_RETAINED_QUOTA_EXCEEDED");
      assert.deepEqual((await usage()).retained.used, u.retained.used);
    },
  );
  await t.test(
    "permanent deletion requires ownership, soft deletion, exact ETag, password and slug; it frees retained quota",
    async () => {
      const id = deleted.body.id,
        path = "/templates/" + id + "/purge",
        body = { password, confirmSlug: deleted.body.slug };
      for (const user of [other, admin])
        assert.equal(
          (await call("POST", path, body, user.token, deleted.etag)).status,
          404,
        );
      assert.equal(
        (
          await call(
            "POST",
            path,
            { ...body, password: "Wrong!2026" },
            owner.token,
            deleted.etag,
          )
        ).body.code,
        "PASSWORD_CONFIRMATION_FAILED",
      );
      assert.equal((await call("POST", path, body, owner.token)).status, 428);
      assert.equal(
        (
          await call(
            "POST",
            path,
            body,
            owner.token,
            deleted.etag.replace(':2"', ':1"'),
          )
        ).status,
        412,
      );
      assert.equal(
        (
          await call(
            "POST",
            path,
            { ...body, confirmSlug: "wrong-slug" },
            owner.token,
            deleted.etag,
          )
        ).status,
        400,
      );
      const before = (await usage()).retained.used;
      assert.equal(
        (await call("POST", path, body, owner.token, deleted.etag)).status,
        204,
      );
      const after = (await usage()).retained.used;
      assert.equal(after.templates, before.templates - 1);
      assert.equal(after.revisions, before.revisions - 2);
      assert(after.contentBytes < before.contentBytes);
      assert.equal(
        (
          await call(
            "GET",
            "/templates/" + id + "/revisions",
            null,
            owner.token,
          )
        ).status,
        404,
      );
      assert.equal(
        (await call("POST", path, body, owner.token, deleted.etag)).status,
        404,
      );
      const active = await create(owner);
      assert.equal(active.status, 201);
      assert.equal((await call("POST", "/templates/" + active.body.id + "/purge",
        { password, confirmSlug: active.body.slug }, owner.token, active.etag)).status, 400);
    },
  );
  await t.test(
    "revision and byte limits reject atomically while soft deletion stays available and restore does not bypass the budget",
    async () => {
      const user = await account();
      let r = await create(user);
      for (let i = 0; i < 7; i++) {
        r = await call(
          "PATCH",
          "/templates/" + r.body.id,
          { title: "Kế hoạch học Web " + i },
          user.token,
          r.etag,
        );
        assert.equal(r.status, 200);
      }
      const before = (await usage(user)).retained.used,
        id = r.body.id;
      const denied = await call(
        "PATCH",
        "/templates/" + id,
        { title: "Too many revisions" },
        user.token,
        r.etag,
      );
      assert.equal(denied.body.code, "TEMPLATE_RETAINED_QUOTA_EXCEEDED");
      assert.deepEqual((await usage(user)).retained.used, before);
      const d = await call(
        "DELETE",
        "/templates/" + id,
        null,
        user.token,
        r.etag,
      );
      assert.equal(d.status, 204);
      assert.equal((await usage(user)).retained.used.revisions, 9);
      const restored = await call(
        "POST",
        "/templates/" + id + "/restore",
        { revision: 1 },
        user.token,
        d.etag,
      );
      assert.equal(restored.body.code, "TEMPLATE_RETAINED_QUOTA_EXCEEDED");
      assert.equal((await usage(user)).used.templates, 0);
      const bytesUser = await account(),
        big = await create(bytesUser, {
          ...baseContent,
          html: "<p>" + "x".repeat(2000) + "</p>",
        });
      assert.equal(big.status, 201);
      const old = (await usage(bytesUser)).retained.used;
      const bigger = await call(
        "PATCH",
        "/templates/" + big.body.id,
        {
          contentJson: {
            ...baseContent,
            html: "<p>" + "x".repeat(3000) + "</p>",
          },
        },
        bytesUser.token,
        big.etag,
      );
      assert.equal(bigger.body.code, "TEMPLATE_RETAINED_QUOTA_EXCEEDED");
      assert.deepEqual((await usage(bytesUser)).retained.used, old);
      assert.equal(
        (await call("GET", "/templates/" + big.body.id, null, bytesUser.token))
          .etag,
        big.etag,
      );
    },
  );
  await t.test(
    "pending reports prevent purging; after an admin decision, purge removes history/receipts and unlinks audit references",
    async () => {
      const author = await account(),
        reader = await account(),
        resource = await create(author, baseContent, true),
        id = resource.body.id;
      const report = await call(
        "POST",
        `/templates/${id}/reports`,
        { reasonCode: "unsafe", description: "Kiểm tra trước khi xóa." },
        reader.token,
      );
      assert.equal(report.status, 202);
      const d = await call(
        "DELETE",
        `/templates/${id}`,
        null,
        author.token,
        resource.etag,
      );
      assert.equal(d.status, 204);
      const body = { password, confirmSlug: resource.body.slug };
      assert.equal(
        (
          await call(
            "POST",
            `/templates/${id}/purge`,
            body,
            author.token,
            d.etag,
          )
        ).body.code,
        "RESOURCE_UNDER_REVIEW",
      );
      const result = await call(
        "POST",
        `/admin/reports/${report.body.id}/decision`,
        {
          action: "dismiss",
          reason: "Đã kiểm tra, tác giả được xóa dữ liệu.",
          reportVersion: 1,
        },
        admin.token,
        d.etag,
      );
      assert.equal(result.status, 200);
      if (pool) {
        const before = (await usage(author)).retained.used;
        await pool.query(`CREATE FUNCTION test_purge_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced purge rollback'; END $$;
          CREATE TRIGGER test_purge_failure AFTER DELETE ON templates FOR EACH ROW EXECUTE FUNCTION test_purge_failure()`);
        try {
          const failed = await call("POST", `/templates/${id}/purge`, body, author.token, d.etag);
          assert.equal(failed.status, 500);
          assert(!JSON.stringify(failed.body).includes("forced purge rollback"));
          assert.deepEqual((await usage(author)).retained.used, before);
          assert.equal((await call("GET", "/account/reports?state=all", null, reader.token)).body.totalElements, 1);
          const audit = (await pool.query("SELECT report_id,template_id FROM moderation_audit WHERE report_id=$1", [report.body.id])).rows[0];
          assert.equal(audit.template_id, id);
          assert.equal(audit.report_id, report.body.id);
        } finally {
          await pool.query("DROP TRIGGER test_purge_failure ON templates; DROP FUNCTION test_purge_failure()");
        }
      }
      assert.equal(
        (
          await call(
            "POST",
            `/templates/${id}/purge`,
            body,
            author.token,
            d.etag,
          )
        ).status,
        204,
      );
      assert.equal(
        (await call("GET", "/account/reports?state=all", null, reader.token))
          .body.totalElements,
        0,
      );
      assert.equal((await usage(author)).retained.used.templates, 0);
      if (pool) {
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM template_revisions WHERE template_id=$1",
              [id],
            )
          ).rows[0].n,
          0,
        );
        const a = (
          await pool.query(
            "SELECT report_id,template_id FROM moderation_audit WHERE reason=$1",
            ["Đã kiểm tra, tác giả được xóa dữ liệu."],
          )
        ).rows[0];
        assert.equal(a.report_id, null);
        assert.equal(a.template_id, null);
      }
    },
  );
  await t.test(
    "retained report count is per member and duplicate receipts remain available at the limit",
    async () => {
      const author = await account(),
        reader = await account();
      let resource = await create(author, baseContent, true);
      const input = {
          reasonCode: "spam",
          description: "Kiểm tra report budget.",
        },
        id = resource.body.id;
      const first = await call(
        "POST",
        `/templates/${id}/reports`,
        input,
        reader.token,
      );
      assert.equal(first.status, 202);
      resource = await call(
        "PATCH",
        `/templates/${id}`,
        { title: "Revision two" },
        author.token,
        resource.etag,
      );
      const second = await call(
        "POST",
        `/templates/${id}/reports`,
        input,
        reader.token,
      );
      assert.equal(second.status, 202);
      assert.notEqual(second.body.id, first.body.id);
      assert.equal(
        (await call("POST", `/templates/${id}/reports`, input, reader.token))
          .body.id,
        second.body.id,
      );
      resource = await call(
        "PATCH",
        `/templates/${id}`,
        { title: "Revision three" },
        author.token,
        resource.etag,
      );
      const denied = await call(
        "POST",
        `/templates/${id}/reports`,
        input,
        reader.token,
      );
      assert.equal(denied.body.code, "REPORT_QUOTA_EXCEEDED");
      assert.equal(
        (await call("GET", "/account/reports?state=all", null, reader.token))
          .body.totalElements,
        2,
      );
    },
  );
  if (pool)
    await t.test(
      "technical retention is dry-run first, requires the exact reviewed candidate digest and never removes active sessions or business content",
      async () => {
        const {
          prepareTechnicalRetention,
          applyTechnicalRetention,
        } = require("../dist/src/operations/technical-retention");
        const before = (
            await pool.query("SELECT count(*)::int n FROM templates")
          ).rows[0].n,
          history = (
            await pool.query("SELECT count(*)::int n FROM template_revisions")
          ).rows[0].n;
        const initial = await prepareTechnicalRetention(pool);
        assert.equal(initial.emailEnabled, false);
        await migrateProject(pool, undefined, { accountEmail: true });
        const session = randomUUID(),
          family = randomUUID(),
          hash = "a".repeat(64),
          rate = "b".repeat(64);
        await pool.query(
          "INSERT INTO auth_refresh_sessions(id,user_id,family_id,token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,now()-interval '60 days',now()-interval '40 days')",
          [session, owner.id, family, hash],
        );
        await pool.query(
          "INSERT INTO service_rate_limits(key_hash,hits,expires_at) VALUES($1,1,now()-interval '2 days')",
          [rate],
        );
        await pool.query(
          "INSERT INTO auth_email_actions(user_id,purpose,token_hash,requested_at,expires_at) VALUES($1,'verify',$2,now()-interval '20 days',now()-interval '10 days')",
          [owner.id, "c".repeat(64)],
        );
        const plan = await prepareTechnicalRetention(pool);
        assert.deepEqual(plan.eligible, {
          rateBuckets: 1,
          expiredSessions: 1,
          emailActions: 1,
        });
        assert(!JSON.stringify(plan).includes(owner.id));
        assert(!JSON.stringify(plan).includes(hash));
        await assert.rejects(
          applyTechnicalRetention(pool, plan.asOf, "d".repeat(64)),
          { code: "RETENTION_PLAN_CHANGED" },
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM auth_refresh_sessions WHERE id=$1",
              [session],
            )
          ).rows[0].n,
          1,
        );
        await assert.rejects(
          prepareTechnicalRetention(
            pool,
            new Date(Date.now() + 86400000).toISOString(),
          ),
          { code: "RETENTION_INVALID_AS_OF" },
        );
        const result = await applyTechnicalRetention(
          pool,
          plan.asOf,
          plan.digest,
        );
        assert.equal(result.applied, true);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM auth_refresh_sessions WHERE id=$1",
              [session],
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (await pool.query("SELECT count(*)::int n FROM templates")).rows[0].n,
          before,
        );
        assert.equal(
          (await pool.query("SELECT count(*)::int n FROM template_revisions"))
            .rows[0].n,
          history,
        );
        assert.equal(
          (await call("GET", "/auth/me", null, owner.token)).status,
          200,
        );
        assert.deepEqual((await prepareTechnicalRetention(pool)).eligible, {
          rateBuckets: 0,
          expiredSessions: 0,
          emailActions: 0,
        });
      },
    );
  await t.test("concurrent reports across APIs cannot exceed the per-member retained budget", async () => {
    const author = await account(), reader = await account();
    const rows = [];
    for (let i = 0; i < 3; i++) rows.push(await create(author, baseContent, true));
    const input = { reasonCode: "spam", description: "Concurrent report budget." };
    assert.equal((await call("POST", `/templates/${rows[0].body.id}/reports`, input, reader.token)).status, 202);
    let peer;
    try {
      let target = f.origin;
      if (pool) {
        peer = await createApplication(f.settings, false);
        await peer.listen(0, "127.0.0.1"); target = await peer.getUrl();
      }
      const results = await Promise.all([f.origin, target].map(async (origin, i) => {
        const r = await fetch(`${origin}/templates/${rows[i + 1].body.id}/reports`, {
          method: "POST", headers: { Authorization: "Bearer " + reader.token, "Content-Type": "application/json" }, body: JSON.stringify(input),
        });
        return { status: r.status, body: await r.json() };
      }));
      assert.deepEqual(results.map(r => r.status).sort(), [202, 409]);
      assert.equal(results.find(r => r.status === 409).body.code, "REPORT_QUOTA_EXCEEDED");
      assert.equal((await call("GET", "/account/reports?state=all", null, reader.token)).body.totalElements, 2);
    } finally { await peer?.close(); }
  });
  await t.test(
    "concurrent writes serialize retained history accounting across APIs",
    async () => {
      const user = await account(),
        r = await create(user);
      let tag = r.etag;
      for (let i = 0; i < 6; i++) {
        const next = await call(
          "PATCH",
          "/templates/" + r.body.id,
          { title: "Seed revision " + i },
          user.token,
          tag,
        );
        assert.equal(next.status, 200);
        tag = next.etag;
      }
      let peer;
      try {
        let target = f.origin;
        if (pool) {
          peer = await createApplication(f.settings, false);
          await peer.listen(0, "127.0.0.1");
          target = await peer.getUrl();
        }
        const current = tag,
          results = await Promise.all(
            [f.origin, target].map(async (origin) => {
              const reply = await fetch(origin + "/templates", {
                method: "POST",
                headers: {
                  Authorization: "Bearer " + user.token,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  title: "Concurrent resource",
                  slug: "concurrent-" + randomUUID(),
                  description: "Retained budget test.",
                  categoryId: "c0000000-0000-0000-0000-000000000001",
                  contentJson: baseContent,
                  isPublic: false,
                }),
              });
              return reply.status;
            }),
          );
        assert.deepEqual(results.sort(), [201, 409]);
        assert.equal((await usage(user)).retained.used.revisions, 8);
      } finally {
        await peer?.close();
      }
    },
  );
}
test("retained resources and explicit permanent deletion: memory", (t) =>
  contract(t, "memory"));
test(
  "retained resources and explicit permanent deletion: PostgreSQL",
  { skip: process.env.RUN_RETAINED_TESTS !== "1" },
  (t) => contract(t, "postgres"),
);
