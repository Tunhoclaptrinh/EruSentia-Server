import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { AdminAuditService } from "./admin-audit.service";
import { AdminTemplateQueryDto, AdminCurateTemplateDto } from "./dto/admin.dto";

@Injectable()
export class AdminTemplatesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AdminAuditService,
  ) {}

  async list(query: AdminTemplateQueryDto) {
    const page = Math.max(1, query.page || 1);
    const size = Math.min(100, Math.max(1, query.size || 20));
    const offset = (page - 1) * size;

    const conditions: string[] = ["t.deleted_at IS NULL"];
    const params: unknown[] = [];
    let pIdx = 1;

    if (query.search) {
      conditions.push(`(t.title ILIKE $${pIdx} OR t.slug ILIKE $${pIdx})`);
      params.push(`%${query.search}%`);
      pIdx++;
    }

    if (query.authorId) {
      conditions.push(`t.author_id = $${pIdx++}`);
      params.push(query.authorId);
    }

    if (query.isPublic !== undefined) {
      conditions.push(`t.is_public = $${pIdx++}`);
      params.push(query.isPublic);
    }

    if (query.moderationState) {
      conditions.push(`t.moderation_state = $${pIdx++}`);
      params.push(query.moderationState);
    }

    if (query.isCurated !== undefined) {
      conditions.push(`t.is_curated = $${pIdx++}`);
      params.push(query.isCurated);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const countRes = await this.dataSource.query<{ count: string }[]>(
      `SELECT count(*) as count FROM templates t ${whereClause}`,
      params,
    );
    const total = parseInt(countRes[0]?.count || "0", 10);

    const rows = await this.dataSource.query(
      `SELECT t.id, t.title, t.slug, t.version, t.revision,
              t.is_public as "isPublic",
              t.moderation_state as "moderationState",
              t.moderation_reason as "moderationReason",
              t.is_featured as "isFeatured",
              t.is_curated as "isCurated",
              t.curated_at as "curatedAt",
              t.forks_count as "forksCount",
              t.views_count as "viewsCount",
              t.rating_avg as "ratingAvg",
              t.ratings_count as "ratingsCount",
              t.content_bytes as "contentBytes",
              t.created_at as "createdAt",
              t.updated_at as "updatedAt",
              u.id as "authorId",
              u.email as "authorEmail",
              p.display_name as "authorName",
              c.name as "categoryName",
              COALESCE((SELECT count(*) FROM template_reports r WHERE r.template_id = t.id AND r.state = 'open'), 0)::int as "openReportsCount"
       FROM templates t
       JOIN users u ON u.id = t.author_id
       LEFT JOIN profiles p ON p.user_id = u.id
       LEFT JOIN categories c ON c.id = t.category_id
       ${whereClause}
       ORDER BY t.updated_at DESC, t.id DESC
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
    const [template] = await this.dataSource.query(
      `SELECT t.id, t.title, t.slug, t.description, t.version, t.revision,
              t.is_public as "isPublic",
              t.moderation_state as "moderationState",
              t.moderation_reason as "moderationReason",
              t.is_featured as "isFeatured",
              t.is_curated as "isCurated",
              t.curated_at as "curatedAt",
              t.curated_by as "curatedBy",
              t.tags,
              t.content_json as "contentJson",
              t.content_bytes as "contentBytes",
              t.created_at as "createdAt",
              t.updated_at as "updatedAt",
              u.id as "authorId",
              u.email as "authorEmail",
              p.display_name as "authorName",
              c.id as "categoryId",
              c.name as "categoryName"
       FROM templates t
       JOIN users u ON u.id = t.author_id
       LEFT JOIN profiles p ON p.user_id = u.id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.id = $1 AND t.deleted_at IS NULL`,
      [id],
    );

    if (!template) throw new NotFoundException("Template not found");

    const reports = await this.dataSource.query(
      `SELECT id, reporter_id as "reporterId", template_revision as "templateRevision",
              reason_code as "reasonCode", description, state, created_at as "createdAt"
       FROM template_reports
       WHERE template_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [id],
    );

    const revisions = await this.dataSource.query(
      `SELECT revision,
              operation,
              snapshot->>'version' as version,
              snapshot->>'title' as title,
              snapshot->>'checksum' as checksum,
              created_at as "createdAt"
       FROM template_revisions
       WHERE template_id = $1
       ORDER BY revision DESC`,
      [id],
    );

    return {
      template,
      reports,
      revisions,
    };
  }

  async curate(
    id: string,
    input: AdminCurateTemplateDto,
    actorId: string,
    meta: { ip?: string; userAgent?: string },
  ) {
    const [target] = await this.dataSource.query(
      "SELECT id, title, is_curated FROM templates WHERE id = $1 AND deleted_at IS NULL",
      [id],
    );
    if (!target) throw new NotFoundException("Template not found");

    if (input.isCurated) {
      await this.dataSource.query(
        `UPDATE templates
         SET is_curated = TRUE,
             curated_at = NOW(),
             curated_by = $1
         WHERE id = $2`,
        [actorId, id],
      );
    } else {
      await this.dataSource.query(
        `UPDATE templates
         SET is_curated = FALSE,
             curated_at = NULL,
             curated_by = NULL
         WHERE id = $1`,
        [id],
      );
    }

    await this.audit.record({
      actorId,
      action: input.isCurated ? "TEMPLATE_CURATED" : "TEMPLATE_UNCURATED",
      targetType: "template",
      targetId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      reason: input.isCurated ? "Marked as curated template" : "Removed curation badge",
      metadata: { templateTitle: target.title, isCurated: input.isCurated },
    });

    return { success: true, id, isCurated: input.isCurated };
  }

  async forceHide(
    id: string,
    reason: string,
    actorId: string,
    meta: { ip?: string; userAgent?: string },
  ) {
    const [target] = await this.dataSource.query(
      "SELECT id, title, is_public, moderation_state FROM templates WHERE id = $1 AND deleted_at IS NULL",
      [id],
    );
    if (!target) throw new NotFoundException("Template not found");

    await this.dataSource.query(
      `UPDATE templates
       SET moderation_state = 'hidden',
           is_public = FALSE,
           moderation_reason = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [reason, id],
    );

    await this.audit.record({
      actorId,
      action: "TEMPLATE_FORCE_HIDDEN",
      targetType: "template",
      targetId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      reason,
      metadata: { templateTitle: target.title },
    });

    return { success: true, id, moderationState: "hidden", reason };
  }
}
