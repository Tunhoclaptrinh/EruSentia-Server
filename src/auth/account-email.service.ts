import {
  BadRequestException,
  Inject,
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
  HttpException,
} from "@nestjs/common";
import { randomBytes, createHash } from "node:crypto";
import { AUTH_STORE, AuthStore, active, EmailPurpose } from "./auth-store";
import { Passwords } from "./passwords";
import {
  AccountEmailMailer,
  ACCOUNT_EMAIL_CONFIG,
  AccountEmailConfig,
} from "./account-email.mailer";
class AccountEmailRateLimit extends HttpException {
  readonly retryAfter: number;
  constructor(seconds: number) {
    super("Too many account email requests", 429);
    this.retryAfter = seconds;
  }
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
@Injectable()
export class AccountEmailService implements OnModuleInit {
  private readonly limits = new Map<string, { count: number; until: number }>();
  constructor(
    @Inject(AUTH_STORE) private readonly store: AuthStore,
    private readonly passwords: Passwords,
    private readonly mailer: AccountEmailMailer,
    @Inject(ACCOUNT_EMAIL_CONFIG) private readonly config: AccountEmailConfig,
  ) {}
  async onModuleInit() {
    if (this.enabled())
      try {
        await this.store.checkEmailSchema();
      } catch {
        throw Error(
          "ACCOUNT_EMAIL_SCHEMA_NOT_READY: migrate the optional local email module before starting",
        );
      }
  }
  enabled() {
    return this.config.enabled;
  }
  private check() {
    if (!this.enabled())
      throw new ServiceUnavailableException("Account email is not enabled");
  }
  limit(ip: string, confirmation = false) {
    this.check();
    const now = Date.now(),
      key = (confirmation ? "confirm:" : "request:") + ip;
    for (const [entry, bucket] of this.limits)
      if (bucket.until <= now) this.limits.delete(entry);
    let bucket = this.limits.get(key);
    if (!bucket) {
      if (this.limits.size >= 5000) throw new AccountEmailRateLimit(900);
      bucket = { count: 0, until: now + 15 * 60000 };
      this.limits.set(key, bucket);
    }
    if (++bucket.count > (confirmation ? 50 : 20))
      throw new AccountEmailRateLimit(
        Math.max(1, Math.ceil((bucket.until - now) / 1000)),
      );
  }
  async status(userId: string) {
    this.check();
    return { emailVerifiedAt: await this.store.emailVerifiedAt(userId) };
  }
  async sendVerification(userId: string) {
    this.check();
    const user = await this.store.findById(userId);
    if (active(user) && !(await this.store.emailVerifiedAt(userId)))
      await this.issue(user.id, user.email, "verify");
  }
  async forgot(email: string) {
    this.check();
    const started = Date.now();
    try {
      const user = await this.store.findByEmail(email);
      if (active(user)) await this.issue(user.id, user.email, "reset");
    } finally {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, 250 - (Date.now() - started))),
      );
    }
  }
  private async issue(userId: string, email: string, purpose: EmailPurpose) {
    if (!this.mailer.available()) return;
    const token = randomBytes(32).toString("base64url"),
      now = new Date(),
      expiresAt = new Date(
        now.getTime() + (purpose === "verify" ? 24 * 60 : 15) * 60000,
      );
    if (
      await this.store.issueEmailAction(
        userId,
        purpose,
        hash(token),
        now,
        expiresAt,
      )
    )
      this.mailer.send(email, purpose, token);
  }
  async verify(token: string) {
    this.check();
    if (!(await this.store.consumeEmailVerification(hash(token), new Date())))
      throw new BadRequestException("Invalid or expired action code");
  }
  async reset(token: string, password: string) {
    this.check();
    const email = await this.store.consumePasswordReset(
      hash(token),
      await this.passwords.hash(password),
      new Date(),
    );
    if (!email) throw new BadRequestException("Invalid or expired action code");
    this.mailer.send(email, "changed");
  }
}
