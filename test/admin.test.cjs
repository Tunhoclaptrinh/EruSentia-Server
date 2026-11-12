require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createApplication } = require("../dist/src/app");
const { readConfig } = require("../dist/src/config");

test("Admin Portal Core APIs & Security RBAC", async (t) => {
  const settings = readConfig({
    ...process.env,
    CACHE_ENABLED: "false",
    QUEUE_ENABLED: "false",
  });
  const app = await createApplication(settings, false);
  t.after(() => app.close());
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();

  async function request(method, path, body, token) {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: response.status, text, json };
  }

  // 1. Register a regular user
  const regularEmail = "reg-" + randomUUID() + "@example.test";
  const regularPass = "RegularPass!2026";
  const regRes = await request("POST", "/auth/register", {
    email: regularEmail,
    password: regularPass,
  });
  assert.equal(regRes.status, 201);

  const regularLogin = await request("POST", "/auth/login", {
    email: regularEmail,
    password: regularPass,
  });
  assert.equal(regularLogin.status, 200);
  const regularToken = regularLogin.json.accessToken;
  const regularUserId = regularLogin.json.user.id;

  // 2. Unauthenticated check
  const unauthRes = await request("GET", "/admin/accounts");
  assert.equal(unauthRes.status, 401, "Unauthenticated request should return 401");

  // 3. Regular user check (RBAC boundary)
  const forbiddenUsers = await request("GET", "/admin/accounts", null, regularToken);
  assert.equal(forbiddenUsers.status, 403, "Regular user should get 403 on /admin/accounts");

  const forbiddenOverview = await request("GET", "/admin/system/overview", null, regularToken);
  assert.equal(forbiddenOverview.status, 403, "Regular user should get 403 on /admin/system/overview");

  // 4. Admin login with seeded demo admin or promote user
  // Let's use demo admin if available, or promote via DB
  let adminToken;
  let adminUserId;
  const adminLogin = await request("POST", "/auth/login", {
    email: "admin@erusentia.test",
    password: "EruSentiaDemo!2026",
  });

  if (adminLogin.status === 200 && adminLogin.json.user?.role === "admin") {
    adminToken = adminLogin.json.accessToken;
    adminUserId = adminLogin.json.user.id;
  } else {
    // If running with memory or fresh DB without seed, register an admin
    const adminEmail = "admin-" + randomUUID() + "@example.test";
    await request("POST", "/auth/register", { email: adminEmail, password: regularPass });
    const pool = app.get("DataSource");
    await pool.query("UPDATE users SET role = 'admin' WHERE email = $1", [adminEmail]);
    const l = await request("POST", "/auth/login", { email: adminEmail, password: regularPass });
    adminToken = l.json.accessToken;
    adminUserId = l.json.user.id;
  }

  assert(adminToken, "Admin token must be obtained");

  // 5. Admin System Overview
  const overview = await request("GET", "/admin/system/overview", null, adminToken);
  assert.equal(overview.status, 200);
  assert(typeof overview.json.users.total === "number");
  assert(typeof overview.json.templates.total === "number");
  assert(typeof overview.json.moderation.total === "number");

  // 6. Admin System Health
  const health = await request("GET", "/admin/system/health", null, adminToken);
  assert.equal(health.status, 200);
  assert.equal(health.json.status, "healthy");
  assert.equal(health.json.services.database.status, "connected");

  // 7. Admin List Users
  const userList = await request("GET", "/admin/accounts?page=1&size=10", null, adminToken);
  assert.equal(userList.status, 200);
  assert(Array.isArray(userList.json.data));
  assert(userList.json.totalElements >= 1);

  // Search filter
  const searchUser = await request("GET", `/admin/accounts?search=${encodeURIComponent(regularEmail)}`, null, adminToken);
  assert.equal(searchUser.status, 200);
  assert.equal(searchUser.json.data.length, 1);
  assert.equal(searchUser.json.data[0].id, regularUserId);

  // 8. Admin User Detail
  const detail = await request("GET", `/admin/accounts/${regularUserId}`, null, adminToken);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.user.email, regularEmail);
  assert(typeof detail.json.quota.totalContentBytes === "number");
  assert(Array.isArray(detail.json.sessions));

  // 9. Update User Role
  const roleUpdate = await request("PATCH", `/admin/accounts/${regularUserId}/role`, { role: "creator" }, adminToken);
  assert.equal(roleUpdate.status, 200);
  assert.equal(roleUpdate.json.role, "creator");

  // Verify self-demotion is forbidden
  const selfDemote = await request("PATCH", `/admin/accounts/${adminUserId}/role`, { role: "user" }, adminToken);
  assert.equal(selfDemote.status, 403, "Admin cannot demote own account");

  // 10. Suspend User
  const suspendRes = await request("POST", `/admin/accounts/${regularUserId}/suspend`, { reason: "Testing suspension policy" }, adminToken);
  assert.equal(suspendRes.status, 200);
  assert.equal(suspendRes.json.status, "suspended");

  // Verify suspended user cannot login
  const tryLogin = await request("POST", "/auth/login", {
    email: regularEmail,
    password: regularPass,
  });
  assert.equal(tryLogin.status, 401, "Suspended user cannot login");

  // Verify self-suspension is forbidden
  const selfSuspend = await request("POST", `/admin/accounts/${adminUserId}/suspend`, { reason: "Self lock test" }, adminToken);
  assert.equal(selfSuspend.status, 403, "Admin cannot suspend own account");

  // 11. Reactivate User
  const activateRes = await request("POST", `/admin/accounts/${regularUserId}/activate`, null, adminToken);
  assert.equal(activateRes.status, 200);
  assert.equal(activateRes.json.status, "active");

  const reLogin = await request("POST", "/auth/login", {
    email: regularEmail,
    password: regularPass,
  });
  assert.equal(reLogin.status, 200, "Reactivated user can log in again");

  // 12. Create a Template to test Template Admin Operations
  const categories = JSON.parse((await request("GET", "/categories", null, adminToken)).text);
  const tplSlug = "test-tpl-" + randomUUID();
  const createTpl = await request("POST", "/templates", {
    categoryId: categories[0].id,
    title: "Admin Test Template",
    slug: tplSlug,
    description: "Template for admin management test",
    isPublic: false,
    contentJson: {
      format: "erusentia-template-html",
      schemaVersion: 1,
      html: "<section><h2>Admin test content</h2></section>",
    },
  }, adminToken);
  assert.equal(createTpl.status, 201);
  const createdTplId = createTpl.json.id;

  // 13. Admin List Templates
  const tplList = await request("GET", `/admin/templates?search=${tplSlug}`, null, adminToken);
  assert.equal(tplList.status, 200);
  assert.equal(tplList.json.data.length, 1);
  assert.equal(tplList.json.data[0].id, createdTplId);

  // 14. Admin Curate Template
  const curateRes = await request("PATCH", `/admin/templates/${createdTplId}/curation`, { isCurated: true }, adminToken);
  assert.equal(curateRes.status, 200);
  assert.equal(curateRes.json.isCurated, true);

  // Filter curated
  const curatedList = await request("GET", `/admin/templates?search=${tplSlug}&isCurated=true`, null, adminToken);
  assert.equal(curatedList.status, 200);
  assert.equal(curatedList.json.data.length, 1);

  // 15. Admin Force Hide Template
  const hideRes = await request("POST", `/admin/templates/${createdTplId}/force-hide`, { reason: "Violates terms" }, adminToken);
  assert.equal(hideRes.status, 200);
  assert.equal(hideRes.json.moderationState, "hidden");

  // 16. Audit Logs
  const auditLogs = await request("GET", "/admin/audit-logs?size=20", null, adminToken);
  assert.equal(auditLogs.status, 200);
  assert(Array.isArray(auditLogs.json.data));
  const actions = auditLogs.json.data.map((l) => l.action);
  assert(actions.includes("USER_ROLE_UPDATED"), "Audit log should contain USER_ROLE_UPDATED");
  assert(actions.includes("USER_SUSPENDED"), "Audit log should contain USER_SUSPENDED");
  assert(actions.includes("USER_ACTIVATED"), "Audit log should contain USER_ACTIVATED");
  assert(actions.includes("TEMPLATE_CURATED"), "Audit log should contain TEMPLATE_CURATED");
  assert(actions.includes("TEMPLATE_FORCE_HIDDEN"), "Audit log should contain TEMPLATE_FORCE_HIDDEN");
});
