const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { randomUUID } = require("node:crypto");
const { once } = require("node:events");
const { createApplication } = require("../dist/src/app");
const { readConfig } = require("../dist/src/config");
const { AUTH_STORE } = require("../dist/src/auth/auth-store");
const { Passwords } = require("../dist/src/auth/passwords");
const { ResourcesService } = require("../dist/src/resources/resources.service");
const { resourceSettings } = require("../dist/src/resources/resource-settings");
const {
  relayResource,
  isPublicResourceAddress,
} = require("../dist/src/resources/resource-relay");

test("hosted resource policy rejects local networks and production bypasses", async () => {
  for (const ip of [
    "127.0.0.1",
    "0.0.0.0",
    "10.2.0.1",
    "169.254.169.254",
    "172.16.2.3",
    "192.168.1.1",
    "100.64.0.1",
    "192.88.99.1",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fe80::1",
    "fc00::1",
    "2001:db8::1",
    "2002:7f00:1::",
  ])
    assert.equal(isPublicResourceAddress(ip), false, ip);
  for (const ip of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])
    assert.equal(isPublicResourceAddress(ip), true, ip);
  assert.throws(() =>
    resourceSettings({
      NODE_ENV: "production",
      RESOURCE_ALLOW_LOCAL_TARGETS: "true",
    }),
  );
  assert.throws(() =>
    resourceSettings({ RESOURCE_TARGET_ORIGINS: "https://example.com/path" }),
  );
  assert.throws(() =>
    resourceSettings({ RESOURCE_TARGET_ORIGINS: "http://example.com" }),
  );
  assert.throws(() => resourceSettings({ RESOURCE_FREE_DAILY_LIMIT: "-1" }));
  const settings = resourceSettings({
    RESOURCE_TARGET_ORIGINS: "https://127.0.0.1",
  });
  await assert.rejects(
    relayResource({ url: "https://127.0.0.1/test", method: "GET" }, settings),
    (error) => error.getStatus() === 403,
  );
  for (const url of [
    "https://evil.example/test",
    "https://127.0.0.1/resource-gateway/requests",
    "https://127.0.0.1/%2572esource-documents/test",
    "https://127.0.0.1/admin/users",
    "https://user:password@127.0.0.1/test",
  ])
    await assert.rejects(
      relayResource({ url, method: "GET" }, settings),
      (error) => error.getStatus() === 403,
    );
});

test("hosted relay preserves bytes, filters headers, blocks redirects/large responses and cancels upstream", async (t) => {
  let received, aborted;
  const server = createServer((req, res) => {
    received = req.headers;
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "http://169.254.169.254/" });
      res.end();
      return;
    }
    if (req.url === "/large") {
      res.end(Buffer.alloc(2 * 1024 * 1024 + 1));
      return;
    }
    if (req.url === "/wait") {
      aborted = once(res, "close");
      return;
    }
    res.setHeader("Set-Cookie", "secret=value");
    res.setHeader("Content-Type", "application/octet-stream");
    res.end(Buffer.from([0, 1, 128, 255]));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const settings = resourceSettings({
    RESOURCE_ALLOW_LOCAL_TARGETS: "true",
    RESOURCE_TARGET_ORIGINS: base,
  });
  const result = await relayResource(
    {
      url: base + "/bytes",
      method: "GET",
      headers: { Authorization: "Bearer target-only" },
    },
    settings,
  );
  assert.equal(result.status, 200);
  assert.deepEqual(
    Buffer.from(result.bodyBase64, "base64"),
    Buffer.from([0, 1, 128, 255]),
  );
  assert.equal(result.headers["set-cookie"], undefined);
  assert.equal(received.authorization, "Bearer target-only");
  for (const headers of [
    { Cookie: "a=1" },
    { Host: "other.example" },
    { "X-Eru-Gateway-Key": "key" },
    { Origin: "null" },
    { "Bad Header": "value" },
    { test: "a\r\nb: c" },
  ])
    await assert.rejects(
      relayResource({ url: base, method: "GET", headers }, settings),
      (error) => error.getStatus() === 400,
    );
  await assert.rejects(
    relayResource({ url: base + "/redirect", method: "GET" }, settings),
    (error) => error.getStatus() === 502,
  );
  await assert.rejects(
    relayResource({ url: base + "/large", method: "GET" }, settings),
    (error) => error.getStatus() === 413,
  );
  await assert.rejects(
    relayResource(
      { url: base, method: "POST", body: "a".repeat(524289) },
      settings,
    ),
    (error) => error.getStatus() === 413,
  );
  const controller = new AbortController();
  const wait = relayResource(
    { url: base + "/wait", method: "GET" },
    settings,
    controller.signal,
  );
  while (!aborted) await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  await assert.rejects(wait, (error) => error.getStatus() === 502);
  await aborted;
});

test("resource identity, server-controlled plans, document ACLs, audit and atomic quotas", async (t) => {
  const upstream = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({ authorization: req.headers.authorization || null }),
    );
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const target = `http://127.0.0.1:${upstream.address().port}`;
  const mode = process.env.RESOURCE_TEST_STORE || "memory";
  const app = await createApplication(
    readConfig({
      ...process.env,
      TEMPLATE_STORE: mode,
      QUEUE_ENABLED: "false",
      CACHE_ENABLED: "false",
      API_RATE_LIMITS_ENABLED: "false",
      RESOURCE_ALLOW_LOCAL_TARGETS: "true",
      RESOURCE_TARGET_ORIGINS: target,
      RESOURCE_FREE_DAILY_LIMIT: "2",
      RESOURCE_PREMIUM_DAILY_LIMIT: "10",
    }),
    false,
  );
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const base = await app.getUrl();
  const password = "ResourceTests!2026";
  async function call(method, path, status, body, account) {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(account ? { Authorization: "Bearer " + account.accessToken } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${path}: ${text}`);
    return text ? JSON.parse(text) : undefined;
  }
  async function user(label) {
    const email = `${label}-${randomUUID()}@example.test`;
    await call("POST", "/auth/register", 201, { email, password });
    return call("POST", "/auth/login", 200, { email, password });
  }
  const owner = await user("owner"),
    reader = await user("reader"),
    limited = await user("limited");
  const adminUser = await app.get(AUTH_STORE).createUser({
    email: `admin-${randomUUID()}@example.test`,
    passwordHash: await app.get(Passwords).hash(password),
    role: "admin",
  });
  const admin = await call("POST", "/auth/login", 200, {
    email: adminUser.email,
    password,
  });
  const plan = (account, plan) =>
    call(
      "PATCH",
      "/admin/resource-plans/" + account.user.id,
      200,
      { plan },
      admin,
    );
  await t.test("requires JWT and rejects client plan escalation", async () => {
    await call("GET", "/resource-gateway/me", 401);
    await call("POST", "/resource-gateway/requests", 401, {
      url: target,
      method: "GET",
    });
    const info = await call(
      "GET",
      "/resource-gateway/me",
      200,
      undefined,
      owner,
    );
    assert.equal(info.user.id, owner.user.id);
    assert.equal(info.plan, "free");
    assert.equal(info.dailyLimit, 2);
    await call(
      "PATCH",
      "/admin/resource-plans/" + reader.user.id,
      403,
      { plan: "premium" },
      owner,
    );
    await call(
      "POST",
      "/resource-documents",
      400,
      { title: "Forged", html: "test", plan: "premium" },
      owner,
    );
    await call(
      "PATCH",
      "/admin/resource-plans/" + reader.user.id,
      400,
      { plan: "premium", expiresAt: "2020-01-01T00:00:00Z" },
      admin,
    );
    await plan(owner, "premium");
  });
  let shared;
  await t.test(
    "private/shared content is authorized before returning HTML and records allowed/denied identities",
    async () => {
      const doc = await call(
        "POST",
        "/resource-documents",
        201,
        {
          title: "Private report",
          html: "<h1>Private report</h1>",
          access: "private",
        },
        owner,
      );
      assert.equal(doc.ownerId, owner.user.id);
      const own = await call(
        "GET",
        "/resource-documents/" + doc.id,
        200,
        undefined,
        owner,
      );
      assert.equal(own.html, "<h1>Private report</h1>");
      await call(
        "GET",
        "/resource-documents/" + doc.id,
        403,
        undefined,
        reader,
      );
      assert.deepEqual(
        await call("GET", "/resource-documents", 200, undefined, reader),
        [],
      );
      await call(
        "POST",
        `/resource-documents/${doc.id}/grants`,
        400,
        { userId: reader.user.id },
        owner,
      );
      await call(
        "GET",
        `/resource-documents/${doc.id}/access-events`,
        403,
        undefined,
        reader,
      );
      const events = await call(
        "GET",
        `/resource-documents/${doc.id}/access-events`,
        200,
        undefined,
        owner,
      );
      assert(
        events.some(
          (event) =>
            event.userId === reader.user.id && event.outcome === "denied",
        ),
      );
      assert(
        events.some(
          (event) =>
            event.userId === owner.user.id && event.outcome === "allowed",
        ),
      );
      shared = await call(
        "POST",
        "/resource-documents",
        201,
        { title: "Shared report", html: "Shared HTML", access: "shared" },
        owner,
      );
      await call(
        "POST",
        `/resource-documents/${shared.id}/grants`,
        403,
        { userId: reader.user.id },
        reader,
      );
      await call(
        "POST",
        `/resource-documents/${shared.id}/grants`,
        201,
        { userId: reader.user.id },
        owner,
      );
      const grants = await call(
        "GET",
        `/resource-documents/${shared.id}/grants`,
        200,
        undefined,
        owner,
      );
      assert.equal(grants.length, 1);
      assert.equal(grants[0].userId, reader.user.id);
      await call(
        "GET",
        `/resource-documents/${shared.id}/grants`,
        403,
        undefined,
        reader,
      );
      await call(
        "GET",
        "/resource-documents/" + shared.id,
        200,
        undefined,
        reader,
      );
      await call(
        "DELETE",
        `/resource-documents/${shared.id}/grants/${reader.user.id}`,
        204,
        undefined,
        owner,
      );
      assert.deepEqual(
        await call(
          "GET",
          `/resource-documents/${shared.id}/grants`,
          200,
          undefined,
          owner,
        ),
        [],
      );
      await call(
        "GET",
        "/resource-documents/" + shared.id,
        403,
        undefined,
        reader,
      );
    },
  );
  await t.test(
    "premium and blocked status are checked on every request",
    async () => {
      const doc = await call(
        "POST",
        "/resource-documents",
        201,
        { title: "Premium report", html: "Premium HTML", access: "premium" },
        owner,
      );
      await call(
        "GET",
        "/resource-documents/" + doc.id,
        403,
        undefined,
        reader,
      );
      await plan(reader, "premium");
      await call(
        "GET",
        "/resource-documents/" + doc.id,
        200,
        undefined,
        reader,
      );
      await plan(reader, "blocked");
      await call(
        "GET",
        "/resource-documents/" + doc.id,
        403,
        undefined,
        reader,
      );
      await call(
        "POST",
        "/resource-gateway/requests",
        403,
        { url: target, method: "GET" },
        reader,
      );
      await call(
        "POST",
        "/resource-documents",
        403,
        { title: "Blocked", html: "html" },
        reader,
      );
      await plan(reader, "free");
      await call(
        "GET",
        "/resource-documents/" + doc.id,
        403,
        undefined,
        reader,
      );
      await call(
        "DELETE",
        "/resource-documents/" + doc.id,
        204,
        undefined,
        owner,
      );
      await call("GET", "/resource-documents/" + doc.id, 404, undefined, owner);
    },
  );
  await t.test(
    "concurrent requests enforce per-user quota and do not forward the service JWT automatically",
    async () => {
      const replies = await Promise.all(
        Array.from({ length: 7 }, () =>
          fetch(base + "/resource-gateway/requests", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + limited.accessToken,
            },
            body: JSON.stringify({ url: target, method: "GET" }),
          }),
        ),
      );
      assert.equal(
        replies.filter((response) => response.status === 200).length,
        2,
      );
      assert.equal(
        replies.filter((response) => response.status === 429).length,
        5,
      );
      for (const response of replies.filter(
        (response) => response.status === 200,
      )) {
        const data = await response.json();
        assert.equal(
          JSON.parse(Buffer.from(data.bodyBase64, "base64").toString())
            .authorization,
          null,
        );
      }
      const info = await call(
        "GET",
        "/resource-gateway/me",
        200,
        undefined,
        limited,
      );
      assert.equal(info.used, 2);
      assert.equal(info.remaining, 0);
      await plan(limited, "premium");
      await call(
        "POST",
        "/resource-gateway/requests",
        200,
        { url: target, method: "GET" },
        limited,
      );
      await call(
        "POST",
        "/resource-gateway/requests",
        403,
        { url: target, method: "GET", documentId: shared.id },
        limited,
      );
    },
  );
  await t.test(
    "file origin remains outside API CORS; connect UI has a nonce CSP and no secrets",
    async () => {
      const preflight = await fetch(base + "/resource-gateway/requests", {
        method: "OPTIONS",
        headers: {
          Origin: "null",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization,content-type",
        },
      });
      assert.equal(preflight.headers.get("access-control-allow-origin"), null);
      const page = await fetch(base + "/resource-gateway/connect");
      assert.equal(page.status, 200);
      assert.equal(page.headers.get("cache-control"), "no-store");
      assert.match(
        page.headers.get("content-security-policy"),
        /script-src 'nonce-/,
      );
      assert.doesNotMatch(await page.text(), new RegExp(owner.accessToken));
      await call("POST", "/auth/logout", 204, {
        refreshToken: owner.refreshToken,
      });
      await call("GET", "/resource-gateway/me", 401, undefined, owner);
    },
  );
});

test("expired premium falls back to free instead of trusting prior client identity", async () => {
  const service = new ResourcesService(resourceSettings({}));
  const actor = {
      id: randomUUID(),
      email: "admin@example.test",
      role: "admin",
    },
    user = { id: randomUUID(), email: "reader@example.test", role: "user" };
  await service.updatePlan(
    user.id,
    { plan: "premium", expiresAt: new Date(Date.now() + 30).toISOString() },
    actor,
  );
  assert.equal((await service.me(user)).plan, "premium");
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal((await service.me(user)).plan, "free");
});
