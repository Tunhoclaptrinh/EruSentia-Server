const test = require("node:test");
const assert = require("node:assert/strict");
const { readConfig } = require("../dist/src/config");

test("Mailpit supports its exact Docker service name while arbitrary SMTP hosts remain blocked", () => {
  const {
    LocalWelcomeMailer,
  } = require("../dist/src/messaging/welcome-mailer");
  const settings = readConfig({}).queue;
  assert.doesNotThrow(
    () => new LocalWelcomeMailer({ ...settings, smtpHost: "mailpit" }),
  );
  assert.throws(
    () => new LocalWelcomeMailer({ ...settings, smtpHost: "smtp.example.com" }),
    /WELCOME_SMTP_MUST_BE_LOCAL_MAILPIT/,
  );
});
