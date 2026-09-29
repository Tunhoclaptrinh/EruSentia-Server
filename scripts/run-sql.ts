import * as fs from 'fs';
import * as path from 'path';
import { dbPool } from '../src/infrastructure/database/postgres';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Error: Please specify the SQL file path to execute.');
    console.error('Example: tsx scripts/run-sql.ts sql/01_schema.sql');
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: File not found at ${resolvedPath}`);
    process.exit(1);
  }

  console.log(`Executing SQL script: ${filePath}...`);
  const sql = fs.readFileSync(resolvedPath, 'utf-8');

  const client = await dbPool.connect();
  try {
    const start = Date.now();
    await client.query(sql);
    const duration = Date.now() - start;
    console.log(`Successfully executed ${filePath} in ${duration}ms!`);
  } catch (error) {
    console.error(`Failed to execute ${filePath}:`, error);
    process.exit(1);
  } finally {
    client.release();
    await dbPool.end();
  }
}

main();
