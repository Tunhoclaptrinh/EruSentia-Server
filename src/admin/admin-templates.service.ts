import { randomUUID } from "node:crypto";
import { AdminBatchCurationDto } from "./dto/batch.dto";
import { lockAdminActor, selectedIds } from "./admin-authorization";
import { BaseService } from "../common/services/base.service";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { AdminAuditService } from "./admin-audit.service";
import { AdminTemplateQueryDto, AdminCurateTemplateDto } from "./dto/admin.dto";

@Injectable()
export class AdminTemplatesService extends BaseService {
  constructor(
    dataSource: DataSource,
    private readonly audit: AdminAuditService,
  ) {
    super(dataSource);
  }

  async list(query: AdminTemplateQueryDto) {
    const conditions: string[] =
      query.status === "all"
        ? []
        : [
            query.status === "trash"
              ? "t.deleted_at IS NOT NULL"
              : "t.deleted_at IS NULL",
          ];
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

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    return this.paginate(query, async (manager, { size, offset }) => {
      const countRes = await manager.query<{ count: string }[]>(
        `SELECT count(*) as count FROM templates t ${whereClause}`,
        params,
      );
      const total = parseInt(countRes[0]?.count || "0", 10);

      const rows = await manager.query(
        `SELECT t.id, t.title, t.slug, t.description, t.category_id AS "categoryId", t.deleted_at AS "deletedAt", t.version, t.revision,
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

      return { data: rows, total };
    });
  }

  async detail(id: string) {
    return this.snapshot(async (manager) => {
      const [template] = await manager.query(
        `SELECT t.id, t.title, t.slug, t.description, t.deleted_at AS "deletedAt", t.version, t.revision,
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
       WHERE t.id = $1`,
        [id],
      );

      if (!template) throw new NotFoundException("Template not found");

      const reports = await manager.query(
        `SELECT id, reporter_id as "reporterId", template_revision as "templateRevision",
              reason_code as "reasonCode", description, state, created_at as "createdAt"
       FROM template_reports
       WHERE template_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
        [id],
      );

      const revisions = await manager.query(
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
    });
  }

  private async lockTemplate(
    manager: EntityManager,
    id: string,
    actorId: string,
  ) {
    const [hint] = await manager.query(
      "SELECT author_id FROM templates WHERE id=$1 AND deleted_at IS NULL",
      [id],
    );
    if (!hint) throw new NotFoundException("Template not found");
    // Match the lock order used by author writes and report decisions.
    await manager.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      ["eru-template-quota:" + hint.author_id],
    );
    await manager.query("SELECT id FROM templates WHERE id=$1 FOR UPDATE", [
      id,
    ]);
    await manager.query(
      "SELECT set_config('eru.actor_id',$1,true),set_config('eru.template_operation','update',true)",
      [actorId],
    );
  }

  private async curateUsing(
    manager: EntityManager,
    id: string,
    input: AdminCurateTemplateDto,
    actorId: string,
    meta: { ip?: string; userAgent?: string },
    reason?: string,
    batchId?: string,
  ) {
    const [target] = await manager.query(
      "SELECT id, title, is_curated FROM templates WHERE id = $1 AND deleted_at IS NULL",
      [id],
    );
    if (!target) throw new NotFoundException("Template not found");

    if (target.is_curated === input.isCurated)
      return { success: true, id, isCurated: input.isCurated, changed: false };
    if (input.isCurated) {
      await manager.query(
        `UPDATE templates
         SET is_curated = TRUE,
             curated_at = NOW(),
             curated_by = $1
         WHERE id = $2`,
        [actorId, id],
      );
    } else {
      await manager.query(
        `UPDATE templates
         SET is_curated = FALSE,
             curated_at = NULL,
             curated_by = NULL
         WHERE id = $1`,
        [id],
      );
    }

    await this.audit.record(
      {
        actorId,
        action: input.isCurated ? "TEMPLATE_CURATED" : "TEMPLATE_UNCURATED",
        targetType: "template",
        targetId: id,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
        reason:
          reason ||
          (input.isCurated
            ? "Marked as curated template"
            : "Removed curation badge"),
        metadata: {
          templateTitle: target.title,
          isCurated: input.isCurated,
          ...(batchId ? { batchId } : {}),
        },
      },
      manager,
    );

    return { success: true, id, isCurated: input.isCurated, changed: true };
  }

  async curate(
    id: string,
    input: AdminCurateTemplateDto,
    actorId: string,
    meta: { ip?: string; userAgent?: string },
  ) {
    return this.transaction(async (manager) => {
      await lockAdminActor(manager, actorId);
      await this.lockTemplate(manager, id, actorId);
      return this.curateUsing(manager, id, input, actorId, meta);
    });
  }

  async curateMany(
    input: AdminBatchCurationDto,
    actorId: string,
    meta: { ip?: string; userAgent?: string },
  ) {
    const ids = selectedIds(input.ids);
    return this.transaction(async (manager) => {
      await lockAdminActor(manager, actorId);
      const hints: { id: string; author_id: string }[] = await manager.query(
        "SELECT id,author_id FROM templates WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL",
        [ids],
      );
      if (hints.length !== ids.length)
        throw new NotFoundException(
          "Một số mẫu không còn khả dụng. Hãy tải lại danh sách chọn.",
        );
      for (const author of [
        ...new Set(hints.map((row) => row.author_id)),
      ].sort())
        await manager.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          ["eru-template-quota:" + author],
        );
      await manager.query(
        "SELECT id FROM templates WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [ids],
      );
      await manager.query(
        "SELECT set_config('eru.actor_id',$1,true),set_config('eru.template_operation','update',true)",
        [actorId],
      );
      const batchId = randomUUID();
      let updated = 0;
      for (const id of ids)
        if (
          (
            await this.curateUsing(
              manager,
              id,
              input,
              actorId,
              meta,
              input.reason,
              batchId,
            )
          ).changed
        )
          updated++;
      return { updated, ids, isCurated: input.isCurated, batchId };
    });
  }

  async forceHide(
    id: string,
    reason: string,
    actorId: string,
    meta: { ip?: string; userAgent?: string },
    expectedRevision?: number,
  ) {
    return this.transaction(async (manager) => {
      await lockAdminActor(manager, actorId);
      await this.lockTemplate(manager, id, actorId);
      const [target] = await manager.query(
        "SELECT id, title, is_public, moderation_state, revision FROM templates WHERE id = $1 AND deleted_at IS NULL",
        [id],
      );
      if (!target) throw new NotFoundException("Template not found");
      if (
        expectedRevision !== undefined &&
        target.revision !== expectedRevision
      )
        throw new ConflictException(
          "Mẫu đã thay đổi. Hãy tải lại để đối chiếu trước khi ẩn.",
        );

      await manager.query(
        `UPDATE templates
       SET moderation_state = 'hidden',
           is_public = FALSE,
           moderation_reason = $1,
           updated_at = NOW()
       WHERE id = $2`,
        [reason, id],
      );

      await this.audit.record(
        {
          actorId,
          action: "TEMPLATE_FORCE_HIDDEN",
          targetType: "template",
          targetId: id,
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
          reason,
          metadata: { templateTitle: target.title },
        },
        manager,
      );

      return { success: true, id, moderationState: "hidden", reason };
    });
  }
}
