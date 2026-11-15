import {
  lockDocumentQuota,
  assertDocumentRetention,
} from "../community-documents/document-history";
import { createHash } from "node:crypto";
import { recordAdminActions } from "./admin-audit-record";
import {
  AdminCategoryTransferDto,
  AdminCategoryTransferPreviewDto,
} from "./dto/lifecycle.dto";
import {
  SERVICE_CONTROL_SETTINGS,
  type ServiceControlSettings,
} from "../service-controls/settings";
import { assertRetainedQuota } from "../templates/template-quota";
import { Inject } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { randomUUID } from "node:crypto";
import { BadRequestException, HttpCode } from "@nestjs/common";
import { RateLimited } from "../service-controls/service-controls";
import { AdminCategoryImportDto, AdminSelectionDto } from "./dto/batch.dto";
import { inspectCategoryImport } from "./category-import";
import { lockAdminActor, selectedIds } from "./admin-authorization";
import { BaseController } from "../common/controllers/base.controller";
import { AdminController } from "./admin-controller.decorator";
import { BaseService } from "../common/services/base.service";
import {
  Body,
  ConflictException,
  Delete,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiOperation } from "@nestjs/swagger";
import { DataSource } from "typeorm";
import { CurrentUser } from "../auth/auth.guards";
import type { UserIdentity } from "../auth/auth-store";
import { UuidPipe } from "../common/uuid.pipe";
import { AdminAuditService } from "./admin-audit.service";
import {
  AdminCategoryDto,
  AdminPageQueryDto,
  AdminReasonDto,
} from "./dto/admin.dto";
import { type AdminRequest, type AdminRequestMeta } from "./request-meta";

interface CategoryRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  displayOrder: number;
}

@Injectable()
export class AdminCategoriesService extends BaseService {
  constructor(
    dataSource: DataSource,
    private readonly audit: AdminAuditService,
    @Inject(SERVICE_CONTROL_SETTINGS)
    private readonly limits: ServiceControlSettings,
  ) {
    super(dataSource);
  }

  async list(query: AdminPageQueryDto) {
    const values = query.search ? [`%${query.search}%`] : [];
    const where = query.search
      ? "WHERE (c.name ILIKE $1 OR c.slug ILIKE $1)"
      : "";
    return this.paginate(query, async (manager, { size, offset }) => {
      const [{ total }] = await manager.query(
        `SELECT count(*)::int AS total FROM categories c ${where}`,
        values,
      );
      const rows = await manager.query(
        `SELECT c.id,c.name,c.slug,c.icon,c.description,c.display_order AS "displayOrder",
        (SELECT count(*)::int FROM templates t WHERE t.category_id=c.id) AS "templateCount",
        (SELECT count(*)::int FROM community_documents d WHERE d.category_id=c.id) AS "documentCount"
        FROM categories c ${where} ORDER BY c.display_order,c.name,c.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, size, offset],
      );
      return { data: rows, total };
    });
  }

  previewImport(input: AdminCategoryImportDto) {
    return inspectCategoryImport(input.rows, this.dataSource);
  }

  async importRows(
    input: AdminCategoryImportDto,
    actorId: string,
    meta: AdminRequestMeta,
  ) {
    try {
      return await this.transaction(async (manager) => {
        await lockAdminActor(manager, actorId);
        const preview = await inspectCategoryImport(input.rows, manager);
        if (preview.issues.length)
          throw new BadRequestException(
            preview.issues
              .map((issue) => `Dòng ${issue.row}: ${issue.message}`)
              .join(" · "),
          );
        const ids: string[] = [],
          batchId = randomUUID();
        for (const row of preview.rows) {
          const [created] = await this.rows<CategoryRecord>(
            manager,
            'INSERT INTO categories(name,slug,description,display_order) VALUES($1,$2,$3,$4) RETURNING id,name,slug,description,display_order AS "displayOrder"',
            [row.name, row.slug, row.description || null, row.displayOrder],
          );
          ids.push(created.id);
          await this.audit.record(
            {
              actorId,
              action: "CATEGORY_CREATED",
              targetType: "category",
              targetId: created.id,
              reason: input.reason,
              ipAddress: meta.ip,
              userAgent: meta.userAgent,
              metadata: { current: created, source: "import", batchId },
            },
            manager,
          );
        }
        return { created: ids.length, ids, batchId };
      });
    } catch (error) {
      this.conflict(error);
    }
  }

  async removeMany(
    input: AdminSelectionDto,
    actorId: string,
    meta: AdminRequestMeta,
  ) {
    const ids = selectedIds(input.ids);
    try {
      return await this.transaction(async (manager) => {
        await lockAdminActor(manager, actorId);
        const rows = await manager.query<CategoryRecord[]>(
          'SELECT id,name,slug,description,display_order AS "displayOrder" FROM categories WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
          [ids],
        );
        if (rows.length !== ids.length)
          throw new NotFoundException(
            "Một số chuyên mục không còn tồn tại. Hãy tải lại danh sách chọn.",
          );
        const used: { name: string }[] = await manager.query(
          "SELECT c.name FROM categories c WHERE c.id=ANY($1::uuid[]) AND (EXISTS(SELECT 1 FROM templates t WHERE t.category_id=c.id) OR EXISTS(SELECT 1 FROM community_documents d WHERE d.category_id=c.id)) ORDER BY c.id",
          [ids],
        );
        if (used.length)
          throw new ConflictException(
            `Chuyên mục đang được sử dụng: ${used.map((row) => row.name).join(", ")}. Toàn bộ danh sách được giữ lại.`,
          );
        await manager.query("DELETE FROM categories WHERE id=ANY($1::uuid[])", [
          ids,
        ]);
        const batchId = randomUUID();
        for (const row of rows)
          await this.audit.record(
            {
              actorId,
              action: "CATEGORY_DELETED",
              targetType: "category",
              targetId: row.id,
              reason: input.reason,
              ipAddress: meta.ip,
              userAgent: meta.userAgent,
              metadata: { previous: row, batchId },
            },
            manager,
          );
        return { deleted: rows.length, ids, batchId };
      });
    } catch (error) {
      this.conflict(error);
    }
  }

  private async transferState(
    manager: Pick<EntityManager, "query">,
    source: string,
    target: string,
  ) {
    if (source === target)
      throw new BadRequestException(
        "Chọn chuyên mục đích khác chuyên mục nguồn",
      );
    const categories = await manager.query(
      "SELECT id,name FROM categories WHERE id=ANY($1::uuid[]) ORDER BY id",
      [[source, target]],
    );
    if (categories.length !== 2)
      throw new NotFoundException(
        "Chuyên mục nguồn hoặc đích không còn tồn tại",
      );
    const templates = await manager.query(
      "SELECT id,revision,author_id FROM templates WHERE category_id=$1 ORDER BY id",
      [source],
    );
    const documents = await manager.query(
      "SELECT id,version FROM community_documents WHERE category_id=$1 ORDER BY id",
      [source],
    );
    const previewToken = createHash("sha256")
      .update(JSON.stringify({ source, target, templates, documents }))
      .digest("hex");
    return {
      templates,
      documents,
      previewToken,
      sourceName: categories.find((row: { id: string }) => row.id === source)
        .name,
      targetName: categories.find((row: { id: string }) => row.id === target)
        .name,
    };
  }
  async previewTransfer(id: string, input: AdminCategoryTransferPreviewDto) {
    const state = await this.snapshot((m) =>
      this.transferState(m, id, input.targetCategoryId),
    );
    return {
      previewToken: state.previewToken,
      templates: state.templates.length,
      documents: state.documents.length,
      sourceName: state.sourceName,
      targetName: state.targetName,
    };
  }
  async transfer(
    id: string,
    input: AdminCategoryTransferDto,
    actorId: string,
    meta: AdminRequestMeta,
  ) {
    return this.transaction(async (manager) => {
      await lockAdminActor(manager, actorId);
      // Match author-write lock order before acquiring category FK locks.
      const authors = await manager.query(
        "SELECT DISTINCT author_id FROM templates WHERE category_id=$1 ORDER BY author_id",
        [id],
      );
      for (const author of authors)
        await manager.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          ["eru-template-quota:" + author.author_id],
        );
      const documentAuthors = await manager.query(
        "SELECT DISTINCT author_id FROM community_documents WHERE category_id=$1 ORDER BY author_id",
        [id],
      );
      for (const author of documentAuthors)
        await lockDocumentQuota(manager, author.author_id);
      await manager.query(
        "SELECT id FROM categories WHERE id=ANY($1::uuid[]) ORDER BY id FOR NO KEY UPDATE",
        [[id, input.targetCategoryId]],
      );
      await manager.query(
        "SELECT id FROM templates WHERE category_id=$1 ORDER BY id FOR UPDATE",
        [id],
      );
      await manager.query(
        "SELECT id FROM community_documents WHERE category_id=$1 ORDER BY id FOR UPDATE",
        [id],
      );
      const state = await this.transferState(
        manager,
        id,
        input.targetCategoryId,
      );
      // A newly referenced author must not bypass the quota lock set acquired above.
      if (
        state.templates.some(
          (row: { author_id: string }) =>
            !authors.some(
              (author: { author_id: string }) =>
                author.author_id === row.author_id,
            ),
        )
      )
        throw new ConflictException(
          "Nội dung đã thay đổi. Hãy kiểm tra lại phạm vi chuyển.",
        );
      if (state.previewToken !== input.previewToken)
        throw new ConflictException(
          "Nội dung hoặc revision đã thay đổi sau bước xem trước. Hãy kiểm tra lại.",
        );
      const retained = async (authorId: string) => {
        const [row] = await manager.query(
          "SELECT (SELECT count(*)::int FROM templates WHERE author_id=$1) AS templates,(SELECT count(*)::int FROM template_revisions r JOIN templates t ON t.id=r.template_id WHERE t.author_id=$1) AS revisions,(SELECT COALESCE(sum(content_bytes),0) FROM templates WHERE author_id=$1)+(SELECT COALESCE(sum(snapshot_bytes),0) FROM template_revisions r JOIN templates t ON t.id=r.template_id WHERE t.author_id=$1) AS bytes",
          [authorId],
        );
        return {
          templates: row.templates,
          revisions: row.revisions,
          contentBytes: Number(row.bytes),
        };
      };
      const before = new Map<string, Awaited<ReturnType<typeof retained>>>();
      for (const author of authors)
        before.set(author.author_id, await retained(author.author_id));
      await manager.query(
        "SELECT set_config('eru.actor_id',$1,true),set_config('eru.template_operation','update',true)",
        [actorId],
      );
      const templates = await this.rows<{ id: string; title: string }>(
        manager,
        "UPDATE templates SET category_id=$2,updated_at=now() WHERE id=ANY($1::uuid[]) RETURNING id,title",
        [
          state.templates.map((row: { id: string }) => row.id),
          input.targetCategoryId,
        ],
      );
      const documents = await this.rows<{
        id: string;
        title: string;
        version: number;
      }>(
        manager,
        "UPDATE community_documents SET category_id=$2,version=version+1,updated_at=now() WHERE id=ANY($1::uuid[]) RETURNING id,title,version",
        [
          state.documents.map((row: { id: string }) => row.id),
          input.targetCategoryId,
        ],
      );
      for (const author of authors)
        assertRetainedQuota(
          this.limits,
          before.get(author.author_id)!,
          await retained(author.author_id),
        );
      for (const author of documentAuthors)
        await assertDocumentRetention(manager, author.author_id);
      const batchId = randomUUID();
      await recordAdminActions(manager, [
        ...templates.map((row) => ({
          actorId,
          action: "TEMPLATE_CATEGORY_TRANSFERRED",
          targetType: "template",
          targetId: row.id,
          reason: input.reason,
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
          metadata: {
            title: row.title,
            previousCategoryId: id,
            categoryId: input.targetCategoryId,
            batchId,
          },
        })),
        ...documents.map((row) => ({
          actorId,
          action: "DOCUMENT_CATEGORY_TRANSFERRED",
          targetType: "community_document",
          targetId: row.id,
          reason: input.reason,
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
          metadata: {
            title: row.title,
            previousCategoryId: id,
            categoryId: input.targetCategoryId,
            batchId,
          },
        })),
      ]);
      if (documents.length)
        await manager.query(
          "INSERT INTO community_document_events(document_id,actor_id,action,reason,version) SELECT id,$2,'category_changed',$3,version FROM community_documents WHERE id=ANY($1::uuid[])",
          [documents.map((row) => row.id), actorId, input.reason],
        );
      return {
        templates: templates.length,
        documents: documents.length,
        batchId,
      };
    });
  }
  private conflict(error: unknown): never {
    const code = (error as { driverError?: { code?: string } })?.driverError
      ?.code;
    if (code === "23505")
      throw new ConflictException(
        "Tên hoặc đường dẫn chuyên mục đã được sử dụng.",
      );
    if (code === "23503")
      throw new ConflictException(
        "Chuyên mục đang có mẫu hoặc tài liệu tham chiếu, bao gồm mẫu đã đưa vào thùng rác. Hãy chuyển chúng sang chuyên mục khác trước.",
      );
    throw error;
  }

  async save(
    id: string | null,
    input: AdminCategoryDto,
    actorId: string,
    meta: AdminRequestMeta,
  ) {
    try {
      return await this.transaction(async (manager) => {
        await lockAdminActor(manager, actorId);
        let previous = null;
        if (id) {
          [previous] = await manager.query(
            'SELECT id,name,slug,description,display_order AS "displayOrder" FROM categories WHERE id=$1 FOR UPDATE',
            [id],
          );
          if (!previous)
            throw new NotFoundException("Không tìm thấy chuyên mục");
        }
        const values = [
          input.name,
          input.slug,
          input.description || null,
          input.displayOrder,
        ];
        const [category] = await this.rows<CategoryRecord>(
          manager,
          id
            ? 'UPDATE categories SET name=$1,slug=$2,description=$3,display_order=$4 WHERE id=$5 RETURNING id,name,slug,description,display_order AS "displayOrder"'
            : 'INSERT INTO categories(name,slug,description,display_order) VALUES($1,$2,$3,$4) RETURNING id,name,slug,description,display_order AS "displayOrder"',
          id ? [...values, id] : values,
        );
        await this.audit.record(
          {
            actorId,
            action: id ? "CATEGORY_UPDATED" : "CATEGORY_CREATED",
            targetType: "category",
            targetId: category.id,
            reason: input.reason,
            ipAddress: meta.ip,
            userAgent: meta.userAgent,
            metadata: { previous, current: category },
          },
          manager,
        );
        return category;
      });
    } catch (error) {
      this.conflict(error);
    }
  }

  async remove(
    id: string,
    reason: string,
    actorId: string,
    meta: AdminRequestMeta,
  ) {
    try {
      return await this.transaction(async (manager) => {
        await lockAdminActor(manager, actorId);
        const [category] = await this.rows<{
          id: string;
          name: string;
          slug: string;
        }>(
          manager,
          "DELETE FROM categories WHERE id=$1 RETURNING id,name,slug",
          [id],
        );
        if (!category) throw new NotFoundException("Không tìm thấy chuyên mục");
        await this.audit.record(
          {
            actorId,
            action: "CATEGORY_DELETED",
            targetType: "category",
            targetId: id,
            reason,
            ipAddress: meta.ip,
            userAgent: meta.userAgent,
            metadata: { previous: category },
          },
          manager,
        );
        return { success: true, id };
      });
    } catch (error) {
      this.conflict(error);
    }
  }
}

@AdminController("categories", "Admin - Categories")
export class AdminCategoriesController extends BaseController {
  constructor(private readonly service: AdminCategoriesService) {
    super();
  }
  @Get()
  @ApiOperation({ summary: "Tìm kiếm chuyên mục, thứ tự và số mẫu tham chiếu" })
  list(@Query() query: AdminPageQueryDto) {
    return this.service.list(query);
  }
  @Post()
  @ApiOperation({
    summary: "Tạo chuyên mục cộng đồng và ghi nhật ký cùng transaction",
  })
  create(
    @Body() input: AdminCategoryDto,
    @CurrentUser() actor: UserIdentity,
    @Req() req: AdminRequest,
  ) {
    const { actorId, meta } = this.actionContext(actor, req);
    return this.service.save(null, input, actorId, meta);
  }
  @Post(":id/transfer-preview")
  @HttpCode(200)
  @RateLimited("write")
  transferPreview(
    @Param("id", UuidPipe) id: string,
    @Body() input: AdminCategoryTransferPreviewDto,
  ) {
    return this.service.previewTransfer(id, input);
  }
  @Post(":id/transfer")
  @HttpCode(200)
  @RateLimited("write")
  transfer(
    @Param("id", UuidPipe) id: string,
    @Body() input: AdminCategoryTransferDto,
    @CurrentUser() actor: UserIdentity,
    @Req() req: AdminRequest,
  ) {
    const context = this.actionContext(actor, req);
    return this.service.transfer(id, input, context.actorId, context.meta);
  }
  @Post("import/preview")
  @HttpCode(200)
  @RateLimited("write")
  @ApiOperation({
    summary: "Kiểm tra tối đa 100 chuyên mục trước khi nhập; không ghi dữ liệu",
  })
  preview(@Body() input: AdminCategoryImportDto) {
    return this.service.previewImport(input);
  }

  @Post("import")
  @HttpCode(200)
  @RateLimited("write")
  @ApiOperation({
    summary: "Nhập chuyên mục mới và audit trong một transaction",
  })
  importRows(
    @Body() input: AdminCategoryImportDto,
    @CurrentUser() actor: UserIdentity,
    @Req() req: AdminRequest,
  ) {
    const context = this.actionContext(actor, req);
    return this.service.importRows(input, context.actorId, context.meta);
  }

  @Post("batch-delete")
  @HttpCode(200)
  @RateLimited("write")
  @ApiOperation({
    summary:
      "Xóa đồng thời tối đa 100 chuyên mục chưa sử dụng, kèm lý do và audit",
  })
  removeMany(
    @Body() input: AdminSelectionDto,
    @CurrentUser() actor: UserIdentity,
    @Req() req: AdminRequest,
  ) {
    const context = this.actionContext(actor, req);
    return this.service.removeMany(input, context.actorId, context.meta);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Sửa tên, đường dẫn và thứ tự chuyên mục" })
  update(
    @Param("id", UuidPipe) id: string,
    @Body() input: AdminCategoryDto,
    @CurrentUser() actor: UserIdentity,
    @Req() req: AdminRequest,
  ) {
    const { actorId, meta } = this.actionContext(actor, req);
    return this.service.save(id, input, actorId, meta);
  }
  @Delete(":id")
  @ApiOperation({
    summary: "Xóa chuyên mục chưa được sử dụng; từ chối nếu còn mẫu tham chiếu",
  })
  remove(
    @Param("id", UuidPipe) id: string,
    @Body() input: AdminReasonDto,
    @CurrentUser() actor: UserIdentity,
    @Req() req: AdminRequest,
  ) {
    const { actorId, meta } = this.actionContext(actor, req);
    return this.service.remove(id, input.reason, actorId, meta);
  }
}
