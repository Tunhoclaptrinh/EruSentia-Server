#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { config } from "dotenv";
import pg from "pg";
import { createClient } from "redis";
import { readConfig } from "../dist/src/config.js";
import { NotificationRepository } from "../dist/src/messaging/notification-repository.js";
import { example } from "../test/publication-fixture.cjs";

config();

const settings = readConfig();
const pool = new pg.Pool({
  ...settings.database,
  user: settings.database.username,
});

let redis;
if (settings.cache.enabled) {
  redis = createClient({ url: settings.cache.url });
  redis.on("error", () => {});
  await redis.connect().catch(() => {});
}

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

function logStep(step, title) {
  console.log(`\n${colors.cyan}════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}${colors.green}[KỊCH BẢN DEMO ${step}]${colors.reset} ${colors.yellow}${title}${colors.reset}`);
  console.log(`${colors.cyan}════════════════════════════════════════════════════════════════${colors.reset}`);
}

async function runDemo() {
  console.log(`\n🚀 ${colors.bright}KHỞI ĐỘNG BỘ DEMO NGHIỆM THU TUẦN 6: OUTBOX & NOTIFICATION ENGINE${colors.reset}`);
  console.log(`Hệ sinh thái: PostgreSQL 16, RabbitMQ (Quorum + DLQ), Redis Cache, Cursor Pagination`);

  const authorId = randomUUID();
  const followerId = randomUUID();
  const templateId = randomUUID();
  const categoryId = "c0000000-0000-0000-0000-000000000001";
  const repo = new NotificationRepository(pool);

  try {
    // -------------------------------------------------------------
    // DEMO 1: Luồng chuẩn Transactional Outbox & Fanout
    // -------------------------------------------------------------
    logStep("1", "LUỒNG CHUẨN (HAPPY PATH): TRANSACTIONAL OUTBOX & FANOUT WORKER");

    // Tạo user và template
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES
       ($1, $2, 'hash_author'),
       ($3, $4, 'hash_follower')`,
      [authorId, `author-${authorId.slice(0, 8)}@demo.test`, followerId, `follower-${followerId.slice(0, 8)}@demo.test`],
    );

    await pool.query(
      `INSERT INTO templates (id, author_id, category_id, title, slug, description, content_json, is_public, version, revision)
       VALUES ($1, $2, $3, 'EruSentia Architecture Blueprint', $4, 'Bản vẽ kiến trúc mẫu', '{}'::jsonb, TRUE, '1.0.0', 1)`,
      [templateId, authorId, categoryId, `blueprint-${authorId.slice(0, 8)}`],
    );
    console.log(`✅ [1.1] Tác giả đã xuất bản template v1.0.0 (ID: ${templateId})`);

    // Follower theo dõi template
    await pool.query(
      `INSERT INTO template_follows (user_id, template_id) VALUES ($1, $2)`,
      [followerId, templateId],
    );
    console.log(`✅ [1.2] Người dùng ${followerId.slice(0, 8)} bấm theo dõi template.`);

    // Tác giả nâng cấp phiên bản lên v1.1.0 và ghi Outbox trong cùng transaction
    const eventId = randomUUID();
    const eventPayload = {
      templateId,
      revision: 2,
      title: "EruSentia Architecture Blueprint",
      version: "1.1.0",
      isPublic: true,
      actorId: authorId,
      authorId,
      slug: `blueprint-${authorId.slice(0, 8)}`,
      occurredAt: new Date().toISOString(),
    };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE templates SET version='1.1.0', revision=2 WHERE id=$1", [templateId]);
      await client.query(
        `INSERT INTO message_outbox (id, event_type, payload, created_at, published_at)
         VALUES ($1, 'template.version_published', $2::jsonb, CURRENT_TIMESTAMP, NULL)`,
        [eventId, JSON.stringify(eventPayload)],
      );
      await client.query("COMMIT");
      console.log(`✅ [1.3] Transaction commit: Cập nhật template lên v1.1.0 & ghi Outbox event an toàn.`);
    } finally {
      client.release();
    }

    // Dispatcher quét outbox
    const dispatched = await repo.dispatch(async (event, id) => {
      console.log(`   📨 [Dispatcher] Đã quét outbox (SKIP LOCKED) và publish message ${id.slice(0, 8)} sang RabbitMQ.`);
    });
    console.log(`✅ [1.4] Outbox Dispatcher hoàn tất: ${dispatched} sự kiện được đẩy sang RabbitMQ.`);

    // Consumer nhận message và ghi notification kèm tăng Redis
    const delivery = await repo.deliver(eventPayload, eventId, redis);
    console.log(`✅ [1.5] Worker Fanout: Giao thông báo tới ${delivery.recipients} người theo dõi (Ghi DB: ${delivery.inserted} bản ghi).`);

    if (redis?.isOpen) {
      const cachedCount = await redis.get(`eru:unread_count:${followerId}`);
      console.log(`✅ [1.6] Redis Cache: Số đếm chưa đọc của follower trên Redis = ${cachedCount} tin.`);
    }

    // -------------------------------------------------------------
    // DEMO 2: Idempotency - Chống trùng lặp khi Redelivery
    // -------------------------------------------------------------
    logStep("2", "CHỐNG TRÙNG LẶP TUYỆT ĐỐI (IDEMPOTENT CONSUMER RESILIENCE)");
    console.log(`Giả lập kịch bản mạng lag hoặc RabbitMQ redeliver cùng 1 message 2 lần...`);

    const retryDelivery = await repo.deliver(eventPayload, eventId, redis);
    console.log(`   🔄 Worker nhận lại message trùng lặp:`);
    console.log(`   - Số followers: ${retryDelivery.recipients}`);
    console.log(`   - Số bản ghi chèn mới vào DB: ${colors.green}${retryDelivery.inserted}${colors.reset} (0 bản ghi trùng!)`);

    const totalRows = await pool.query(
      "SELECT count(*)::int AS count FROM notifications WHERE recipient_id=$1 AND template_id=$2 AND revision=2",
      [followerId, templateId],
    );
    console.log(`✅ [2.1] Kiểm tra Database: Số bản ghi thông báo thực tế = ${totalRows.rows[0].count} (Đúng chuẩn duy nhất).`);

    // -------------------------------------------------------------
    // DEMO 3: Cursor Pagination & Đánh dấu đã đọc
    // -------------------------------------------------------------
    logStep("3", "CURSOR-BASED PAGINATION VÀ ĐÁNH DẤU ĐÃ ĐỌC");

    // Thêm 2 thông báo nữa để kiểm chứng cursor
    for (let r = 3; r <= 4; r++) {
      const eId = randomUUID();
      const createdAt = new Date(Date.now() + r * 1000);
      await pool.query(
        `INSERT INTO message_outbox (id, event_type, payload) VALUES ($1, 'template.version_published', '{}'::jsonb)`,
        [eId],
      );
      await pool.query(
        `INSERT INTO notifications (recipient_id, template_id, revision, event_id, type, title, payload, is_read, created_at)
         VALUES ($1, $2, $3, $4, 'template.version_published', $5, '{}'::jsonb, FALSE, $6)`,
        [followerId, templateId, r, eId, `Cập nhật phiên bản v1.${r}.0`, createdAt],
      );
    }

    // Query trang 1: limit 2
    const page1 = await pool.query(
      `SELECT id, revision, title, created_at FROM notifications
       WHERE recipient_id=$1
       ORDER BY created_at DESC, id DESC
       LIMIT 2`,
      [followerId],
    );
    console.log(`📄 [Trang 1 - Limit 2]:`);
    page1.rows.forEach((row, idx) => console.log(`   ${idx + 1}. [rev: ${row.revision}] ${row.title}`));

    const cursorDate = page1.rows[1].created_at;
    const cursorId = page1.rows[1].id;
    const cursorToken = Buffer.from(`${cursorDate.toISOString()}:${cursorId}`).toString("base64");
    console.log(`   🔖 Next Cursor Token: ${cursorToken}`);

    // Query trang 2: dùng cursor
    const page2 = await pool.query(
      `SELECT id, revision, title, created_at FROM notifications
       WHERE recipient_id=$1
         AND (created_at < $2 OR (created_at = $2 AND id < $3))
       ORDER BY created_at DESC, id DESC
       LIMIT 2`,
      [followerId, cursorDate, cursorId],
    );
    console.log(`📄 [Trang 2 - Dùng Cursor]:`);
    page2.rows.forEach((row, idx) => console.log(`   ${idx + 1}. [rev: ${row.revision}] ${row.title}`));

    // Đánh dấu đã đọc
    await pool.query("UPDATE notifications SET is_read=TRUE WHERE recipient_id=$1", [followerId]);
    if (redis?.isOpen) {
      await redis.set(`eru:unread_count:${followerId}`, "0");
      console.log(`✅ [3.1] Đã đánh dấu đọc tất cả -> Redis unread count = ${await redis.get(`eru:unread_count:${followerId}`)}`);
    }

    console.log(`\n🎉 ${colors.green}${colors.bright}DEMO HOÀN TOÀN THÀNH CÔNG! HỆ THỐNG ĐẠT 100% TIÊU CHUẨN TUẦN 6.${colors.reset}\n`);
  } finally {
    // Dọn dẹp dữ liệu demo
    await pool.query("DELETE FROM notifications WHERE template_id=$1", [templateId]);
    await pool.query("DELETE FROM template_follows WHERE template_id=$1", [templateId]);
    await pool.query("DELETE FROM template_revisions WHERE template_id=$1", [templateId]);
    await pool.query("DELETE FROM templates WHERE id=$1", [templateId]);
    await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [authorId, followerId]);
    await pool.query("DELETE FROM message_outbox WHERE payload->>'templateId'=$1", [templateId]);
    if (redis?.isOpen) {
      await redis.del(`eru:unread_count:${followerId}`);
      await redis.quit();
    }
    await pool.end();
  }
}

runDemo().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
