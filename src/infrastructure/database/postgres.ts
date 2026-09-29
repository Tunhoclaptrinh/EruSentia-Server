import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const poolConfig: PoolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres_dev_password',
  database: process.env.DB_DATABASE || 'sentia_hub_db',
  min: Number(process.env.DB_POOL_MIN) || 2,
  max: Number(process.env.DB_POOL_MAX) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

export const dbPool = new Pool(poolConfig);

dbPool.on('error', (err) => {
  console.error('[PostgreSQL Pool Error]: Unexpected client error', err);
});

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  const res = await dbPool.query<T>(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === 'development') {
    console.log(`[SQL Query] (${duration}ms) rows=${res.rowCount}: ${text.slice(0, 80).replace(/\s+/g, ' ')}...`);
  }
  return res;
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const res = await dbPool.query('SELECT 1 AS ok');
    return res.rows[0]?.ok === 1;
  } catch (error) {
    console.error('[Database HealthCheck Failed]:', error);
    return false;
  }
}
