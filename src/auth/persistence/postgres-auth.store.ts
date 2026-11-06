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
