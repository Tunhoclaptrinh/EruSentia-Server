const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const { createApplication } = require("../dist/src/app");
const { readConfig } = require("../dist/src/config");
const { AUTH_STORE } = require("../dist/src/auth/auth-store");
const {
  migrateProject,
} = require("../dist/src/infrastructure/database/project-migrations");

async function sessionContract(t, persistence) {
  const settings = readConfig({
    ...process.env,
    NODE_ENV: "test",
    TEMPLATE_STORE: persistence,
    QUEUE_ENABLED: "false",
    CACHE_ENABLED: "false",
    JWT_SECRET: "session-contract-test-only-key-at-least-32-characters",
  });
  if (persistence === "postgres") {
    assert.match(
      settings.database.database,
      /^project_test_sessions[a-z0-9_]*$/,
    );
    const pool = new Pool({
      ...settings.database,
      user: settings.database.username,
    });
    try {
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'",
          )
        ).rows[0].n,
        0,
      );
      await migrateProject(pool);
    } finally {
      await pool.end();
    }
  }
  const app = await createApplication(settings, false);
  t.after(() => app.close());
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const credentials = {
    email: randomUUID() + "@example.test",
    password: "SessionTestOnly!2026",
  };
  async function call(method, route, token, body, status) {
    const response = await fetch(base + route, {
      method,
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, status, method + " " + route);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  const login = (input = credentials) =>
    call("POST", "/auth/login", null, input, 200);
  await call("POST", "/auth/register", null, credentials, 201);
  const alice = await login(),
    otherLogin = await login();
  const bobCredentials = {
    ...credentials,
    email: randomUUID() + "@example.test",
  };
  await call("POST", "/auth/register", null, bobCredentials, 201);
  const bob = await login(bobCredentials);
  const list = (pair = alice, query = "") =>
    call("GET", "/auth/sessions" + query, pair.accessToken, null, 200);
  await t.test(
    "only own active login families are listed with bounded pagination and safe fields",
    async () => {
      const rows = await list();
      assert.equal(rows.totalElements, 2);
      assert.equal(rows.data.filter((row) => row.current).length, 1);
      for (const row of rows.data) {
        assert.deepEqual(
          Object.keys(row).sort(),
          ["id", "createdAt", "lastRefreshedAt", "expiresAt", "current"].sort(),
        );
        assert(Date.parse(row.expiresAt) > Date.parse(row.createdAt));
      }
      const first = await list(alice, "?page=1&size=1"),
        second = await list(alice, "?page=2&size=1");
      assert.equal(first.totalPages, 2);
      assert.notEqual(first.data[0].id, second.data[0].id);
      for (const query of [
        "?size=101",
        "?page=0",
        "?authorId=" + bob.user.id,
        "?size=1.5",
      ])
        await call(
          "GET",
          "/auth/sessions" + query,
          alice.accessToken,
          null,
          400,
        );
      await call("GET", "/auth/sessions", null, null, 401);
    },
  );
  await t.test(
    "rotation stays one login, retains its original start and does not expose token material",
    async () => {
      const before = await list();
      const item = before.data.find((row) => row.current);
      const rotated = await call(
        "POST",
        "/auth/refresh",
        null,
        { refreshToken: alice.refreshToken },
        200,
      );
      Object.assign(alice, rotated);
      const after = await list();
      assert.equal(after.totalElements, 2);
      const current = after.data.find((row) => row.current);
      assert.equal(current.id, item.id);
      assert.equal(current.createdAt, item.createdAt);
      assert.equal(current.expiresAt, item.expiresAt);
      assert(
        Date.parse(current.lastRefreshedAt) >= Date.parse(item.lastRefreshedAt),
      );
    },
  );
  await t.test(
    "revoke by ID is idempotent, scoped to the caller, and invalidates access/refresh after rotation",
    async () => {
      const target = (await list(otherLogin)).data.find(
        (row) => row.current,
      ).id;
      const foreign = (await list(bob)).data[0].id;
      await call(
        "DELETE",
        "/auth/sessions/" + foreign,
        alice.accessToken,
        null,
        204,
      );
      await call("GET", "/auth/me", bob.accessToken, null, 200);
      await call(
        "DELETE",
        "/auth/sessions/" + randomUUID(),
        alice.accessToken,
        null,
        204,
      );
      await call("DELETE", "/auth/sessions/nope", alice.accessToken, null, 400);
      const rotated = await call(
        "POST",
        "/auth/refresh",
        null,
        { refreshToken: otherLogin.refreshToken },
        200,
      );
      await call(
        "DELETE",
        "/auth/sessions/" + target,
        alice.accessToken,
        null,
        204,
      );
      await call(
        "DELETE",
        "/auth/sessions/" + target,
        alice.accessToken,
        null,
        204,
      );
      await call("GET", "/auth/me", rotated.accessToken, null, 401);
      await call(
        "POST",
        "/auth/refresh",
        null,
        { refreshToken: rotated.refreshToken },
        401,
      );
      assert.equal((await list()).totalElements, 1);
    },
  );
  await t.test(
    "revoke others preserves this session and other accounts, and expired families stay hidden",
    async () => {
      const others = await Promise.all([login(), login()]);
      const now = Date.now();
      await app.get(AUTH_STORE).addSession({
        id: randomUUID(),
        familyId: randomUUID(),
        userId: alice.user.id,
        tokenHash: "c".repeat(64),
        createdAt: new Date(now - 30000),
        expiresAt: new Date(now - 10000),
        usedAt: null,
        revokedAt: null,
      });
      assert.equal((await list()).totalElements, 3);
      await call(
        "POST",
        "/auth/sessions/revoke-others",
        alice.accessToken,
        null,
        204,
      );
      await call(
        "POST",
        "/auth/sessions/revoke-others",
        alice.accessToken,
        null,
        204,
      );
      assert.equal((await list()).totalElements, 1);
      await call("GET", "/auth/me", bob.accessToken, null, 200);
      for (const pair of others) {
        await call("GET", "/auth/me", pair.accessToken, null, 401);
        await call(
          "POST",
          "/auth/refresh",
          null,
          { refreshToken: pair.refreshToken },
          401,
        );
      }
    },
  );
  await t.test(
    "concurrent rotation and revocation cannot leave a usable child session",
    async () => {
      for (let n = 0; n < 4; n++) {
        const victim = await login();
        const id = (await list(victim)).data.find((row) => row.current).id;
        const [rotation] = await Promise.all([
          fetch(base + "/auth/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken: victim.refreshToken }),
          }),
          call("DELETE", "/auth/sessions/" + id, alice.accessToken, null, 204),
        ]);
        assert([200, 401].includes(rotation.status));
        if (rotation.status === 200) {
          const child = await rotation.json();
          await call("GET", "/auth/me", child.accessToken, null, 401);
          await call(
            "POST",
            "/auth/refresh",
            null,
            { refreshToken: child.refreshToken },
            401,
          );
        }
        assert.equal((await list()).totalElements, 1);
      }
    },
  );
  await t.test(
    "revoke others and concurrent rotations preserve no hidden child login",
    async () => {
      const victims = await Promise.all([login(), login(), login()]);
      const results = await Promise.all([
        ...victims.map((pair) =>
          fetch(base + "/auth/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken: pair.refreshToken }),
          }),
        ),
        call(
          "POST",
          "/auth/sessions/revoke-others",
          alice.accessToken,
          null,
          204,
        ),
      ]);
      for (const response of results.slice(0, 3)) {
        assert([200, 401].includes(response.status));
        if (response.status === 200) {
          const child = await response.json();
          await call("GET", "/auth/me", child.accessToken, null, 401);
          await call(
            "POST",
            "/auth/refresh",
            null,
            { refreshToken: child.refreshToken },
            401,
          );
        }
      }
      assert.equal((await list()).totalElements, 1);
    },
  );
  await t.test(
    "revoking the current login ends it without touching another account",
    async () => {
      const current = (await list()).data.find((row) => row.current).id;
      await call(
        "DELETE",
        "/auth/sessions/" + current,
        alice.accessToken,
        null,
        204,
      );
      await call("GET", "/auth/sessions", alice.accessToken, null, 401);
      await call("GET", "/auth/me", bob.accessToken, null, 200);
    },
  );
}

test("account session ownership, pagination, rotation and revocation (memory)", (t) =>
  sessionContract(t, "memory"));
test(
  "account sessions serialize revocation against rotation (PostgreSQL TLS)",
  { skip: process.env.RUN_LOGIN_SESSION_TESTS !== "1" },
  (t) => sessionContract(t, "postgres"),
);
