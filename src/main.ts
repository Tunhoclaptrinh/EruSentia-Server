import * as dotenv from "dotenv";
import {
  checkDatabaseHealth,
  dbPool,
} from "./infrastructure/database/postgres";

dotenv.config();

const APP_NAME = process.env.APP_NAME || "sentia-hub-service";

async function bootstrap() {
  console.log(
    `================================================================`,
  );
  console.log(
    `Checking ${APP_NAME} database in ${process.env.NODE_ENV || "development"} mode...`,
  );
  console.log(
    `================================================================`,
  );

  const isDbHealthy = await checkDatabaseHealth();
  if (isDbHealthy) {
    console.log(`✅ [Database]: Successfully connected to PostgreSQL!`);
  } else {
    throw new Error(
      "PostgreSQL is unreachable. Start the database or verify the DB_* environment variables.",
    );
  }

  console.log("Database check completed. The HTTP API is not implemented yet.");
}

bootstrap()
  .catch((err) => {
    console.error("Database check failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => dbPool.end());
