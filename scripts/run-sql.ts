import * as fs from "fs";
import * as path from "path";
import {
  dbPool,
  withDatabaseClient,
} from "../src/infrastructure/database/postgres";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error(
      "Please specify the SQL file path. Example: node --import tsx scripts/run-sql.ts sql/01_schema.sql",
    );
  }

  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`SQL file not found: ${resolvedPath}`);
  }

  console.log(`Executing SQL script: ${filePath}...`);
  const sql = fs.readFileSync(resolvedPath, "utf-8");

  await withDatabaseClient(async (client) => {
    const start = Date.now();
    await client.query(sql);
    const duration = Date.now() - start;
    console.log(`Successfully executed ${filePath} in ${duration}ms!`);
  });
}

main()
  .catch((error) => {
    console.error("SQL execution failed:", error);
    process.exitCode = 1;
  })
  .finally(() => dbPool.end());
