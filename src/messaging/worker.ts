import "reflect-metadata";
import { config } from "dotenv";
import { Pool } from "pg";
import { setTimeout as delay } from "node:timers/promises";
import { rm, writeFile } from "node:fs/promises";
import { readConfig } from "../config";
import { RabbitTransport } from "./rabbit";
import { WelcomeRepository } from "./welcome-repository";
import { LocalWelcomeMailer } from "./welcome-mailer";
import { WelcomeWorker } from "./welcome-worker";
import { NotificationRepository } from "./notification-repository";
import { NotificationWorker } from "./notification-worker";
import { createClient } from "redis";

async function main() {
  config();
  const readyFile = process.env.WORKER_READY_FILE;
  const clearReady = async () => {
    if (readyFile) await rm(readyFile, { force: true });
  };
  await clearReady();
  const settings = readConfig();
  if (!settings.queue.enabled)
    throw new Error(
      "Enable QUEUE_ENABLED=true with PostgreSQL before starting the worker",
    );
  const mailer = new LocalWelcomeMailer(settings.queue);
  const pool = new Pool({
    ...settings.database,
    user: settings.database.username,
    connectionTimeoutMillis: 5000,
    max: Math.min(5, settings.database.poolSize),
  });
  pool.on("error", () => console.error("Worker database connection failed"));
  let stopping = false;
  let active: RabbitTransport | undefined;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await pool.query("SELECT event_id FROM welcome_email_deliveries LIMIT 0");
    await pool.query("SELECT id FROM notifications LIMIT 0");
    let redisClient: ReturnType<typeof createClient> | undefined;
    if (settings.cache.enabled) {
      redisClient = createClient({ url: settings.cache.url });
      redisClient.on("error", () => {});
      await redisClient.connect().catch(() => {});
    }
    while (!stopping) {
      let worker: WelcomeWorker | undefined;
      let notificationWorker: NotificationWorker | undefined;
      try {
        active = await RabbitTransport.open(settings.queue);
        let closed = false;
        active.connection.once("close", () => {
          closed = true;
        });
        worker = new WelcomeWorker(new WelcomeRepository(pool), active, mailer);
        notificationWorker = new NotificationWorker(
          new NotificationRepository(pool),
          active,
          redisClient,
        );
        await worker.startConsumer();
        await notificationWorker.startConsumer();
        if (readyFile) await writeFile(readyFile, "ready\n", { mode: 0o600 });
        console.log(
          "Worker ready: outbox → RabbitMQ (welcome email + template notifications)",
        );
        while (!stopping && !closed) {
          await worker.dispatch();
          await notificationWorker.dispatch();
          await delay(1000);
        }
      } catch {
        if (!stopping)
          console.error(
            "Worker unavailable; retrying in 3 seconds (outbox retained)",
          );
      } finally {
        await clearReady();
        await worker?.stopConsumer();
        await notificationWorker?.stopConsumer();
        await active?.close();
        active = undefined;
      }
      if (!stopping) await delay(3000);
    }
  } finally {
    await clearReady();
    await active?.close();
    await pool.end();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
main().catch(() => {
  console.error(
    "Welcome worker startup failed; check PostgreSQL, queue configuration and db:queue migration",
  );
  process.exitCode = 1;
});
