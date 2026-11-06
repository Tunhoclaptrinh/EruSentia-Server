const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createApplication } = require("../dist/src/app");
const { readConfig } = require("../dist/src/config");
const { example, sharing } = require("./publication-fixture.cjs");

test("public writes require explicit rights, retain private drafts and never echo credential-like input", async (t) => {
  const app = await createApplication(
    readConfig({ TEMPLATE_STORE: "memory" }),
    false,
  );
  t.after(() => app.close());
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const credentials = {
    email: "publishing@example.test",
    password: "PublicationTest!2026",
  };
  const request = async (path, body, token) => {
    const response = await fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  await request("/auth/register", credentials);
  const token = (await request("/auth/login", credentials)).body.accessToken;
  const input = {
    ...example,
    slug: "publication-" + randomUUID(),
    isPublic: true,
    contentJson: { ...example.contentJson },
  };
  delete input.contentJson.sharing;
  assert.equal((await request("/templates", input, token)).status, 400);
  assert.equal(
    (await request("/templates", { ...input, isPublic: false }, token)).status,
    201,
  );
  input.slug += "-public";
  for (const invalid of [
    { ...sharing, permissionConfirmed: false },
    { ...sharing, license: "UNKNOWN" },
    { ...sharing, attribution: "   " },
  ]) {
    assert.equal(
      (
        await request(
          "/templates",
          { ...input, contentJson: { ...input.contentJson, sharing: invalid } },
          token,
        )
      ).status,
      400,
    );
  }
  const fakeKey = "sk-" + "notarealcredential".repeat(3);
  const blocked = await request(
    "/templates",
    {
      ...input,
      contentJson: { ...input.contentJson, sharing, html: `<p>${fakeKey}</p>` },
    },
    token,
  );
  assert.equal(blocked.status, 400);
  assert(!JSON.stringify(blocked.body).includes(fakeKey));
  const created = await request(
    "/templates",
    { ...input, contentJson: { ...input.contentJson, sharing } },
    token,
  );
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.contentJson.sharing, sharing);
});
