const { conditionalHeaders } = require("./conditional-headers.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const { Pool } = require("pg");
const { createClient } = require("redis");
const { readConfig } = require("../dist/src/config");
const { createApplication } = require("../dist/src/app");
const { TemplateCache } = require("../dist/src/cache/template-cache");
const { TEMPLATE_STORE } = require("../dist/src/templates/template-store");
async function until(fn) {
  const end = Date.now() + 10000;
  do {
    const result = await fn();
    if (result) return result;
    await delay(30);
  } while (Date.now() < end);
  throw new Error("Timed out waiting for Redis");
}
test(
  "public Template cache with PostgreSQL and Redis",
  {
    skip:
      process.env.RUN_CACHE_TESTS !== "1"
        ? "Set RUN_CACHE_TESTS=1 and an empty week5_test_* database"
        : false,
  },
  async (t) => {
    assert.match(process.env.DB_DATABASE ?? "", /^week5_test_[a-z0-9_]+$/);
    const settings = readConfig({
      ...process.env,
      TEMPLATE_STORE: "postgres",
      CACHE_ENABLED: "true",
      QUEUE_ENABLED: "false",
      CACHE_NAMESPACE: "week5test_" + randomUUID().replaceAll("-", ""),
      CACHE_TTL_SECONDS: "2",
    });
    const pool = new Pool({
      ...settings.database,
      user: settings.database.username,
    });
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'",
        )
      ).rows[0].n,
      0,
      "Never reset an existing database",
    );
    for (const f of [
      "01_schema.sql",
      "02_indexes.sql",
      "03_seed.sql",
      "05_auth_sessions.sql",
      "07_template_cache_revision.sql",
      "08_template_revisions.sql",
      "10_service_controls.sql",
      "07_template_cache_revision.sql",
    ])
      await pool.query(
        (await fs.readFile(path.join(__dirname, "../sql", f), "utf8")).replace(
          /^\uFEFF/,
          "",
        ),
      );
    const app = await createApplication(settings, false);
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const cache = app.get(TemplateCache);
    await until(() => cache.client.isReady);
    const redis = createClient({ url: settings.cache.url });
    redis.on("error", () => {});
    await redis.connect();
    t.after(async () => {
      await app.close();
      const keys = await redis.keys(settings.cache.namespace + ":*");
      if (keys.length) await redis.del(keys);
      redis.destroy();
      await pool.end();
    });
    async function api(method, route, token, body) {
      const r = await fetch(base + route, {
        method,
        headers: await conditionalHeaders(base, method, route, {
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(body ? { "content-type": "application/json" } : {}),
        }),
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        response: r,
        status: r.status,
        cache: r.headers.get("x-cache"),
        body: r.status === 204 ? null : await r.json(),
      };
    }
    async function account() {
      const credentials = {
        email: `cache-${randomUUID()}@example.test`,
        password: "LearningPass!2026",
      };
      assert.equal(
        (await api("POST", "/auth/register", null, credentials)).status,
        201,
      );
      const r = await api("POST", "/auth/login", null, credentials);
      return r.body.accessToken;
    }
    const owner = await account(),
      other = await account();
    async function create(isPublic = true) {
      const r = await api("POST", "/templates", owner, {
        categoryId: "c0000000-0000-0000-0000-000000000001",
        title: "Cache contract",
        slug: "cache-" + randomUUID(),
        description: "public cache demo",
        isPublic,
        contentJson: {
          format: "erusentia-template-html",
          schemaVersion: 1,
          sharing: require("./publication-fixture.cjs").sharing,
          html: "<main>" + "content ".repeat(4000) + "</main>",
        },
      });
      assert.equal(r.status, 201);
      return r.body;
    }
    const item = await create();
    const route = "/templates/" + item.id;
    let key;
    await t.test(
      "MISS fills Redis with TTL; HIT returns same contract without a full catalog query",
      async () => {
        const store = app.get(TEMPLATE_STORE);
        const original = store.find.bind(store);
        let reads = 0;
        store.find = async (...args) => {
          reads++;
          return original(...args);
        };
        try {
          const first = await api("GET", route, owner);
          assert.equal(first.cache, "MISS");
          const second = await api("GET", route, other);
          assert.equal(second.cache, "HIT");
          assert.deepEqual(second.body, first.body);
          assert.equal(reads, 1);
          assert.equal(
            second.response.headers.get("cache-control"),
            "no-store",
          );
        } finally {
          store.find = original;
        }
        key = cache.key(item.id, (await cache.stamp(item.id)).revision);
        assert((await redis.ttl(key)) > 0);
      },
    );
    await t.test(
      "PATCH changes revision and deletes old key; subsequent read misses then hits fresh data",
      async () => {
        const updated = await api("PATCH", route, owner, {
          title: "Fresh title",
        });
        assert.equal(updated.status, 200);
        assert.equal(await redis.exists(key), 0);
        const r = await api("GET", route, other);
        assert.equal(r.cache, "MISS");
        assert.equal(r.body.title, "Fresh title");
        assert.equal((await api("GET", route, other)).cache, "HIT");
      },
    );
    await t.test(
      "public to private hides a previously warmed key from another account and bypasses owner caching",
      async () => {
        const oldKey = cache.key(
          item.id,
          (await cache.stamp(item.id)).revision,
        );
        const oldValue = await redis.get(oldKey);
        assert.equal(
          (await api("PATCH", route, owner, { isPublic: false })).status,
          200,
        );
        await redis.set(oldKey, oldValue, { EX: 60 }); // stale entry deliberately restored: visibility must still protect it.
        assert.equal((await api("GET", route, other)).status, 404);
        const mine = await api("GET", route, owner);
        assert.equal(mine.cache, "BYPASS_PRIVATE");
        assert.equal(mine.body.isPublic, false);
        assert.equal(
          (await api("PATCH", route, owner, { isPublic: true })).status,
          200,
        );
        assert.equal((await api("GET", route, other)).cache, "MISS");
      },
    );
    await t.test(
      "direct SQL writes bump revision, so stale-fill races cannot poison the current version",
      async () => {
        const stamp = await cache.stamp(item.id);
        const oldKey = cache.key(item.id, stamp.revision);
        const raw = await redis.get(oldKey);
        await pool.query("UPDATE templates SET title=$1 WHERE id=$2", [
          "SQL changed title",
          item.id,
        ]);
        assert.notEqual((await cache.stamp(item.id)).revision, stamp.revision);
        await redis.set(oldKey, raw, { EX: 60 });
        const r = await api("GET", route, other);
        assert.equal(r.cache, "MISS");
        assert.equal(r.body.title, "SQL changed title");
      },
    );
    await t.test(
      "corrupt cache entries are discarded and rebuilt from PostgreSQL",
      async () => {
        const k = cache.key(item.id, (await cache.stamp(item.id)).revision);
        await redis.set(k, "bad JSON", { EX: 30 });
        const r = await api("GET", route, other);
        assert.equal(r.cache, "MISS");
        assert.equal(r.status, 200);
        assert.equal((await api("GET", route, other)).cache, "HIT");
      },
    );
    await t.test(
      "expiry causes a miss, while concurrent misses coalesce the full load inside one process",
      async () => {
        const k = cache.key(item.id, (await cache.stamp(item.id)).revision);
        await redis.pExpire(k, 1);
        await until(async () => !(await redis.exists(k)));
        const store = app.get(TEMPLATE_STORE);
        const original = store.find.bind(store);
        let reads = 0;
        store.find = async (...args) => {
          reads++;
          await delay(50);
          return original(...args);
        };
        try {
          const responses = await Promise.all(
            Array.from({ length: 8 }, () => api("GET", route, other)),
          );
          assert(responses.every((r) => r.status === 200));
          assert.equal(reads, 1);
          assert(responses.some((r) => r.cache === "COALESCED"));
        } finally {
          store.find = original;
        }
      },
    );
    await t.test(
      "authorization is evaluated before Redis; missing IDs do not create negative cache entries",
      async () => {
        assert.equal((await api("GET", route, null)).status, 401);
        const absent = randomUUID();
        assert.equal(
          (await api("GET", "/templates/" + absent, owner)).status,
          404,
        );
        assert.equal(
          (
            await redis.keys(
              settings.cache.namespace + ":template:v1:" + absent + ":*",
            )
          ).length,
          0,
        );
      },
    );
    await t.test(
      "Redis connection loss falls back to DB; writes remain safe when invalidation cannot reach Redis",
      async () => {
        cache.client.destroy();
        const before = (await cache.stamp(item.id)).revision;
        assert.equal((await api("GET", route, other)).cache, "BYPASS_REDIS");
        assert.equal(
          (await api("PATCH", route, owner, { title: "Offline Redis write" }))
            .status,
          200,
        );
        assert.notEqual((await cache.stamp(item.id)).revision, before);
        await cache.client.connect();
        await until(() => cache.client.isReady);
        const r = await api("GET", route, other);
        assert.equal(r.cache, "MISS");
        assert.equal(r.body.title, "Offline Redis write");
      },
    );
    await t.test(
      "a GET racing a SQL update cannot refill the new revision with old data",
      async () => {
        const stamp = await cache.stamp(item.id),
          oldKey = cache.key(item.id, stamp.revision);
        await redis.del(oldKey);
        const store = app.get(TEMPLATE_STORE),
          original = store.find.bind(store);
        let entered, release;
        const waiting = new Promise((resolve) => {
          entered = resolve;
        });
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        store.find = async (...args) => {
          const row = await original(...args);
          entered();
          await gate;
          return row;
        };
        const inflight = api("GET", route, other);
        try {
          await waiting;
          await pool.query(
            "UPDATE templates SET title='Concurrent revision' WHERE id=$1",
            [item.id],
          );
          release();
          await inflight;
          assert.equal(await redis.exists(oldKey), 0);
        } finally {
          release();
          store.find = original;
        }
        const fresh = await api("GET", route, other);
        assert.equal(fresh.cache, "MISS");
        assert.equal(fresh.body.title, "Concurrent revision");
      },
    );
    await t.test(
      "startup with unreachable Redis remains available through PostgreSQL",
      async () => {
        const degraded = await createApplication(
          {
            ...settings,
            cache: { ...settings.cache, url: "redis://127.0.0.1:1" },
          },
          false,
        );
        try {
          await degraded.listen(0, "127.0.0.1");
          const r = await fetch((await degraded.getUrl()) + route, {
            headers: { Authorization: "Bearer " + owner },
          });
          assert.equal(r.status, 200);
          assert.equal(r.headers.get("x-cache"), "BYPASS_REDIS");
        } finally {
          await degraded.close();
        }
      },
    );
    await t.test(
      "soft deletion prevents reading any warmed cache version",
      async () => {
        const k = cache.key(item.id, (await cache.stamp(item.id)).revision),
          raw = await redis.get(k);
        assert.equal((await api("DELETE", route, owner)).status, 204);
        await redis.set(k, raw, { EX: 60 });
        assert.equal((await api("GET", route, owner)).status, 404);
        assert.equal((await api("GET", route, other)).status, 404);
      },
    );
    await t.test(
      "disabled caching preserves the historical HTTP contract and creates no Redis keys",
      async () => {
        const disabled = await createApplication(
          { ...settings, cache: { ...settings.cache, enabled: false } },
          false,
        );
        await disabled.listen(0, "127.0.0.1");
        try {
          const target = await create();
          const r = await fetch(
            (await disabled.getUrl()) + "/templates/" + target.id,
            { headers: { Authorization: "Bearer " + owner } },
          );
          assert.equal(r.status, 200);
          assert.equal(r.headers.get("x-cache"), "BYPASS_DISABLED");
          assert.equal(
            (
              await redis.keys(
                settings.cache.namespace + ":template:v1:" + target.id + ":*",
              )
            ).length,
            0,
          );
        } finally {
          await disabled.close();
        }
      },
    );
  },
);
