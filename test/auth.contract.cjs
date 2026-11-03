const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { JwtService } = require("@nestjs/jwt");
const { DataSource } = require("typeorm");
const { createApplication } = require("../dist/src/app");
const { readConfig } = require("../dist/src/config");
const { AUTH_STORE } = require("../dist/src/auth/auth-store");
const { Passwords } = require("../dist/src/auth/passwords");
const example = require("../tools/examples/create-template.json");

async function authContract(t, mode) {
  const secret = "week3-test-only-signing-key-never-use-in-production";
  const app = await createApplication(
    readConfig({ ...process.env, TEMPLATE_STORE: mode, JWT_SECRET: secret }),
    false,
  );
  t.after(() => app.close());
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const store = app.get(AUTH_STORE);
  const password = "LearningPass!2026";
  const suffix = randomUUID();
  const aliceEmail = `alice-${suffix}@example.test`;
  const bobEmail = `bob-${suffix}@example.test`;
  const createdIds = [];
  let alice, alicePair, bobPair, adminPair;
  async function request(method, route, expected, body, token) {
    const response = await fetch(base + route, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    assert.equal(response.status, expected, `${method} ${route}: ${text}`);
    if (expected === 204) {
      assert.equal(text, "");
      return;
    }
    const json = JSON.parse(text);
    assert(!/"(?:password_hash|passwordHash)"\s*:/.test(text));
    if (expected >= 400) {
      assert.equal(json.statusCode, expected);
      assert(Array.isArray(json.details));
      if (expected === 401)
        assert.equal(response.headers.get("www-authenticate"), "Bearer");
    }
    if (route === "/auth/login" || route === "/auth/refresh")
      assert.equal(response.headers.get("cache-control"), "no-store");
    return json;
  }
  const login = (email = aliceEmail) =>
    request("POST", "/auth/login", 200, { email, password });
  const refresh = (token, status = 200) =>
    request("POST", "/auth/refresh", status, { refreshToken: token });
  const template = (name, isPublic) => ({
    ...example,
    title: `Week 3 ${name}`,
    slug: `week3-${suffix}-${name}`,
    tags: [`auth-${suffix}`],
    isPublic,
  });
  async function mutateUser(id, changes) {
    if (mode === "postgres") {
      const {
        AuthorEntity,
      } = require("../dist/src/templates/persistence/entities");
      await app.get(DataSource).getRepository(AuthorEntity).update(id, changes);
    } else Object.assign(store.users.get(id), changes);
  }
  try {
    await t.test(
      "registration normalizes email, validates input, hashes passwords and rejects privilege escalation",
      async () => {
        for (const extra of [
          { role: "admin" },
          { role: "creator" },
          { isActive: false },
          { passwordHash: "forged" },
        ])
          await request("POST", "/auth/register", 400, {
            email: aliceEmail,
            password,
            ...extra,
          });
        await request("POST", "/auth/register", 400, {
          email: aliceEmail,
          password: "short",
        });
        await request("POST", "/auth/register", 400, {
          email: "invalid",
          password,
        });
        alice = await request("POST", "/auth/register", 201, {
          email: `  ${aliceEmail.toUpperCase()}  `,
          password,
        });
        assert.equal(alice.email, aliceEmail);
        assert.equal(alice.role, "user");
        await request("POST", "/auth/register", 409, {
          email: aliceEmail.toUpperCase(),
          password,
        });
        const stored = await store.findByEmail(aliceEmail);
        assert.match(
          stored.passwordHash,
          /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/,
        );
        assert.notEqual(stored.passwordHash, password);
        assert.equal(
          await app.get(Passwords).verify(password, stored.passwordHash),
          true,
        );
        await request("POST", "/auth/register", 201, {
          email: bobEmail,
          password,
        });
        const races = await Promise.all(
          [1, 2].map(() =>
            fetch(base + "/auth/register", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: `race-${suffix}@example.test`,
                password,
              }),
            }),
          ),
        );
        assert.deepEqual(races.map((r) => r.status).sort(), [201, 409]);
      },
    );
    await t.test(
      "login has generic failures and issues bounded access/refresh tokens without caching",
      async () => {
        const bad = await request("POST", "/auth/login", 401, {
          email: aliceEmail,
          password: "wrong-password",
        });
        const missing = await request("POST", "/auth/login", 401, {
          email: `missing-${suffix}@example.test`,
          password,
        });
        assert.equal(bad.message, missing.message);
        alicePair = await login();
        bobPair = await login(bobEmail);
        assert.equal(alicePair.expiresIn, 900);
        assert.equal(alicePair.tokenType, "Bearer");
        assert.match(alicePair.refreshToken, /^[A-Za-z0-9_-]{43}$/);
        const claims = new JwtService().decode(alicePair.accessToken);
        assert.equal(claims.sub, alice.id);
        assert.equal(claims.exp - claims.iat, 900);
        assert.equal(claims.iss, "erusentia-server");
        assert.equal(claims.aud, "erusentia-api");
        assert.equal(claims.email, undefined);
        assert(
          Date.parse(alicePair.refreshExpiresAt) > Date.now() + 6 * 86400000,
        );
      },
    );
    await t.test(
      "protected API rejects absent, tampered, expired and incorrectly scoped JWTs",
      async () => {
        await request("GET", "/templates", 401);
        await request(
          "GET",
          "/auth/me",
          401,
          undefined,
          alicePair.refreshToken,
        );
        await request(
          "GET",
          "/auth/me",
          401,
          undefined,
          alicePair.accessToken + "x",
        );
        const claims = new JwtService().decode(alicePair.accessToken);
        const payload = {
          sub: claims.sub,
          sid: claims.sid,
          tokenUse: "access",
        };
        for (const options of [
          {
            secret: "incorrect-test-secret",
            issuer: "erusentia-server",
            audience: "erusentia-api",
            expiresIn: 60,
          },
          {
            secret,
            issuer: "wrong-issuer",
            audience: "erusentia-api",
            expiresIn: 60,
          },
          {
            secret,
            issuer: "erusentia-server",
            audience: "wrong-audience",
            expiresIn: 60,
          },
          {
            secret,
            algorithm: "HS384",
            issuer: "erusentia-server",
            audience: "erusentia-api",
            expiresIn: 60,
          },
          {
            secret,
            issuer: "erusentia-server",
            audience: "erusentia-api",
            expiresIn: -1,
          },
          { secret, issuer: "erusentia-server", audience: "erusentia-api" },
        ])
          await request(
            "GET",
            "/auth/me",
            401,
            undefined,
            new JwtService().sign(payload, options),
          );
        const me = await request(
          "GET",
          "/auth/me",
          200,
          undefined,
          alicePair.accessToken,
        );
        assert.equal(me.id, alice.id);
      },
    );
    await t.test(
      "Template author comes from JWT and private data/counts respect ownership",
      async () => {
        await request(
          "POST",
          "/templates",
          400,
          { ...template("forged", false), authorId: bobPair.user.id },
          alicePair.accessToken,
        );
        const privateRow = await request(
          "POST",
          "/templates",
          201,
          template("private", false),
          alicePair.accessToken,
        );
        const publicRow = await request(
          "POST",
          "/templates",
          201,
          template("public", true),
          alicePair.accessToken,
        );
        createdIds.push(privateRow.id, publicRow.id);
        assert.equal(privateRow.authorId, alice.id);
        await request(
          "GET",
          `/templates/${privateRow.id}`,
          404,
          undefined,
          bobPair.accessToken,
        );
        await request(
          "PATCH",
          `/templates/${privateRow.id}`,
          404,
          { title: "Forbidden" },
          bobPair.accessToken,
        );
        await request(
          "DELETE",
          `/templates/${privateRow.id}`,
          404,
          undefined,
          bobPair.accessToken,
        );
        await request(
          "GET",
          `/templates/${publicRow.id}`,
          200,
          undefined,
          bobPair.accessToken,
        );
        await request(
          "PATCH",
          `/templates/${publicRow.id}`,
          403,
          { title: "Forbidden" },
          bobPair.accessToken,
        );
        await request(
          "DELETE",
          `/templates/${publicRow.id}`,
          403,
          undefined,
          bobPair.accessToken,
        );
        const bobList = await request(
          "GET",
          `/templates?tag=auth-${suffix}&authorId=${alice.id}&isPublic=false`,
          200,
          undefined,
          bobPair.accessToken,
        );
        assert.equal(bobList.totalElements, 0);
        assert.deepEqual(bobList.data, []);
        const ownList = await request(
          "GET",
          `/templates?tag=auth-${suffix}`,
          200,
          undefined,
          alicePair.accessToken,
        );
        assert.equal(ownList.totalElements, 2);
      },
    );
    await t.test(
      "admin RBAC uses current database role and responses contain only safe account fields",
      async () => {
        await request(
          "GET",
          "/admin/users",
          403,
          undefined,
          alicePair.accessToken,
        );
        const email = `admin-${suffix}@example.test`;
        await store.createUser({
          email,
          passwordHash: await app.get(Passwords).hash(password),
          role: "admin",
        });
        adminPair = await login(email);
        const users = await request(
          "GET",
          "/admin/users?size=2",
          200,
          undefined,
          adminPair.accessToken,
        );
        assert.equal(users.data.length, 2);
        assert.deepEqual(Object.keys(users.data[0]).sort(), [
          "createdAt",
          "email",
          "id",
          "role",
        ]);
        await request(
          "GET",
          "/admin/users?size=101",
          400,
          undefined,
          adminPair.accessToken,
        );
        await request(
          "GET",
          `/templates/${createdIds[0]}`,
          200,
          undefined,
          adminPair.accessToken,
        );
        await request(
          "PATCH",
          `/templates/${createdIds[0]}`,
          200,
          { title: "Admin moderated planner" },
          adminPair.accessToken,
        );
        await mutateUser(adminPair.user.id, { role: "user" });
        await request(
          "GET",
          "/admin/users",
          403,
          undefined,
          adminPair.accessToken,
        );
        await mutateUser(adminPair.user.id, { role: "admin" });
        await mutateUser(alice.id, { role: "creator" });
        assert.equal(
          (
            await request(
              "GET",
              "/auth/me",
              200,
              undefined,
              alicePair.accessToken,
            )
          ).role,
          "creator",
        );
        await request(
          "GET",
          "/admin/users",
          403,
          undefined,
          alicePair.accessToken,
        );
      },
    );
    await t.test(
      "refresh rotates credentials once while preserving absolute family expiry",
      async () => {
        const first = await login();
        const next = await refresh(first.refreshToken);
        assert.notEqual(next.refreshToken, first.refreshToken);
        assert.notEqual(next.accessToken, first.accessToken);
        assert.equal(next.refreshExpiresAt, first.refreshExpiresAt);
        await request("GET", "/auth/me", 200, undefined, next.accessToken);
        await refresh(first.refreshToken, 401);
        await refresh(next.refreshToken, 401);
        await request("GET", "/auth/me", 401, undefined, next.accessToken);
      },
    );
    await t.test(
      "concurrent refresh and cross-generation replay cannot leave a usable child session",
      async () => {
        const first = await login();
        const simultaneous = await Promise.all(
          [1, 2].map(() =>
            fetch(base + "/auth/refresh", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ refreshToken: first.refreshToken }),
            }),
          ),
        );
        assert.deepEqual(simultaneous.map((r) => r.status).sort(), [200, 401]);
        const success = await simultaneous.find((r) => r.status === 200).json();
        await request("GET", "/auth/me", 401, undefined, success.accessToken);
        const parent = await login();
        const child = await refresh(parent.refreshToken);
        const raced = await Promise.all(
          [child.refreshToken, parent.refreshToken].map((refreshToken) =>
            fetch(base + "/auth/refresh", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ refreshToken }),
            }),
          ),
        );
        assert.equal(raced[1].status, 401);
        if (raced[0].status === 200) {
          const newest = await raced[0].json();
          await request("GET", "/auth/me", 401, undefined, newest.accessToken);
          await refresh(newest.refreshToken, 401);
        } else assert.equal(raced[0].status, 401);
        await request("GET", "/auth/me", 401, undefined, child.accessToken);
      },
    );
    await t.test(
      "logout is idempotent, revokes this session and leaves other logins active",
      async () => {
        const first = await login();
        const other = await login();
        await request("POST", "/auth/logout", 204, {
          refreshToken: first.refreshToken,
        });
        await request("POST", "/auth/logout", 204, {
          refreshToken: first.refreshToken,
        });
        await request("GET", "/auth/me", 401, undefined, first.accessToken);
        await refresh(first.refreshToken, 401);
        await request("GET", "/auth/me", 200, undefined, other.accessToken);
        await request("POST", "/auth/logout", 204, {
          refreshToken: "x".repeat(43),
        });
        const racing = await login();
        await Promise.all([
          fetch(base + "/auth/refresh", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ refreshToken: racing.refreshToken }),
          }),
          request("POST", "/auth/logout", 204, {
            refreshToken: racing.refreshToken,
          }),
        ]);
        await request("GET", "/auth/me", 401, undefined, racing.accessToken);
      },
    );
    await t.test(
      "expired refresh families and soft-deleted accounts stop authorizing requests",
      async () => {
        const pair = await login();
        const family = new JwtService().decode(pair.accessToken).sid;
        const expiresAt = new Date(Date.now() - 1000);
        const createdAt = new Date(Date.now() - 3600000);
        if (mode === "postgres") {
          await app
            .get(DataSource)
            .query(
              "UPDATE auth_refresh_sessions SET expires_at=$1,created_at=$2 WHERE family_id=$3",
              [expiresAt, createdAt, family],
            );
        } else {
          for (const session of store.sessions.values())
            if (session.familyId === family)
              Object.assign(session, { expiresAt, createdAt });
        }
        await request("GET", "/auth/me", 401, undefined, pair.accessToken);
        await refresh(pair.refreshToken, 401);
        const email = `deleted-${suffix}@example.test`;
        const user = await request("POST", "/auth/register", 201, {
          email,
          password,
        });
        const deletedPair = await login(email);
        await mutateUser(user.id, { deletedAt: new Date() });
        await request("POST", "/auth/login", 401, { email, password });
        await request(
          "GET",
          "/auth/me",
          401,
          undefined,
          deletedPair.accessToken,
        );
        await refresh(deletedPair.refreshToken, 401);
      },
    );
    await t.test(
      "inactive users and legacy seed hashes cannot authenticate or refresh",
      async () => {
        const email = `disabled-${suffix}@example.test`;
        const user = await request("POST", "/auth/register", 201, {
          email,
          password,
        });
        const pair = await login(email);
        await mutateUser(user.id, { isActive: false });
        await request("GET", "/auth/me", 401, undefined, pair.accessToken);
        await request("POST", "/auth/login", 401, { email, password });
        await refresh(pair.refreshToken, 401);
        const legacyEmail = `legacy-${suffix}@example.test`;
        await store.createUser({
          email: legacyEmail,
          passwordHash: "week-one-placeholder",
          role: "user",
        });
        await request("POST", "/auth/login", 401, {
          email: legacyEmail,
          password,
        });
        await request("POST", "/auth/refresh", 400, {
          refreshToken: "invalid",
        });
      },
    );
  } finally {
    if (adminPair)
      for (const id of createdIds)
        await fetch(`${base}/templates/${id}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${adminPair.accessToken}` },
        });
  }
  return { registeredId: alice?.id };
}
module.exports = { authContract };
