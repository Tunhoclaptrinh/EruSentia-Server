const assert = require("node:assert/strict");
const test = require("node:test");
const { readConfig } = require("../dist/src/config");
const {
  readDatabaseSettings,
} = require("../dist/src/infrastructure/database/settings");

test("hosted PostgreSQL requires verified TLS and bounds the connection pool", () => {
  const env = { DB_HOST: "db.example.test", DB_SSL: "true", DB_POOL_MAX: "5" };
  assert.deepEqual(readDatabaseSettings(env).ssl, { rejectUnauthorized: true });
  assert.deepEqual(readConfig(env).database, readDatabaseSettings(env));
  assert.equal(readDatabaseSettings(env).poolSize, 5);
  assert.equal(readDatabaseSettings({}).ssl, false);
  assert.equal(readDatabaseSettings({ DB_SSL: "false" }).ssl, false);
  for (const DB_SSL of ["", "require", "no-verify", "0"])
    assert.throws(() => readDatabaseSettings({ DB_SSL }), /DB_SSL/);
  for (const DB_POOL_MAX of ["", "0", "101", "1.5", "NaN"])
    assert.throws(() => readDatabaseSettings({ DB_POOL_MAX }), /DB_POOL_MAX/);
  for (const DB_PORT of ["", "0", "65536", "1.5", "NaN"])
    assert.throws(() => readDatabaseSettings({ DB_PORT }), /DB_PORT/);
});
