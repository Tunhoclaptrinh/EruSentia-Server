import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AppConfig } from "../config";
import { UUID_PATTERN } from "../common/uuid.pipe";
import {
  active,
  AUTH_STORE,
  AuthStore,
  RefreshSession,
  UserAccount,
  userIdentity,
} from "./auth-store";
import { LoginDto, RegisterDto } from "./auth.dto";
import { Passwords } from "./passwords";

export const AUTH_SETTINGS = Symbol("AUTH_SETTINGS");
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_STORE) private readonly store: AuthStore,
    private readonly passwords: Passwords,
    private readonly jwt: JwtService,
    @Inject(AUTH_SETTINGS) private readonly settings: AppConfig["auth"],
  ) {}
  async register(input: RegisterDto) {
    const user = await this.store.createUser({
      email: input.email,
      passwordHash: await this.passwords.hash(input.password),
      role: "user",
    });
    return userIdentity(user);
  }
  async login(input: LoginDto) {
    const user = await this.store.findByEmail(input.email);
    const verified = await this.passwords.verify(
      input.password,
      user?.passwordHash,
    );
    if (!verified || !active(user))
      throw new UnauthorizedException("Invalid email or password");
    const refreshToken = randomBytes(32).toString("base64url");
    const now = new Date();
    const session: RefreshSession = {
      id: randomUUID(),
      familyId: randomUUID(),
      userId: user.id,
      tokenHash: tokenHash(refreshToken),
      createdAt: now,
      expiresAt: new Date(
        now.getTime() + this.settings.refreshTtlSeconds * 1000,
      ),
      usedAt: null,
      revokedAt: null,
    };
    await this.store.addSession(session);
    return this.tokens(user, session, refreshToken);
  }
  private async tokens(
    user: UserAccount,
    session: RefreshSession,
    refreshToken: string,
  ) {
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      sid: session.familyId,
      tokenUse: "access",
      jti: randomUUID(),
    });
    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer" as const,
      expiresIn: this.settings.accessTtlSeconds,
      refreshExpiresAt: session.expiresAt,
      user: userIdentity(user),
    };
  }
  async refresh(token: string) {
    const next = randomBytes(32).toString("base64url");
    const rotated = await this.store.rotateSession(
      tokenHash(token),
      tokenHash(next),
      randomUUID(),
      new Date(),
    );
    if (!rotated)
      throw new UnauthorizedException("Invalid or expired refresh token");
    return this.tokens(rotated.user, rotated.session, next);
  }
  logout(token: string) {
    return this.store.revokeSessionFamily(tokenHash(token), new Date());
  }
  async authenticate(token: string) {
    return (await this.authenticateSession(token)).user;
  }
  async authenticateSession(token: string) {
    let payload: {
      sub?: string;
      sid?: string;
      tokenUse?: string;
      exp?: number;
    };
    try {
      payload = await this.jwt.verifyAsync(token, {
        algorithms: ["HS256"],
        issuer: "erusentia-server",
        audience: "erusentia-api",
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }
    if (
      payload.tokenUse !== "access" ||
      !payload.sub ||
      !UUID_PATTERN.test(payload.sub) ||
      !payload.sid ||
      !UUID_PATTERN.test(payload.sid) ||
      !Number.isInteger(payload.exp) ||
      payload.exp! <= Date.now() / 1000
    )
      throw new UnauthorizedException("Invalid or expired access token");
    const [user, validSession] = await Promise.all([
      this.store.findById(payload.sub),
      this.store.isSessionActive(payload.sub, payload.sid, new Date()),
    ]);
    if (!active(user) || !validSession)
      throw new UnauthorizedException("Session is no longer active");
    return { user: userIdentity(user), sessionId: payload.sid };
  }
}
