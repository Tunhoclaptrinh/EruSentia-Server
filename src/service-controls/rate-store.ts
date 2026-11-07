import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { DataSource } from "typeorm";
export interface RateBucket {
  key: string;
  limit: number;
  windowSeconds: number;
}
export interface RateStore {
  checkSchema(): Promise<void>;
  consume(buckets: RateBucket[], now: Date): Promise<number>;
}
export const RATE_STORE = Symbol("RATE_STORE");
@Injectable()
export class MemoryRateStore implements RateStore {
  private operations = 0;
  private readonly rows = new Map<string, { until: number; hits: number }>();
  async checkSchema() {}
  async consume(buckets: RateBucket[], now: Date) {
    if (++this.operations % 64 === 0 || this.rows.size > 49990)
      for (const [key, value] of this.rows)
        if (value.until <= now.getTime()) this.rows.delete(key);
    if (
      this.rows.size + buckets.filter((b) => !this.rows.has(b.key)).length >
      50000
    )
      throw new ServiceUnavailableException("Rate limit capacity unavailable");
    let retry = 0;
    for (const b of buckets) {
      const existing = this.rows.get(b.key);
      const current = (existing && existing.until > now.getTime()
        ? existing
        : null) || {
        until: now.getTime() + b.windowSeconds * 1000,
        hits: 0,
      };
      current.hits = Math.min(b.limit + 1, current.hits + 1);
      this.rows.set(b.key, current);
      if (current.hits > b.limit)
        retry = Math.max(
          retry,
          Math.ceil((current.until - now.getTime()) / 1000),
        );
    }
    return retry;
  }
}
@Injectable()
export class PostgresRateStore implements RateStore {
  private operations = 0;
  constructor(private readonly db: DataSource) {}
  async checkSchema() {
    await this.db.query(
      "SELECT key_hash,hits,expires_at FROM service_rate_limits LIMIT 0",
    );
    await this.db.query("SELECT content_bytes FROM templates LIMIT 0");
  }
  async consume(buckets: RateBucket[], now: Date) {
    try {
      const values = buckets.map((b) => ({
        key: b.key,
        limit: b.limit,
        until: new Date(now.getTime() + b.windowSeconds * 1000).toISOString(),
      }));
      const rows: { hits: number; expires_at: Date; ceiling: number }[] =
        await this.db.query(
          `
        WITH input AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS b(key text, "limit" integer, until timestamptz)),
        consumed AS (
          INSERT INTO service_rate_limits(key_hash,hits,expires_at)
          SELECT key,1,until FROM input ORDER BY key
          ON CONFLICT(key_hash) DO UPDATE SET
            hits=CASE WHEN service_rate_limits.expires_at <= $2 THEN 1 ELSE LEAST(service_rate_limits.hits+1,10001) END,
            expires_at=CASE WHEN service_rate_limits.expires_at <= $2 THEN EXCLUDED.expires_at ELSE service_rate_limits.expires_at END
          RETURNING key_hash,hits,expires_at
        ) SELECT c.hits,c.expires_at,i."limit" AS ceiling FROM consumed c JOIN input i ON i.key=c.key_hash`,
          [JSON.stringify(values), now],
        );
      if (++this.operations % 128 === 0)
        await this.db.query(
          "DELETE FROM service_rate_limits WHERE key_hash IN (SELECT key_hash FROM service_rate_limits WHERE expires_at < $1 ORDER BY expires_at LIMIT 1000)",
          [now],
        );
      return rows.reduce(
        (retry, row) =>
          row.hits > row.ceiling
            ? Math.max(
                retry,
                Math.ceil((row.expires_at.getTime() - now.getTime()) / 1000),
              )
            : retry,
        0,
      );
    } catch {
      throw new ServiceUnavailableException("Rate limit storage unavailable");
    }
  }
}
