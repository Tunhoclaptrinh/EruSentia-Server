import { ConflictException, Injectable } from "@nestjs/common";
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
  Role,
  userIdentity,
} from "../auth-store";
import { RefreshSessionEntity } from "./refresh-session.entity";

@Injectable()
export class PostgresAuthStore implements AuthStore {
  constructor(
    @InjectRepository(AuthorEntity)
    private readonly users: Repository<AuthorEntity>,
    @InjectRepository(RefreshSessionEntity)
    private readonly sessions: Repository<RefreshSessionEntity>,
    private readonly dataSource: DataSource,
  ) {}
  async createUser(input: { email: string; passwordHash: string; role: Role }) {
    try {
      return await this.users.save(this.users.create(input));
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
