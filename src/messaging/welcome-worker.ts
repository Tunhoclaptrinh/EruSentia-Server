import type { ConsumeMessage } from "amqplib";
import { RabbitTransport } from "./rabbit";
import { parseRegistrationEvent, REGISTERED } from "./registration-event";
import {
  PermanentEventError,
  WelcomeMailer,
  WelcomeRepository,
} from "./welcome-repository";

export class WelcomeWorker {
  private tag?: string;
  private readonly inFlight = new Set<Promise<void>>();
  constructor(
    readonly repository: WelcomeRepository,
    readonly rabbit: RabbitTransport,
    readonly mailer: WelcomeMailer,
  ) {}
  dispatch() {
    return this.repository.dispatch((event) =>
      this.rabbit.publish(
        this.rabbit.names.exchange,
        REGISTERED,
        Buffer.from(JSON.stringify(event)),
        { messageId: event.id, type: event.type },
      ),
    );
  }
  async startConsumer() {
    const { consumerTag } = await this.rabbit.consumer.consume(
      this.rabbit.names.work,
      (message) => {
        if (!message) return;
        const task = this.handle(message).catch(async () => {
          // If forwarding/DB failed, keep the original unacked; closing the connection requeues it.
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
      let event;
      try {
        event = parseRegistrationEvent(
          message.content,
          message.properties.messageId,
        );
      } catch {
        permanent = true;
        throw new PermanentEventError("INVALID_EVENT");
      }
      await this.repository.deliver(event, this.mailer);
      this.rabbit.consumer.ack(message);
      return;
    } catch (error) {
      permanent ||= error instanceof PermanentEventError;
      const raw = message.properties.headers?.["x-attempt"];
      const attempt =
        typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 3
          ? raw
          : 0;
      const dead = permanent || attempt >= 2; // initial delivery + two delayed retries
      await this.rabbit.publish(
        "",
        dead ? this.rabbit.names.dead : this.rabbit.names.retry,
        message.content,
        {
          messageId: message.properties.messageId,
          type: message.properties.type,
          headers: {
            "x-attempt": attempt + 1,
            "x-failure": permanent ? "INVALID_EVENT" : "DELIVERY_FAILED",
          },
        },
      );
      // Acknowledge the original only after the replacement is confirmed and routed.
      this.rabbit.consumer.ack(message);
    }
  }
  async stopConsumer() {
    if (this.tag) await this.rabbit.consumer.cancel(this.tag).catch(() => {});
    await Promise.allSettled([...this.inFlight]);
    this.tag = undefined;
  }
}
