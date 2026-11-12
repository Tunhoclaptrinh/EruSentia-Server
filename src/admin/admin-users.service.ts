import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { AdminAuditService } from "./admin-audit.service";
import { AdminUserQueryDto, AdminSuspendUserDto, AdminUpdateRoleDto } from "./dto/admin.dto";
import type { Role } from "../auth/auth-store";

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AdminAuditService,
  ) {}

  async list(query: AdminUserQueryDto) {
    const page = Math.max(1, query.page || 1);
    const size = Math.min(100, Math.max(1, query.size || 20));
    const offset = (page - 1) * size;

    const conditions: string[] = ["u.deleted_at IS NULL"];
    const params: unknown[] = [];
    let pIdx = 1;

    if (query.search) {
      conditions.push(`(u.email ILIKE $${pIdx} OR p.display_name ILIKE $${pIdx})`);
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

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const countRes = await this.dataSource.query<{ count: string }[]>(
      `SELECT count(*) as count
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       ${whereClause}`,
      params,
    );
    const total = parseInt(countRes[0]?.count || "0", 10);

    const rows = await this.dataSource.query(
      `SELECT u.id, u.email, u.role, u.is_active as "isActive",
              u.suspension_reason as "suspensionReason",
              u.suspended_at as "suspendedAt",
              u.email_verified_at as "emailVerifiedAt",
              u.created_at as "createdAt",
              p.display_name as "displayName",
              p.avatar_url as "avatarUrl",
              COALESCE((SELECT count(*) FROM templates t WHERE t.author_id = u.id AND t.deleted_at IS NULL), 0)::int as "templateCount",
              COALESCE((SELECT count(*) FROM auth_refresh_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > NOW()), 0)::int as "activeSessionCount"
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       ${whereClause}
       ORDER BY u.created_at DESC, u.id DESC
       LIMIT $${pIdx++} OFFSET $${pIdx++}`,
      [...params, size, offset],
    );

    return {
      data: rows,
      page,
      size,
      totalElements: total,
      totalPages: Math.ceil(total / size),
    };
  }

  async detail(id: string) {
    const [user] = await this.dataSource.query(
      `SELECT u.id, u.email, u.role, u.is_active as "isActive",
              u.suspension_reason as "suspensionReason",
              u.suspended_at as "suspendedAt",
              u.suspended_by as "suspendedBy",
              u.email_verified_at as "emailVerifiedAt",
              u.created_at as "createdAt",
              u.updated_at as "updatedAt",
              p.display_name as "displayName",
              p.avatar_url as "avatarUrl",
              p.bio,
              p.reputation_score as "reputationScore"
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [id],
    );

    if (!user) throw new NotFoundException("User not found");

    const [quota] = await this.dataSource.query(
      `SELECT COALESCE(sum(content_bytes), 0)::bigint as "totalContentBytes",
              count(*)::int as "templateCount"
       FROM templates
       WHERE author_id = $1 AND deleted_at IS NULL`,
      [id],
    );

    const sessions = await this.dataSource.query(
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
      sessions: sessions.map((s: any) => ({
        ...s,
        isActive: !s.revokedAt && new Date(s.expiresAt) > new Date(),
      })),
    };
  }

  async updateRole(
    id: string,
    input: AdminUpdateRoleDto,
    actorId: string,
    meta: { ip?: string; userAgent?: string },
  ) {
    const [target] = await this.dataSource.query(
      "SELECT id, email, role FROM users WHERE id = $1 AND deleted_at IS NULL",
      [id],
    );
    if (!target) throw new NotFoundException("User not found");

    if (id === actorId && input.role !== "admin") {
      throw new ForbiddenException("Cannot demote your own admin account");
    }

    await this.dataSource.query(
      "UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2",
      [input.role, id],
    );

    await this.audit.record({
      actorId,
      action: "USER_ROLE_UPDATED",
      targetType: "user",
      targetId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      reason: `Changed role from ${target.role} to ${input.role}`,
      metadata: { previousRole: target.role, newRole: input.role, userEmail: target.email },
    });

    return { success: true, id, role: input.role };
  }

  async suspend(
    id: string,
    input: AdminSuspendUserDto,
    actorId: string,
    meta: { ip?: string; userAgent?: string },
  ) {
    if (id === actorId) {
      throw new ForbiddenException("Cannot suspend your own admin account");
    }

    const [target] = await this.dataSource.query(
      "SELECT id, email, role, is_active FROM users WHERE id = $1 AND deleted_at IS NULL",
      [id],
    );
    if (!target) throw new NotFoundException("User not found");

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE users
         SET is_active = FALSE,
             suspension_reason = $1,
             suspended_at = NOW(),
             suspended_by = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [input.reason, actorId, id],
      );

      // Force revoke all active refresh sessions
      await manager.query(
        "UPDATE auth_refresh_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
        [id],
      );
    });

    await this.audit.record({
      actorId,
      action: "USER_SUSPENDED",
      targetType: "user",
      targetId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      reason: input.reason,
      metadata: { userEmail: target.email },
    });

    return { success: true, id, status: "suspended", reason: input.reason };
  }

  async activate(
    id: string,
    actorId: string,
    meta: { ip?: string; userAgent?: string },
  ) {
    const [target] = await this.dataSource.query(
      "SELECT id, email, is_active FROM users WHERE id = $1 AND deleted_at IS NULL",
      [id],
    );
    if (!target) throw new NotFoundException("User not found");

    await this.dataSource.query(
      `UPDATE users
       SET is_active = TRUE,
           suspension_reason = NULL,
           suspended_at = NULL,
           suspended_by = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [id],
    );

    await this.audit.record({
      actorId,
      action: "USER_ACTIVATED",
      targetType: "user",
      targetId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      reason: "Account reactivated by administrator",
      metadata: { userEmail: target.email },
    });

    return { success: true, id, status: "active" };
  }

  async revokeSessions(
    id: string,
    actorId: string,
    meta: { ip?: string; userAgent?: string },
  ) {
    const [target] = await this.dataSource.query(
      "SELECT id, email FROM users WHERE id = $1 AND deleted_at IS NULL",
      [id],
    );
    if (!target) throw new NotFoundException("User not found");

    const result = await this.dataSource.query(
      "UPDATE auth_refresh_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
      [id],
    );

    await this.audit.record({
      actorId,
      action: "USER_SESSIONS_REVOKED",
      targetType: "user",
      targetId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      reason: "All active sessions revoked by administrator",
      metadata: { userEmail: target.email },
    });

    return { success: true, id, revoked: true };
  }
}
