const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { readConfig } = require("../dist/src/config");
const { createApplication } = require("../dist/src/app");
test("CORS configuration has exact development origins and a closed production default", () => {
  assert.deepEqual(readConfig({}).corsOrigins, [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);
  assert.deepEqual(
    readConfig({
      NODE_ENV: "production",
      JWT_SECRET: "test-only-secret-at-least-32-bytes",
    }).corsOrigins,
    [],
  );
  assert.deepEqual(readConfig({ CORS_ORIGINS: "" }).corsOrigins, []);
  assert.deepEqual(
    readConfig({ CORS_ORIGINS: "https://app.example/,https://app.example" })
      .corsOrigins,
    ["https://app.example"],
  );
  for (const value of [
    "*",
    "https://*.example",
    "null",
    "file://app",
    "https://app.example/path",
    "https://user:pass@app.example",
    "https://app.example?key=x",
  ])
    assert.throws(() => readConfig({ CORS_ORIGINS: value }), /CORS_ORIGINS/);
});
test("web preflight and category discovery support authenticated template creation", async (t) => {
  const app = await createApplication(
    readConfig({ TEMPLATE_STORE: "memory" }),
    false,
  );
  t.after(() => app.close());
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const preflight = await fetch(base + "/templates", {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:5173",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get("access-control-allow-origin"),
    "http://localhost:5173",
  );
  assert.equal(preflight.headers.get("access-control-allow-credentials"), null);
  for (const origin of [
    "https://untrusted.example",
    "null",
    "http://localhost:5174",
  ]) {
    const r = await fetch(base + "/auth/me", { headers: { Origin: origin } });
    assert.equal(r.headers.get("access-control-allow-origin"), null);
  }
  const anonymous = await fetch(base + "/categories");
  assert.equal(anonymous.status, 401);
  const input = {
    email: randomUUID() + "@example.test",
    password: "LearningPass!2026",
  };
  await fetch(base + "/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const login = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const { accessToken } = await login.json();
  const headers = {
    Authorization: "Bearer " + accessToken,
    Origin: "http://localhost:5173",
  };
  const response = await fetch(base + "/categories", { headers });
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "http://localhost:5173",
  );
  assert.match(
    response.headers.get("access-control-expose-headers"),
    /X-Cache/,
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  const rows = await response.json();
  assert.equal(rows.length, 2);
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    "description",
    "displayOrder",
    "icon",
    "id",
    "name",
    "slug",
  ]);
  const created = await fetch(base + "/templates", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      categoryId: rows[0].id,
      title: "Discovered category",
      slug: "discovered-" + randomUUID(),
      description: "Independent integration payload",
      isPublic: false,
      contentJson: {
        format: "erusentia-template-html",
        schemaVersion: 1,
        html: "<div>Integration readiness</div>",
      },
    }),
  });
  assert.equal(created.status, 201);
});
