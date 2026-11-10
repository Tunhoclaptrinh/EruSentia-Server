import type { ConsumeMessage } from "amqplib";
import type { createClient } from "redis";
import { RabbitTransport, TEMPLATE_VERSION_PUBLISHED } from "./rabbit";
import {
  parseTemplatePublishedEvent,
  TemplatePublishedEvent,
} from "./template-notification-event";
import {
  NotificationRepository,
  PermanentNotificationError,
} from "./notification-repository";

export class NotificationWorker {
  private tag?: string;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    readonly repository: NotificationRepository,
    readonly rabbit: RabbitTransport,
    readonly redis?: ReturnType<typeof createClient>,
  ) {}

  dispatch() {
    return this.repository.dispatch((event: TemplatePublishedEvent, eventId: string) =>
      this.rabbit.publish(
        this.rabbit.names.exchange,
        TEMPLATE_VERSION_PUBLISHED,
        Buffer.from(JSON.stringify(event)),
        { messageId: eventId, type: TEMPLATE_VERSION_PUBLISHED },
      ),
    );
  }

  async startConsumer() {
    const { consumerTag } = await this.rabbit.consumer.consume(
      this.rabbit.names.notificationWork,
      (message) => {
        if (!message) return;
        const task = this.handle(message).catch(async () => {
          await this.rabbit.close();
        });
        this.inFlight.add(task);
        void task.finally(() => this.inFlight.delete(task));
      },
      { noAck: false },
    );
    this.tag = consumerTag;
  }

  private async handle(message: ConsumeMessage) {
    let permanent = false;
    try {
      let event: TemplatePublishedEvent;
      try {
        event = parseTemplatePublishedEvent(message.content);
      } catch {
        permanent = true;
        throw new PermanentNotificationError("INVALID_EVENT");
      }

      await this.repository.deliver(
        event,
        message.properties.messageId || "unknown",
        this.redis,
      );
      this.rabbit.consumer.ack(message);
      return;
    } catch (error) {
      permanent ||= error instanceof PermanentNotificationError;
      const raw = message.properties.headers?.["x-attempt"];
      const attempt =
        typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 3
          ? raw
          : 0;
      const dead = permanent || attempt >= 2;

      await this.rabbit.publish(
        "",
        dead
          ? this.rabbit.names.notificationDead
          : this.rabbit.names.notificationRetry,
        message.content,
        {
          messageId: message.properties.messageId,
          correlationId: message.properties.correlationId,
          type: message.properties.type,
          headers: {
            ...message.properties.headers,
            "x-attempt": attempt + 1,
            "x-exception-message":
              error instanceof Error ? error.message : "Unknown error",
          },
        },
      );
      this.rabbit.consumer.ack(message);
    }
  }

  async stopConsumer() {
    if (this.tag) {
      await this.rabbit.consumer.cancel(this.tag).catch(() => {});
      this.tag = undefined;
    }
    await Promise.allSettled([...this.inFlight]);
  }
}
