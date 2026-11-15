import { lockAdminTarget } from "./admin-authorization";
import { BaseService } from "../common/services/base.service";
import {
  Inject,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { AdminAuditService } from "./admin-audit.service";
import {
  AdminUserQueryDto,
  AdminSuspendUserDto,
  AdminUpdateRoleDto,
  AdminRestoreAccountDto,
} from "./dto/admin.dto";
import { AUTH_STORE, type AuthStore } from "../auth/auth-store";
import { AdminPageQueryDto } from "./dto/admin.dto";
import type { AdminRequestMeta } from "./request-meta";

@Injectable()
export class AdminUsersService extends BaseService {
  constructor(
    dataSource: DataSource,
    private readonly audit: AdminAuditService,
    @Inject(AUTH_STORE) private readonly auth: AuthStore,
  ) {
    super(dataSource);
  }

  async list(query: AdminUserQueryDto) {
    const conditions: string[] =
      query.status === "all"
        ? []
        : [
            query.status === "deleted"
              ? "u.deleted_at IS NOT NULL"
              : "u.deleted_at IS NULL",
          ];
    const params: unknown[] = [];
    let pIdx = 1;

    if (query.search) {
      conditions.push(
        `(u.email ILIKE $${pIdx} OR p.display_name ILIKE $${pIdx})`,
      );
      params.push(`%${query.search}%`);
      pIdx++;
    }

    if (query.role) {
      conditions.push(`u.role = $${pIdx++}`);
      params.push(query.role);
    }

    if (query.status === "active") {
      conditions.push(`u.is_active = TRUE`);
    } else if (query.status === "suspended") {
      conditions.push(`u.is_active = FALSE`);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    return this.paginate(query, async (manager, { size, offset }) => {
      const countRes = await manager.query<{ count: string }[]>(
        `SELECT count(*) as count
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       ${whereClause}`,
        params,
      );
      const total = parseInt(countRes[0]?.count || "0", 10);

      const rows = await manager.query(
        `SELECT u.id, u.email, u.role, u.is_active as "isActive",
              u.suspension_reason as "suspensionReason",
              u.suspended_at as "suspendedAt",
              u.email_verified_at as "emailVerifiedAt",
              u.created_at as "createdAt", u.deleted_at AS "deletedAt",
              p.display_name as "displayName",
              p.avatar_url as "avatarUrl",
              COALESCE((SELECT count(*) FROM templates t WHERE t.author_id = u.id AND t.deleted_at IS NULL), 0)::int as "templateCount",
              COALESCE((SELECT count(DISTINCT s.family_id) FROM auth_refresh_sessions s WHERE s.user_id = u.id AND s.used_at IS NULL AND s.revoked_at IS NULL AND s.expires_at > NOW()), 0)::int as "activeSessionCount"
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       ${whereClause}
       ORDER BY u.created_at DESC, u.id DESC
       LIMIT $${pIdx++} OFFSET $${pIdx++}`,
        [...params, size, offset],
      );

      return { data: rows, total };
    });
  }

  async detail(id: string) {
    return this.snapshot(async (manager) => {
      const [user] = await manager.query(
        `SELECT u.id, u.email, u.role, u.is_active as "isActive",
              u.suspension_reason as "suspensionReason",
              u.suspended_at as "suspendedAt",
              u.suspended_by as "suspendedBy",
              u.email_verified_at as "emailVerifiedAt",
              u.created_at as "createdAt", u.deleted_at AS "deletedAt",
              u.updated_at as "updatedAt",
              p.display_name as "displayName",
              p.avatar_url as "avatarUrl",
              p.bio,
              p.reputation_score as "reputationScore"
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE u.id = $1`,
        [id],
      );

      if (!user) throw new NotFoundException("User not found");

      const [quota] = await manager.query(
        `SELECT COALESCE(sum(content_bytes), 0)::bigint as "totalContentBytes",
              count(*)::int as "templateCount"
       FROM templates
       WHERE author_id = $1 AND deleted_at IS NULL`,
        [id],
      );

      const sessions = await manager.query(
        `SELECT id, family_id as "familyId", expires_at as "expiresAt",
              created_at as "createdAt", revoked_at as "revokedAt", used_at as "usedAt"
       FROM auth_refresh_sessions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
        [id],
      );

      return {
        user,
        quota: {
          totalContentBytes: Number(quota?.totalContentBytes || 0),
          templateCount: Number(quota?.templateCount || 0),
        },
        sessions: sessions.map(
          (s: {
            usedAt: Date | null;
            revokedAt: Date | null;
            expiresAt: Date;
          }) => ({
            ...s,
            isActive:
              !s.usedAt && !s.revokedAt && new Date(s.expiresAt) > new Date(),
          }),
        ),
      };
    });
  }

  async restore(
    id: string,
    input: AdminRestoreAccountDto,
    actorId: string,
    meta: AdminRequestMeta,
  ) {
    return this.transaction(async (manager) => {
      const target = await lockAdminTarget(manager, actorId, id, true, true);
      if (
        !target.deleted_at ||
        new Date(target.deleted_at).getTime() !==
          Date.parse(input.expectedDeletedAt)
      )
        throw new ConflictException(
          "Tài khoản đã thay đổi hoặc không còn trong danh sách đã xóa. Hãy tải lại.",
        );
      await manager.query(
        "UPDATE users SET deleted_at=NULL,is_active=FALSE,role='user',suspension_reason=$2,suspended_at=now(),suspended_by=$3,updated_at=now() WHERE id=$1",
        [id, input.reason, actorId],
      );
      await this.revokeFamilies(manager, id);
      await this.audit.record(
        {
          actorId,
          action: "USER_RESTORED",
          targetType: "user",
          targetId: id,
          reason: input.reason,
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
          metadata: {
            previousRole: target.role,
            previousDeletedAt: target.deleted_at,
            role: "user",
            isActive: false,
          },
        },
        manager,
      );
      return { id, success: true, status: "suspended", role: "user" };
    });
  }

  private accountTransaction<T>(
    id: string,
    actorId: string,
    work: (
      manager: EntityManager,
      target: { id: string; email: string; role: string; is_active: boolean },
    ) => Promise<T>,
  ): Promise<T> {
    return this.transaction(async (manager) => {
      const target = await lockAdminTarget(manager, actorId, id, true);
      return work(manager, target);
    });
  }

  async updateRole(
    id: string,
    input: AdminUpdateRoleDto,
    actorId: string,
    meta: AdminRequestMeta,
  ) {
    if (id === actorId && input.role !== "admin") {
      throw new ForbiddenException(
        "Không thể tự hạ quyền quản trị của chính mình",
      );
    }
    return this.accountTransaction(id, actorId, async (manager, target) => {
      if (target.role === input.role)
        return { success: true, id, role: input.role };
      await manager.query(
        "UPDATE users SET role=$1,updated_at=NOW() WHERE id=$2",
        [input.role, id],
      );
      await this.audit.record(
        {
          actorId,
          action: "USER_ROLE_UPDATED",
          targetType: "user",
          targetId: id,
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
          reason:
            input.reason || `Changed role from ${target.role} to ${input.role}`,
          metadata: {
            previousRole: target.role,
            newRole: input.role,
            userEmail: target.email,
          },
        },
        manager,
      );
      return { success: true, id, role: input.role };
    });
  }

  private async revokeFamilies(
    manager: EntityManager,
    id: string,
    familyId?: string,
  ) {
    const families: { familyId: string }[] = await manager.query(
      `SELECT DISTINCT family_id AS "familyId" FROM auth_refresh_sessions
       WHERE user_id=$1 AND revoked_at IS NULL ${familyId ? "AND family_id=$2" : ""} ORDER BY family_id`,
      familyId ? [id, familyId] : [id],
    );
    for (const family of families) {
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [family.familyId],
      );
      await manager.query(
        "UPDATE auth_refresh_sessions SET revoked_at=NOW() WHERE user_id=$1 AND family_id=$2 AND revoked_at IS NULL",
        [id, family.familyId],
      );
    }
  }

  async suspend(
    id: string,
    input: AdminSuspendUserDto,
    actorId: string,
    meta: AdminRequestMeta,
  ) {
    if (id === actorId)
      throw new ForbiddenException("Không thể tự khóa tài khoản quản trị");
    return this.accountTransaction(id, actorId, async (manager, target) => {
      await manager.query(
        `UPDATE users SET is_active=FALSE,suspension_reason=$1,suspended_at=NOW(),suspended_by=$2,updated_at=NOW() WHERE id=$3`,
        [input.reason, actorId, id],
      );
      await this.revokeFamilies(manager, id);
      await this.audit.record(
        {
          actorId,
          action: "USER_SUSPENDED",
          targetType: "user",
          targetId: id,
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
          reason: input.reason,
          metadata: { userEmail: target.email },
        },
        manager,
      );
      return { success: true, id, status: "suspended", reason: input.reason };
    });
  }

  async activate(id: string, actorId: string, meta: AdminRequestMeta) {
    return this.accountTransaction(id, actorId, async (manager, target) => {
      await manager.query(
        `UPDATE users SET is_active=TRUE,suspension_reason=NULL,suspended_at=NULL,suspended_by=NULL,updated_at=NOW() WHERE id=$1`,
        [id],
      );
      await this.audit.record(
        {
          actorId,
          action: "USER_ACTIVATED",
          targetType: "user",
          targetId: id,
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
          reason: "Account reactivated by administrator",
          metadata: { userEmail: target.email },
        },
        manager,
      );
      return { success: true, id, status: "active" };
    });
  }

  async sessions(
    id: string,
    query: AdminPageQueryDto,
    actorId: string,
    current: string,
  ) {
    const [user] = await this.dataSource.query(
      "SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL",
      [id],
    );
    if (!user) throw new NotFoundException("Không tìm thấy tài khoản");
    const page = await this.auth.listSessions(
      id,
      query.page,
      query.size,
      new Date(),
    );
    return {
      ...page,
      data: page.data.map((row) => ({
        ...row,
        current: id === actorId && row.id === current,
      })),
    };
  }

  async revokeSession(
    id: string,
    familyId: string,
    reason: string,
    actorId: string,
    meta: AdminRequestMeta,
  ) {
    return this.accountTransaction(id, actorId, async (manager, target) => {
      const [session] = await manager.query(
        "SELECT family_id FROM auth_refresh_sessions WHERE user_id=$1 AND family_id=$2 LIMIT 1",
        [id, familyId],
      );
      if (!session)
        throw new NotFoundException("Không tìm thấy phiên của tài khoản này");
      await this.revokeFamilies(manager, id, familyId);
      await this.audit.record(
        {
          actorId,
          action: "USER_SESSION_REVOKED",
          targetType: "user",
          targetId: id,
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
          reason,
          metadata: { userEmail: target.email, sessionId: familyId },
        },
        manager,
      );
      return { success: true, id, sessionId: familyId };
    });
  }

  async revokeSessions(id: string, actorId: string, meta: AdminRequestMeta) {
    return this.accountTransaction(id, actorId, async (manager, target) => {
      await this.revokeFamilies(manager, id);
      await this.audit.record(
        {
          actorId,
          action: "USER_SESSIONS_REVOKED",
          targetType: "user",
          targetId: id,
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
          reason: "All active sessions revoked by administrator",
          metadata: { userEmail: target.email },
        },
        manager,
      );
      return { success: true, id, revoked: true };
    });
  }
}
