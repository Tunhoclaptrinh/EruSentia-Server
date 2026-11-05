const test = require("node:test");
const assert = require("node:assert/strict");
const { readConfig } = require("../dist/src/config");
const { cacheTtl, canRead } = require("../dist/src/cache/template-cache");
test("cache is opt-in and validates backend, namespace, protocol and bounded TTL", () => {
  assert.equal(readConfig({}).cache.enabled, false);
  for (const env of [
    { CACHE_ENABLED: "yes" },
    { CACHE_ENABLED: "true", TEMPLATE_STORE: "memory" },
    { CACHE_NAMESPACE: "x:y" },
    { REDIS_URL: "https://example.test" },
    { CACHE_TTL_SECONDS: "0" },
  ])
    assert.throws(() => readConfig(env));
  assert.equal(readConfig({ CACHE_ENABLED: "true" }).cache.enabled, true);
});
test("TTL jitter stays in its configured range and public/private authorization remains explicit", () => {
  assert.equal(cacheTtl(60, 0), 60);
  assert.equal(cacheTtl(60, 0.999), 71);
  assert(canRead({ isPublic: true, authorId: "a" }, { id: "b", role: "user" }));
  assert(
    canRead({ isPublic: false, authorId: "a" }, { id: "a", role: "user" }),
  );
  assert(
    !canRead({ isPublic: false, authorId: "a" }, { id: "b", role: "user" }),
  );
  assert(
    canRead({ isPublic: false, authorId: "a" }, { id: "b", role: "admin" }),
  );
});
