import { randomUUID } from "node:crypto";
import * as amqp from "amqplib";
import type { AppConfig } from "../config";
import { REGISTERED } from "./registration-event";

export const TEMPLATE_VERSION_PUBLISHED = "template.version_published";

export function queueNames(namespace: string) {
  return {
    exchange: `${namespace}.events`,
    work: `${namespace}.welcome`,
    retry: `${namespace}.welcome.retry`,
    deadExchange: `${namespace}.dead`,
    dead: `${namespace}.welcome.dead`,
    notificationWork: `${namespace}.notification`,
    notificationRetry: `${namespace}.notification.retry`,
    notificationDead: `${namespace}.notification.dead`,
  };
}

export class RabbitTransport {
  private constructor(
    readonly connection: amqp.ChannelModel,
    readonly publisher: amqp.ConfirmChannel,
    readonly consumer: amqp.Channel,
    readonly names: ReturnType<typeof queueNames>,
  ) {}
  static async open(config: AppConfig["queue"]) {
    const connection = await amqp.connect(config.url, { timeout: 5000 });
    // Handle error events; callers receive operation failures/close without printing credentials.
    connection.on("error", () => {});
    try {
      const publisher = await connection.createConfirmChannel();
      const consumer = await connection.createChannel();
      publisher.on("error", () => {});
      consumer.on("error", () => {});
      const names = queueNames(config.namespace);
      await publisher.assertExchange(names.exchange, "topic", {
        durable: true,
      });
      await publisher.assertExchange(names.deadExchange, "direct", {
        durable: true,
      });
      await publisher.assertQueue(names.dead, {
        durable: true,
        arguments: { "x-queue-type": "quorum" },
      });
      await publisher.bindQueue(names.dead, names.deadExchange, "welcome.dead");
      await publisher.assertQueue(names.notificationDead, {
        durable: true,
        arguments: { "x-queue-type": "quorum" },
      });
      await publisher.bindQueue(
        names.notificationDead,
        names.deadExchange,
        "notification.dead",
      );
      await publisher.assertQueue(names.work, {
        durable: true,
        arguments: {
          "x-queue-type": "quorum",
          "x-delivery-limit": 3,
          "x-dead-letter-exchange": names.deadExchange,
          "x-dead-letter-routing-key": "welcome.dead",
          "x-dead-letter-strategy": "at-least-once",
          "x-overflow": "reject-publish",
        },
      });
      await publisher.bindQueue(names.work, names.exchange, REGISTERED);
      await publisher.assertQueue(names.notificationWork, {
        durable: true,
        arguments: {
          "x-queue-type": "quorum",
          "x-delivery-limit": 3,
          "x-dead-letter-exchange": names.deadExchange,
          "x-dead-letter-routing-key": "notification.dead",
          "x-dead-letter-strategy": "at-least-once",
          "x-overflow": "reject-publish",
        },
      });
      await publisher.bindQueue(
        names.notificationWork,
        names.exchange,
        TEMPLATE_VERSION_PUBLISHED,
      );
      await publisher.assertQueue(names.retry, {
        durable: true,
        arguments: {
          "x-queue-type": "quorum",
          "x-message-ttl": config.retryDelayMs,
          "x-dead-letter-exchange": names.exchange,
          "x-dead-letter-routing-key": REGISTERED,
          "x-dead-letter-strategy": "at-least-once",
          "x-overflow": "reject-publish",
        },
      });
      await publisher.assertQueue(names.notificationRetry, {
        durable: true,
        arguments: {
          "x-queue-type": "quorum",
          "x-message-ttl": config.retryDelayMs,
          "x-dead-letter-exchange": names.exchange,
          "x-dead-letter-routing-key": TEMPLATE_VERSION_PUBLISHED,
          "x-dead-letter-strategy": "at-least-once",
          "x-overflow": "reject-publish",
        },
      });
      await consumer.prefetch(1);
      return new RabbitTransport(connection, publisher, consumer, names);
    } catch (error) {
      await connection.close().catch(() => {});
      throw error;
    }
  }
  publish(
    exchange: string,
    routingKey: string,
    body: Buffer,
    options: amqp.Options.Publish,
  ) {
    const correlationId = randomUUID();
    return new Promise<void>((resolve, reject) => {
      let returned = false;
      const onReturn = (message: amqp.Message) => {
        if (message.properties.correlationId === correlationId) returned = true;
      };
      const onClose = () => finish(new Error("BROKER_CHANNEL_CLOSED"));
      const timer = setTimeout(
        () => finish(new Error("PUBLISH_CONFIRM_TIMEOUT")),
        10000,
      );
      const finish = (error?: Error | null) => {
        clearTimeout(timer);
        this.publisher.removeListener("return", onReturn);
        this.publisher.removeListener("close", onClose);
        if (error) reject(error);
        else if (returned) reject(new Error("UNROUTABLE_MESSAGE"));
        else resolve();
      };
      this.publisher.on("return", onReturn);
      this.publisher.once("close", onClose);
      try {
        this.publisher.publish(
          exchange,
          routingKey,
          body,
          {
            ...options,
            correlationId,
            persistent: true,
            mandatory: true,
            contentType: "application/json",
          },
          (error) => finish(error),
        );
      } catch {
        finish(new Error("PUBLISH_FAILED"));
      }
    });
  }
  async close() {
    await this.connection.close().catch(() => {});
  }
}
