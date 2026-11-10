require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { readConfig } = require("../dist/src/config");
const { createApplication } = require("../dist/src/app");
const { example } = require("./publication-fixture.cjs");

test("Template follow & notification lifecycle contract", async (t) => {
  const settings = readConfig({
    ...process.env,
    TEMPLATE_STORE: "postgres",
    QUEUE_ENABLED: "false",
    CACHE_ENABLED: "false",
  });
  const app = await createApplication(settings, false);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  t.after(() => app.close());

  // Helper to register & login
  async function authUser(prefix) {
    const email = `${prefix}-${randomUUID()}@example.test`;
    const password = "Password!2026";
    const regRes = await fetch(`${base}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(regRes.status, 201, `Failed to register ${email}`);
    const user = await regRes.json();

    const loginRes = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(loginRes.status, 200, `Failed to login ${email}`);
    const { accessToken } = await loginRes.json();
    return {
      id: user.id,
      email,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
    };
  }

  const author = await authUser("author");
  const follower = await authUser("follower");

  let templateId;
  let currentEtag;

  await t.test("author creates a public template", async () => {
    const res = await fetch(`${base}/templates`, {
      method: "POST",
      headers: author.headers,
      body: JSON.stringify({
        categoryId: "c0000000-0000-0000-0000-000000000001",
        title: "Follow Test Template",
        slug: `follow-test-${randomUUID().replaceAll("_", "")}`,
        description: "A comprehensive test template for notifications",
        isPublic: true,
        contentJson: example.contentJson,
      }),
    });
    const body = await res.json();
    if (res.status !== 201) console.error("POST /templates error:", body);
    assert.equal(res.status, 201);
    templateId = body.id;
    currentEtag = res.headers.get("etag");
    assert.ok(templateId);
    assert.ok(currentEtag);
  });

  await t.test("author cannot follow their own template", async () => {
    const res = await fetch(`${base}/templates/${templateId}/follow`, {
      method: "POST",
      headers: author.headers,
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /cannot follow your own template/i);
  });

  await t.test("follower follows the public template", async () => {
    const res = await fetch(`${base}/templates/${templateId}/follow`, {
      method: "POST",
      headers: follower.headers,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.isFollowing, true);
    assert.equal(body.followerCount, 1);
  });

  await t.test("follow-status returns correct follower state", async () => {
    const res = await fetch(`${base}/templates/${templateId}/follow-status`, {
      headers: follower.headers,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.isFollowing, true);
    assert.equal(body.followerCount, 1);
  });

  await t.test("author updates template revision (creates outbox event)", async () => {
    const res = await fetch(`${base}/templates/${templateId}`, {
      method: "PATCH",
      headers: {
        ...author.headers,
        "if-match": currentEtag,
      },
      body: JSON.stringify({
        title: "Follow Test Template - Updated Version",
      }),
    });
    assert.equal(res.status, 200);
    currentEtag = res.headers.get("etag");
  });

  await t.test("notifications feed endpoint returns cursor pagination structure", async () => {
    const res = await fetch(`${base}/notifications?limit=10`, {
      headers: follower.headers,
    });
    assert.equal(res.status, 200);
    const feed = await res.json();
    assert.ok(Array.isArray(feed.items));
    assert.equal(typeof feed.unreadCount, "number");
    assert.equal(feed.nextCursor === null || typeof feed.nextCursor === "string", true);
  });

  await t.test("unread-count endpoint returns count object", async () => {
    const res = await fetch(`${base}/notifications/unread-count`, {
      headers: follower.headers,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(typeof body.count, "number");
  });

  await t.test("notifications feed rejects malformed cursor with 400", async () => {
    const res = await fetch(`${base}/notifications?cursor=malformed_not_base64_or_colon`, {
      headers: follower.headers,
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /cursor/i);
  });

  await t.test("follower unfollows the template", async () => {
    const res = await fetch(`${base}/templates/${templateId}/follow`, {
      method: "DELETE",
      headers: follower.headers,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.isFollowing, false);
    assert.equal(body.followerCount, 0);
  });
});
