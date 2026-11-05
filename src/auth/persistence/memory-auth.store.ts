import { ConflictException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  active,
  AuthStore,
  RefreshSession,
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
