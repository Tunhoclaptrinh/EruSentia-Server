const { conditionalHeaders } = require("./conditional-headers.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const { Pool } = require("pg");
const { readConfig } = require("../dist/src/config");
const { createApplication } = require("../dist/src/app");
const { TemplateCache } = require("../dist/src/cache/template-cache");
const { RabbitTransport } = require("../dist/src/messaging/rabbit");
const {
  WelcomeRepository,
} = require("../dist/src/messaging/welcome-repository");
const { WelcomeWorker } = require("../dist/src/messaging/welcome-worker");
const { LocalWelcomeMailer } = require("../dist/src/messaging/welcome-mailer");
async function until(fn) {
  const end = Date.now() + 10000;
  do {
    const value = await fn();
    if (value) return value;
    await delay(50);
  } while (Date.now() < end);
  throw new Error("Project stack did not become ready");
}
test(
  "project foundation with auth, PostgreSQL, RabbitMQ and Redis enabled together",
  {
    skip:
      process.env.RUN_PROJECT_TESTS !== "1"
        ? "Set RUN_PROJECT_TESTS=1 and an empty project_test_* database"
        : false,
  },
  async (t) => {
    assert.match(process.env.DB_DATABASE ?? "", /^project_test_[a-z0-9_]+$/);
    const namespace = "project_" + randomUUID().replaceAll("-", "");
    const settings = readConfig({
      ...process.env,
      TEMPLATE_STORE: "postgres",
      QUEUE_ENABLED: "true",
      CACHE_ENABLED: "true",
      QUEUE_NAMESPACE: namespace,
      CACHE_NAMESPACE: namespace,
      QUEUE_RETRY_DELAY_MS: "300",
    });
    const pool = new Pool({
      ...settings.database,
      user: settings.database.username,
    });
    let app, rabbit, worker;
    const emails = [],
      mailIds = new Set();
    t.after(async () => {
      await worker?.stopConsumer();
      if (app) {
        const cache = app.get(TemplateCache);
        if (cache.client.isReady) {
          const keys = await cache.client.keys(namespace + ":*");
          if (keys.length) await cache.client.del(keys);
        }
        await app.close();
      }
      if (rabbit) {
        for (const name of [
          rabbit.names.work,
          rabbit.names.retry,
          rabbit.names.dead,
        ])
          await rabbit.publisher.deleteQueue(name);
        await rabbit.publisher.deleteExchange(rabbit.names.exchange);
        await rabbit.publisher.deleteExchange(rabbit.names.deadExchange);
        await rabbit.close();
      }
      for (const email of emails) {
        const r = await fetch(
          "http://127.0.0.1:8025/api/v1/search?query=" +
            encodeURIComponent("to:" + email),
        );
        const data = await r.json();
        for (const m of data.messages ?? []) mailIds.add(m.ID);
      }
      if (mailIds.size)
        await fetch("http://127.0.0.1:8025/api/v1/messages", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ IDs: [...mailIds] }),
        });
      await pool.end();
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
      "06_message_queue.sql",
      "07_template_cache_revision.sql",
      "08_template_revisions.sql",
      "10_service_controls.sql",
    ])
      await pool.query(
        (await fs.readFile(path.join(__dirname, "../sql", f), "utf8")).replace(
          /^\uFEFF/,
          "",
        ),
      );
    app = await createApplication(settings, false);
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    await until(() => app.get(TemplateCache).client.isReady);
    rabbit = await RabbitTransport.open(settings.queue);
    worker = new WelcomeWorker(
      new WelcomeRepository(pool),
      rabbit,
      new LocalWelcomeMailer(settings.queue),
    );
    async function request(method, route, token, body) {
      const r = await fetch(base + route, {
        method,
        headers: await conditionalHeaders(base, method, route, {
          Origin: "http://localhost:5173",
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(body ? { "content-type": "application/json" } : {}),
        }),
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        status: r.status,
        headers: r.headers,
        body: r.status === 204 ? null : await r.json(),
      };
    }
    async function account() {
      const credentials = {
        email: `project-${randomUUID()}@example.test`,
        password: "LearningPass!2026",
      };
      emails.push(credentials.email);
      assert.equal(
        (await request("POST", "/auth/register", null, credentials)).status,
        201,
      );
      return (await request("POST", "/auth/login", null, credentials)).body;
    }
    let owner, other, item;
    await t.test(
      "all additive migrations coexist and category IDs are discoverable over the authenticated contract",
      async () => {
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'",
            )
          ).rows[0].n,
          13,
        );
        owner = await account();
        other = await account();
        const categories = await request(
          "GET",
          "/categories",
          owner.accessToken,
        );
        assert.equal(categories.status, 200);
        assert.equal(
          categories.headers.get("access-control-allow-origin"),
          "http://localhost:5173",
        );
        assert.equal(
          categories.body.length,
          (await pool.query("SELECT count(*)::int n FROM categories")).rows[0]
            .n,
        );
        const created = await request("POST", "/templates", owner.accessToken, {
          categoryId: categories.body[0].id,
          title: "Project integration fixture",
          slug: "project-" + randomUUID(),
          description: "Independent fixture, no App assets",
          isPublic: true,
          contentJson: {
            format: "erusentia-template-html",
            schemaVersion: 1,
            sharing: require("./publication-fixture.cjs").sharing,
            html: "<div>Independent project fixture</div>",
            allowHeightResize: false,
          },
        });
        assert.equal(created.status, 201);
        item = created.body;
      },
    );
    await t.test(
      "public reads hit Redis while writes and private visibility remain correct",
      async () => {
        const route = "/templates/" + item.id;
        const first = await request("GET", route, other.accessToken);
        assert.equal(first.headers.get("x-cache"), "MISS");
        const second = await request("GET", route, other.accessToken);
        assert.equal(second.headers.get("x-cache"), "HIT");
        assert.deepEqual(first.body, second.body);
        assert.equal(
          (
            await request("PATCH", route, owner.accessToken, {
              isPublic: false,
            })
          ).status,
          200,
        );
        assert.equal(
          (await request("GET", route, other.accessToken)).status,
          404,
        );
        assert.equal(
          (await request("GET", route, owner.accessToken)).headers.get(
            "x-cache",
          ),
          "BYPASS_PRIVATE",
        );
      },
    );
    await t.test(
      "registrations still deliver real welcome emails through the outbox and RabbitMQ",
      async () => {
        assert.equal(await worker.dispatch(), 2);
        await worker.startConsumer();
        await until(
          async () =>
            (
              await pool.query(
                "SELECT count(*)::int n FROM welcome_email_deliveries WHERE status='sent'",
              )
            ).rows[0].n === 2,
        );
        for (const email of emails) {
          const r = await fetch(
            "http://127.0.0.1:8025/api/v1/search?query=" +
              encodeURIComponent("to:" + email),
          );
          const data = await r.json();
          assert.equal(data.messages.length, 1);
          mailIds.add(data.messages[0].ID);
        }
      },
    );
    await t.test(
      "refresh and logout revoke the same access session with cache and queue enabled",
      async () => {
        const refreshed = await request("POST", "/auth/refresh", null, {
          refreshToken: owner.refreshToken,
        });
        assert.equal(refreshed.status, 200);
        assert.notEqual(refreshed.body.refreshToken, owner.refreshToken);
        assert.equal(
          (await request("GET", "/auth/me", refreshed.body.accessToken)).status,
          200,
        );
        assert.equal(
          (
            await request("POST", "/auth/logout", null, {
              refreshToken: refreshed.body.refreshToken,
            })
          ).status,
          204,
        );
        assert.equal(
          (
            await request(
              "GET",
              "/templates/" + item.id,
              refreshed.body.accessToken,
            )
          ).status,
          401,
        );
        assert.equal(
          (await request("GET", "/auth/me", other.accessToken)).status,
          200,
        );
      },
    );
  },
);
