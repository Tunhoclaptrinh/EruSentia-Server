require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { DataSource } = require("typeorm");
const enabled = process.env.RUN_ADMIN_TESTS === "1";
if (
  enabled &&
  !/^project_test_admin_[a-z0-9_]+$/.test(process.env.DB_DATABASE || "")
) {
  throw new Error(
    "Admin integration tests require a disposable project_test_admin_ database",
  );
}
const { createApplication } = require("../dist/src/app");
const { readConfig } = require("../dist/src/config");

test("Admin Portal Core APIs & Security RBAC", { skip: !enabled }, async (t) => {
  const settings = readConfig({
    ...process.env,
    NODE_ENV: "test",
    TEMPLATE_STORE: "postgres",
    ACCOUNT_EMAIL_MODE: "disabled",
    CACHE_ENABLED: "false",
    API_RATE_LIMITS_ENABLED: "false",
    QUEUE_ENABLED: "false",
  });
  const app = await createApplication(settings, false);
  t.after(() => app.close());
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();

  async function request(method, path, body, token, extraHeaders = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...extraHeaders,
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

  // 4. Create a test-only admin in the disposable database
  const adminEmail = "admin-" + randomUUID() + "@example.test";
  const adminRegister = await request("POST", "/auth/register", {
    email: adminEmail,
    password: regularPass,
  });
  assert.equal(adminRegister.status, 201);
  const pool = app.get(DataSource);
  await pool.query("UPDATE users SET role = 'admin' WHERE email = $1", [
    adminEmail,
  ]);
  const adminLogin = await request("POST", "/auth/login", {
    email: adminEmail,
    password: regularPass,
  });
  assert.equal(adminLogin.status, 200);
  const adminToken = adminLogin.json.accessToken;
  const adminUserId = adminLogin.json.user.id;

  assert(adminToken, "Admin token must be obtained");

  await t.test("Concurrent cross-admin account changes retain an authorized administrator", async () => {
    const { AdminUsersService } = require("../dist/src/admin/admin-users.service");
    const service = app.get(AdminUsersService);
    for (const action of ["role", "suspend"]) {
      const ids = [];
      for (let i = 0; i < 2; i++) {
        const email = "race-admin-" + randomUUID() + "@example.test";
        assert.equal((await request("POST", "/auth/register", { email, password: regularPass })).status, 201);
        await pool.query("UPDATE users SET role='admin' WHERE email=$1", [email]);
        const [row] = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
        ids.push(row.id);
      }
      const change = (target, actor) => action === "role"
        ? service.updateRole(target, { role: "user", reason: "Concurrent authorization regression" }, actor, {})
        : service.suspend(target, { reason: "Concurrent authorization regression" }, actor, {});
      const results = await Promise.allSettled([change(ids[1], ids[0]), change(ids[0], ids[1])]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      const failure = results.find(result => result.status === "rejected");
      assert.equal(failure.reason.getStatus(), 403);
      const [{ count }] = await pool.query("SELECT count(*)::int count FROM users WHERE id=ANY($1::uuid[]) AND role='admin' AND is_active=true", [ids]);
      assert.equal(count, 1, "At least one of the two administrators remains active");
    }
  });

  await t.test("Base pagination keeps count and rows in the same snapshot across a concurrent insert", async () => {
    const { BaseService } = require("../dist/src/common/services/base.service");
    class Reader extends BaseService {
      read(work) { return this.paginate({ page: 1, size: 10 }, work); }
    }
    let counted, continueRead;
    const countReady = new Promise(resolve => { counted = resolve; });
    const inserted = new Promise(resolve => { continueRead = resolve; });
    const slug = "snapshot-" + randomUUID();
    const reading = new Reader(pool).read(async (manager, window) => {
      const [{ total }] = await manager.query("SELECT count(*)::int total FROM categories WHERE slug=$1", [slug]);
      counted();
      await inserted;
      const data = await manager.query("SELECT id FROM categories WHERE slug=$1 LIMIT $2 OFFSET $3", [slug, window.size, window.offset]);
      return { data, total };
    });
    try {
      await countReady;
      await pool.query("INSERT INTO categories(name,slug) VALUES($1,$1)", [slug]);
    } finally { continueRead(); }
    const result = await reading;
    assert.equal(result.totalElements, 0);
    assert.deepEqual(result.data, []);
    assert.equal((await pool.query("SELECT id FROM categories WHERE slug=$1", [slug])).length, 1);
  });

  await t.test("Every Admin list rejects invalid pagination, unrecognized fields and oversized searches", async () => {
    const paths = ["/admin/accounts", "/admin/templates", "/admin/categories", "/admin/audit-logs", "/admin/community-documents", "/admin/reports"];
    for (const path of paths) {
      for (const query of ["page=1.5", "page=9007199254740993", "size=0", "size=101", "sortBy=password_hash"]) {
        assert.equal((await request("GET", path + "?" + query, null, adminToken)).status, 400, path + "?" + query);
      }
      assert.equal((await request("GET", path, null, adminToken)).status, 200);
      assert.equal((await request("GET", path, null, regularToken)).status, 403);
    }
    for (const path of paths.slice(0, 4)) {
      assert.equal((await request("GET", path + "?search=" + "x".repeat(201), null, adminToken)).status, 400);
    }
  });

  // 5. Admin System Overview
  const overview = await request("GET", "/admin/system/overview", null, adminToken);
  assert.equal(overview.status, 200);
  assert(typeof overview.json.users.total === "number");
  assert(typeof overview.json.templates.total === "number");
  assert(typeof overview.json.moderation.total === "number");

  await t.test(
    "Outbox metrics distinguish unpublished events from published events",
    async () => {
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      const before = overview.json.outbox;
      try {
        for (let index = 0; index < ids.length; index++) {
          await pool.query(
            "INSERT INTO message_outbox(id,event_type,payload,published_at) VALUES($1,'test.admin-observability','{}'::jsonb,$2)",
            [ids[index], index === 2 ? new Date() : null],
          );
        }
        const pending = await request(
          "GET",
          "/admin/system/overview",
          null,
          adminToken,
        );
        assert.equal(pending.status, 200);
        assert.equal(pending.json.outbox.totalOutbox, before.totalOutbox + 3);
        assert.equal(
          pending.json.outbox.pendingOutbox,
          before.pendingOutbox + 2,
        );
        await pool.query(
          "UPDATE message_outbox SET published_at=NOW() WHERE id=$1",
          [ids[0]],
        );
        const published = await request(
          "GET",
          "/admin/system/overview",
          null,
          adminToken,
        );
        assert.equal(
          published.json.outbox.totalOutbox,
          before.totalOutbox + 3,
        );
        assert.equal(
          published.json.outbox.pendingOutbox,
          before.pendingOutbox + 1,
        );
      } finally {
        await pool.query(
          "DELETE FROM message_outbox WHERE id=ANY($1::uuid[])",
          [ids],
        );
      }
    },
  );

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
  await t.test("Admin sessions count login families and revoke rotated sessions without affecting other logins", async () => {
    const email = "session-admin-" + randomUUID() + "@example.test";
    assert.equal((await request("POST", "/auth/register", { email, password: regularPass })).status, 201);
    const first = await request("POST", "/auth/login", { email, password: regularPass });
    const second = await request("POST", "/auth/login", { email, password: regularPass });
    const targetId = first.json.user.id;
    const before = await request("GET", `/admin/accounts/${targetId}/sessions`, null, adminToken);
    assert.equal(before.status, 200);
    assert.equal(before.json.totalElements, 2);
    assert.equal((await request("GET", `/admin/accounts/${targetId}/sessions`, null, regularToken)).status, 401);
    assert.equal((await request("GET", `/admin/accounts/${targetId}/sessions`, null, second.json.accessToken)).status, 403);
    const firstFamily = JSON.parse(Buffer.from(first.json.accessToken.split(".")[1], "base64url").toString()).sid;
    const rotated = await request("POST", "/auth/refresh", { refreshToken: first.json.refreshToken });
    assert.equal(rotated.status, 200);
    const afterRotation = await request("GET", `/admin/accounts/${targetId}/sessions`, null, adminToken);
    assert.equal(afterRotation.json.totalElements, 2, "A rotated token is not an additional login");
    assert(!JSON.stringify(afterRotation.json).includes("tokenHash"));
    const targetList = await request("GET", `/admin/accounts?search=${email}`, null, adminToken);
    assert.equal(targetList.json.data[0].activeSessionCount, 2);
    assert.equal((await request("POST", `/admin/accounts/${adminUserId}/sessions/${firstFamily}/revoke`, { reason: "Wrong owner" }, adminToken)).status, 404);
    assert.equal((await request("POST", `/admin/accounts/${targetId}/sessions/${firstFamily}/revoke`, { reason: " " }, adminToken)).status, 400);
    const revoke = await request("POST", `/admin/accounts/${targetId}/sessions/${firstFamily}/revoke`, { reason: "Suspicious login under review" }, adminToken);
    assert.equal(revoke.status, 200);
    assert.equal((await request("GET", "/auth/me", null, rotated.json.accessToken)).status, 401);
    assert.equal((await request("GET", "/auth/me", null, first.json.accessToken)).status, 401);
    assert.equal((await request("GET", "/auth/me", null, second.json.accessToken)).status, 200);
    assert.equal((await request("GET", `/admin/accounts/${targetId}/sessions`, null, adminToken)).json.totalElements, 1);
    const logs = await request("GET", `/admin/audit-logs?action=USER_SESSION_REVOKED&targetId=${targetId}`, null, adminToken);
    assert.equal(logs.status, 200);
    assert.equal(logs.json.totalElements, 1);
    assert.equal(logs.json.data[0].reason, "Suspicious login under review");
  });

  await t.test("Categories validate, persist changes, prevent duplicate slugs and refuse deletion of referenced categories", async () => {
    const slug = "category-" + randomUUID();
    const input = { name: slug, slug, description: "Admin test category", displayOrder: 7, reason: "Organize the library" };
    assert.equal((await request("POST", "/admin/categories", input, reLogin.json.accessToken)).status, 403);
    assert.equal((await request("POST", "/admin/categories", { ...input, slug: "Invalid slug" }, adminToken)).status, 400);
    assert.equal((await request("POST", "/admin/categories", { ...input, reason: " " }, adminToken)).status, 400);
    const created = await request("POST", "/admin/categories", input, adminToken);
    assert.equal(created.status, 201);
    assert.equal((await request("POST", "/admin/categories", input, adminToken)).status, 409);
    const id = created.json.id;
    const updated = await request("PATCH", `/admin/categories/${id}`, { ...input, displayOrder: 12 }, adminToken);
    assert.equal(updated.status, 200);
    assert.equal(updated.json.id, id);
    assert.equal(updated.json.displayOrder, 12);
    const logs = await request("GET", `/admin/audit-logs?action=CATEGORY_UPDATED&targetId=${id}`, null, adminToken);
    assert.equal(logs.json.totalElements, 1);
    assert.equal(logs.json.data[0].metadata.current.id, id);
    assert.equal(logs.json.data[0].metadata.current.displayOrder, 12);
    const listed = await request("GET", `/admin/categories?search=${slug}`, null, adminToken);
    assert.equal(listed.json.totalElements, 1);
    assert.equal(listed.json.data[0].displayOrder, 12);
    assert.equal(listed.json.data[0].templateCount, 0);
    const publicCategories = await request("GET", "/categories", null, adminToken);
    assert(publicCategories.json.some((row) => row.id === id && row.displayOrder === 12));
    const used = categories[0].id;
    assert.equal((await request("DELETE", `/admin/categories/${used}`, { reason: "Attempt deletion of referenced category" }, adminToken)).status, 409);
    const removed = await request("DELETE", `/admin/categories/${id}`, { reason: "Remove unused test category" }, adminToken);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.id, id);
    assert.equal((await request("DELETE", `/admin/categories/${id}`, { reason: "Already removed" }, adminToken)).status, 404);
    assert.equal((await request("GET", `/admin/categories?search=${slug}`, null, adminToken)).json.totalElements, 0);
  });

  await t.test("Category import previews without writes, validates every row, and revalidates at commit", async () => {
    const prefix = "import-" + randomUUID();
    const rows = [0, 1].map(i => ({ name: prefix + i, slug: prefix + i, description: "Imported category", displayOrder: String(i + 2) }));
    const input = { rows, reason: "Organize imported categories" };
    const [{ count: before }] = await pool.query("SELECT count(*)::int count FROM admin_audit_logs");
    const preview = await request("POST", "/admin/categories/import/preview", input, adminToken);
    assert.equal(preview.status, 200, preview.text);
    assert.deepEqual(preview.json.issues, []);
    assert.equal(preview.json.rows[0].displayOrder, 2);
    assert.equal((await pool.query("SELECT id FROM categories WHERE slug LIKE $1", [prefix + "%"])).length, 0);
    assert.equal((await pool.query("SELECT count(*)::int count FROM admin_audit_logs"))[0].count, before);
    const invalid = await request("POST", "/admin/categories/import/preview", { ...input, rows: [rows[0], rows[0], { ...rows[1], displayOrder: -1 }, { ...rows[1], role: "admin" }] }, adminToken);
    assert.equal(invalid.status, 200, invalid.text);
    assert(invalid.json.issues.some(issue => issue.row === 2 && issue.field === "slug"));
    assert(invalid.json.issues.some(issue => issue.row === 3 && issue.field === "displayOrder"));
    assert(invalid.json.issues.some(issue => issue.row === 4));
    assert.equal((await request("POST", "/admin/categories/import", { ...input, rows: [rows[0], { ...rows[1], slug: "Bad slug" }] }, adminToken)).status, 400);
    assert.equal((await pool.query("SELECT id FROM categories WHERE slug LIKE $1", [prefix + "%"])).length, 0);
    const saved = await request("POST", "/admin/categories/import", input, adminToken);
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.json.created, 2);
    const logs = await pool.query("SELECT reason,metadata FROM admin_audit_logs WHERE target_id=ANY($1::text[])", [saved.json.ids]);
    assert.equal(logs.length, 2);
    assert(logs.every(log => log.reason === input.reason && log.metadata.batchId === saved.json.batchId && log.metadata.source === "import"));
    assert.equal((await request("POST", "/admin/categories/import", input, adminToken)).status, 400, "stale preview cannot overwrite existing categories");
    assert.equal((await pool.query("SELECT id FROM categories WHERE slug LIKE $1", [prefix + "%"])).length, 2);
  });

  await t.test("Category batch deletion is atomic and refuses referenced, missing or stale targets", async () => {
    const prefix = "batch-delete-" + randomUUID();
    const saved = await request("POST", "/admin/categories/import", { rows: [0, 1].map(i => ({ name: prefix + i, slug: prefix + i })), reason: "Prepare batch" }, adminToken);
    assert.equal(saved.status, 200, saved.text);
    const ids = saved.json.ids, reason = "Remove unused test categories";
    assert.equal((await request("POST", "/admin/categories/batch-delete", { ids: [ids[0], categories[0].id], reason }, adminToken)).status, 409);
    assert.equal((await request("POST", "/admin/categories/batch-delete", { ids: [ids[0], randomUUID()], reason }, adminToken)).status, 404);
    assert.equal((await pool.query("SELECT id FROM categories WHERE id=ANY($1::uuid[])", [ids])).length, 2);
    const deleted = await request("POST", "/admin/categories/batch-delete", { ids: [...ids].reverse(), reason }, adminToken);
    assert.equal(deleted.status, 200, deleted.text);
    assert.equal(deleted.json.deleted, 2);
    assert.equal((await pool.query("SELECT id FROM categories WHERE id=ANY($1::uuid[])", [ids])).length, 0);
    const logs = await pool.query("SELECT reason,metadata FROM admin_audit_logs WHERE action='CATEGORY_DELETED' AND target_id=ANY($1::text[])", [ids]);
    assert.equal(logs.length, 2);
    assert(logs.every(row => row.reason === reason && row.metadata.batchId === deleted.json.batchId && row.metadata.previous.id));
    assert.equal((await request("POST", "/admin/categories/batch-delete", { ids, reason }, adminToken)).status, 404);
  });

  await t.test("Batch APIs enforce administrator access, explicit reasons, UUID uniqueness and the 100 item bound", async () => {
    const endpoints = [
      ["/admin/categories/import/preview", { rows: [{ name: "Bounded", slug: "bounded" }], reason: "Testing policy" }, "rows"],
      ["/admin/categories/import", { rows: [{ name: "Bounded", slug: "bounded" }], reason: "Testing policy" }, "rows"],
      ["/admin/categories/batch-delete", { ids: [randomUUID()], reason: "Testing policy" }, "ids"],
      ["/admin/templates/batch-curation", { ids: [createdTplId], reason: "Testing policy", isCurated: true }, "ids"]
    ];
    for (const [path, input, key] of endpoints) {
      assert.equal((await request("POST", path, input)).status, 401, path);
      assert.equal((await request("POST", path, input, reLogin.json.accessToken)).status, 403, path);
      for (const bad of [{ ...input, reason: " " }, { ...input, [key]: [] }, { ...input, [key]: Array.from({ length: 101 }, () => key === "ids" ? randomUUID() : input.rows[0]) }, { ...input, unknown: true }]) {
        assert.equal((await request("POST", path, bad, adminToken)).status, 400, path + JSON.stringify(bad).slice(0, 90));
      }
      if (key === "ids") for (const ids of [[input.ids[0], input.ids[0].toUpperCase()], ["not-a-uuid"]])
        assert.equal((await request("POST", path, { ...input, ids }, adminToken)).status, 400, path);
    }
    const service = app.get(require("../dist/src/admin/admin-categories").AdminCategoriesService);
    await assert.rejects(service.importRows({ rows: [{ name: "Unauthorized", slug: "unauthorized" }], reason: "Actor lost authority" }, regularUserId, {}), error => error.getStatus() === 403);
  });

  await t.test("Template batch curation records each change, avoids duplicate revisions and rolls back missing targets", async () => {
    const second = await request("POST", "/templates", { categoryId: categories[0].id, title: "Batch test template", description: "Batch curation regression", slug: "batch-tpl-" + randomUUID(), isPublic: false, contentJson: { format: "erusentia-template-html", schemaVersion: 1, html: "<p>Batch test</p>" } }, reLogin.json.accessToken);
    assert.equal(second.status, 201, second.text);
    const ids = [createdTplId, second.json.id], input = { ids, isCurated: false, reason: "Review selection quality" };
    const first = await request("POST", "/admin/templates/batch-curation", input, adminToken);
    assert.equal(first.status, 200, first.text);
    assert.equal(first.json.updated, 1, "one template was already uncurated");
    const selected = await request("POST", "/admin/templates/batch-curation", { ...input, isCurated: true }, adminToken);
    assert.equal(selected.status, 200, selected.text);
    assert.equal(selected.json.updated, 2);
    const logs = await pool.query("SELECT reason,metadata FROM admin_audit_logs WHERE action='TEMPLATE_CURATED' AND metadata->>'batchId'=$1", [selected.json.batchId]);
    assert.equal(logs.length, 2);
    assert(logs.every(row => row.reason === input.reason));
    const snapshot = await pool.query("SELECT id,is_curated,revision,curated_at FROM templates WHERE id=ANY($1::uuid[]) ORDER BY id", [ids]);
    const revisionCount = (await pool.query("SELECT count(*)::int count FROM template_revisions WHERE template_id=ANY($1::uuid[])", [ids]))[0].count;
    const repeat = await request("POST", "/admin/templates/batch-curation", { ...input, isCurated: true }, adminToken);
    assert.equal(repeat.json.updated, 0);
    assert.deepEqual(await pool.query("SELECT id,is_curated,revision,curated_at FROM templates WHERE id=ANY($1::uuid[]) ORDER BY id", [ids]), snapshot);
    assert.equal((await pool.query("SELECT count(*)::int count FROM template_revisions WHERE template_id=ANY($1::uuid[])", [ids]))[0].count, revisionCount);
    assert.equal((await request("POST", "/admin/templates/batch-curation", { ...input, ids: [ids[0], randomUUID()] }, adminToken)).status, 404);
    assert.deepEqual(await pool.query("SELECT id,is_curated,revision,curated_at FROM templates WHERE id=ANY($1::uuid[]) ORDER BY id", [ids]), snapshot);
    const service = app.get(require("../dist/src/admin/admin-templates.service").AdminTemplatesService);
    const concurrent = await Promise.all([service.curateMany({ ...input, ids: [...ids].reverse() }, adminUserId, {}), service.curateMany({ ...input, isCurated: true }, adminUserId, {})]);
    assert.equal(concurrent.length, 2, "opposite batches serialize across authors without deadlock");
  });

  await t.test("Multi-row imports, deletions and curation roll back earlier rows when a later audit write fails", async () => {
    const audit = app.get(require("../dist/src/admin/admin-audit.service").AdminAuditService), original = audit.record;
    const prefix = "batch-rollback-" + randomUUID();
    const input = { rows: [0, 1].map(i => ({ name: prefix + i, slug: prefix + i })), reason: "Atomic rollback regression" };
    const failSecond = () => { let count = 0; audit.record = async function(...args) { if (++count === 2) throw new Error("Deliberate second audit failure"); return original.apply(this, args); }; };
    try {
      failSecond();
      assert.equal((await request("POST", "/admin/categories/import", input, adminToken)).status, 500);
    } finally { audit.record = original; }
    assert.equal((await pool.query("SELECT id FROM categories WHERE slug LIKE $1", [prefix + "%"])).length, 0);
    const saved = await request("POST", "/admin/categories/import", input, adminToken);
    assert.equal(saved.status, 200, saved.text);
    try {
      failSecond();
      assert.equal((await request("POST", "/admin/categories/batch-delete", { ids: saved.json.ids, reason: input.reason }, adminToken)).status, 500);
    } finally { audit.record = original; }
    assert.equal((await pool.query("SELECT id FROM categories WHERE id=ANY($1::uuid[])", [saved.json.ids])).length, 2);
    assert.equal((await pool.query("SELECT id FROM admin_audit_logs WHERE action='CATEGORY_DELETED' AND target_id=ANY($1::text[])", [saved.json.ids])).length, 0);
    const templates = await pool.query("SELECT id,is_curated,revision FROM templates ORDER BY id LIMIT 2"), ids = templates.map(row => row.id);
    // Put both in one known state before testing a failure after the first committed statement.
    await app.get(require("../dist/src/admin/admin-templates.service").AdminTemplatesService).curateMany({ ids, isCurated: false, reason: input.reason }, adminUserId, {});
    const before = await pool.query("SELECT id,is_curated,revision FROM templates WHERE id=ANY($1::uuid[]) ORDER BY id", [ids]);
    try {
      failSecond();
      assert.equal((await request("POST", "/admin/templates/batch-curation", { ids, isCurated: true, reason: input.reason }, adminToken)).status, 500);
    } finally { audit.record = original; }
    assert.deepEqual(await pool.query("SELECT id,is_curated,revision FROM templates WHERE id=ANY($1::uuid[]) ORDER BY id", [ids]), before);
  });

  await t.test("Audit filters use real action codes, inclusive/exclusive dates and reject invalid ranges", async () => {
    const logs = await request("GET", `/admin/audit-logs?action=USER_ROLE_UPDATED&targetType=user&actorId=${adminUserId}&search=${encodeURIComponent(adminEmail)}&from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z`, null, adminToken);
    assert.equal(logs.status, 200);
    assert(logs.json.totalElements >= 1);
    assert(logs.json.data.every((row) => row.action === "USER_ROLE_UPDATED" && row.targetType === "user" && row.actorId === adminUserId));
    assert.equal((await request("GET", "/admin/audit-logs?from=2100-01-01&to=2020-01-01", null, adminToken)).status, 400);
    assert.equal((await request("GET", "/admin/audit-logs?action=user:suspend", null, adminToken)).status, 400);
    assert.equal((await request("GET", "/admin/audit-logs?from=2100-01-01T00:00:00Z", null, adminToken)).json.totalElements, 0);
  });

  await t.test("Administrative mutations roll back when their audit entry cannot be written", async () => {
    const { AdminAuditService } = require("../dist/src/admin/admin-audit.service");
    const audit = app.get(AdminAuditService);
    const original = audit.record;
    const slug = "rollback-" + randomUUID();
    try {
      audit.record = async () => { throw new Error("Deliberate audit failure in disposable database"); };
      assert.equal((await request("POST", "/admin/categories", { name: slug, slug, displayOrder: 0, reason: "Must roll back" }, adminToken)).status, 500);
      assert.equal((await request("PATCH", `/admin/accounts/${regularUserId}/role`, { role: "admin", reason: "Must roll back" }, adminToken)).status, 500);
    } finally { audit.record = original; }
    assert.equal((await request("GET", `/admin/categories?search=${slug}`, null, adminToken)).json.totalElements, 0);
    const [user] = await pool.query("SELECT role FROM users WHERE id=$1", [regularUserId]);
    assert.equal(user.role, "creator");
  });

  await t.test("Community documents follow submit, revision-checked review, return and publication without exposing private drafts", async () => {
    const body = { title: "Publication workflow " + randomUUID(), summary: "Separate community document", categoryId: categories[0].id, html: "<h1>Study guide</h1><p>Version one</p>", license: "CC-BY-4.0", attribution: "EruSentia test author" };
    const own = "/account/community-documents";
    let created = await request("POST", own, body, reLogin.json.accessToken);
    assert.equal(created.status, 201, created.text); let doc = created.json;
    assert.equal(doc.status, "draft");
    assert.equal((await request("GET", "/community/documents/" + doc.id, null, adminToken)).status, 404);
    assert.equal((await request("GET", own+"/"+doc.id, null, adminToken)).status, 404, "Even another admin is not the owner in the author API");
    assert.equal((await request("POST", own+"/"+doc.id+"/submit", { version: doc.version, permissionConfirmed: false }, reLogin.json.accessToken)).status, 400);
    let submitted = await request("POST", own+"/"+doc.id+"/submit", { version: doc.version, permissionConfirmed: true }, reLogin.json.accessToken);
    assert.equal(submitted.status, 200); doc=submitted.json; assert.equal(doc.status,"pending");
    assert.equal((await request("PATCH", own+"/"+doc.id, {...body, version:doc.version}, reLogin.json.accessToken)).status,409);
    const decision="/admin/community-documents/"+doc.id+"/decision";
    assert.equal((await request("POST",decision,{action:"approve",version:doc.version,reason:"Forbidden"},reLogin.json.accessToken)).status,403);
    assert.equal((await request("POST",decision,{action:"approve",version:1,reason:"Stale"},adminToken)).status,409);
    assert.equal((await request("POST",decision,{action:"approve",version:doc.version,reason:" "},adminToken)).status,400);
    const returned=await request("POST",decision,{action:"request_changes",version:doc.version,reason:"Please add a conclusion. Internal review detail."},adminToken);
    assert.equal(returned.status,200);doc=returned.json;assert.equal(doc.status,"changes_requested");
    const receipt=await request("GET",own+"/"+doc.id,null,reLogin.json.accessToken);
    assert(receipt.json.history.some(row=>row.reason?.includes("conclusion")));
    const edited=await request("PATCH",own+"/"+doc.id,{...body,html:body.html+"<p>Conclusion</p>",version:doc.version},reLogin.json.accessToken);
    assert.equal(edited.status,200);doc=edited.json;
    doc=(await request("POST",own+"/"+doc.id+"/submit",{version:doc.version,permissionConfirmed:true},reLogin.json.accessToken)).json;
    const audit=app.get(require("../dist/src/admin/admin-audit.service").AdminAuditService), record=audit.record;
    try {
      audit.record=async()=>{throw Error("Deliberate document audit failure")};
      assert.equal((await request("POST",decision,{action:"approve",version:doc.version,reason:"Should roll back"},adminToken)).status,500);
    } finally { audit.record=record; }
    assert.equal((await request("GET","/admin/community-documents/"+doc.id,null,adminToken)).json.document.status,"pending");
    doc=(await request("POST",decision,{action:"approve",version:doc.version,reason:"Internal final review passed"},adminToken)).json;
    assert.equal(doc.status,"published");
    const publicRead=await request("GET","/community/documents/"+doc.id,null,reLogin.json.accessToken);
    assert.equal(publicRead.status,200);assert(publicRead.json.document.html.includes("Conclusion"));
    assert(!("reviewReason" in publicRead.json.document));assert.equal(publicRead.json.history.length,0);
    const published=await request("GET","/community/documents?search="+encodeURIComponent(body.title),null,adminToken);
    assert.equal(published.json.totalElements,1);assert(!("html" in published.json.data[0]));assert(!("reviewReason" in published.json.data[0]));assert(!("authorEmail" in published.json.data[0]));
    assert.equal((await request("PATCH",own+"/"+doc.id,{...body,version:doc.version},reLogin.json.accessToken)).status,409);
    doc=(await request("POST",decision,{action:"archive",version:doc.version,reason:"Withdraw publication for revision"},adminToken)).json;
    assert.equal(doc.status,"archived");assert.equal((await request("GET","/community/documents/"+doc.id,null,reLogin.json.accessToken)).status,404);
    const logs=await request("GET","/admin/audit-logs?action=DOCUMENT_APPROVED&targetId="+doc.id,null,adminToken);assert.equal(logs.json.totalElements,1);
    const self=await request("POST",own,{...body,title:"Self approval test"},adminToken);
    const selfPending=await request("POST",own+"/"+self.json.id+"/submit",{version:self.json.version,permissionConfirmed:true},adminToken);
    assert.equal((await request("POST","/admin/community-documents/"+self.json.id+"/decision",{action:"approve",version:selfPending.json.version,reason:"Cannot approve own"},adminToken)).status,403);
    const races=await Promise.all([
      request("POST","/admin/community-documents/"+self.json.id+"/decision",{action:"request_changes",version:selfPending.json.version,reason:"Review A"},adminToken),
      request("POST","/admin/community-documents/"+self.json.id+"/decision",{action:"archive",version:selfPending.json.version,reason:"Review B"},adminToken)
    ]);
    assert.deepEqual(races.map(row=>row.status).sort(),[200,409]);
  });

  await t.test("Document review, moderation and plan writes reject an administrator whose database authority changed", async () => {
    const documents = app.get(require("../dist/src/community-documents/documents.service").CommunityDocumentsService);
    const reports = app.get(require("../dist/src/moderation/report-store").ReportStore);
    const resources = app.get(require("../dist/src/resources/resources.service").ResourcesService);
    const templateStore = app.get(require("../dist/src/templates/template-store").TEMPLATE_STORE);
    const actor = adminLogin.json.user, owner = reLogin.json.user;
    const draft = await documents.create({ title: "Authority regression", summary: "", categoryId: categories[0].id, html: "<p>Authority test</p>", license: "MIT", attribution: "Test author" }, owner);
    const pending = await documents.submit(draft.id, draft.version, owner);
    const [template] = await pool.query("SELECT id,revision,title FROM templates WHERE id=$1", [createdTplId]);
    const [report] = await pool.query("INSERT INTO template_reports(template_id,reporter_id,template_revision,reported_title,reason_code,description) VALUES($1,$2,$3,$4,'other','Authority test') RETURNING id,version", [template.id, regularUserId, template.revision, template.title]);
    const reason = "An admin request passed the HTTP guard before its role changed";
    const beforePlan = await pool.query("SELECT * FROM resource_account_plans WHERE user_id=$1", [regularUserId]);
    for (const change of ["role='user'", "is_active=false"]) {
      await pool.query("UPDATE users SET " + change + " WHERE id=$1", [adminUserId]);
      try {
        await assert.rejects(documents.decide(pending.id, { action: "approve", version: pending.version, reason }, actor, {}), error => error.getStatus() === 403);
        await assert.rejects(reports.decide(report.id, { action: "dismiss", reportVersion: report.version, reason }, `"template:${template.id}:${template.revision}"`, actor), error => error.getStatus() === 403);
        const tag = `"template:${template.id}:${template.revision}"`;
        await assert.rejects(templateStore.update(template.id, { title: "Stale admin change" }, tag, actor), error => error.getStatus() === 403);
        await assert.rejects(templateStore.remove(template.id, tag, actor), error => error.getStatus() === 403);
        await assert.rejects(resources.updatePlan(regularUserId, { plan: "premium", reason }, actor), error => error.getStatus() === 403);
      } finally { await pool.query("UPDATE users SET role='admin',is_active=true WHERE id=$1", [adminUserId]); }
    }
    assert.equal((await pool.query("SELECT status FROM community_documents WHERE id=$1", [pending.id]))[0].status, "pending");
    assert.equal((await pool.query("SELECT state FROM template_reports WHERE id=$1", [report.id]))[0].state, "open");
    assert.deepEqual(await pool.query("SELECT * FROM resource_account_plans WHERE user_id=$1", [regularUserId]), beforePlan);
    await pool.query("DELETE FROM template_reports WHERE id=$1", [report.id]);
  });

  await t.test("Moderation and resource plan changes include target and reason in central audit; an audit failure rolls back all writes", async () => {
    const [template] = await pool.query("SELECT id,revision,title FROM templates WHERE id=$1", [createdTplId]);
    const [report] = await pool.query("INSERT INTO template_reports(template_id,reporter_id,template_revision,reported_title,reason_code,description) VALUES($1,$2,$3,$4,'spam','Atomic audit test') RETURNING id,version", [template.id, regularUserId, template.revision, template.title]);
    const path = `/admin/reports/${report.id}/decision`, planPath = `/admin/resource-plans/${regularUserId}`;
    const reason = "Verified administrative decision";
    const input = { action: "dismiss", reportVersion: report.version, reason };
    const headers = { "If-Match": `"template:${template.id}:${template.revision}"` };
    const beforeLegacy = (await pool.query("SELECT count(*)::int count FROM resource_access_events WHERE user_id=$1 AND action='plan.changed'", [adminUserId]))[0].count;
    await pool.query("CREATE FUNCTION test_reject_admin_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('REPORT_DISMISSED','RESOURCE_PLAN_UPDATED') THEN RAISE EXCEPTION 'Deliberate central audit failure'; END IF; RETURN NEW; END $$");
    await pool.query("CREATE TRIGGER test_reject_admin_audit BEFORE INSERT ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION test_reject_admin_audit()");
    try {
      assert.equal((await request("POST", path, input, adminToken, headers)).status, 500);
      assert.equal((await request("PATCH", planPath, { plan: "premium", reason }, adminToken)).status, 500);
    } finally {
      await pool.query("DROP TRIGGER test_reject_admin_audit ON admin_audit_logs");
      await pool.query("DROP FUNCTION test_reject_admin_audit()");
    }
    const [unchanged] = await pool.query("SELECT state,version FROM template_reports WHERE id=$1", [report.id]);
    assert.equal(unchanged.state, "open"); assert.equal(unchanged.version, report.version);
    assert.equal((await pool.query("SELECT id FROM moderation_audit WHERE report_id=$1", [report.id])).length, 0);
    assert.equal((await pool.query("SELECT user_id FROM resource_account_plans WHERE user_id=$1", [regularUserId])).length, 0);
    assert.equal((await pool.query("SELECT count(*)::int count FROM resource_access_events WHERE user_id=$1 AND action='plan.changed'", [adminUserId]))[0].count, beforeLegacy);
    assert.equal((await request("POST", path, input, adminToken, headers)).status, 200);
    const logged = await request("GET", `/admin/audit-logs?action=REPORT_DISMISSED&targetId=${report.id}`, null, adminToken);
    assert.equal(logged.json.totalElements, 1);
    assert.equal(logged.json.data[0].reason, reason);
    assert.equal(logged.json.data[0].metadata.templateId, template.id);
    assert(logged.json.data[0].userAgent, "central audit includes request context");
    assert.equal((await request("PATCH", planPath, { plan: "premium", reason: " " }, adminToken)).status, 400);
    assert.equal((await request("PATCH", planPath, { plan: "premium", reason }, adminToken)).status, 200);
    const planLog = await request("GET", `/admin/audit-logs?action=RESOURCE_PLAN_UPDATED&targetId=${regularUserId}`, null, adminToken);
    assert.equal(planLog.json.totalElements, 1);
    assert.equal(planLog.json.data[0].reason, reason);
    assert.equal(planLog.json.data[0].metadata.current.plan, "premium");
    assert.equal(planLog.json.data[0].metadata.previous.plan, "free");
  });

  await t.test("Concurrent plan updates serialize with accurate prior-state audit", async () => {
    const email = "plan-race-" + randomUUID() + "@example.test";
    assert.equal((await request("POST", "/auth/register", { email, password: regularPass })).status, 201);
    const [target] = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
    const path = `/admin/resource-plans/${target.id}`, reason = "Concurrent plan changes";
    const results = await Promise.all([request("PATCH", path, { plan: "premium", reason }, adminToken), request("PATCH", path, { plan: "blocked", reason }, adminToken)]);
    assert.deepEqual(results.map(row => row.status), [200, 200]);
    const logs = await pool.query("SELECT metadata FROM admin_audit_logs WHERE action='RESOURCE_PLAN_UPDATED' AND target_id=$1", [target.id]);
    assert.equal(logs.length, 2);
    const first = logs.find(row => row.metadata.previous.plan === "free"), second = logs.find(row => row !== first);
    assert(first); assert.equal(second.metadata.previous.plan, first.metadata.current.plan);
    const [plan] = await pool.query("SELECT plan FROM resource_account_plans WHERE user_id=$1", [target.id]);
    assert.equal(plan.plan, second.metadata.current.plan);
  });

  await t.test("Protected resource writes roll back on audit failure and deny a stale admin bypass", async () => {
    const service = app.get(require("../dist/src/resources/resources.service").ResourcesService), original = service.audit;
    const owner = reLogin.json.user, actor = adminLogin.json.user;
    const title = "Atomic protected resource " + randomUUID();
    const document = await service.create({ title, html: "<p>Shared resource</p>", access: "shared" }, owner);
    await service.grant(document.id, adminUserId, owner);
    const [recipient] = await pool.query("SELECT id FROM users WHERE id<>$1 AND id<>$2 AND deleted_at IS NULL AND is_active=true LIMIT 1", [owner.id, actor.id]);
    const [{ count: before }] = await pool.query("SELECT count(*)::int count FROM resource_documents WHERE owner_id=$1", [owner.id]);
    const legacyBefore = (await pool.query("SELECT count(*)::int count FROM resource_access_events WHERE document_id=$1", [document.id]))[0].count;
    try {
      service.audit = async () => { throw new Error("Deliberate protected resource audit failure"); };
      for (const work of [() => service.create({ title: title + " failed", html: "<p>Must roll back</p>", access: "private" }, owner), () => service.grant(document.id, recipient.id, owner), () => service.revoke(document.id, adminUserId, owner), () => service.remove(document.id, owner)]) {
        await assert.rejects(work(), /Deliberate protected resource audit failure/);
      }
    } finally { service.audit = original; }
    assert.equal((await pool.query("SELECT count(*)::int count FROM resource_documents WHERE owner_id=$1", [owner.id]))[0].count, before);
    const grants = await pool.query("SELECT user_id FROM resource_document_grants WHERE document_id=$1", [document.id]);
    assert.deepEqual(grants.map(row => row.user_id), [adminUserId]);
    assert.equal((await pool.query("SELECT deleted_at FROM resource_documents WHERE id=$1", [document.id]))[0].deleted_at, null);
    assert.equal((await pool.query("SELECT count(*)::int count FROM resource_access_events WHERE document_id=$1", [document.id]))[0].count, legacyBefore);
    await pool.query("UPDATE users SET role='user' WHERE id=$1", [adminUserId]);
    try {
      for (const work of [() => service.create({ title: "Stale admin", html: "<p>Denied</p>", access: "private" }, actor), () => service.grant(document.id, recipient.id, actor), () => service.revoke(document.id, adminUserId, actor), () => service.remove(document.id, actor)])
        await assert.rejects(work(), error => error.getStatus() === 403);
    } finally { await pool.query("UPDATE users SET role='admin' WHERE id=$1", [adminUserId]); }
    await service.grant(document.id, recipient.id, actor);
    await service.revoke(document.id, recipient.id, actor);
    await service.remove(document.id, actor);
    const logs = await pool.query("SELECT action,metadata FROM admin_audit_logs WHERE target_type='resource_document' AND target_id=$1 ORDER BY created_at,id", [document.id]);
    assert.deepEqual(logs.map(row => row.action).sort(), ["RESOURCE_DOCUMENT_DELETED", "RESOURCE_DOCUMENT_GRANTED", "RESOURCE_DOCUMENT_REVOKED"]);
    assert(logs.every(row => row.metadata.ownerId === owner.id));
    assert(logs.filter(row => row.action !== "RESOURCE_DOCUMENT_DELETED").every(row => row.metadata.recipientId === recipient.id));
    const retained = await service.create({ title: "Retained resource after account deletion", html: "<p>Retained</p>", access: "private" }, owner);
    await pool.query("UPDATE users SET deleted_at=now() WHERE id=$1", [owner.id]);
    try { await service.remove(retained.id, actor); }
    finally { await pool.query("UPDATE users SET deleted_at=NULL WHERE id=$1", [owner.id]); }
    assert((await pool.query("SELECT deleted_at FROM resource_documents WHERE id=$1", [retained.id]))[0].deleted_at, "An active administrator can still clean up a resource retained after its owner was deleted");
  });

  await t.test("Admin closes the template lifecycle with revision checks, private restores and audited purge", async () => {
    const created=await request("POST","/templates",{title:"Lifecycle sample",slug:"lifecycle-"+randomUUID(),description:"Test lifecycle",categoryId:categories[0].id,isPublic:false,contentJson:{format:"erusentia-template-html",schemaVersion:1,html:"<p>Original</p>"}},adminToken);
    assert.equal(created.status,201,created.text);const id=created.json.id;
    const read=async()=>(await request("GET","/admin/templates/"+id,null,adminToken)).json.template;
    let row=await read();const initial=row.revision;
    const changed=await request("PATCH",`/admin/templates/${id}/metadata`,{revision:row.revision,title:"Lifecycle renamed",description:"Updated metadata",categoryId:categories[1].id,reason:"Organize template"},adminToken);
    assert.equal(changed.status,200,changed.text);row=await read();assert.equal(row.title,"Lifecycle renamed");assert.equal(row.categoryId,categories[1].id);
    assert.equal((await request("POST",`/admin/templates/${id}/trash`,{revision:initial,reason:"Stale request"},adminToken)).status,409);
    assert.equal((await request("POST",`/admin/templates/${id}/force-hide`,{reason:"Stale review restriction",revision:initial},adminToken)).status,409);
    assert.equal((await request("POST",`/admin/templates/${id}/force-hide`,{reason:"Review restriction",revision:row.revision},adminToken)).status,200);row=await read();
    const release=await request("POST",`/admin/templates/${id}/release`,{revision:row.revision,reason:"Restriction resolved"},adminToken);assert.equal(release.status,200,release.text);row=await read();assert.equal(row.moderationState,"visible");assert.equal(row.isPublic,false);
    assert.equal((await request("POST",`/admin/templates/${id}/restore-revision`,{revision:row.revision,sourceRevision:initial,reason:"Restore original"},adminToken)).status,200);row=await read();assert.equal(row.title,"Lifecycle sample");assert.equal(row.isPublic,false);
    const trash=await request("POST",`/admin/templates/${id}/trash`,{revision:row.revision,reason:"Archive unused sample"},adminToken);assert.equal(trash.status,200,trash.text);row=await read();assert(row.deletedAt);
    const list=await request("GET",`/admin/templates?status=trash&search=${created.json.slug}`,null,adminToken);assert.equal(list.json.totalElements,1);
    assert.equal((await request("POST",`/admin/templates/${id}/restore`,{revision:row.revision,reason:"Recover sample"},adminToken)).status,200);row=await read();assert.equal(row.deletedAt,null);assert.equal(row.isPublic,false);
    const audit=app.get(require("../dist/src/admin/admin-audit.service").AdminAuditService),original=audit.record;
    // The canonical writer is also tested below using a database trigger.
    await pool.query("CREATE FUNCTION test_lifecycle_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='TEMPLATE_TRASHED' THEN RAISE EXCEPTION 'Deliberate lifecycle audit failure'; END IF; RETURN NEW; END $$");
    await pool.query("CREATE TRIGGER test_lifecycle_audit_failure BEFORE INSERT ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION test_lifecycle_audit_failure()");
    try{assert.equal((await request("POST",`/admin/templates/${id}/trash`,{revision:row.revision,reason:"Must roll back"},adminToken)).status,500)}finally{await pool.query("DROP TRIGGER test_lifecycle_audit_failure ON admin_audit_logs");await pool.query("DROP FUNCTION test_lifecycle_audit_failure()")}
    assert.equal((await read()).revision,row.revision);assert.equal((await read()).deletedAt,null);
    assert.equal((await request("POST",`/admin/templates/${id}/trash`,{revision:row.revision,reason:"Dispose sample"},adminToken)).status,200);row=await read();
    assert.equal((await request("POST",`/admin/templates/${id}/purge`,{revision:row.revision,reason:"Delete test data permanently",confirmSlug:row.slug,password:"wrong-password"},adminToken)).status,403);
    assert.equal((await request("POST",`/admin/templates/${id}/purge`,{revision:row.revision,reason:"Delete test data permanently",confirmSlug:row.slug,password:regularPass},adminToken)).status,200);
    assert.equal((await request("GET","/admin/templates/"+id,null,adminToken)).status,404);
    const logs=await request("GET",`/admin/audit-logs?targetId=${id}&size=100`,null,adminToken);assert(logs.json.data.some(x=>x.action==="TEMPLATE_PURGED"));assert(logs.json.data.every(x=>x.reason));
  });

  await t.test("Admin resource UI contracts enforce revisions, reasons, ACL invalidation, quotas and safe disposal", async()=>{
    const service=app.get(require("../dist/src/resources/resources.service").ResourcesService);
    const doc=await service.create({title:"Admin managed resource",html:"<h1>Protected</h1>",access:"shared"},reLogin.json.user);
    const url="/admin/resources/documents/"+doc.id;
    let current=(await request("GET",url,null,adminToken)).json.document;assert(current.revision);
    assert.equal((await request("GET","/admin/resources/documents",null,reLogin.json.accessToken)).status,403);
    const grant=await request("POST",url+"/action",{action:"grant",revision:current.revision,reason:"Share with reviewer",userId:adminUserId},adminToken);assert.equal(grant.status,200,grant.text);
    assert.equal((await request("POST",url+"/action",{action:"trash",revision:current.revision,reason:"Stale"},adminToken)).status,409);
    current=(await request("GET",url,null,adminToken)).json.document;
    const grants=await request("GET",url+"/grants",null,adminToken);assert.equal(grants.json.totalElements,1);
    assert.equal((await request("POST",url+"/action",{action:"update",revision:current.revision,title:current.title,access:"private",reason:"Remove shared access"},adminToken)).status,200);
    assert.equal((await request("GET",url+"/grants",null,adminToken)).json.totalElements,0);current=(await request("GET",url,null,adminToken)).json.document;
    assert.equal((await request("POST",url+"/action",{action:"trash",revision:current.revision,reason:"Retire resource"},adminToken)).status,200);current=(await request("GET",url,null,adminToken)).json.document;
    const trash=await request("GET","/admin/resources/documents?status=trash",null,adminToken);assert(trash.json.data.some(x=>x.id===doc.id));
    assert.equal((await request("POST",url+"/action",{action:"restore",revision:current.revision,reason:"Recover private draft"},adminToken)).status,200);current=(await request("GET",url,null,adminToken)).json.document;assert.equal(current.access,"private");assert.equal(current.deletedAt,null);
    const accountPath="/admin/resources/accounts/"+regularUserId;let account=(await request("GET",accountPath,null,adminToken)).json;
    const planInput={plan:"premium",revision:account.plan.revision,reason:"Set reviewed limits",dailyLimit:7,documentLimit:10,retainedBytesLimit:1024};
    const plan=await request("PATCH",accountPath,planInput,adminToken);assert.equal(plan.status,200,plan.text);
    assert.equal((await request("PATCH",accountPath,planInput,adminToken)).status,409);
    account=(await request("GET",accountPath,null,adminToken)).json;assert.equal(account.limits.dailyLimit,7);assert.equal(account.limits.retainedBytes,1024);
    const usage=await request("GET","/admin/resources/usage",null,adminToken);assert.equal(usage.status,200);assert(usage.json.documents.total>=1);
    assert.equal((await request("POST",url+"/action",{action:"trash",revision:current.revision,reason:"Dispose resource"},adminToken)).status,200);current=(await request("GET",url,null,adminToken)).json.document;
    assert.equal((await request("POST",url+"/purge",{action:"purge",revision:current.revision,reason:"Dispose permanently",confirmTitle:current.title,password:regularPass},adminToken)).status,200);assert.equal((await request("GET",url,null,adminToken)).status,404);
    const logs=await request("GET",`/admin/audit-logs?targetId=${doc.id}&size=100`,null,adminToken);assert(logs.json.data.some(x=>x.action==="RESOURCE_DOCUMENT_PURGED"));
  });

  await t.test("Category transfer previews exact versions and moves templates/documents atomically with per-record audit",async()=>{
    const category=async(label)=>{const slug=label+'-'+randomUUID();const r=await request('POST','/admin/categories',{name:slug,slug,displayOrder:1,reason:'Prepare category transfer'},adminToken);assert.equal(r.status,201,r.text);return r.json};
    const source=await category('transfer-source'),target=await category('transfer-target');
    const tpl=await request('POST','/templates',{title:'Transfer template',slug:'transfer-'+randomUUID(),description:'Category transfer test',categoryId:source.id,isPublic:false,contentJson:{format:'erusentia-template-html',schemaVersion:1,html:'<p>Transfer</p>'}},adminToken);assert.equal(tpl.status,201,tpl.text);
    const doc=await request('POST','/account/community-documents',{title:'Transfer document',summary:'',categoryId:source.id,html:'<p>Transfer document</p>',license:'MIT',attribution:'Test author'},reLogin.json.accessToken);assert.equal(doc.status,201,doc.text);
    const path=`/admin/categories/${source.id}`;
    const preview=()=>request('POST',path+'/transfer-preview',{targetCategoryId:target.id},adminToken);
    const before=await preview();assert.equal(before.json.templates,1);assert.equal(before.json.documents,1);
    assert.equal((await request('PATCH',`/admin/templates/${tpl.json.id}/metadata`,{revision:tpl.json.revision,title:'Transfer template revised',description:'New metadata',categoryId:source.id,reason:'Change after preview'},adminToken)).status,200);
    const submit=(token)=>request('POST',path+'/transfer',{targetCategoryId:target.id,previewToken:token,reason:'Merge categories'},adminToken);
    assert.equal((await submit(before.json.previewToken)).status,409);
    const current=await preview();
    await pool.query("CREATE FUNCTION test_category_transfer_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='DOCUMENT_CATEGORY_TRANSFERRED' THEN RAISE EXCEPTION 'Deliberate category transfer audit failure'; END IF; RETURN NEW; END $$");
    await pool.query("CREATE TRIGGER test_category_transfer_audit BEFORE INSERT ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION test_category_transfer_audit()");
    try{assert.equal((await submit(current.json.previewToken)).status,500)}finally{await pool.query("DROP TRIGGER test_category_transfer_audit ON admin_audit_logs");await pool.query("DROP FUNCTION test_category_transfer_audit()")}
    assert.equal((await pool.query('SELECT category_id FROM templates WHERE id=$1',[tpl.json.id]))[0].category_id,source.id);
    assert.equal((await pool.query('SELECT category_id FROM community_documents WHERE id=$1',[doc.json.id]))[0].category_id,source.id);
    const moved=await submit(current.json.previewToken);assert.equal(moved.status,200,moved.text);assert.equal(moved.json.templates,1);assert.equal(moved.json.documents,1);
    assert.equal((await pool.query('SELECT category_id FROM templates WHERE id=$1',[tpl.json.id]))[0].category_id,target.id);
    assert.equal((await pool.query('SELECT category_id FROM community_documents WHERE id=$1',[doc.json.id]))[0].category_id,target.id);
    const logs=await pool.query("SELECT metadata FROM admin_audit_logs WHERE metadata->>'batchId'=$1",[moved.json.batchId]);assert.equal(logs.length,2);assert(logs.every(row=>row.metadata.previousCategoryId===source.id&&row.metadata.categoryId===target.id));
    assert.equal((await request('DELETE',path,{reason:'Remove now-unused source'},adminToken)).status,200);
  });

  await t.test("Document snapshots restore privately and report decisions check both versions and roll back on audit failure", async () => {
    const own = "/account/community-documents", authorToken = reLogin.json.accessToken;
    const body = {title:"Document report " + randomUUID(),summary:"Review history",categoryId:categories[0].id,html:"<h1>Original snapshot</h1>",license:"MIT",attribution:"Test author"};
    let result = await request("POST",own,body,authorToken); assert.equal(result.status,201,result.text); let doc=result.json;
    const id=doc.id, adminPath="/admin/community-documents/"+id;
    result=await request("PATCH",own+"/"+id,{...body,version:doc.version,html:"<h1>Updated snapshot</h1>"},authorToken);assert.equal(result.status,200,result.text);doc=result.json;
    const history=await request("GET",adminPath+"/revisions?page=1&size=1",null,adminToken);assert.equal(history.json.totalElements,2);assert.equal(history.json.data.length,1);
    const snapshot=await request("GET",adminPath+"/revision?version=1",null,adminToken);assert.equal(snapshot.json.snapshot.html,body.html);
    assert.equal((await request("GET",adminPath+"/revision?version=0",null,adminToken)).status,400);
    assert.equal((await request("GET",adminPath+"/revisions",null,authorToken)).status,403);
    const submit=await request("POST",own+"/"+id+"/submit",{version:doc.version,permissionConfirmed:true},authorToken);assert.equal(submit.status,200,submit.text);doc=submit.json;
    result=await request("POST",adminPath+"/decision",{action:"approve",version:doc.version,reason:"Review publication"},adminToken);assert.equal(result.status,200,result.text);doc=result.json;
    const reportBody={reasonCode:"copyright",description:"Original attribution needs checking"};
    assert.equal((await request("POST","/community/documents/"+id+"/reports",reportBody)).status,401);
    result=await request("POST","/community/documents/"+id+"/reports",reportBody,authorToken);assert.equal(result.status,202,result.text);const report=result.json;
    const duplicate=await request("POST","/community/documents/"+id+"/reports",reportBody,authorToken);assert.equal(duplicate.json.id,report.id);
    const read=await request("GET","/admin/document-reports/"+report.id,null,adminToken);assert.equal(read.json.report.documentVersion,doc.version);assert.equal(read.json.reportedSnapshot.html,doc.html);
    assert.equal((await request("GET","/admin/document-reports?search="+encodeURIComponent(body.title),null,adminToken)).json.totalElements,1);
    const decision={reportVersion:1,documentVersion:doc.version,action:"archive",reason:"Content requires correction"}, decisionPath="/admin/document-reports/"+report.id+"/decision";
    assert.equal((await request("POST",decisionPath,{...decision,documentVersion:1},adminToken)).status,409);
    await pool.query(`CREATE FUNCTION test_document_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='DOCUMENT_REPORT_ARCHIVED' THEN RAISE EXCEPTION 'Test audit failure'; END IF; RETURN NEW; END $$`);
    await pool.query("CREATE TRIGGER test_document_audit_fail BEFORE INSERT ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION test_document_audit_fail()");
    try { assert.equal((await request("POST",decisionPath,decision,adminToken)).status,500); }
    finally { await pool.query("DROP TRIGGER test_document_audit_fail ON admin_audit_logs");await pool.query("DROP FUNCTION test_document_audit_fail()"); }
    const unchanged=await request("GET","/admin/document-reports/"+report.id,null,adminToken);assert.equal(unchanged.json.report.state,"open");assert.equal(unchanged.json.document.status,"published");assert.equal(unchanged.json.document.version,doc.version);
    assert.equal((await request("POST",decisionPath,decision,adminToken)).status,200);
    assert.equal((await request("GET","/community/documents/"+id,null,authorToken)).status,404);
    doc=(await request("GET",adminPath,null,adminToken)).json.document;
    const restored=await request("POST",adminPath+"/restore-revision",{version:doc.version,sourceVersion:1,reason:"Recover original for author review"},adminToken);assert.equal(restored.status,200,restored.text);assert.equal(restored.json.status,"draft");
    const restoredDoc=(await request("GET",own+"/"+id,null,authorToken)).json.document;assert.equal(restoredDoc.html,body.html);assert.equal(restoredDoc.status,"draft");
    assert.equal((await request("POST",adminPath+"/restore-revision",{version:doc.version,sourceVersion:1,reason:"Stale request"},adminToken)).status,409);
  });

  await t.test("Deleted accounts are inspectable and restore as suspended users without reviving old authority or sessions", async () => {
    const email="deleted-"+randomUUID()+"@example.test";
    assert.equal((await request("POST","/auth/register",{email,password:regularPass})).status,201);
    const login=await request("POST","/auth/login",{email,password:regularPass}), userId=login.json.user.id;
    await pool.query("UPDATE users SET deleted_at=now(),role='admin' WHERE id=$1",[userId]);
    const [deleted]=await pool.query("SELECT deleted_at FROM users WHERE id=$1",[userId]);
    const list=await request("GET","/admin/accounts?status=deleted&search="+encodeURIComponent(email),null,adminToken);assert.equal(list.json.totalElements,1);assert(list.json.data[0].deletedAt);
    assert.equal((await request("GET","/admin/accounts?search="+encodeURIComponent(email),null,adminToken)).json.totalElements,0);
    assert.equal((await request("GET","/admin/accounts/"+userId,null,adminToken)).status,200);
    const input={reason:"Restore verified legacy profile",expectedDeletedAt:deleted.deleted_at.toISOString()};
    assert.equal((await request("POST","/admin/accounts/"+userId+"/restore",{...input,expectedDeletedAt:'2020-01-01T00:00:00Z'},adminToken)).status,409);
    assert.equal((await request("POST","/admin/accounts/"+userId+"/restore",input,reLogin.json.accessToken)).status,403);
    const restored=await request("POST","/admin/accounts/"+userId+"/restore",input,adminToken);assert.equal(restored.status,200,restored.text);
    const [user]=await pool.query("SELECT role,is_active,deleted_at FROM users WHERE id=$1",[userId]);assert.deepEqual(user,{role:'user',is_active:false,deleted_at:null});
    assert.equal((await pool.query("SELECT id FROM auth_refresh_sessions WHERE user_id=$1 AND revoked_at IS NULL",[userId])).length,0);
    assert.equal((await request("POST","/auth/login",{email,password:regularPass})).status,401);
    assert.equal((await request("POST","/admin/accounts/"+userId+"/restore",input,adminToken)).status,409);
  });

  await t.test("Retention cleanup previews only old trash, rechecks versions, preserves active content and rolls back on audit failure", async () => {
    const ids=[];
    for(const title of ['Old trash','Recent trash','Active retained']) {
      const result=await app.get(require('../dist/src/resources/resources.service').ResourcesService).create({title,html:'<h1>'+title+'</h1>',access:'private'},adminLogin.json.user);ids.push(result.id);
    }
    await pool.query("UPDATE resource_documents SET deleted_at=now()-interval '31 days' WHERE id=$1",[ids[0]]);
    await pool.query("UPDATE resource_documents SET deleted_at=now()-interval '2 days' WHERE id=$1",[ids[1]]);
    const scope={ownerId:adminUserId},previewPath='/admin/resources/retention/preview',commitPath='/admin/resources/retention/commit';
    let preview=await request('POST',previewPath,scope,adminToken);assert.equal(preview.status,200,preview.text);assert.equal(preview.json.selected,1);assert.equal(preview.json.rows[0].id,ids[0]);
    const input=()=>({...scope,cutoff:preview.json.cutoff,previewToken:preview.json.previewToken,confirmText:'XÓA VĨNH VIỄN',password:regularPass,reason:'Remove expired trash after owner review'});
    assert.equal((await request('POST',commitPath,{...input(),password:'incorrect'},adminToken)).status,403);
    assert.equal((await request('POST',commitPath,{...input(),cutoff:new Date().toISOString()},adminToken)).status,400);
    await pool.query("UPDATE resource_documents SET title='Changed old trash' WHERE id=$1",[ids[0]]);
    assert.equal((await request('POST',commitPath,input(),adminToken)).status,409);
    preview=await request('POST',previewPath,scope,adminToken);
    await pool.query(`CREATE FUNCTION test_retention_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='RESOURCE_DOCUMENT_PURGED' THEN RAISE EXCEPTION 'Test audit failure'; END IF; RETURN NEW; END $$`);
    await pool.query("CREATE TRIGGER test_retention_audit_fail BEFORE INSERT ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION test_retention_audit_fail()");
    try { assert.equal((await request('POST',commitPath,input(),adminToken)).status,500); }
    finally { await pool.query('DROP TRIGGER test_retention_audit_fail ON admin_audit_logs');await pool.query('DROP FUNCTION test_retention_audit_fail()'); }
    assert.equal((await pool.query('SELECT id FROM resource_documents WHERE id=ANY($1::uuid[])',[ids])).length,3);
    const committed=await request('POST',commitPath,input(),adminToken);assert.equal(committed.status,200,committed.text);assert.equal(committed.json.deleted,1);assert(committed.json.bytes>0);
    assert.equal((await pool.query('SELECT id FROM resource_documents WHERE id=ANY($1::uuid[])',[ids])).length,2);
    assert.equal((await request('POST',commitPath,input(),adminToken)).status,409);
    const [audit]=await pool.query("SELECT metadata FROM admin_audit_logs WHERE action='RESOURCE_DOCUMENT_PURGED' AND target_id=$1",[ids[0]]);assert.equal(audit.metadata.batchId,committed.json.batchId);
  });

});
