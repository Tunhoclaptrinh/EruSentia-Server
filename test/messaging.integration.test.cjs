const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const { Pool } = require("pg");
const { readConfig } = require("../dist/src/config");
const { createApplication } = require("../dist/src/app");
const { RabbitTransport } = require("../dist/src/messaging/rabbit");
const {
  WelcomeRepository,
} = require("../dist/src/messaging/welcome-repository");
const { WelcomeWorker } = require("../dist/src/messaging/welcome-worker");
const { LocalWelcomeMailer } = require("../dist/src/messaging/welcome-mailer");
const { REGISTERED } = require("../dist/src/messaging/registration-event");

async function until(fn, timeout = 12000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await fn();
    if (value) return value;
    await delay(80);
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for queue side effect");
}

test(
  "registration outbox → RabbitMQ → welcome SMTP with PostgreSQL",
  {
    skip:
      process.env.RUN_QUEUE_TESTS !== "1"
        ? "Set RUN_QUEUE_TESTS=1 and an empty week4_test_* database"
        : false,
  },
  async (t) => {
    assert.match(process.env.DB_DATABASE ?? "", /^week4_test_[a-z0-9_]+$/);
    const settings = readConfig({
      ...process.env,
      QUEUE_ENABLED: "true",
      TEMPLATE_STORE: "postgres",
      QUEUE_NAMESPACE: `week4test_${randomUUID().replaceAll("-", "")}`,
      QUEUE_RETRY_DELAY_MS: "300",
    });
    const pool = new Pool({
      ...settings.database,
      user: settings.database.username,
    });

    const tables = await pool.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'",
    );
    assert.equal(tables.rows[0].n, 0, "Never reset an existing database");
    for (const f of [
      "01_schema.sql",
      "02_indexes.sql",
      "03_seed.sql",
      "05_auth_sessions.sql",
      "06_message_queue.sql",
      "08_template_revisions.sql",
      "10_service_controls.sql",
      "06_message_queue.sql",
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
    const repo = new WelcomeRepository(pool);
    const mailer = new LocalWelcomeMailer(settings.queue);
    let rabbit = await RabbitTransport.open(settings.queue);
    let worker = new WelcomeWorker(repo, rabbit, mailer);
    const mailIds = new Set();
    t.after(async () => {
      await worker.stopConsumer();
      await rabbit.close();
      const cleanup = await RabbitTransport.open(settings.queue);
      for (const name of [
        cleanup.names.work,
        cleanup.names.retry,
        cleanup.names.dead,
      ])
        await cleanup.publisher.deleteQueue(name);
      await cleanup.publisher.deleteExchange(cleanup.names.exchange);
      await cleanup.publisher.deleteExchange(cleanup.names.deadExchange);
      await cleanup.close();
      if (mailIds.size)
        await fetch("http://127.0.0.1:8025/api/v1/messages", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ IDs: [...mailIds] }),
        });
      await app.close();
      await pool.end();
    });
    async function register() {
      const email = `week4-${randomUUID()}@example.test`;
      const response = await fetch(base + "/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "LearningPass!2026" }),
      });
      assert.equal(response.status, 201);
      const user = await response.json();
      assert(!JSON.stringify(user).includes("password"));
      const rows = await pool.query(
        "SELECT payload FROM message_outbox WHERE payload->>'userId'=$1",
        [user.id],
      );
      assert.equal(rows.rowCount, 1);
      return { user, event: rows.rows[0].payload, email };
    }
    async function mails(email) {
      const r = await fetch(
        "http://127.0.0.1:8025/api/v1/search?query=" +
          encodeURIComponent("to:" + email),
      );
      assert.equal(r.status, 200);
      const data = await r.json();
      for (const m of data.messages ?? []) mailIds.add(m.ID);
      return data.messages ?? [];
    }
    async function sent(event) {
      return (
        await pool.query(
          "SELECT status,message_id FROM welcome_email_deliveries WHERE event_id=$1",
          [event.id],
        )
      ).rows[0];
    }
    async function publish(event) {
      await rabbit.publish(
        rabbit.names.exchange,
        REGISTERED,
        Buffer.from(JSON.stringify(event)),
        { messageId: event.id, type: REGISTERED },
      );
    }
    async function drained() {
      await until(async () => {
        const q = await rabbit.publisher.checkQueue(rabbit.names.work);
        return q.messageCount === 0;
      });
      await delay(100);
    }

    let first;
    await t.test(
      "API commits user + outbox before any worker or broker connection; duplicate registration creates no second event",
      async () => {
        first = await register();
        assert.equal((await mails(first.email)).length, 0);
        assert.equal(
          (
            await pool.query(
              "SELECT published_at FROM message_outbox WHERE id=$1",
              [first.event.id],
            )
          ).rows[0].published_at,
          null,
        );
        const duplicate = await fetch(base + "/auth/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: first.email,
            password: "LearningPass!2026",
          }),
        });
        assert.equal(duplicate.status, 409);
        assert.equal(
          (await pool.query("SELECT count(*)::int n FROM message_outbox"))
            .rows[0].n,
          1,
        );
        assert.equal(await worker.dispatch(), 1);
        assert.equal(
          (await rabbit.publisher.checkQueue(rabbit.names.work)).messageCount,
          1,
        );
      },
    );
    await t.test(
      "consumer sends a real email to Mailpit and records a durable delivery before ack",
      async () => {
        await worker.startConsumer();
        assert.equal((await until(() => sent(first.event))).status, "sent");
        const messages = await until(async () => {
          const list = await mails(first.email);
          return list.length ? list : null;
        });
        assert.equal(messages.length, 1);
        assert.match(messages[0].Subject, /EruSentia/);
        await drained();
      },
    );
    await t.test(
      "duplicate message and concurrent consumers reuse inbox result without sending another email",
      async () => {
        await publish(first.event);
        await publish(first.event);
        await drained();
        const results = await Promise.all([
          repo.deliver(first.event, mailer),
          repo.deliver(first.event, mailer),
        ]);
        assert.deepEqual(results, ["duplicate", "duplicate"]);
        assert.equal((await mails(first.email)).length, 1);
      },
    );
    await t.test(
      "two workers handling a fresh event concurrently produce one recorded SMTP delivery",
      async () => {
        await worker.stopConsumer();
        const item = await register();
        const results = await Promise.all([
          repo.deliver(item.event, mailer),
          repo.deliver(item.event, mailer),
        ]);
        assert.deepEqual(results.sort(), ["duplicate", "sent"]);
        assert.equal((await mails(item.email)).length, 1);
        await worker.dispatch();
        await worker.startConsumer();
        await drained();
        assert.equal((await mails(item.email)).length, 1);
      },
    );
    await t.test(
      "failure to persist outbox rolls registration back completely",
      async () => {
        await pool.query(
          "ALTER TABLE message_outbox RENAME TO message_outbox_hidden",
        );
        const email = `rollback-${randomUUID()}@example.test`;
        try {
          const r = await fetch(base + "/auth/register", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, password: "LearningPass!2026" }),
          });
          assert.equal(r.status, 500);
          assert.equal(
            (await pool.query("SELECT id FROM users WHERE email=$1", [email]))
              .rowCount,
            0,
          );
        } finally {
          await pool.query(
            "ALTER TABLE message_outbox_hidden RENAME TO message_outbox",
          );
        }
      },
    );
    await t.test(
      "broker publish failure leaves pending outbox; recovery publishes it later",
      async () => {
        await worker.stopConsumer();
        const item = await register();
        await assert.rejects(
          () =>
            repo.dispatch((event) =>
              rabbit.publish(
                "",
                `missing_${randomUUID()}`,
                Buffer.from(JSON.stringify(event)),
                { messageId: event.id },
              ),
            ),
          /UNROUTABLE/,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT published_at FROM message_outbox WHERE id=$1",
              [item.event.id],
            )
          ).rows[0].published_at,
          null,
        );
        assert.equal(await worker.dispatch(), 1);
        await worker.startConsumer();
        await until(() => sent(item.event));
        assert.equal((await mails(item.email)).length, 1);
        await drained();
      },
    );
    await t.test(
      "transient SMTP failures take two delayed retries then succeed",
      async () => {
        await worker.stopConsumer();
        let calls = 0;
        worker = new WelcomeWorker(repo, rabbit, {
          send: async (event, email) => {
            calls++;
            if (calls < 3) throw new Error("temporary SMTP failure");
            return mailer.send(event, email);
          },
        });
        const item = await register();
        await worker.dispatch();
        await worker.startConsumer();
        await until(() => sent(item.event));
        assert.equal(calls, 3);
        assert.equal((await mails(item.email)).length, 1);
        await drained();
      },
    );
    await t.test(
      "permanent SMTP failure stops after three attempts and retains message in DLQ",
      async () => {
        await worker.stopConsumer();
        let calls = 0;
        worker = new WelcomeWorker(repo, rabbit, {
          send: async () => {
            calls++;
            throw new Error("SMTP unavailable");
          },
        });
        const item = await register();
        await worker.dispatch();
        await worker.startConsumer();
        const dead = await until(() =>
          rabbit.consumer.get(rabbit.names.dead, { noAck: false }),
        );
        assert.equal(calls, 3);
        assert.equal(dead.properties.messageId, item.event.id);
        assert.equal(dead.properties.headers["x-attempt"], 3);
        assert.equal(await sent(item.event), undefined);
        rabbit.consumer.ack(dead);
        // Operator replay after fixing SMTP preserves event ID and produces one recorded email.
        await worker.stopConsumer();
        worker = new WelcomeWorker(repo, rabbit, mailer);
        await publish(item.event);
        await worker.startConsumer();
        await until(() => sent(item.event));
        assert.equal((await mails(item.email)).length, 1);
        await drained();
      },
    );
    await t.test(
      "malformed and unknown events go straight to DLQ without email",
      async () => {
        const badId = randomUUID();
        await rabbit.publish(
          rabbit.names.exchange,
          REGISTERED,
          Buffer.from("{bad json"),
          { messageId: badId },
        );
        const dead = await until(() =>
          rabbit.consumer.get(rabbit.names.dead, { noAck: false }),
        );
        assert.equal(dead.properties.messageId, badId);
        assert.equal(dead.properties.headers["x-failure"], "INVALID_EVENT");
        rabbit.consumer.ack(dead);
        const unknown = { ...first.event, id: randomUUID() };
        await publish(unknown);
        const next = await until(() =>
          rabbit.consumer.get(rabbit.names.dead, { noAck: false }),
        );
        assert.equal(next.properties.messageId, unknown.id);
        rabbit.consumer.ack(next);
        assert.equal((await mails(first.email)).length, 1);
      },
    );
    await t.test(
      "closing consumer connection before ack requeues the original delivery",
      async () => {
        await worker.stopConsumer();
        const item = await register();
        await worker.dispatch();
        const message = await until(() =>
          rabbit.consumer.get(rabbit.names.work, { noAck: false }),
        );
        assert.equal(message.properties.messageId, item.event.id);
        await rabbit.close();
        rabbit = await RabbitTransport.open(settings.queue);
        worker = new WelcomeWorker(repo, rabbit, mailer);
        const redelivered = await until(() =>
          rabbit.consumer.get(rabbit.names.work, { noAck: false }),
        );
        assert.equal(redelivered.fields.redelivered, true);
        assert.equal(redelivered.properties.messageId, item.event.id);
        rabbit.consumer.nack(redelivered, false, true);
        await worker.startConsumer();
        await until(() => sent(item.event));
        assert.equal((await mails(item.email)).length, 1);
        await drained();
      },
    );
    await t.test(
      "worker CLI dispatches pending outbox and shuts down cleanly on SIGTERM",
      async () => {
        await worker.stopConsumer();
        const item = await register();
        const { spawn } = require("node:child_process");
        const child = spawn(
          process.execPath,
          [path.join(__dirname, "../dist/src/messaging/worker.js")],
          {
            cwd: path.join(__dirname, ".."),
            env: {
              ...process.env,
              QUEUE_ENABLED: "true",
              TEMPLATE_STORE: "postgres",
              QUEUE_NAMESPACE: settings.queue.namespace,
              QUEUE_RETRY_DELAY_MS: "300",
              SMTP_HOST: "127.0.0.1",
              SMTP_PORT: "1025",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += chunk;
        });
        child.stderr.on("data", (chunk) => {
          output += chunk;
        });
        const exit = new Promise((resolve) =>
          child.once("exit", (code, signal) => resolve({ code, signal })),
        );
        let timer;
        try {
          await until(() => sent(item.event));
          assert.match(output, /Welcome worker ready/);
          assert.equal((await mails(item.email)).length, 1);
        } finally {
          child.kill("SIGTERM");
        }
        try {
          const ended = await Promise.race([
            exit,
            new Promise((_, reject) => {
              timer = setTimeout(() => {
                child.kill("SIGKILL");
                reject(new Error("Worker failed to stop"));
              }, 10000);
            }),
          ]);
          assert.equal(ended.code, 0, output);
          assert.equal(ended.signal, null);
        } finally {
          clearTimeout(timer);
        }
      },
    );
    await t.test(
      "inactive account is skipped and acknowledged without sending welcome mail",
      async () => {
        await worker.stopConsumer();
        const item = await register();
        await pool.query("UPDATE users SET is_active=FALSE WHERE id=$1", [
          item.user.id,
        ]);
        await worker.dispatch();
        await worker.startConsumer();
        assert.equal((await until(() => sent(item.event))).status, "skipped");
        assert.equal((await mails(item.email)).length, 0);
        await drained();
      },
    );
  },
);
