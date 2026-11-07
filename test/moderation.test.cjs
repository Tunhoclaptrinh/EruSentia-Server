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
const { example } = require("./publication-fixture.cjs");
async function fixture(t, mode) {
  const settings = readConfig({
    ...process.env,
    NODE_ENV: "test",
    TEMPLATE_STORE: mode,
    JWT_SECRET: "moderation-tests-only-at-least-32-characters",
    QUEUE_ENABLED: "false",
    CACHE_ENABLED: "false",
    ACCOUNT_EMAIL_MODE: "disabled",
    API_WRITES_PER_USER: "1000",
    AUTH_LOGIN_PER_IDENTITY: "100",
  });
  let pool;
  if (mode === "postgres") {
    assert.match(settings.database.database, /^project_test_moderation/);
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
  async function call(method, path, body, token, headers = {}) {
    const r = await fetch(origin + path, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...headers,
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
    const credentials = {
      email: randomUUID() + "@example.test",
      password: "ModerationTestOnly!2026",
    };
    if (role === "user")
      assert.equal(
        (await call("POST", "/auth/register", credentials)).status,
        201,
      );
    else
      await app
        .get(AUTH_STORE)
        .createUser({
          email: credentials.email,
          passwordHash: await app.get(Passwords).hash(credentials.password),
          role,
        });
    const r = await call("POST", "/auth/login", credentials);
    assert.equal(r.status, 200);
    return { ...r.body.user, token: r.body.accessToken };
  }
  return { app, call, account, pool, settings, origin };
}
async function contract(t, mode) {
  const { call, account, pool } = await fixture(t, mode),
    alice = await account(),
    bob = await account(),
    admin = await account("admin"),
    creator = await account("creator"),
    other = await account();
  const created = await call(
    "POST",
    "/templates",
    { ...example, slug: "review-" + randomUUID(), isPublic: true },
    alice.token,
  );
  assert.equal(created.status, 201);
  const id = created.body.id;
  const reportInput = {
    reasonCode: "unsafe",
    description: "Nội dung mô phỏng cần kiểm tra; không chạy mã ngoài runner.",
  };
  let report;
  await t.test(
    "only authenticated members report public content; duplicates are idempotent and own receipts contain no HTML or reporter identity",
    async () => {
      assert.equal(
        (await call("POST", `/templates/${id}/reports`, reportInput)).status,
        401,
      );
      assert.equal(
        (
          await call(
            "POST",
            `/templates/${id}/reports`,
            { ...reportInput, reporterId: alice.id },
            bob.token,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            "POST",
            `/templates/${id}/reports`,
            { ...reportInput, description: " ".repeat(20) },
            bob.token,
          )
        ).status,
        400,
      );
      const replies = await Promise.all(
        Array.from({ length: 3 }, () =>
          call("POST", `/templates/${id}/reports`, reportInput, bob.token),
        ),
      );
      assert(replies.every((r) => r.status === 202));
      assert.equal(new Set(replies.map((r) => r.body.id)).size, 1);
      report = replies[0].body;
      assert(!("reporterId" in report));
      assert(!JSON.stringify(report).includes("contentJson"));
      assert.equal(
        (await call("GET", "/account/reports?state=all", null, bob.token)).body
          .totalElements,
        1,
      );
      assert.equal(
        (await call("GET", "/account/reports?state=all", null, other.token))
          .body.totalElements,
        0,
      );
      for (const user of [alice, bob, creator]) {
        assert.equal(
          (await call("GET", "/admin/reports", null, user.token)).status,
          403,
        );
        assert.equal(
          (await call("GET", `/admin/reports/${report.id}`, null, user.token))
            .status,
          403,
        );
        assert.equal(
          (
            await call(
              "POST",
              `/admin/reports/${report.id}/decision`,
              { action: "hide", reason: "Invalid role", reportVersion: 1 },
              user.token,
              { "If-Match": created.etag },
            )
          ).status,
          403,
        );
      }
      const listing = await call("GET", "/admin/reports", null, admin.token);
      assert.equal(listing.status, 200);
      assert.equal(listing.body.totalElements, 1);
      assert(!JSON.stringify(listing.body).includes("contentJson"));
    },
  );
  const decision = (input, tag = created.etag) =>
    call(
      "POST",
      `/admin/reports/${report.id}/decision`,
      input,
      admin.token,
      tag ? { "If-Match": tag } : {},
    );
  await t.test(
    "report and resource versions both guard decisions; rejected decisions have no audit or visibility change",
    async () => {
      const input = {
        action: "hide",
        reason: "Mẫu cần sửa.",
        reportVersion: 1,
      };
      assert.equal((await decision(input, null)).status, 428);
      assert.equal(
        (await decision({ ...input, reportVersion: 2 })).status,
        412,
      );
      assert.equal(
        (await decision(input, created.etag.replace(':1"', ':999"'))).status,
        412,
      );
      const detail = await call(
        "GET",
        `/admin/reports/${report.id}`,
        null,
        admin.token,
      );
      assert.equal(detail.body.audit.length, 0);
      assert.equal(detail.body.resource.isPublic, true);
      assert.equal(detail.body.report.version, 1);
    },
  );
  await t.test(
    "hiding is atomic, excludes catalog/detail and blocks all ordinary publication paths; history restore keeps policy",
    async () => {
      const r = await decision({
        action: "hide",
        reason: "Cần loại bỏ nội dung không phù hợp trước khi chia sẻ.",
        reportVersion: 1,
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.state, "resolved");
      assert.equal(
        (await call("GET", `/templates/${id}`, null, bob.token)).status,
        404,
      );
      assert.equal(
        (await call("GET", `/templates?authorId=${alice.id}`, null, bob.token))
          .body.totalElements,
        0,
      );
      assert.equal(
        (
          await call(
            "POST",
            `/templates/${id}/reports`,
            reportInput,
            other.token,
          )
        ).status,
        404,
      );
      let current = await call("GET", `/templates/${id}`, null, alice.token);
      assert.equal(current.body.moderationState, "hidden");
      assert.equal(current.body.isPublic, false);
      for (const user of [alice, admin])
        assert.equal(
          (
            await call(
              "PATCH",
              `/templates/${id}`,
              { isPublic: true },
              user.token,
              { "If-Match": current.etag },
            )
          ).body.code,
          "TEMPLATE_RESTRICTED",
        );
      assert.equal(
        (
          await call(
            "PATCH",
            `/templates/${id}`,
            { moderationState: "visible" },
            alice.token,
            { "If-Match": current.etag },
          )
        ).status,
        400,
      );
      const edited = await call(
        "PATCH",
        `/templates/${id}`,
        { title: "Private author revision" },
        alice.token,
        { "If-Match": current.etag },
      );
      assert.equal(edited.status, 200);
      const restored = await call(
        "POST",
        `/templates/${id}/restore`,
        { revision: 1 },
        alice.token,
        { "If-Match": edited.etag },
      );
      assert.equal(restored.status, 200);
      assert.equal(restored.body.moderationState, "hidden");
      assert.equal(restored.body.isPublic, false);
      const receipt = await call(
        "GET",
        "/account/reports?state=all",
        null,
        bob.token,
      );
      assert.equal(receipt.body.data[0].reportedTitle, created.body.title);
      assert(!JSON.stringify(receipt.body).includes("Private author revision"));
    },
  );
  await t.test(
    "release is auditable and remains private until the author deliberately republishes",
    async () => {
      const detail = await call(
        "GET",
        `/admin/reports/${report.id}`,
        null,
        admin.token,
      );
      const released = await decision(
        {
          action: "release",
          reason: "Đã xem lại bản chỉnh sửa; tác giả có thể xuất bản lại.",
          reportVersion: detail.body.report.version,
        },
        detail.body.etag,
      );
      assert.equal(released.status, 200);
      assert.equal(
        (await call("GET", `/templates/${id}`, null, bob.token)).status,
        404,
      );
      const current = await call("GET", `/templates/${id}`, null, alice.token);
      assert.equal(current.body.moderationState, "visible");
      assert.equal(current.body.isPublic, false);
      const publish = await call(
        "PATCH",
        `/templates/${id}`,
        { isPublic: true },
        alice.token,
        { "If-Match": current.etag },
      );
      assert.equal(publish.status, 200);
      const after = await call(
        "GET",
        `/admin/reports/${report.id}`,
        null,
        admin.token,
      );
      assert.deepEqual(
        after.body.audit.map((a) => a.action),
        ["hide", "release"],
      );
    },
  );
  await t.test(
    "two simultaneous decisions have one winner; report-only dismissal does not change the template revision",
    async () => {
      const submitted = await call(
        "POST",
        `/templates/${id}/reports`,
        { reasonCode: "spam", description: "Kiểm tra báo cáo ở revision mới." },
        other.token,
      );
      assert.equal(submitted.status, 202);
      assert.notEqual(submitted.body.id, report.id);
      const detail = await call(
          "GET",
          `/admin/reports/${submitted.body.id}`,
          null,
          admin.token,
        ),
        input = {
          action: "dismiss",
          reason: "Không phát hiện vi phạm.",
          reportVersion: 1,
        };
      const results = await Promise.all(
        Array.from({ length: 2 }, () =>
          call(
            "POST",
            `/admin/reports/${submitted.body.id}/decision`,
            input,
            admin.token,
            { "If-Match": detail.body.etag },
          ),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 412]);
      assert.equal(
        (await call("GET", `/templates/${id}`, null, alice.token)).etag,
        detail.body.etag,
      );
    },
  );
  if (pool)
    await t.test(
      "a failed audit insert rolls back template, report and revision together",
      async () => {
        const submitted = await call(
            "POST",
            `/templates/${id}/reports`,
            reportInput,
            alice.token,
          ),
          detail = await call(
            "GET",
            `/admin/reports/${submitted.body.id}`,
            null,
            admin.token,
          );
        await pool.query(
          "CREATE FUNCTION test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only'; END $$; CREATE TRIGGER test_reject_audit BEFORE INSERT ON moderation_audit FOR EACH ROW EXECUTE FUNCTION test_reject_audit()",
        );
        try {
          const r = await call(
            "POST",
            `/admin/reports/${submitted.body.id}/decision`,
            { action: "hide", reason: "Should roll back", reportVersion: 1 },
            admin.token,
            { "If-Match": detail.body.etag },
          );
          assert.equal(r.status, 500);
        } finally {
          await pool.query(
            "DROP TRIGGER test_reject_audit ON moderation_audit; DROP FUNCTION test_reject_audit()",
          );
        }
        const after = await call(
          "GET",
          `/admin/reports/${submitted.body.id}`,
          null,
          admin.token,
        );
        assert.equal(after.body.etag, detail.body.etag);
        assert.equal(after.body.resource.isPublic, true);
        assert.equal(after.body.report.version, 1);
        assert.equal(after.body.audit.length, 0);
      },
    );
  await t.test(
    "report budget is shared per member and does not throttle reads or leak arbitrary fields",
    async () => {
      const user = await account();
      let last;
      for (let i = 0; i < 11; i++)
        last = await call(
          "POST",
          `/templates/${id}/reports`,
          reportInput,
          user.token,
        );
      assert.equal(last.status, 429);
      assert.equal(last.body.code, "RATE_LIMITED");
      assert.equal(
        (await call("GET", "/account/reports?state=all", null, user.token))
          .status,
        200,
      );
    },
  );
}
test("moderation: memory permissions, concurrent decisions and author workflow", (t) =>
  contract(t, "memory"));
test(
  "moderation: PostgreSQL atomic policy, reports and audit",
  { skip: process.env.RUN_MODERATION_TESTS !== "1" },
  (t) => contract(t, "postgres"),
);
