require("dotenv").config();
const test = require("node:test");
const week6Database = require("./week6-database.cjs");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const { readConfig } = require("../dist/src/config");
const {
  NotificationRepository,
} = require("../dist/src/messaging/notification-repository");

test("Notification outbox dispatch, worker fanout, idempotency & cursor pagination", week6Database, async (t) => {
  const settings = readConfig();
  const pool = new Pool({
    ...settings.database,
    user: settings.database.username,
  });
  t.after(() => pool.end());

  const repo = new NotificationRepository(pool);

  // Setup test users & template
  const authorId = randomUUID();
  const follower1Id = randomUUID();
  const follower2Id = randomUUID();
  const templateId = randomUUID();
  const categoryId = "c0000000-0000-0000-0000-000000000001";

  // Create test records in database
  await pool.query(
    `INSERT INTO users (id, email, password_hash) VALUES
     ($1, $2, 'hash1'),
     ($3, $4, 'hash2'),
     ($5, $6, 'hash3')`,
    [
      authorId, `author-${authorId}@test.local`,
      follower1Id, `f1-${follower1Id}@test.local`,
      follower2Id, `f2-${follower2Id}@test.local`,
    ],
  );

  await pool.query(
    `INSERT INTO templates (id, author_id, category_id, title, slug, description, content_json, is_public, version, revision)
     VALUES ($1, $2, $3, 'Worker Test Template', $4, 'Test Description', '{}'::jsonb, TRUE, '1.0.0', 1)`,
    [templateId, authorId, categoryId, `worker-slug-${randomUUID()}`],
  );

  // Followers follow the template
  await pool.query(
    `INSERT INTO template_follows (user_id, template_id) VALUES ($1, $3), ($2, $3)`,
    [follower1Id, follower2Id, templateId],
  );

  const eventId = randomUUID();
  const eventPayload = {
    templateId,
    revision: 2,
    title: "Worker Test Template",
    version: "1.1.0",
    isPublic: true,
    actorId: authorId,
    authorId,
    slug: "worker-test-template",
    occurredAt: new Date().toISOString(),
  };

  await t.test("Transactional outbox: record inserted with published_at IS NULL", async () => {
    await pool.query(
      `INSERT INTO message_outbox (id, event_type, payload, created_at, published_at)
       VALUES ($1, 'template.version_published', $2::jsonb, CURRENT_TIMESTAMP, NULL)`,
      [eventId, JSON.stringify(eventPayload)],
    );

    const check = await pool.query(
      "SELECT published_at FROM message_outbox WHERE id=$1",
      [eventId],
    );
    assert.equal(check.rowCount, 1);
    assert.equal(check.rows[0].published_at, null);
  });

  await t.test("Outbox dispatcher marks published_at using SKIP LOCKED", async () => {
    const published = [];
    const count = await repo.dispatch(async (event, id) => {
      published.push({ event, id });
    }, 10);

    assert.ok(count >= 1);
    const matched = published.find((p) => p.id === eventId);
    assert.ok(matched, "Dispatcher must pick up the event");
    assert.equal(matched.event.templateId, templateId);

    const after = await pool.query(
      "SELECT published_at FROM message_outbox WHERE id=$1",
      [eventId],
    );
    assert.notEqual(after.rows[0].published_at, null);
  });

  await t.test("Worker deliver performs fanout to all followers", async () => {
    const result = await repo.deliver(eventPayload, eventId);
    assert.equal(result.recipients, 2);
    assert.equal(result.inserted, 2);

    // Verify rows in notifications table
    const rows = await pool.query(
      "SELECT recipient_id, revision, is_read FROM notifications WHERE template_id=$1 AND revision=2",
      [templateId],
    );
    assert.equal(rows.rowCount, 2);
    const recipients = rows.rows.map((r) => r.recipient_id);
    assert.ok(recipients.includes(follower1Id));
    assert.ok(recipients.includes(follower2Id));
  });

  await t.test("Idempotency: redelivering the same event creates 0 duplicates", async () => {
    // Re-run deliver with the identical template revision
    const result = await repo.deliver(eventPayload, eventId);
    assert.equal(result.recipients, 2);
    assert.equal(result.inserted, 0, "Duplicate delivery must insert 0 rows");

    // Total rows in DB must still be 2, not 4
    const count = await pool.query(
      "SELECT count(*)::int AS count FROM notifications WHERE template_id=$1 AND revision=2",
      [templateId],
    );
    assert.equal(count.rows[0].count, 2);
  });

  await t.test("Cursor pagination: compound (created_at, id) cursor ordering and tie-breaking", async () => {
    // Insert a third notification for follower 1 with a different revision
    const eventId2 = randomUUID();
    await pool.query(
      `INSERT INTO message_outbox (id, event_type, payload) VALUES ($1, 'template.version_published', '{}'::jsonb)`,
      [eventId2],
    );
    await pool.query(
      `INSERT INTO notifications (recipient_id, template_id, revision, event_id, type, title, payload, is_read, created_at)
       VALUES ($1, $2, 3, $3, 'template.version_published', 'Version 3 Update', '{}'::jsonb, FALSE, CURRENT_TIMESTAMP + INTERVAL '1 second')`,
      [follower1Id, templateId, eventId2],
    );

    // Page 1: limit 1
    const page1 = await pool.query(
      `SELECT id, created_at, revision FROM notifications
       WHERE recipient_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [follower1Id],
    );
    assert.equal(page1.rowCount, 1);
    assert.equal(page1.rows[0].revision, 3);

    const cursorDate = page1.rows[0].created_at;
    const cursorId = page1.rows[0].id;

    // Page 2: query with cursor (created_at < cursorDate OR (created_at = cursorDate AND id < cursorId))
    const page2 = await pool.query(
      `SELECT id, created_at, revision FROM notifications
       WHERE recipient_id = $1
         AND (created_at < $2 OR (created_at = $2 AND id < $3))
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [follower1Id, cursorDate, cursorId],
    );
    assert.equal(page2.rowCount, 1);
    assert.equal(page2.rows[0].revision, 2);
    assert.notEqual(page2.rows[0].id, cursorId, "Cursor must not return the same row");
  });

  // Cleanup test artifacts
  await pool.query("DELETE FROM notifications WHERE template_id=$1", [templateId]);
  await pool.query("DELETE FROM template_follows WHERE template_id=$1", [templateId]);
  await pool.query("DELETE FROM template_revisions WHERE template_id=$1", [templateId]);
  await pool.query("DELETE FROM templates WHERE id=$1", [templateId]);
  await pool.query("DELETE FROM users WHERE id IN ($1, $2, $3)", [
    authorId,
    follower1Id,
    follower2Id,
  ]);
  await pool.query("DELETE FROM message_outbox WHERE id=$1 OR payload->>'templateId'=$2", [eventId, templateId]);
});
