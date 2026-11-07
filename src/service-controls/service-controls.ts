import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  OnModuleInit,
  SetMetadata,
  applyDecorators,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHmac } from "node:crypto";
import { RATE_STORE, RateStore, RateBucket } from "./rate-store";
import { SERVICE_CONTROL_SETTINGS, ServiceControlSettings } from "./settings";
import { PolicyError } from "./policy-error";
import { ApiTooManyRequestsResponse } from "@nestjs/swagger";
export const RATE_SCOPE = Symbol("rate_scope");
export const RATE_SECRET = Symbol("rate_secret");
export type RateScope = "login" | "register" | "refresh" | "write";
export const RateLimited = (scope: RateScope) =>
  applyDecorators(
    SetMetadata(RATE_SCOPE, scope),
    ApiTooManyRequestsResponse({
      description: "Rate limited; never automatically replay a write",
      headers: {
        "Retry-After": {
          description: "Seconds before retrying",
          schema: { type: "integer", minimum: 1, maximum: 900 },
        },
      },
    }),
  );
type Client = {
  method: string;
  ip?: string;
  socket: { remoteAddress?: string };
  body?: { email?: unknown };
  user?: { id: string };
};
@Injectable()
export class ServiceControls implements OnModuleInit {
  constructor(
    @Inject(RATE_STORE) private readonly store: RateStore,
    @Inject(SERVICE_CONTROL_SETTINGS) readonly settings: ServiceControlSettings,
    @Inject(RATE_SECRET) private readonly secret: string,
  ) {}
  async onModuleInit() {
    try {
      await this.store.checkSchema();
    } catch {
      throw Error(
        "SERVICE_CONTROLS_SCHEMA_NOT_READY: run project migrations before starting",
      );
    }
  }
  async check(scope: RateScope, request: Client) {
    if (
      !this.settings.rateLimitsEnabled ||
      (scope === "write" &&
        !["POST", "PATCH", "DELETE"].includes(request.method))
    )
      return;
    const ip =
      (this.settings.trustProxyHops
        ? request.ip
        : request.socket.remoteAddress) || "unknown";
    const key = (value: string) =>
      createHmac("sha256", this.secret)
        .update("eru-rate-v1\0" + value)
        .digest("hex");
    let buckets: RateBucket[];
    if (scope === "login") {
      const email =
        typeof request.body?.email === "string" &&
        request.body.email.length <= 255
          ? request.body.email.trim().toLowerCase()
          : "invalid";
      buckets = [
        {
          key: key("login-ip\0" + ip),
          limit: this.settings.loginPerIp,
          windowSeconds: 900,
        },
        {
          key: key("login-identity\0" + ip + "\0" + email),
          limit: this.settings.loginPerIdentity,
          windowSeconds: 900,
        },
      ];
    } else if (scope === "write") {
      if (!request.user) return; // Authentication guard rejects unauthenticated writes first.
      buckets = [
        {
          key: key("write\0" + request.user.id),
          limit: this.settings.writesPerUser,
          windowSeconds: 60,
        },
      ];
    } else {
      buckets = [
        {
          key: key(scope + "\0" + ip),
          limit:
            scope === "register"
              ? this.settings.registerPerIp
              : this.settings.refreshPerIp,
          windowSeconds: scope === "register" ? 900 : 60,
        },
      ];
    }
    const retry = await this.store.consume(buckets, new Date());
    if (retry > 0)
      throw new PolicyError("RATE_LIMITED", Math.max(1, Math.min(900, retry)));
  }
}
@Injectable()
export class ServiceRateGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly controls: ServiceControls,
  ) {}
  async canActivate(context: ExecutionContext) {
    const scope = this.reflector.getAllAndOverride<RateScope>(RATE_SCOPE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (scope)
      await this.controls.check(scope, context.switchToHttp().getRequest());
    return true;
  }
}
