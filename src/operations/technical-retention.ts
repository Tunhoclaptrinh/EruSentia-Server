import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { assertProjectDatabase } from "../infrastructure/database/project-migrations";
const maxPerTable = 5000,
  day = 86400000;
interface Candidate {
  rate: string[];
  sessions: string[];
  email: { user_id: string; purpose: string }[];
}
interface Context {
  database: string;
  asOf: string;
  rateBefore: string;
  sessionsBefore: string;
  emailBefore: string;
  emailEnabled: boolean;
}
export interface TechnicalRetentionPlan extends Context {
  version: 1;
  maxPerTable: number;
  eligible: {
    rateBuckets: number;
    expiredSessions: number;
    emailActions: number;
  };
  digest: string;
}
const failure = (code: string) => Object.assign(new Error(code), { code });
async function context(client: PoolClient, asOf?: string): Promise<Context> {
  const {
    rows: [row],
  } = await client.query(
    "SELECT current_database() name,now() time,to_regclass('public.auth_email_actions') IS NOT NULL email",
  );
  assertProjectDatabase(row.name);
  const date = asOf ? new Date(asOf) : new Date(row.time);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getTime() > new Date(row.time).getTime() + 1000
  )
    throw failure("RETENTION_INVALID_AS_OF");
  return {
    database: row.name,
    asOf: date.toISOString(),
    rateBefore: new Date(date.getTime() - day).toISOString(),
    sessionsBefore: new Date(date.getTime() - 30 * day).toISOString(),
    emailBefore: new Date(date.getTime() - 7 * day).toISOString(),
    emailEnabled: row.email,
  };
}
async function candidates(
  client: PoolClient,
  ctx: Context,
  lock = false,
): Promise<Candidate> {
  const suffix = lock ? " FOR UPDATE SKIP LOCKED" : "";
  const rate = (
    await client.query(
      `SELECT key_hash FROM service_rate_limits WHERE expires_at < $1 ORDER BY key_hash LIMIT ${maxPerTable}${suffix}`,
      [ctx.rateBefore],
    )
  ).rows.map((row) => row.key_hash);
  const sessions = (
    await client.query(
      `SELECT id FROM auth_refresh_sessions WHERE expires_at < $1 ORDER BY id LIMIT ${maxPerTable}${suffix}`,
      [ctx.sessionsBefore],
    )
  ).rows.map((row) => row.id);
  const email = ctx.emailEnabled
    ? (
        await client.query(
          `SELECT user_id,purpose FROM auth_email_actions WHERE expires_at < $1 ORDER BY user_id,purpose LIMIT ${maxPerTable}${suffix}`,
          [ctx.emailBefore],
        )
      ).rows
    : [];
  return { rate, sessions, email };
}
function plan(ctx: Context, rows: Candidate): TechnicalRetentionPlan {
  return {
    ...ctx,
    version: 1,
    maxPerTable,
    eligible: {
      rateBuckets: rows.rate.length,
      expiredSessions: rows.sessions.length,
      emailActions: rows.email.length,
    },
    digest: createHash("sha256")
      .update(JSON.stringify({ context: ctx, candidates: rows }))
      .digest("hex"),
  };
}
export async function prepareTechnicalRetention(pool: Pool, asOf?: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const ctx = await context(client, asOf),
      result = plan(ctx, await candidates(client, ctx));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function applyTechnicalRetention(
  pool: Pool,
  asOf: string,
  digest: string,
) {
  if (!/^[a-f0-9]{64}$/.test(digest))
    throw failure("RETENTION_CONFIRMATION_REQUIRED");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('eru-technical-retention-v1',0))",
    );
    const ctx = await context(client, asOf),
      rows = await candidates(client, ctx, true),
      checked = plan(ctx, rows);
    if (checked.digest !== digest) throw failure("RETENTION_PLAN_CHANGED");
    if (rows.rate.length)
      await client.query(
        "DELETE FROM service_rate_limits WHERE key_hash=ANY($1::text[]) AND expires_at<$2",
        [rows.rate, ctx.rateBefore],
      );
    if (rows.sessions.length)
      await client.query(
        "DELETE FROM auth_refresh_sessions WHERE id=ANY($1::uuid[]) AND expires_at<$2",
        [rows.sessions, ctx.sessionsBefore],
      );
    if (rows.email.length)
      await client.query(
        "DELETE FROM auth_email_actions a USING unnest($1::uuid[],$2::text[]) AS k(user_id,purpose) WHERE a.user_id=k.user_id AND a.purpose=k.purpose AND a.expires_at<$3",
        [
          rows.email.map((r) => r.user_id),
          rows.email.map((r) => r.purpose),
          ctx.emailBefore,
        ],
      );
    await client.query("COMMIT");
    return { ...checked, applied: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
