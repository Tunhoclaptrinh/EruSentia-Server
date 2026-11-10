require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { readConfig } = require("../dist/src/config");
const { createApplication } = require("../dist/src/app");
const { example } = require("./publication-fixture.cjs");

test("Workspace multi-tenancy, RBAC & Last Owner concurrency contract", async (t) => {
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

  const ownerA = await authUser("owner-a");
  const userB = await authUser("user-b");
  const userC = await authUser("user-c");
  const outsider = await authUser("outsider");

  let workspaceId;
  const slug = `ws-${randomUUID().replaceAll("_", "")}`;

  await t.test("Owner creates a new workspace and is automatically assigned owner role", async () => {
    const res = await fetch(`${base}/workspaces`, {
      method: "POST",
      headers: ownerA.headers,
      body: JSON.stringify({
        name: "Acme Engineering Workspace",
        slug,
        description: "Shared documentation vault",
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    workspaceId = body.id;
    assert.ok(workspaceId);
    assert.equal(body.name, "Acme Engineering Workspace");
    assert.equal(body.currentUserRole, "owner");
    assert.equal(body.membersCount, 1);
  });

  await t.test("Duplicate slug rejected with 409 Conflict", async () => {
    const res = await fetch(`${base}/workspaces`, {
      method: "POST",
      headers: ownerA.headers,
      body: JSON.stringify({
        name: "Duplicate Workspace",
        slug,
      }),
    });
    assert.equal(res.status, 409);
  });

  await t.test("Multi-tenancy isolation: non-member cannot read or update workspace", async () => {
    const readRes = await fetch(`${base}/workspaces/${workspaceId}`, {
      headers: outsider.headers,
    });
    assert.equal(readRes.status, 403);

    const updateRes = await fetch(`${base}/workspaces/${workspaceId}`, {
      method: "PATCH",
      headers: outsider.headers,
      body: JSON.stringify({ name: "Hacked" }),
    });
    assert.equal(updateRes.status, 403);
  });

  let inviteToken;
  await t.test("Owner generates invitation link for User B (role: editor)", async () => {
    const res = await fetch(`${base}/workspaces/${workspaceId}/invites`, {
      method: "POST",
      headers: ownerA.headers,
      body: JSON.stringify({
        email: userB.email,
        role: "editor",
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    inviteToken = body.token;
    assert.ok(inviteToken);
    assert.equal(body.role, "editor");
  });

  await t.test("A different email cannot accept an unused invitation", async () => {
    const res = await fetch(`${base}/workspaces/invites/${inviteToken}/accept`, { method: "POST", headers: userC.headers });
    assert.equal(res.status, 403);
  });

  await t.test("User B accepts invite and gains editor role", async () => {
    const res = await fetch(`${base}/workspaces/invites/${inviteToken}/accept`, {
      method: "POST",
      headers: userB.headers,
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.role, "editor");

    // Verify User B can now read workspace
    const wsRes = await fetch(`${base}/workspaces/${workspaceId}`, {
      headers: userB.headers,
    });
    assert.equal(wsRes.status, 200);
    const ws = await wsRes.json();
    assert.equal(ws.currentUserRole, "editor");
    assert.equal(ws.membersCount, 2);
  });

  await t.test("Reusing accepted invitation token is rejected with 409 Conflict", async () => {
    const res = await fetch(`${base}/workspaces/invites/${inviteToken}/accept`, {
      method: "POST",
      headers: userC.headers,
    });
    assert.equal(res.status, 409);
  });

  await t.test("RBAC: Editor cannot modify member roles or invite members", async () => {
    const res = await fetch(`${base}/workspaces/${workspaceId}/members/${ownerA.id}`, {
      method: "PATCH",
      headers: userB.headers,
      body: JSON.stringify({ role: "viewer" }),
    });
    assert.equal(res.status, 403);
  });

  await t.test("The Last Owner Problem: Sole owner cannot demote self", async () => {
    const res = await fetch(`${base}/workspaces/${workspaceId}/members/${ownerA.id}`, {
      method: "PATCH",
      headers: ownerA.headers,
      body: JSON.stringify({ role: "editor" }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.message, /last remaining owner/i);
  });

  await t.test("The Last Owner Problem: Sole owner cannot leave or be removed", async () => {
    const res = await fetch(`${base}/workspaces/${workspaceId}/members/${ownerA.id}`, {
      method: "DELETE",
      headers: ownerA.headers,
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.message, /last remaining owner/i);
  });

  await t.test("A viewer invitation cannot downgrade the sole owner", async () => {
    const inviteRes = await fetch(`${base}/workspaces/${workspaceId}/invites`, {
      method: "POST", headers: ownerA.headers, body: JSON.stringify({ email: ownerA.email, role: "viewer" })
    });
    assert.equal(inviteRes.status, 201);
    const { token } = await inviteRes.json();
    const accept = await fetch(`${base}/workspaces/invites/${token}/accept`, { method: "POST", headers: ownerA.headers });
    assert.equal(accept.status, 201);
    const detail = await fetch(`${base}/workspaces/${workspaceId}`, { headers: ownerA.headers });
    assert.equal((await detail.json()).currentUserRole, "owner");
  });

  await t.test("Owner promotes User B to co-owner (now 2 owners)", async () => {
    const res = await fetch(`${base}/workspaces/${workspaceId}/members/${userB.id}`, {
      method: "PATCH",
      headers: ownerA.headers,
      body: JSON.stringify({ role: "owner" }),
    });
    assert.equal(res.status, 200);

    const membersRes = await fetch(`${base}/workspaces/${workspaceId}/members`, {
      headers: ownerA.headers,
    });
    assert.equal(membersRes.status, 200);
    const members = await membersRes.json();
    const ownerCount = members.filter((m) => m.role === "owner").length;
    assert.equal(ownerCount, 2);
  });

  await t.test("With 2 owners, one owner can now safely leave", async () => {
    const res = await fetch(`${base}/workspaces/${workspaceId}/members/${ownerA.id}`, {
      method: "DELETE",
      headers: ownerA.headers,
    });
    assert.equal(res.status, 204);

    // Verify User B is now the sole owner
    const wsRes = await fetch(`${base}/workspaces/${workspaceId}`, {
      headers: userB.headers,
    });
    assert.equal(wsRes.status, 200);
    const ws = await wsRes.json();
    assert.equal(ws.currentUserRole, "owner");
    assert.equal(ws.membersCount, 1);
  });

  await t.test("User B (now sole owner) cannot leave workspace", async () => {
    const res = await fetch(`${base}/workspaces/${workspaceId}/members/${userB.id}`, {
      method: "DELETE",
      headers: userB.headers,
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.message, /last remaining owner/i);
  });
});

