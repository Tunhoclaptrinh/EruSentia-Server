const test = require("node:test");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { readConfig } = require("../dist/src/config");
const { createApplication } = require("../dist/src/app");
const { TEMPLATE_STORE } = require("../dist/src/templates/template-store");
const { example } = require("./publication-fixture.cjs");

// Every feature module must share the application's one template store: a second TemplatesModule
// registration silently splits state (memory mode) and caches (both modes).
test("feature modules share one template store", async (t) => {
  const settings = readConfig({
    NODE_ENV: "test",
    TEMPLATE_STORE: "memory",
    JWT_SECRET: randomBytes(48).toString("base64url"),
    QUEUE_ENABLED: "false",
    CACHE_ENABLED: "false",
    SWAGGER_ENABLED: "false",
  });
  const app = await createApplication(settings, false);
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const base = await app.getUrl();
  async function login(email) {
    const body = JSON.stringify({ email, password: "Password!2026" });
    const headers = { "content-type": "application/json" };
    assert.equal((await fetch(`${base}/auth/register`, { method: "POST", headers, body })).status, 201);
    const response = await fetch(`${base}/auth/login`, { method: "POST", headers, body });
    const { accessToken } = await response.json();
    return { ...headers, authorization: `Bearer ${accessToken}` };
  }
  const author = await login("wiring-author@example.test");
  const reader = await login("wiring-reader@example.test");
  const created = await fetch(`${base}/templates`, {
    method: "POST",
    headers: author,
    body: JSON.stringify({ ...example, slug: "module-wiring", isPublic: true }),
  });
  assert.equal(created.status, 201);
  const { id } = await created.json();

  assert.equal((await app.get(TEMPLATE_STORE).find(id))?.id, id, "the resolvable store is the one the API writes to");
  const follow = await fetch(`${base}/templates/${id}/follow`, { method: "POST", headers: reader });
  assert.equal(follow.status, 200, "follows read the same store as the templates API");
});
