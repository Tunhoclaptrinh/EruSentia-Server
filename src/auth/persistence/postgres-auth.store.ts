import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  DataSource,
  EntityManager,
  IsNull,
  MoreThan,
  QueryFailedError,
  Repository,
} from "typeorm";
import { AuthorEntity } from "../../templates/persistence/entities";
import {
  active,
  AuthStore,
  RefreshSession,
  LoginSession,
  EmailPurpose,
  Role,
  userIdentity,
} from "../auth-store";
import {
  registrationEvent,
  REGISTRATION_EVENTS_ENABLED,
} from "../../messaging/registration-event";
import { RefreshSessionEntity } from "./refresh-session.entity";

@Injectable()
export class PostgresAuthStore implements AuthStore {
  constructor(
    @InjectRepository(AuthorEntity)
    private readonly users: Repository<AuthorEntity>,
    @InjectRepository(RefreshSessionEntity)
    private readonly sessions: Repository<RefreshSessionEntity>,
    private readonly dataSource: DataSource,
    @Inject(REGISTRATION_EVENTS_ENABLED)
    private readonly eventsEnabled: boolean,
  ) {}
  async createUser(input: { email: string; passwordHash: string; role: Role }) {
    try {
      if (!this.eventsEnabled)
        return await this.users.save(this.users.create(input));
      return await this.dataSource.transaction(async (manager) => {
        const user = await manager.save(
          AuthorEntity,
          manager.create(AuthorEntity, input),
        );
        const event = registrationEvent(user.id);
        await manager.query(
          "INSERT INTO message_outbox (id,event_type,payload) VALUES ($1,$2,$3::jsonb)",
          [event.id, event.type, JSON.stringify(event)],
        );
        return user;
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        error.driverError.code === "23505"
      )
        throw new ConflictException("Email is already registered");
      throw error;
    }
  }
  findByEmail(email: string) {
    return this.users
      .createQueryBuilder("u")
      .withDeleted()
      .addSelect("u.passwordHash")
      .where("LOWER(u.email) = :email", { email })
      .getOne();
  }
  findById(id: string) {
    return this.users.findOne({ where: { id }, withDeleted: true });
  }
  findCredentialsById(id: string) {
    return this.users
      .createQueryBuilder("u")
      .withDeleted()
      .addSelect("u.passwordHash")
      .where("u.id=:id", { id })
      .getOne();
  }
  async listUsers(page: number, size: number) {
    const [users, total] = await this.users.findAndCount({
      order: { createdAt: "ASC", id: "ASC" },
      skip: (page - 1) * size,
      take: size,
    });
    return {
      data: users.map(userIdentity),
      page,
      size,
      totalPages: Math.ceil(total / size),
      totalElements: total,
    };
  }
  async addSessionIfCredentialsMatch(
    session: RefreshSession,
    expectedPasswordHash: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const [user] = await manager.query(
        "SELECT password_hash,is_active,deleted_at FROM users WHERE id=$1 FOR NO KEY UPDATE",
        [session.userId],
      );
      if (
        !user ||
        !user.is_active ||
        user.deleted_at ||
        user.password_hash !== expectedPasswordHash
      )
        return false;
      await manager.insert(RefreshSessionEntity, session);
      return true;
    });
  }
  async checkEmailSchema() {
    await this.dataSource.query(
      "SELECT user_id,purpose,token_hash,requested_at,expires_at,used_at FROM auth_email_actions LIMIT 0",
    );
    await this.dataSource.query(
      "SELECT user_id,verified_at FROM auth_email_verifications LIMIT 0",
    );
  }
  async emailVerifiedAt(userId: string) {
    const [row] = await this.dataSource.query(
      "SELECT verified_at FROM auth_email_verifications WHERE user_id=$1",
      [userId],
    );
    return row?.verified_at || null;
  }
  async issueEmailAction(
    userId: string,
    purpose: EmailPurpose,
    hash: string,
    now: Date,
    expiresAt: Date,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const [user] = await manager.query(
        "SELECT is_active,deleted_at FROM users WHERE id=$1 FOR NO KEY UPDATE",
        [userId],
      );
      if (!user || !user.is_active || user.deleted_at) return false;
      const [previous] = await manager.query(
        "SELECT requested_at FROM auth_email_actions WHERE user_id=$1 AND purpose=$2",
        [userId, purpose],
      );
      if (previous && now.getTime() - previous.requested_at.getTime() < 60000)
        return false;
      await manager.query(
        `INSERT INTO auth_email_actions(user_id,purpose,token_hash,requested_at,expires_at) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(user_id,purpose) DO UPDATE SET token_hash=EXCLUDED.token_hash,requested_at=EXCLUDED.requested_at,expires_at=EXCLUDED.expires_at,used_at=NULL`,
        [userId, purpose, hash, now, expiresAt],
      );
      return true;
    });
  }
  private async emailActionLock(
    manager: EntityManager,
    hash: string,
    purpose: EmailPurpose,
    now: Date,
  ) {
    const [hint] = await manager.query(
      "SELECT user_id FROM auth_email_actions WHERE token_hash=$1 AND purpose=$2",
      [hash, purpose],
    );
    if (!hint) return null;
    // NO KEY UPDATE serializes password changes with login without blocking session FK KEY SHARE.
    // FOR UPDATE here would deadlock against rotation holding a family advisory lock.
    const [user] = await manager.query(
      "SELECT id,email,is_active,deleted_at FROM users WHERE id=$1 FOR NO KEY UPDATE",
      [hint.user_id],
    );
    if (!user || !user.is_active || user.deleted_at) return null;
    const [row] = await manager.query(
      "SELECT * FROM auth_email_actions WHERE token_hash=$1 AND purpose=$2 FOR UPDATE",
      [hash, purpose],
    );
    if (!row || row.used_at || row.expires_at <= now) return null;
    return user as { id: string; email: string };
  }
  async consumeEmailVerification(hash: string, now: Date) {
    return this.dataSource.transaction(async (manager) => {
      const user = await this.emailActionLock(manager, hash, "verify", now);
      if (!user) return false;
      await manager.query(
        "UPDATE auth_email_actions SET used_at=$2 WHERE token_hash=$1",
        [hash, now],
      );
      await manager.query(
        "INSERT INTO auth_email_verifications(user_id,verified_at) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING",
        [user.id, now],
      );
      return true;
    });
  }
  async consumePasswordReset(hash: string, passwordHash: string, now: Date) {
    return this.dataSource.transaction(async (manager) => {
      const user = await this.emailActionLock(manager, hash, "reset", now);
      if (!user) return null;
      const families: { family_id: string }[] = await manager.query(
        "SELECT DISTINCT family_id FROM auth_refresh_sessions WHERE user_id=$1 ORDER BY family_id",
        [user.id],
      );
      for (const row of families)
        await manager.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [row.family_id],
        );
      await manager.query(
        "UPDATE users SET password_hash=$2,updated_at=$3 WHERE id=$1",
        [user.id, passwordHash, now],
      );
      await manager.query(
        "UPDATE auth_refresh_sessions SET revoked_at=$2 WHERE user_id=$1",
        [user.id, now],
      );
      await manager.query(
        "UPDATE auth_email_actions SET used_at=$2 WHERE token_hash=$1",
        [hash, now],
      );
      return user.email;
    });
  }
  async addSession(session: RefreshSession) {
    await this.sessions.insert(session);
  }

  private async familyLock(manager: EntityManager, hash: string) {
    const row = await manager.findOneBy(RefreshSessionEntity, {
      tokenHash: hash,
    });
    if (!row) return null;
    // Serialize every rotation/logout/replay for the same family, including different
    // generations of tokens. A token-row lock alone can miss a newly rotated child.
    await manager.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [row.familyId],
    );
    return manager.findOne(RefreshSessionEntity, {
      where: { id: row.id },
      lock: { mode: "pessimistic_write" },
    });
  }
  async rotateSession(
    hash: string,
    nextHash: string,
    nextId: string,
    now: Date,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const old = await this.familyLock(manager, hash);
      if (!old) return null;
      const user = await manager.findOne(AuthorEntity, {
        where: { id: old.userId },
        withDeleted: true,
      });
      if (
        old.usedAt ||
        old.revokedAt ||
        old.expiresAt <= now ||
        !active(user)
      ) {
        await manager.update(
          RefreshSessionEntity,
          { familyId: old.familyId },
          { revokedAt: now },
        );
        // Return, don't throw: the family revocation must COMMIT before HTTP 401.
        return null;
      }
      await manager.update(
        RefreshSessionEntity,
        { id: old.id },
        { usedAt: now },
      );
      const session: RefreshSession = {
        id: nextId,
        userId: old.userId,
        familyId: old.familyId,
        tokenHash: nextHash,
        expiresAt: old.expiresAt,
        usedAt: null,
        revokedAt: null,
        createdAt: now,
      };
      await manager.insert(RefreshSessionEntity, session);
      return { session, user };
    });
  }
  async revokeSessionFamily(hash: string, now: Date) {
    await this.dataSource.transaction(async (manager) => {
      const session = await this.familyLock(manager, hash);
      if (session)
        await manager.update(
          RefreshSessionEntity,
          { familyId: session.familyId },
          { revokedAt: now },
        );
    });
  }
  async listSessions(userId: string, page: number, size: number, now: Date) {
    // Count/page share one database snapshot. Never select token hashes or other accounts.
    return this.dataSource.transaction("REPEATABLE READ", async (manager) => {
      const activeFamilies = `FROM auth_refresh_sessions WHERE user_id=$1 GROUP BY family_id
        HAVING bool_or(used_at IS NULL AND revoked_at IS NULL AND expires_at > $2)`;
      const [{ total }] = await manager.query(
        `SELECT count(*)::int total FROM (SELECT family_id ${activeFamilies}) s`,
        [userId, now],
      );
      const rows = await manager.query(
        `SELECT family_id AS id, min(created_at) AS "createdAt", max(created_at) AS "lastRefreshedAt", max(expires_at) AS "expiresAt"
        ${activeFamilies} ORDER BY min(created_at) DESC, family_id ASC LIMIT $3 OFFSET $4`,
        [userId, now, size, (page - 1) * size],
      );
      return {
        data: rows as LoginSession[],
        page,
        size,
        totalElements: total,
        totalPages: Math.ceil(total / size),
      };
    });
  }
  async revokeOwnedSession(userId: string, familyId: string, now: Date) {
    await this.dataSource.transaction(async (manager) => {
      // Same lock as rotation: revoking an older generation also catches a newly rotated child.
      const own = await manager.existsBy(RefreshSessionEntity, {
        userId,
        familyId,
      });
      if (!own) return;
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [familyId],
      );
      await manager.update(
        RefreshSessionEntity,
        { userId, familyId },
        { revokedAt: now },
      );
    });
  }
  async revokeOtherSessions(
    userId: string,
    currentFamilyId: string,
    now: Date,
  ) {
    await this.dataSource.transaction(async (manager) => {
      // Snapshot the active families at this operation. A subsequent new login is a new session.
      const families: { family_id: string }[] = await manager.query(
        `SELECT DISTINCT family_id FROM auth_refresh_sessions
        WHERE user_id=$1 AND family_id<>$2 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>$3 ORDER BY family_id`,
        [userId, currentFamilyId, now],
      );
      for (const { family_id: familyId } of families) {
        await manager.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [familyId],
        );
        await manager.update(
          RefreshSessionEntity,
          { userId, familyId },
          { revokedAt: now },
        );
      }
    });
  }
  isSessionActive(userId: string, familyId: string, now: Date) {
    return this.sessions.existsBy({
      userId,
      familyId,
      usedAt: IsNull(),
      revokedAt: IsNull(),
      expiresAt: MoreThan(now),
    });
  }
}
