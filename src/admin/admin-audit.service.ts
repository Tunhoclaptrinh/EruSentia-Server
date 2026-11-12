import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { AdminAuditLogEntity } from "./persistence/admin-audit-log.entity";
import { AdminAuditLogQueryDto } from "./dto/admin.dto";

export interface LogAdminActionParams {
  actorId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AdminAuditService {
  constructor(private readonly dataSource: DataSource) {}

  async record(params: LogAdminActionParams): Promise<void> {
    try {
      await this.dataSource.query(
        `INSERT INTO admin_audit_logs (actor_id, action, target_type, target_id, ip_address, user_agent, reason, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())`,
        [
          params.actorId,
          params.action,
          params.targetType,
          params.targetId ?? null,
          params.ipAddress ?? null,
          params.userAgent ?? null,
          params.reason ?? null,
          JSON.stringify(params.metadata ?? {}),
        ],
      );
    } catch (error) {
      console.error("Failed to record admin audit log:", error);
    }
  }

  async list(query: AdminAuditLogQueryDto) {
    const page = Math.max(1, query.page || 1);
    const size = Math.min(100, Math.max(1, query.size || 20));
    const offset = (page - 1) * size;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let pIdx = 1;

    if (query.actorId) {
      conditions.push(`l.actor_id = $${pIdx++}`);
      params.push(query.actorId);
    }
    if (query.targetType) {
      conditions.push(`l.target_type = $${pIdx++}`);
      params.push(query.targetType);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRes = await this.dataSource.query<{ count: string }[]>(
      `SELECT count(*) as count FROM admin_audit_logs l ${whereClause}`,
      params,
    );
    const total = parseInt(countRes[0]?.count || "0", 10);

    const rows = await this.dataSource.query(
      `SELECT l.id, l.actor_id as "actorId", u.email as "actorEmail", l.action,
              l.target_type as "targetType", l.target_id as "targetId",
              l.ip_address as "ipAddress", l.reason, l.metadata, l.created_at as "createdAt"
       FROM admin_audit_logs l
       LEFT JOIN users u ON u.id = l.actor_id
       ${whereClause}
       ORDER BY l.created_at DESC, l.id DESC
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
}
