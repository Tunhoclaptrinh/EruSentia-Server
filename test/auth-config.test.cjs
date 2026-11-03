const assert = require("node:assert/strict");
const test = require("node:test");
const { readConfig } = require("../dist/src/config");

test("JWT configuration requires a stable production key and rejects short keys", () => {
  assert.throws(
    () => readConfig({ NODE_ENV: "production" }),
    /JWT_SECRET is required/,
  );
  assert.throws(() => readConfig({ JWT_SECRET: "short" }), /at least 32 bytes/);
  const key = "test-only-signing-key-with-at-least-32-bytes";
  assert.equal(
    readConfig({ NODE_ENV: "production", JWT_SECRET: key }).auth.secret,
    key,
  );
  const first = readConfig({}).auth.secret;
  assert(Buffer.byteLength(first) >= 32);
  assert.notEqual(first, readConfig({}).auth.secret);
});
