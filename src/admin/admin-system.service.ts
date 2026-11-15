import { BaseService } from "../common/services/base.service";
import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";

@Injectable()
export class AdminSystemService extends BaseService {
  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  async getOverview() {
    return this.snapshot(async (manager) => {
      const [userStats] = await manager.query(`
      SELECT 
        count(*)::int as "totalUsers",
        count(CASE WHEN is_active = TRUE THEN 1 END)::int as "activeUsers",
        count(CASE WHEN is_active = FALSE THEN 1 END)::int as "suspendedUsers",
        count(CASE WHEN role = 'creator' THEN 1 END)::int as "creatorUsers",
        count(CASE WHEN role = 'admin' THEN 1 END)::int as "adminUsers",
        count(CASE WHEN created_at >= NOW() - INTERVAL '24 HOURS' THEN 1 END)::int as "newUsers24h"
      FROM users
      WHERE deleted_at IS NULL
    `);

      const [templateStats] = await manager.query(`
      SELECT 
        count(*)::int as "totalTemplates",
        count(CASE WHEN is_public = TRUE THEN 1 END)::int as "publicTemplates",
        count(CASE WHEN is_public = FALSE THEN 1 END)::int as "privateTemplates",
        count(CASE WHEN moderation_state = 'hidden' THEN 1 END)::int as "hiddenTemplates",
        count(CASE WHEN is_curated = TRUE THEN 1 END)::int as "curatedTemplates",
        COALESCE(sum(content_bytes), 0)::bigint as "totalContentBytes"
      FROM templates
      WHERE deleted_at IS NULL
    `);

      const [reportStats] = await manager.query(`
      SELECT 
        count(*)::int as "totalReports",
        count(CASE WHEN state = 'open' THEN 1 END)::int as "openReports",
        count(CASE WHEN state = 'resolved' THEN 1 END)::int as "resolvedReports",
        count(CASE WHEN state = 'dismissed' THEN 1 END)::int as "dismissedReports"
      FROM template_reports
    `);

      const [sessionStats] = await manager.query(`
      SELECT count(DISTINCT family_id)::int as "activeSessions"
      FROM auth_refresh_sessions
      WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
    `);

      const [outbox] = await manager.query(`
      SELECT count(*)::int as "totalOutbox",
             count(*) FILTER (WHERE published_at IS NULL)::int as "pendingOutbox"
      FROM message_outbox
    `);
      const outboxStats = {
        pendingOutbox: Number(outbox.pendingOutbox),
        totalOutbox: Number(outbox.totalOutbox),
      };

      return {
        users: {
          total: Number(userStats?.totalUsers || 0),
          active: Number(userStats?.activeUsers || 0),
          suspended: Number(userStats?.suspendedUsers || 0),
          creators: Number(userStats?.creatorUsers || 0),
          admins: Number(userStats?.adminUsers || 0),
          newLast24h: Number(userStats?.newUsers24h || 0),
        },
        templates: {
          total: Number(templateStats?.totalTemplates || 0),
          public: Number(templateStats?.publicTemplates || 0),
          private: Number(templateStats?.privateTemplates || 0),
          hidden: Number(templateStats?.hiddenTemplates || 0),
          curated: Number(templateStats?.curatedTemplates || 0),
          totalContentBytes: Number(templateStats?.totalContentBytes || 0),
        },
        moderation: {
          total: Number(reportStats?.totalReports || 0),
          open: Number(reportStats?.openReports || 0),
          resolved: Number(reportStats?.resolvedReports || 0),
          dismissed: Number(reportStats?.dismissedReports || 0),
        },
        sessions: {
          active: Number(sessionStats?.activeSessions || 0),
        },
        outbox: outboxStats,
      };
    });
  }

  async getHealth() {
    const start = performance.now();
    await this.dataSource.query("SELECT 1");
    const dbLatencyMs = Math.round((performance.now() - start) * 10) / 10;

    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      services: {
        database: {
          status: "connected",
          engine: "PostgreSQL",
          latencyMs: dbLatencyMs,
        },
        api: {
          uptimeSeconds: Math.round(process.uptime()),
          memoryRssBytes: process.memoryUsage().rss,
          nodeVersion: process.version,
        },
      },
    };
  }
}
