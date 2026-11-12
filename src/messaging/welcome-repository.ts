import { Pool } from "pg";
import type { RegistrationEvent } from "./registration-event";

export class PermanentEventError extends Error {}
export interface WelcomeMailer {
  send(event: RegistrationEvent, email: string): Promise<string>;
}

export class WelcomeRepository {
  constructor(readonly pool: Pool) {}
  async dispatch(
    publish: (event: RegistrationEvent) => Promise<void>,
    limit = 10,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const rows = await client.query(
        "SELECT id,payload FROM message_outbox WHERE published_at IS NULL AND event_type='auth.registered' ORDER BY created_at,id LIMIT $1 FOR UPDATE SKIP LOCKED",
        [limit],
      );
      for (const row of rows.rows) {
        await publish(row.payload);
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
  async deliver(event: RegistrationEvent, mailer: WelcomeMailer) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize duplicate deliveries across worker processes, not only this consumer.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,4))",
        [event.id],
      );
      const prior = await client.query(
        "SELECT status FROM welcome_email_deliveries WHERE event_id=$1",
        [event.id],
      );
      if (prior.rowCount) {
        await client.query("COMMIT");
        return "duplicate" as const;
      }
      const source = await client.query(
        "SELECT 1 FROM message_outbox WHERE id=$1 AND payload=$2::jsonb",
        [event.id, JSON.stringify(event)],
      );
      if (!source.rowCount) throw new PermanentEventError("UNKNOWN_EVENT");
      const user = await client.query(
        "SELECT email FROM users WHERE id=$1 AND is_active=TRUE AND deleted_at IS NULL",
        [event.userId],
      );
      let messageId: string | null = null;
      const status = user.rowCount ? "sent" : "skipped";
      if (user.rowCount)
        messageId = await mailer.send(event, user.rows[0].email);
      await client.query(
        "INSERT INTO welcome_email_deliveries (event_id,user_id,status,message_id) VALUES ($1,$2,$3,$4)",
        [event.id, event.userId, status, messageId],
      );
      await client.query("COMMIT");
      return status;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
