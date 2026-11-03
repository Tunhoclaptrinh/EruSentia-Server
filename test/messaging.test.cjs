const test = require("node:test");
const assert = require("node:assert/strict");
const { readConfig } = require("../dist/src/config");
const {
  registrationEvent,
  parseRegistrationEvent,
} = require("../dist/src/messaging/registration-event");

test("queue configuration is opt-in, PostgreSQL-only, with strict namespace and URL validation", () => {
  assert.equal(readConfig({}).queue.enabled, false);
  assert.throws(() => readConfig({ QUEUE_ENABLED: "yes" }), /QUEUE_ENABLED/);
  assert.throws(
    () => readConfig({ QUEUE_ENABLED: "true", TEMPLATE_STORE: "memory" }),
    /postgres/,
  );
  assert.throws(
    () => readConfig({ AMQP_URL: "https://example.test" }),
    /AMQP_URL/,
  );
  assert.throws(
    () => readConfig({ QUEUE_NAMESPACE: "bad.name" }),
    /QUEUE_NAMESPACE/,
  );
  assert.throws(
    () => readConfig({ QUEUE_RETRY_DELAY_MS: "0" }),
    /QUEUE_RETRY_DELAY_MS/,
  );
  assert.equal(readConfig({ QUEUE_ENABLED: "true" }).queue.enabled, true);
});

test("registration event carries identifiers only and rejects unknown fields, oversized or mismatched messages", () => {
  const event = registrationEvent("a0000000-0000-0000-0000-000000000001");
  const body = Buffer.from(JSON.stringify(event));
  assert.deepEqual(parseRegistrationEvent(body, event.id), event);
  assert.throws(() => parseRegistrationEvent(body, "wrong"));
  for (const payload of [
    null,
    {},
    { ...event, password: "forbidden" },
    { ...event, schemaVersion: 2 },
    { ...event, userId: "bad" },
    { ...event, occurredAt: "invalid" },
  ])
    assert.throws(() =>
      parseRegistrationEvent(Buffer.from(JSON.stringify(payload)), event.id),
    );
  assert.throws(() => parseRegistrationEvent(Buffer.alloc(4097), event.id));
});
