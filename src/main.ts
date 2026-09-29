import * as dotenv from 'dotenv';
import { checkDatabaseHealth } from './infrastructure/database/postgres';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const APP_NAME = process.env.APP_NAME || 'sentia-hub-service';

async function bootstrap() {
  console.log(`================================================================`);
  console.log(`🚀 Starting ${APP_NAME} in ${process.env.NODE_ENV || 'development'} mode...`);
  console.log(`================================================================`);

  const isDbHealthy = await checkDatabaseHealth();
  if (isDbHealthy) {
    console.log(`✅ [Database]: Successfully connected to PostgreSQL!`);
  } else {
    console.warn(`⚠️ [Database]: PostgreSQL is currently offline or unreachable. Please start Docker or verify .env configuration.`);
  }

  console.log(`🌐 Server ready and listening on port ${PORT}`);
  console.log(`📡 Ready for Week 1 (Database & OOP) and Week 2 (REST API & ORM)!`);
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
