import { ConflictException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  active,
  AuthStore,
  RefreshSession,
  LoginSession,
  EmailPurpose,
  Role,
  UserAccount,
  userIdentity,
} from "../auth-store";

@Injectable()
export class MemoryAuthStore implements AuthStore {
  private readonly users = new Map<string, UserAccount>();
  private readonly sessions = new Map<string, RefreshSession>();

  async createUser(input: { email: string; passwordHash: string; role: Role }) {
    if ([...this.users.values()].some((u) => u.email === input.email))
      throw new ConflictException("Email is already registered");
    const now = new Date();
    const user: UserAccount = {
      ...input,
      id: randomUUID(),
      isActive: true,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(user.id, user);
    return structuredClone(user);
  }
  async findByEmail(email: string) {
    return structuredClone(
      [...this.users.values()].find((u) => u.email === email) ?? null,
    );
  }
  async findById(id: string) {
    return structuredClone(this.users.get(id) ?? null);
  }
  async listUsers(page: number, size: number) {
    const rows = [...this.users.values()]
      .filter((u) => !u.deletedAt)
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      );
    return {
      data: rows.slice((page - 1) * size, page * size).map(userIdentity),
      page,
      size,
      totalPages: Math.ceil(rows.length / size),
      totalElements: rows.length,
    };
  }
  private readonly emailActions = new Map<
    string,
    {
      userId: string;
      purpose: EmailPurpose;
      hash: string;
      requestedAt: Date;
      expiresAt: Date;
      usedAt: Date | null;
    }
  >();
  private readonly verifiedEmails = new Map<string, Date>();
  async addSessionIfCredentialsMatch(
    session: RefreshSession,
    expectedPasswordHash: string,
  ) {
    const user = this.users.get(session.userId);
    if (!active(user || null) || user!.passwordHash !== expectedPasswordHash)
      return false;
    this.sessions.set(session.tokenHash, structuredClone(session));
    return true;
  }
  async checkEmailSchema() {}
  async emailVerifiedAt(userId: string) {
    return structuredClone(this.verifiedEmails.get(userId) || null);
  }
  async issueEmailAction(
    userId: string,
    purpose: EmailPurpose,
    hash: string,
    now: Date,
    expiresAt: Date,
  ) {
    if (!active(this.users.get(userId) || null)) return false;
    const key = userId + ":" + purpose,
      previous = this.emailActions.get(key);
    if (previous && now.getTime() - previous.requestedAt.getTime() < 60000)
      return false;
    this.emailActions.set(key, {
      userId,
      purpose,
      hash,
      requestedAt: now,
      expiresAt,
      usedAt: null,
    });
    return true;
  }
  async consumeEmailVerification(hash: string, now: Date) {
    const row = [...this.emailActions.values()].find(
      (row) => row.hash === hash && row.purpose === "verify",
    );
    if (
      !row ||
      row.usedAt ||
      row.expiresAt <= now ||
      !active(this.users.get(row.userId) || null)
    )
      return false;
    row.usedAt = now;
    if (!this.verifiedEmails.has(row.userId))
      this.verifiedEmails.set(row.userId, now);
    return true;
  }
  async consumePasswordReset(hash: string, passwordHash: string, now: Date) {
    const row = [...this.emailActions.values()].find(
      (row) => row.hash === hash && row.purpose === "reset",
    );
    if (!row || row.usedAt || row.expiresAt <= now) return null;
    const user = this.users.get(row.userId);
    if (!active(user || null)) return null;
    row.usedAt = now;
    user!.passwordHash = passwordHash;
    user!.updatedAt = now;
    for (const session of this.sessions.values())
      if (session.userId === row.userId) session.revokedAt = now;
    return user!.email;
  }
  async addSession(session: RefreshSession) {
    this.sessions.set(session.tokenHash, structuredClone(session));
  }
  private revoke(familyId: string, now: Date) {
    for (const session of this.sessions.values())
      if (session.familyId === familyId) session.revokedAt = now;
  }
  async rotateSession(
    hash: string,
    nextHash: string,
    nextId: string,
    now: Date,
  ) {
    // No await in the check/mutation: atomic within this single-process demo store.
    const old = this.sessions.get(hash);
    if (!old) return null;
    if (old.usedAt || old.revokedAt) {
      this.revoke(old.familyId, now);
      return null;
    }
    const user = this.users.get(old.userId) ?? null;
    if (old.expiresAt <= now || !active(user)) {
      this.revoke(old.familyId, now);
      return null;
    }
    old.usedAt = now;
    const session: RefreshSession = {
      ...old,
      id: nextId,
      tokenHash: nextHash,
      usedAt: null,
      createdAt: now,
    };
    this.sessions.set(nextHash, session);
    return structuredClone({ session, user });
  }
  async revokeSessionFamily(hash: string, now: Date) {
    const session = this.sessions.get(hash);
    if (session) this.revoke(session.familyId, now);
  }
  async listSessions(userId: string, page: number, size: number, now: Date) {
    const families = new Map<string, LoginSession & { active: boolean }>();
    for (const row of this.sessions.values()) {
      if (row.userId !== userId) continue;
      const group = families.get(row.familyId) || {
        id: row.familyId,
        createdAt: row.createdAt,
        lastRefreshedAt: row.createdAt,
        expiresAt: row.expiresAt,
        active: false,
      };
      if (row.createdAt < group.createdAt) group.createdAt = row.createdAt;
      if (row.createdAt > group.lastRefreshedAt)
        group.lastRefreshedAt = row.createdAt;
      if (!row.usedAt && !row.revokedAt && row.expiresAt > now)
        group.active = true;
      families.set(row.familyId, group);
    }
    const data = [...families.values()]
      .filter((group) => group.active)
      .map(({ active: _, ...row }) => row)
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      );
    return structuredClone({
      data: data.slice((page - 1) * size, page * size),
      page,
      size,
      totalElements: data.length,
      totalPages: Math.ceil(data.length / size),
    });
  }
  async revokeOwnedSession(userId: string, familyId: string, now: Date) {
    if (
      [...this.sessions.values()].some(
        (s) => s.userId === userId && s.familyId === familyId,
      )
    )
      this.revoke(familyId, now);
  }
  async revokeOtherSessions(
    userId: string,
    currentFamilyId: string,
    now: Date,
  ) {
    for (const session of this.sessions.values())
      if (session.userId === userId && session.familyId !== currentFamilyId)
        session.revokedAt = now;
  }
  async isSessionActive(userId: string, familyId: string, now: Date) {
    return [...this.sessions.values()].some(
      (s) =>
        s.userId === userId &&
        s.familyId === familyId &&
        !s.usedAt &&
        !s.revokedAt &&
        s.expiresAt > now,
    );
  }
}
