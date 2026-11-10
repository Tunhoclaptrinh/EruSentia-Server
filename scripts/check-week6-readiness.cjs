// Isolated integration check. Never migrate or reset the user's existing database.
require('dotenv').config();
const { Pool } = require('pg');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { readConfig } = require('../dist/src/config');
const { migrateProject, seedProject } = require('../dist/src/infrastructure/database/project-migrations');

async function main() {
  const settings = readConfig().database;
  if (!['localhost', '127.0.0.1', '::1'].includes(settings.host)) throw new Error('Week 6 checks require a local PostgreSQL server');
  const name = `project_test_week6_${randomBytes(6).toString('hex')}`;
  const options = { ...settings, user: settings.username };
  const admin = new Pool(options);
  let pool;
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    pool = new Pool({ ...options, database: name });
    await migrateProject(pool);
    await seedProject(pool);
    await pool.end();
    pool = undefined;
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--test', '--test-isolation=none', 'test/notifications.test.cjs', 'test/notifications-worker.test.cjs', 'test/workspaces.test.cjs', 'test/notification-cache-safety.test.cjs', 'test/workspace-invite-safety.test.cjs', 'test/resources.test.cjs'], {
        stdio: 'inherit',
        env: { ...process.env, DB_DATABASE: name, RESOURCE_TEST_STORE: 'postgres', API_RATE_LIMITS_ENABLED: 'false' }
      });
      child.on('error', reject);
      child.on('exit', code => resolve(code ?? 1));
    });
    process.exitCode = exitCode;
  } finally {
    if (pool) await pool.end();
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
