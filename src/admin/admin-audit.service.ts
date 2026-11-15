import { BaseService } from "../common/services/base.service";
import { BadRequestException, Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { AdminAuditLogQueryDto } from "./dto/admin.dto";

import {
  recordAdminAction,
  type LogAdminActionParams,
} from "./admin-audit-record";
export type { LogAdminActionParams } from "./admin-audit-record";

@Injectable()
export class AdminAuditService extends BaseService {
  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  async record(
    params: LogAdminActionParams,
    manager: EntityManager,
  ): Promise<void> {
    await recordAdminAction(manager, params);
  }

  async list(query: AdminAuditLogQueryDto) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let pIdx = 1;

    if (query.from && query.to && new Date(query.from) >= new Date(query.to)) {
      throw new BadRequestException(
        "Thời điểm kết thúc phải sau thời điểm bắt đầu",
      );
    }
    if (query.search) {
      conditions.push(
        `(u.email ILIKE $${pIdx} OR l.reason ILIKE $${pIdx} OR l.target_id ILIKE $${pIdx})`,
      );
      params.push(`%${query.search}%`);
      pIdx++;
    }
    for (const [value, column, operator] of [
      [query.action, "l.action", "="],
      [query.targetId, "l.target_id", "="],
      [query.from, "l.created_at", ">="],
      [query.to, "l.created_at", "<"],
    ]) {
      if (value) {
        conditions.push(`${column} ${operator} $${pIdx++}`);
        params.push(value);
      }
    }

    if (query.actorId) {
      conditions.push(`l.actor_id = $${pIdx++}`);
      params.push(query.actorId);
    }
    if (query.targetType) {
      conditions.push(`l.target_type = $${pIdx++}`);
      params.push(query.targetType);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    return this.paginate(query, async (manager, { size, offset }) => {
      const countRes = await manager.query<{ count: string }[]>(
        `SELECT count(*) as count FROM admin_audit_logs l LEFT JOIN users u ON u.id=l.actor_id ${whereClause}`,
        params,
      );
      const total = parseInt(countRes[0]?.count || "0", 10);

      const rows = await manager.query(
        `SELECT l.id, l.actor_id as "actorId", u.email as "actorEmail", l.action,
              l.target_type as "targetType", l.target_id as "targetId",
              l.ip_address as "ipAddress", l.user_agent as "userAgent", l.reason, l.metadata, l.created_at as "createdAt"
       FROM admin_audit_logs l
       LEFT JOIN users u ON u.id = l.actor_id
       ${whereClause}
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT $${pIdx++} OFFSET $${pIdx++}`,
        [...params, size, offset],
      );

      return { data: rows, total };
    });
  }
}
