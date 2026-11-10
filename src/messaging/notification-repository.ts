import { Pool } from "pg";
import type { createClient } from "redis";
import type { TemplatePublishedEvent } from "./template-notification-event";
import { TEMPLATE_VERSION_PUBLISHED } from "./rabbit";

export class PermanentNotificationError extends Error {}

export class NotificationRepository {
  constructor(readonly pool: Pool) {}

  async dispatch(
    publish: (event: TemplatePublishedEvent, eventId: string) => Promise<void>,
    limit = 10,
  ): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const rows = await client.query(
        "SELECT id, payload FROM message_outbox WHERE published_at IS NULL AND event_type=$1 ORDER BY created_at, id LIMIT $2 FOR UPDATE SKIP LOCKED",
        [TEMPLATE_VERSION_PUBLISHED, limit],
      );
      for (const row of rows.rows) {
        await publish(row.payload, row.id);
        await client.query(
          "UPDATE message_outbox SET published_at=CURRENT_TIMESTAMP WHERE id=$1",
          [row.id],
        );
      }
      await client.query("COMMIT");
      return rows.rowCount ?? 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deliver(
    event: TemplatePublishedEvent,
    eventId: string,
    redis?: ReturnType<typeof createClient>,
  ): Promise<{ recipients: number; inserted: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Serialize concurrent deliveries for the exact template revision
      const lockKey = `${event.templateId}:${event.revision}`;
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 5))",
        [lockKey],
      );

      // Verify that the template still exists and is public
      const templateCheck = await client.query(
        "SELECT is_public, moderation_state FROM templates WHERE id=$1 AND deleted_at IS NULL",
        [event.templateId],
      );
      if (
        !templateCheck.rowCount ||
        !templateCheck.rows[0].is_public ||
        templateCheck.rows[0].moderation_state === "hidden"
      ) {
        await client.query("COMMIT");
        return { recipients: 0, inserted: 0 };
      }

      // Query followers of this template
      const followersResult = await client.query<{ user_id: string }>(
        "SELECT user_id FROM template_follows WHERE template_id=$1",
        [event.templateId],
      );
      const followers = followersResult.rows.map((r) => r.user_id);

      if (followers.length === 0) {
        await client.query("COMMIT");
        return { recipients: 0, inserted: 0 };
      }

      let totalInserted = 0;
      const invalidateRecipients = new Set<string>();
      const title = `Mẫu "${event.title}" vừa phát hành phiên bản mới ${event.version}`;
      const payloadJson = JSON.stringify({
        templateId: event.templateId,
        revision: event.revision,
        version: event.version,
        slug: event.slug,
        occurredAt: event.occurredAt,
      });

      // Insert notifications in batches of 100 with ON CONFLICT DO NOTHING
      const batchSize = 100;
      for (let i = 0; i < followers.length; i += batchSize) {
        const batch = followers.slice(i, i + batchSize);
        for (const recipientId of batch) {
          const res = await client.query(
            `INSERT INTO notifications (
              recipient_id, actor_id, type, title, payload,
              template_id, revision, event_id, is_read, created_at
            )
            VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, FALSE, CURRENT_TIMESTAMP)
            ON CONFLICT (recipient_id, template_id, revision)
            WHERE template_id IS NOT NULL AND revision IS NOT NULL
            DO NOTHING
            RETURNING recipient_id`,
            [
              recipientId,
              event.actorId,
              "template.version_published",
              title,
              payloadJson,
              event.templateId,
              event.revision,
              eventId,
            ],
          );
          if (res.rowCount && res.rowCount > 0) {
            totalInserted += res.rowCount;
            invalidateRecipients.add(recipientId);
          }
        }
      }

      await client.query("COMMIT");
      // Redis is a cache: only invalidate after durable database delivery.
      if (redis?.isOpen) {
        await Promise.all([...invalidateRecipients].map(id => redis.del(`eru:unread_count:${id}`).catch(() => {})));
      }
      return { recipients: followers.length, inserted: totalInserted };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

