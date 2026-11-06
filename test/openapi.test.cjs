const assert = require("node:assert/strict");
const test = require("node:test");
const { readConfig } = require("../dist/src/config");
const { createApplication } = require("../dist/src/app");

test("Swagger configuration defaults and explicit overrides", () => {
  assert.equal(readConfig({}).swaggerEnabled, true);
  assert.equal(
    readConfig({
      NODE_ENV: "production",
      JWT_SECRET: "test-only-key-with-at-least-32-bytes",
    }).swaggerEnabled,
    false,
  );
  assert.equal(
    readConfig({
      NODE_ENV: "production",
      SWAGGER_ENABLED: "true",
      JWT_SECRET: "test-only-key-with-at-least-32-bytes",
    }).swaggerEnabled,
    true,
  );
  assert.equal(readConfig({ SWAGGER_ENABLED: "false" }).swaggerEnabled, false);
  assert.throws(
    () => readConfig({ SWAGGER_ENABLED: "yes" }),
    /SWAGGER_ENABLED/,
  );
});

test("Swagger UI and OpenAPI describe an executable Template contract", async (t) => {
  const app = await createApplication(
    readConfig({ TEMPLATE_STORE: "memory" }),
    false,
  );
  t.after(() => app.close());
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const ui = await fetch(`${base}/docs`);
  assert.equal(ui.status, 200);
  assert.match(await ui.text(), /swagger-ui/);
  const init = await fetch(`${base}/docs/swagger-ui-init.js`);
  assert.equal(init.status, 200);
  assert.match(await init.text(), /EruSentia Template API/);
  const response = await fetch(`${base}/docs-json`);
  assert.equal(response.status, 200);
  const spec = await response.json();
  assert.match(spec.openapi, /^3\./);
  assert.equal(Object.keys(spec.paths).length, 15);
  assert.equal(spec.components.securitySchemes.bearer.scheme, "bearer");
  assert.equal(spec.paths["/auth/login"].post.security, undefined);
  assert.deepEqual(spec.paths["/templates"].get.security, [{ bearer: [] }]);
  assert.deepEqual(Object.keys(spec.paths["/templates"]).sort(), [
    "get",
    "post",
  ]);
  assert.deepEqual(Object.keys(spec.paths["/templates/{id}"]).sort(), [
    "delete",
    "get",
    "patch",
  ]);
  assert(
    spec.paths["/templates/{id}"].get.responses[200].headers[
      "X-Cache"
    ].schema.enum.includes("HIT"),
  );
  assert.equal(
    spec.paths["/categories"].get.responses[200].content["application/json"]
      .schema.type,
    "array",
  );
  assert.deepEqual(spec.paths["/categories"].get.security, [{ bearer: [] }]);
  for (const [route, method] of [
    ["/auth/sessions", "get"],
    ["/auth/sessions/{id}", "delete"],
    ["/auth/sessions/revoke-others", "post"],
  ]) {
    assert.deepEqual(spec.paths[route][method].security, [{ bearer: [] }]);
    assert(spec.paths[route][method].responses[401]);
  }
  const sessionQueries = spec.paths["/auth/sessions"].get.parameters;
  assert.deepEqual(sessionQueries.map((p) => p.name).sort(), ["page", "size"]);
  assert.equal(
    sessionQueries.find((p) => p.name === "size").schema.maximum,
    100,
  );
  assert.deepEqual(
    Object.keys(spec.components.schemas.LoginSessionDto.properties).sort(),
    ["id", "createdAt", "lastRefreshedAt", "expiresAt", "current"].sort(),
  );
  const queries = spec.paths["/templates"].get.parameters;
  assert.equal(queries.find((p) => p.name === "page").schema.default, 1);
  assert.equal(queries.find((p) => p.name === "size").schema.maximum, 100);
  assert(queries.every((p) => p.in === "query" && !p.required));
  const unauthorized =
    spec.paths["/auth/me"].get.responses[401].content["application/json"]
      .example;
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.code, "UNAUTHORIZED");
  const forbidden =
    spec.paths["/admin/users"].get.responses[403].content["application/json"]
      .example;
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.code, "FORBIDDEN");
  const schemas = spec.components.schemas;
  assert.deepEqual(schemas.UpdateTemplateDto.required ?? [], []);
  assert(!("authorId" in schemas.UpdateTemplateDto.properties));
  assert.equal(
    schemas.UpdateTemplateDto.properties.thumbnailUrl.nullable,
    true,
  );
  assert.equal(
    spec.paths["/templates/{id}"].delete.responses[204].content,
    undefined,
  );
  assert(!JSON.stringify(spec).includes("password_hash"));
  const body = Object.fromEntries(
    ["categoryId", "title", "slug", "description"].map((key) => [
      key,
      schemas.CreateTemplateDto.properties[key].example,
    ]),
  );
  const content = schemas.TemplateContentDto.properties;
  body.contentJson = {
    format: content.format.enum[0],
    schemaVersion: content.schemaVersion.enum[0],
    html: content.html.example,
    allowHeightResize: content.allowHeightResize.example,
  };
  body.isPublic = schemas.CreateTemplateDto.properties.isPublic.example;
  assert(!("authorId" in schemas.CreateTemplateDto.properties));
  const credentials = {
    email: "swagger@example.test",
    password: "LearningPass!2026",
  };
  await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials),
  });
  const login = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials),
  });
  const { accessToken } = await login.json();
  const created = await fetch(`${base}/templates`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const saved = await created.json();
  assert.equal(created.status, 201, JSON.stringify(saved));
  assert.equal(saved.contentJson.allowHeightResize, false);
  assert.equal(saved.isPublic, false);
});

test("Disabling Swagger removes both documentation endpoints", async (t) => {
  const app = await createApplication(
    readConfig({ TEMPLATE_STORE: "memory", SWAGGER_ENABLED: "false" }),
    false,
  );
  t.after(() => app.close());
  await app.listen(0, "127.0.0.1");
  for (const route of ["/docs", "/docs-json"]) {
    assert.equal((await fetch(`${await app.getUrl()}${route}`)).status, 404);
  }
});
