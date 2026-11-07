const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto"),
  { Pool } = require("pg");
const { createApplication } = require("../dist/src/app"),
  { readConfig } = require("../dist/src/config"),
  { serviceControlSettings } = require("../dist/src/service-controls/settings"),
  {
    MemoryRateStore,
    RATE_STORE,
  } = require("../dist/src/service-controls/rate-store"),
  {
    migrateProject,
    seedProject,
  } = require("../dist/src/infrastructure/database/project-migrations");
const { example } = require("./publication-fixture.cjs");
const defaults = {
  NODE_ENV: "test",
  JWT_SECRET: "service-control-test-only-at-least-32-characters",
  QUEUE_ENABLED: "false",
  CACHE_ENABLED: "false",
  ACCOUNT_EMAIL_MODE: "disabled",
  AUTH_LOGIN_PER_IP: "200",
  AUTH_LOGIN_PER_IDENTITY: "100",
  API_WRITES_PER_USER: "1000",
  TEMPLATE_QUOTA_COUNT: "2",
  TEMPLATE_QUOTA_CONTENT_BYTES: "8192",
};
async function fixture(t, mode, overrides = {}) {
  const settings = readConfig({
    ...process.env,
    ...defaults,
    TEMPLATE_STORE: mode,
    ...overrides,
  });
  let pool;
  if (mode === "postgres") {
    assert.match(settings.database.database, /^project_test_controls/);
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
    const response = await fetch(origin + path, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
      headers: response.headers,
    };
  }
  async function account() {
    const credentials = {
      email: randomUUID() + "@example.test",
      password: "ControlsTestOnly!2026",
    };
    assert.equal(
      (await call("POST", "/auth/register", credentials)).status,
      201,
    );
    const result = await call("POST", "/auth/login", credentials);
    assert.equal(result.status, 200);
    return {
      ...credentials,
      token: result.body.accessToken,
      user: result.body.user,
    };
  }
  return { call, account, pool, app, settings, origin };
}
test("service control configuration is explicit and bounded", () => {
  const c = serviceControlSettings({});
  assert.equal(c.rateLimitsEnabled, true);
  assert.equal(c.trustProxyHops, 0);
  for (const env of [
    { AUTH_LOGIN_PER_IP: "0" },
    { AUTH_LOGIN_PER_IDENTITY: "NaN" },
    { TEMPLATE_QUOTA_COUNT: "-1" },
    { TEMPLATE_QUOTA_CONTENT_BYTES: "1e20" },
    { TRUST_PROXY_HOPS: "true" },
    { API_RATE_LIMITS_ENABLED: "maybe" },
  ])
    assert.throws(() => serviceControlSettings(env));
  assert.equal(
    serviceControlSettings({ API_RATE_LIMITS_ENABLED: "false" })
      .rateLimitsEnabled,
    false,
  );
});
test("memory rate windows admit a bounded concurrent burst and expire without sleeping", async () => {
  const store = new MemoryRateStore(),
    b = [{ key: "a".repeat(64), limit: 7, windowSeconds: 60 }],
    now = new Date();
  const results = await Promise.all(
    Array.from({ length: 25 }, () => store.consume(b, now)),
  );
  assert.equal(results.filter((n) => n === 0).length, 7);
  assert.equal(results.filter((n) => n === 60).length, 18);
  assert.equal(await store.consume(b, new Date(now.getTime() + 60001)), 0);
});
async function contract(t, mode) {
  const f = await fixture(t, mode, { AUTH_LOGIN_PER_IDENTITY: "3" }),
    { call, account, pool } = f,
    alice = await account(),
    bob = await account();
  const content = {
    format: "erusentia-template-html",
    schemaVersion: 1,
    html: "<h2>Kiến thức Web</h2><p>Mẫu của tôi.</p>",
  };
  const input = () => ({
    ...example,
    slug: "quota-" + randomUUID(),
    isPublic: false,
    contentJson: content,
  });
  const create = () => call("POST", "/templates", input(), alice.token);
  const usage = async (token = alice.token) => {
    const r = await call("GET", "/account/usage", null, token);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    return r.body;
  };
  assert.equal((await call("GET", "/account/usage")).status, 401);
  await t.test(
    "atomic concurrent creates cannot overbook a single author and do not leak another account usage",
    async () => {
      const replies = await Promise.all(Array.from({ length: 8 }, create));
      assert.equal(replies.filter((r) => r.status === 201).length, 2);
      assert.equal(
        replies.filter(
          (r) => r.status === 409 && r.body.code === "TEMPLATE_QUOTA_EXCEEDED",
        ).length,
        6,
      );
      const a = await usage(),
        b = await usage(bob.token);
      assert.equal(a.used.templates, 2);
      assert(a.used.contentBytes > 0);
      assert.equal(a.remaining.templates, 0);
      assert.equal(b.used.templates, 0);
      assert.equal(b.used.contentBytes, 0);
      for (const reply of replies.filter((r) => r.status === 409))
        assert(!JSON.stringify(reply.body).includes(alice.email));
    },
  );
  const list = await call(
      "GET",
      "/templates?authorId=" + alice.user.id,
      null,
      alice.token,
    ),
    row = list.body.data[0];
  const etag = () => `"template:${row.id}:${row.revision}"`;
  await t.test(
    "quota failures leave current content, revision and history unchanged; shrinking/metadata remain allowed",
    async () => {
      const before = await call(
        "GET",
        "/templates/" + row.id + "/revisions",
        null,
        alice.token,
      );
      const denied = await call(
        "PATCH",
        "/templates/" + row.id,
        {
          contentJson: { ...content, html: "<p>" + "x".repeat(9000) + "</p>" },
        },
        alice.token,
        { "If-Match": etag() },
      );
      assert.equal(denied.status, 409);
      assert.equal(denied.body.code, "TEMPLATE_QUOTA_EXCEEDED");
      const after = await call(
        "GET",
        "/templates/" + row.id,
        null,
        alice.token,
      );
      assert.equal(after.body.revision, row.revision);
      assert.deepEqual(after.body.contentJson, content);
      assert.equal(
        (
          await call(
            "GET",
            "/templates/" + row.id + "/revisions",
            null,
            alice.token,
          )
        ).body.totalElements,
        before.body.totalElements,
      );
      const ok = await call(
        "PATCH",
        "/templates/" + row.id,
        { description: "Cập nhật rõ ràng" },
        alice.token,
        { "If-Match": etag() },
      );
      assert.equal(ok.status, 200);
      row.revision = ok.body.revision;
    },
  );
  await t.test(
    "soft delete releases active allowance; restore rechecks quota and remains atomic",
    async () => {
      assert.equal(
        (
          await call("DELETE", "/templates/" + row.id, null, alice.token, {
            "If-Match": etag(),
          })
        ).status,
        204,
      );
      row.revision++;
      assert.equal((await usage()).used.templates, 1);
      assert.equal((await create()).status, 201);
      const denied = await call(
        "POST",
        `/templates/${row.id}/restore`,
        { revision: 1 },
        alice.token,
        { "If-Match": etag() },
      );
      assert.equal(denied.status, 409);
      assert.equal(denied.body.code, "TEMPLATE_QUOTA_EXCEEDED");
      assert.equal(
        (await call("GET", "/templates/" + row.id, null, alice.token)).status,
        404,
      );
      const active = (
        await call(
          "GET",
          "/templates?authorId=" + alice.user.id,
          null,
          alice.token,
        )
      ).body.data[0];
      assert.equal(
        (
          await call("DELETE", "/templates/" + active.id, null, alice.token, {
            "If-Match": `"template:${active.id}:${active.revision}"`,
          })
        ).status,
        204,
      );
      assert.equal(
        (
          await call(
            "POST",
            `/templates/${row.id}/restore`,
            { revision: 1 },
            alice.token,
            { "If-Match": etag() },
          )
        ).status,
        200,
      );
      assert.equal((await usage()).used.templates, 2);
    },
  );
  await t.test(
    "concurrent growth on different templates shares one author budget",
    async () => {
      const inputs = [0, 1].map(() => ({
        ...example,
        slug: "growth-" + randomUUID(),
        isPublic: false,
        contentJson: content,
      }));
      const rows = await Promise.all(
        inputs.map(async (body) => {
          const r = await call("POST", "/templates", body, bob.token);
          assert.equal(r.status, 201);
          return r.body;
        }),
      );
      const changed = await Promise.all(
        rows.map((r) =>
          call(
            "PATCH",
            "/templates/" + r.id,
            {
              contentJson: {
                ...content,
                html: "<p>" + "x".repeat(5000) + "</p>",
              },
            },
            bob.token,
            { "If-Match": `"template:${r.id}:${r.revision}"` },
          ),
        ),
      );
      assert.deepEqual(changed.map((r) => r.status).sort(), [200, 409]);
      assert((await usage(bob.token)).used.contentBytes <= 8192);
    },
  );
  if (pool) {
    await t.test(
      "PostgreSQL rate limits survive restart and serialize requests across two API instances",
      async () => {
        const peer = await createApplication(f.settings, false);
        await peer.listen(0, "127.0.0.1");
        try {
          const origins = [f.origin, await peer.getUrl()];
          const carol = await account();
          const creations = await Promise.all(
            Array.from(
              { length: 8 },
              async (_, i) =>
                (
                  await fetch(origins[i % 2] + "/templates", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: "Bearer " + carol.token,
                    },
                    body: JSON.stringify(input()),
                  })
                ).status,
            ),
          );
          assert.equal(creations.filter((s) => s === 201).length, 2);
          assert.equal(creations.filter((s) => s === 409).length, 6);
          const replies = await Promise.all(
            Array.from(
              { length: 16 },
              async (_, i) =>
                (
                  await fetch(origins[i % 2] + "/auth/login", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      email: alice.email,
                      password: alice.password,
                    }),
                  })
                ).status,
            ),
          );
          assert.equal(replies.filter((s) => s === 200).length, 2);
          assert.equal(replies.filter((s) => s === 429).length, 14);
        } finally {
          await peer.close();
        }
        const restarted = await createApplication(f.settings, false);
        await restarted.listen(0, "127.0.0.1");
        try {
          const response = await fetch(
            (await restarted.getUrl()) + "/auth/login",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: alice.email,
                password: alice.password,
              }),
            },
          );
          assert.equal(response.status, 429);
        } finally {
          await restarted.close();
        }
      },
    );
    await t.test(
      "unavailable rate storage rejects authentication without creating an account or exposing database errors",
      async () => {
        const email = randomUUID() + "@example.test";
        await pool.query(
          "ALTER TABLE service_rate_limits RENAME TO service_rate_limits_fixture_hold",
        );
        try {
          const response = await call("POST", "/auth/register", {
            email,
            password: "ControlsTestOnly!2026",
          });
          assert.equal(response.status, 503);
          assert(
            !JSON.stringify(response.body).includes("service_rate_limits"),
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int n FROM users WHERE email=$1",
                [email],
              )
            ).rows[0].n,
            0,
          );
        } finally {
          await pool.query(
            "ALTER TABLE service_rate_limits_fixture_hold RENAME TO service_rate_limits",
          );
        }
      },
    );
  }
  if (pool)
    await t.test(
      "derived bytes include trusted SQL inserts, and quota reads avoid loading HTML",
      async () => {
        const r = await pool.query(
          "SELECT content_bytes,octet_length(content_json::text) expected FROM templates WHERE id=$1",
          [row.id],
        );
        assert.equal(Number(r.rows[0].content_bytes), r.rows[0].expected);
        const keys = (
          await pool.query("SELECT key_hash FROM service_rate_limits")
        ).rows;
        assert(keys.length > 0);
        assert(keys.every((r) => /^[a-f0-9]{64}$/.test(r.key_hash)));
      },
    );
}
test("template quota and privacy contract: memory", (t) =>
  contract(t, "memory"));
test(
  "template quota and privacy contract: PostgreSQL",
  { skip: process.env.RUN_SERVICE_CONTROL_TESTS !== "1" },
  (t) => contract(t, "postgres"),
);
test("login throttling counts failed and successful attempts, ignores spoofed forwarding and preserves HTTP feedback", async (t) => {
  const { call, account } = await fixture(t, "memory", {
      AUTH_LOGIN_PER_IDENTITY: "3",
      AUTH_LOGIN_PER_IP: "20",
    }),
    alice = await account();
  const creds = { email: alice.email, password: "wrong-password" };
  for (let n = 0; n < 2; n++)
    assert.equal(
      (
        await call("POST", "/auth/login", creds, null, {
          "X-Forwarded-For": "192.0.2." + n,
        })
      ).status,
      401,
    );
  const denied = await call(
    "POST",
    "/auth/login",
    { email: alice.email, password: alice.password },
    null,
    { "X-Forwarded-For": "198.51.100.2" },
  );
  assert.equal(denied.status, 429);
  assert.equal(denied.body.code, "RATE_LIMITED");
  assert(Number(denied.headers.get("retry-after")) > 0);
  assert(Number(denied.headers.get("retry-after")) <= 900);
  assert.equal((await call("GET", "/health")).status, 200);
  assert.equal((await call("GET", "/auth/me", null, alice.token)).status, 200);
  assert.equal(
    (
      await call("POST", "/auth/login", {
        email: "unknown@example.test",
        password: "wrong-password",
      })
    ).status,
    401,
  );
});
test("write throttling is scoped to the signed-in account and does not block reads or leak quota state", async (t) => {
  const { call, account } = await fixture(t, "memory", {
      API_WRITES_PER_USER: "1",
    }),
    alice = await account(),
    bob = await account(),
    body = { ...example, slug: "write-" + randomUUID(), isPublic: false };
  assert.equal(
    (await call("POST", "/templates", body, alice.token)).status,
    201,
  );
  const second = await call(
    "POST",
    "/templates",
    { ...body, slug: "write-" + randomUUID() },
    alice.token,
  );
  assert.equal(second.status, 429);
  assert(Number(second.headers.get("retry-after")) <= 60);
  assert.equal(
    (await call("GET", "/account/usage", null, alice.token)).body.used
      .templates,
    1,
  );
  assert.equal(
    (
      await call(
        "POST",
        "/templates",
        { ...body, slug: "write-" + randomUUID() },
        bob.token,
      )
    ).status,
    201,
  );
});
