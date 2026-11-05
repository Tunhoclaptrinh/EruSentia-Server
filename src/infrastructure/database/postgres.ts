import { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from "pg";
import * as dotenv from "dotenv";
import { readDatabaseSettings } from "./settings";

dotenv.config();

const database = readDatabaseSettings();
const poolConfig: PoolConfig = {
  host: database.host,
  port: database.port,
  user: database.username,
  password: database.password,
  database: database.database,
  ssl: database.ssl,
  min: Math.min(Number(process.env.DB_POOL_MIN) || 2, database.poolSize),
  max: database.poolSize,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

export const dbPool = new Pool(poolConfig);

export async function withDatabaseClient<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await dbPool.connect();
  try {
    return await operation(client);
  } finally {
    client.release();
  }
}

dbPool.on("error", (err: Error) => {
  console.error("[PostgreSQL Pool Error]: Unexpected client error", err);
});

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[],
): Promise<QueryResult<T>> {
  const start = Date.now();
  const res = await dbPool.query<T>(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === "development") {
    console.log(
      `[SQL Query] (${duration}ms) rows=${res.rowCount}: ${text.slice(0, 80).replace(/\s+/g, " ")}...`,
    );
  }
  return res;
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const res = await dbPool.query("SELECT 1 AS ok");
    return res.rows[0]?.ok === 1;
  } catch (error) {
    console.error("[Database HealthCheck Failed]:", error);
    return false;
  }
}
