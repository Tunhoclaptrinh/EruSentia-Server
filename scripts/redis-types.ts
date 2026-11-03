import "reflect-metadata";
import { config } from "dotenv";
import { createClient } from "redis";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readConfig } from "../src/config";

async function main() {
  config();
  const settings = readConfig();
  const client = createClient({
    url: settings.cache.url,
    socket: { connectTimeout: 1000, reconnectStrategy: false },
  });
  client.on("error", () => {});
  const pool = new Pool({
    ...settings.database,
    user: settings.database.username,
    connectionTimeoutMillis: 3000,
  });
  const prefix = `${settings.cache.namespace}:types:${randomUUID()}`;
  const keys = ["string", "hash", "list", "set", "sorted"].map(
    (type) => `${prefix}:${type}`,
  );
  try {
    await client.connect();
    const { rows } = await pool.query(
      "SELECT id,title,category_id,views_count FROM templates WHERE is_public=TRUE AND deleted_at IS NULL ORDER BY views_count DESC,id LIMIT 5",
    );
    if (!rows.length)
      throw new Error(
        "No public Template data; prepare the selected demo database first",
      );
    const transaction = client.multi();
    transaction.set(keys[0], rows[0].title, { EX: 60 });
    transaction.hSet(keys[1], { id: rows[0].id, title: rows[0].title });
    transaction.expire(keys[1], 60);
    transaction.rPush(
      keys[2],
      rows.map((row) => row.id),
    );
    transaction.expire(keys[2], 60);
    transaction.sAdd(
      keys[3],
      rows.map((row) => row.category_id),
    );
    transaction.expire(keys[3], 60);
    transaction.zAdd(
      keys[4],
      rows.map((row) => ({ score: row.views_count, value: row.id })),
    );
    transaction.expire(keys[4], 60);
    await transaction.exec();
    console.log(
      JSON.stringify(
        {
          string: await client.get(keys[0]),
          hash: await client.hGetAll(keys[1]),
          list: await client.lRange(keys[2], 0, -1),
          set: await client.sMembers(keys[3]),
          leaderboard: await client.zRangeWithScores(keys[4], 0, 2, {
            REV: true,
          }),
          ttl: await client.ttl(keys[0]),
        },
        null,
        2,
      ),
    );
  } finally {
    if (client.isReady) await client.del(keys);
    if (client.isOpen) client.destroy();
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Redis type demo failed; check selected PostgreSQL database and Redis connection",
  );
  process.exitCode = 1;
});
