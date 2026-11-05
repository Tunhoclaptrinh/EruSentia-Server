import { randomUUID } from "node:crypto";
import { UUID_PATTERN } from "../common/uuid.pipe";

export const REGISTRATION_EVENTS_ENABLED = Symbol(
  "registration-events-enabled",
);
export const REGISTERED = "user.registered.v1";
export interface RegistrationEvent {
  id: string;
  type: typeof REGISTERED;
  schemaVersion: 1;
  userId: string;
  occurredAt: string;
}
export function registrationEvent(userId: string): RegistrationEvent {
  return {
    id: randomUUID(),
    type: REGISTERED,
    schemaVersion: 1,
    userId,
    occurredAt: new Date().toISOString(),
  };
}
export function parseRegistrationEvent(
  content: Buffer,
  messageId?: string,
): RegistrationEvent {
  if (content.length > 4096) throw new Error("INVALID_EVENT");
  const value = JSON.parse(content.toString("utf8"));
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !==
      "id,occurredAt,schemaVersion,type,userId" ||
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id) ||
    typeof value.userId !== "string" ||
    !UUID_PATTERN.test(value.userId) ||
    value.id !== messageId ||
    value.type !== REGISTERED ||
    value.schemaVersion !== 1 ||
    typeof value.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(value.occurredAt))
  ) {
    throw new Error("INVALID_EVENT");
  }
  return value;
}
