import { createTransport } from "nodemailer";
import type { AppConfig } from "../config";
import type { RegistrationEvent } from "./registration-event";
import type { WelcomeMailer } from "./welcome-repository";

export class LocalWelcomeMailer implements WelcomeMailer {
  private readonly transport;
  constructor(config: AppConfig["queue"]) {
    // Loopback or the exact Mailpit service in our private Compose network.
    // Arbitrary SMTP hosts still require a separate authentication/TLS design.
    if (!["127.0.0.1", "localhost", "::1", "mailpit"].includes(config.smtpHost))
      throw new Error("WELCOME_SMTP_MUST_BE_LOCAL_MAILPIT");
    this.transport = createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: false,
      ignoreTLS: true,
      connectionTimeout: 3000,
      greetingTimeout: 3000,
      socketTimeout: 5000,
    });
  }
  async send(event: RegistrationEvent, email: string) {
    const messageId = `<${event.id}@erusentia.local>`;
    const info = await this.transport.sendMail({
      from: "EruSentia <noreply@erusentia.local>",
      to: email,
      subject: "Chào mừng bạn đến với EruSentia",
      messageId,
      text: "Chào mừng bạn đến với EruSentia!\n\nCảm ơn bạn đã tham gia cộng đồng EruSentia.",
      html: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:32px auto;color:#253047"><h1 style="color:#6449c4">EruSentia</h1><h2>Chào mừng bạn!</h2><p>Cảm ơn bạn đã tham gia cộng đồng EruSentia.</p></div>',
    });
    if (!info.accepted?.length || info.rejected?.length)
      throw new Error("SMTP_NOT_ACCEPTED");
    return messageId;
  }
}
