import {
  BadRequestException,
  Body,
  ConflictException,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Inject,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { BaseService } from "../common/services/base.service";
import { BaseController } from "../common/controllers/base.controller";
import { AdminController } from "./admin-controller.decorator";
import { UuidPipe } from "../common/uuid.pipe";
import { CurrentUser } from "../auth/auth.guards";
import {
  AUTH_STORE,
  type AuthStore,
  type UserIdentity,
} from "../auth/auth-store";
import { Passwords } from "../auth/passwords";
import { RateLimited } from "../service-controls/service-controls";
import type { AdminRequest, AdminRequestMeta } from "./request-meta";
import { ResourcesService } from "../resources/resources.service";
import { recordAdminAction, recordAdminActions } from "./admin-audit-record";
import { lockAdminActor, lockAdminTarget } from "./admin-authorization";
import {
  AdminResourceActionDto,
  AdminResourcePlanDto,
  AdminResourceQueryDto,
  AdminRetentionPreviewDto,
  AdminRetentionCommitDto,
} from "./dto/resource-admin.dto";

const resourceFields = `d.id,d.owner_id AS "ownerId",u.email AS "ownerEmail",d.title,d.access,d.revision,d.deleted_at AS "deletedAt",d.created_at AS "createdAt",d.updated_at AS "updatedAt",d.content_bytes::int AS "contentBytes"`;
@Injectable()
export class AdminResourcesService extends BaseService {
  constructor(
    db: DataSource,
    private readonly resources: ResourcesService,
    @Inject(AUTH_STORE) private readonly accounts: AuthStore,
    private readonly passwords: Passwords,
  ) {
    super(db);
  }
  async documents(query: AdminResourceQueryDto) {
    const clauses: string[] = [],
      values: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      clauses.push(sql.replace(/\?/g, "$" + values.length));
    };
    if (query.status !== "all")
      clauses.push(
        query.status === "trash"
          ? "d.deleted_at IS NOT NULL"
          : "d.deleted_at IS NULL",
      );
    if (query.ownerId) add("d.owner_id=?", query.ownerId);
    if (query.access) add("d.access=?", query.access);
    if (query.search)
      add("(d.title ILIKE ? OR u.email ILIKE ?)", "%" + query.search + "%");
    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
    return this.paginate(query, async (m, { size, offset }) => {
      const [{ total }] = await m.query(
        `SELECT count(*)::int total FROM resource_documents d JOIN users u ON u.id=d.owner_id ${where}`,
        values,
      );
      const data = await m.query(
        `SELECT ${resourceFields},(SELECT count(*)::int FROM resource_document_grants g WHERE g.document_id=d.id) AS "grantCount" FROM resource_documents d JOIN users u ON u.id=d.owner_id ${where} ORDER BY d.updated_at DESC,d.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, size, offset],
      );
      return { data, total };
    });
  }
  async accountsList(query: AdminResourceQueryDto) {
    const values: unknown[] = [],
      conditions = ["u.deleted_at IS NULL"];
    if (query.search) {
      values.push("%" + query.search + "%");
      conditions.push(`u.email ILIKE $${values.length}`);
    }
    if (query.plan) {
      values.push(query.plan);
      conditions.push(
        `CASE WHEN p.expires_at<=now() THEN 'free' ELSE COALESCE(p.plan,'free') END=$${values.length}`,
      );
    }
    const where = "WHERE " + conditions.join(" AND ");
    return this.paginate(query, async (m, { size, offset }) => {
      const [{ total }] = await m.query(
        `SELECT count(*)::int total FROM users u LEFT JOIN resource_account_plans p ON p.user_id=u.id ${where}`,
        values,
      );
      const data = await m.query(
        `SELECT u.id,u.email,u.role,u.is_active AS "isActive",COALESCE(p.plan,'free') AS "storedPlan",CASE WHEN p.expires_at<=now() THEN 'free' ELSE COALESCE(p.plan,'free') END AS plan,p.expires_at AS "expiresAt",COALESCE(p.revision,0) AS revision,p.daily_limit AS "dailyLimit",p.document_limit AS "documentLimit",p.retained_bytes_limit AS "retainedBytesLimit",COALESCE(s.requests,0) AS used,(SELECT count(*)::int FROM resource_documents d WHERE d.owner_id=u.id AND d.deleted_at IS NULL) AS "activeDocuments",(SELECT count(*)::int FROM resource_documents d WHERE d.owner_id=u.id) AS "retainedDocuments",(SELECT COALESCE(sum(d.content_bytes),0)::bigint FROM resource_documents d WHERE d.owner_id=u.id) AS "retainedBytes" FROM users u LEFT JOIN resource_account_plans p ON p.user_id=u.id LEFT JOIN resource_daily_usage s ON s.user_id=u.id AND s.usage_day=(now() AT TIME ZONE 'UTC')::date ${where} ORDER BY u.email,u.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, size, offset],
      );
      return { data, total };
    });
  }
  async account(id: string) {
    return this.snapshot(async (m) => {
      const [user] = await m.query(
        'SELECT id,email,role,is_active AS "isActive",deleted_at AS "deletedAt" FROM users WHERE id=$1',
        [id],
      );
      if (!user) throw new NotFoundException("Không tìm thấy tài khoản");
      const [plan] = await m.query(
        'SELECT plan,expires_at AS "expiresAt",revision,daily_limit AS "dailyLimit",document_limit AS "documentLimit",retained_bytes_limit AS "retainedBytesLimit" FROM resource_account_plans WHERE user_id=$1',
        [id],
      );
      const limits = await this.resources.limits(user, m);
      const [usage] = await m.query(
        `SELECT count(*)::int AS "retainedDocuments",count(*) FILTER(WHERE deleted_at IS NULL)::int AS "activeDocuments",COALESCE(sum(content_bytes),0)::bigint AS "retainedBytes" FROM resource_documents WHERE owner_id=$1`,
        [id],
      );
      const [day] = await m.query(
        "SELECT requests FROM resource_daily_usage WHERE user_id=$1 AND usage_day=(now() AT TIME ZONE 'UTC')::date",
        [id],
      );
      return {
        user,
        plan: plan ?? {
          plan: "free",
          revision: 0,
          expiresAt: null,
          dailyLimit: null,
          documentLimit: null,
          retainedBytesLimit: null,
        },
        limits,
        usage: { ...usage, used: day?.requests ?? 0 },
      };
    });
  }
  plan(
    id: string,
    input: AdminResourcePlanDto,
    actor: UserIdentity,
    meta: AdminRequestMeta,
  ) {
    return this.resources.updatePlan(id, input, actor, meta);
  }
  async detail(id: string) {
    return this.snapshot(async (m) => {
      const [document] = await m.query(
        `SELECT ${resourceFields},d.html FROM resource_documents d JOIN users u ON u.id=d.owner_id WHERE d.id=$1`,
        [id],
      );
      if (!document) throw new NotFoundException("Không tìm thấy tài nguyên");
      const grants = await m.query(
        'SELECT g.user_id AS "userId",u.email,g.created_at AS "createdAt",g.granted_by AS "grantedBy" FROM resource_document_grants g JOIN users u ON u.id=g.user_id WHERE g.document_id=$1 ORDER BY g.created_at,g.user_id LIMIT 100',
        [id],
      );
      const events = await m.query(
        'SELECT e.id::text,e.user_id AS "userId",u.email,e.action,e.outcome,e.target_origin AS "targetOrigin",e.created_at AS "createdAt" FROM resource_access_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.document_id=$1 ORDER BY e.id DESC LIMIT 100',
        [id],
      );
      return { document, grants, events };
    });
  }
  async entries(
    id: string,
    kind: "grants" | "events",
    query: AdminResourceQueryDto,
  ) {
    return this.paginate(query, async (m, { size, offset }) => {
      if (
        !(await m.query("SELECT id FROM resource_documents WHERE id=$1", [id]))
          .length
      )
        throw new NotFoundException("Không tìm thấy tài nguyên");
      const values: unknown[] = [id];
      const search = query.search
        ? (values.push("%" + query.search + "%"),
          ` AND (u.email ILIKE $2 ${kind === "events" ? "OR e.action ILIKE $2 OR e.outcome ILIKE $2" : ""})`)
        : "";
      const table =
        kind === "grants"
          ? "resource_document_grants"
          : "resource_access_events";
      const from = `FROM ${table} e LEFT JOIN users u ON u.id=e.user_id WHERE e.document_id=$1 ${search}`;
      const [{ total }] = await m.query(
        `SELECT count(*)::int total ${from}`,
        values,
      );
      const fields =
        kind === "grants"
          ? 'e.user_id AS "userId",u.email,e.created_at AS "createdAt",e.granted_by AS "grantedBy"'
          : 'e.id::text,e.user_id AS "userId",u.email,e.action,e.outcome,e.target_origin AS "targetOrigin",e.created_at AS "createdAt"';
      const data = await m.query(
        `SELECT ${fields} ${from} ORDER BY e.created_at DESC,${kind === "grants" ? "e.user_id" : "e.id"} DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, size, offset],
      );
      return { data, total };
    });
  }
  async usage() {
    return this.snapshot(async (m) => {
      const [documents] = await m.query(
        'SELECT count(*)::int total,count(*) FILTER(WHERE deleted_at IS NULL)::int active,count(*) FILTER(WHERE deleted_at IS NOT NULL)::int trash,COALESCE(sum(content_bytes),0)::bigint AS "retainedBytes",COALESCE(sum(content_bytes) FILTER(WHERE deleted_at IS NOT NULL),0)::bigint AS "trashBytes" FROM resource_documents',
      );
      const [templates] = await m.query(
        'SELECT count(*)::int total,count(*) FILTER(WHERE deleted_at IS NOT NULL)::int trash,COALESCE(sum(content_bytes),0)::bigint AS "contentBytes" FROM templates',
      );
      const [history] = await m.query(
        "SELECT count(*)::int total,COALESCE(sum(snapshot_bytes),0)::bigint bytes FROM template_revisions",
      );
      const [requests] = await m.query(
        "SELECT COALESCE(sum(requests),0)::bigint total FROM resource_daily_usage WHERE usage_day=(now() AT TIME ZONE 'UTC')::date",
      );
      return {
        documents,
        templates,
        history,
        requestsToday: requests.total,
        settings: {
          enabled: this.resources.settings.enabled,
          freeDailyLimit: this.resources.settings.freeDailyLimit,
          premiumDailyLimit: this.resources.settings.premiumDailyLimit,
          retainedDocuments:
            this.resources.settings.maxRetainedDocuments ?? 100,
          retainedBytes: this.resources.settings.maxRetainedBytes ?? 52428800,
        },
      };
    });
  }
  private async retentionScope(
    m: EntityManager,
    ownerId: string,
    actorId: string,
    cutoff: string,
    lock = false,
  ) {
    const rows = await m.query(
      `SELECT id,title,revision,content_bytes::text AS bytes FROM resource_documents WHERE owner_id=$1 AND deleted_at IS NOT NULL AND deleted_at<=$2::timestamptz ORDER BY deleted_at,id LIMIT 100 ${lock ? "FOR UPDATE" : ""}`,
      [ownerId, cutoff],
    );
    const [{ total }] = await m.query(
      "SELECT count(*)::int total FROM resource_documents WHERE owner_id=$1 AND deleted_at IS NOT NULL AND deleted_at<=$2::timestamptz",
      [ownerId, cutoff],
    );
    return {
      ownerId,
      cutoff,
      rows,
      total,
      selected: rows.length,
      bytes: rows.reduce(
        (sum: number, row: { bytes: string }) => sum + Number(row.bytes),
        0,
      ),
      previewToken: createHash("sha256")
        .update(JSON.stringify({ actorId, ownerId, cutoff, rows }))
        .digest("hex"),
    };
  }
  async retentionPreview(input: AdminRetentionPreviewDto, actor: UserIdentity) {
    return this.transaction(async (m) => {
      await lockAdminTarget(m, actor.id, input.ownerId, true, true);
      return this.retentionScope(
        m,
        input.ownerId,
        actor.id,
        new Date(Date.now() - 30 * 86400000).toISOString(),
      );
    });
  }
  async retentionCommit(
    input: AdminRetentionCommitDto,
    actor: UserIdentity,
    meta: AdminRequestMeta,
  ) {
    if (Date.parse(input.cutoff) > Date.now() - 30 * 86400000)
      throw new BadRequestException(
        "Chỉ dọn tài nguyên đã nằm trong thùng rác ít nhất 30 ngày",
      );
    const account = await this.accounts.findCredentialsById(actor.id);
    if (
      !account ||
      !(await this.passwords.verify(input.password, account.passwordHash))
    )
      throw new ForbiddenException("Mật khẩu xác nhận chưa đúng");
    return this.transaction(async (m) => {
      await lockAdminTarget(m, actor.id, input.ownerId, true, true);
      const [current] = await m.query(
        "SELECT id FROM users WHERE id=$1 AND password_hash=$2",
        [actor.id, account.passwordHash],
      );
      if (!current)
        throw new ForbiddenException(
          "Thông tin xác thực đã thay đổi. Hãy đăng nhập lại",
        );
      const scope = await this.retentionScope(
        m,
        input.ownerId,
        actor.id,
        input.cutoff,
        true,
      );
      if (!scope.selected || scope.previewToken !== input.previewToken)
        throw new ConflictException(
          "Phạm vi dọn đã thay đổi hoặc trống. Hãy kiểm tra lại trước khi xác nhận",
        );
      const batchId = randomUUID();
      await m.query("DELETE FROM resource_documents WHERE id=ANY($1::uuid[])", [
        scope.rows.map((row: { id: string }) => row.id),
      ]);
      await recordAdminActions(
        m,
        scope.rows.map(
          (row: {
            id: string;
            title: string;
            revision: number;
            bytes: string;
          }) => ({
            actorId: actor.id,
            action: "RESOURCE_DOCUMENT_PURGED",
            targetType: "resource_document",
            targetId: row.id,
            reason: input.reason,
            ipAddress: meta.ip,
            userAgent: meta.userAgent,
            metadata: {
              batchId,
              ownerId: input.ownerId,
              title: row.title,
              revision: row.revision,
              bytes: row.bytes,
              retentionDays: 30,
            },
          }),
        ),
      );
      return { deleted: scope.selected, bytes: scope.bytes, batchId };
    });
  }

  async action(
    id: string,
    input: AdminResourceActionDto,
    actor: UserIdentity,
    meta: AdminRequestMeta,
  ) {
    let hash: string | undefined;
    if (input.action === "purge") {
      const account = await this.accounts.findCredentialsById(actor.id);
      if (
        !account ||
        !input.password ||
        !(await this.passwords.verify(input.password, account.passwordHash))
      )
        throw new ForbiddenException("Mật khẩu xác nhận chưa đúng");
      hash = account.passwordHash;
    }
    return this.transaction(async (m) => {
      const [hint] = await m.query(
        "SELECT owner_id FROM resource_documents WHERE id=$1",
        [id],
      );
      if (!hint) throw new NotFoundException("Không tìm thấy tài nguyên");
      await lockAdminTarget(m, actor.id, hint.owner_id, true, true);
      const [row] = await m.query(
        "SELECT * FROM resource_documents WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!row) throw new NotFoundException("Không tìm thấy tài nguyên");
      if (row.revision !== input.revision)
        throw new ConflictException(
          "Tài nguyên đã thay đổi. Hãy tải lại trước khi thao tác.",
        );
      if (
        ["restore", "purge"].includes(input.action)
          ? !row.deleted_at
          : !!row.deleted_at
      )
        throw new ConflictException("Trạng thái thùng rác không còn phù hợp");
      const context = { manager: m, reason: input.reason, meta };
      if (input.action === "grant")
        await this.resources.grant(id, input.userId!, actor, context);
      else if (input.action === "revoke")
        await this.resources.revoke(id, input.userId!, actor, context);
      else if (input.action === "trash")
        await this.resources.remove(id, actor, context);
      else {
        if (input.action === "update") {
          if (row.access === "shared" && input.access !== "shared")
            await m.query(
              "DELETE FROM resource_document_grants WHERE document_id=$1",
              [id],
            );
          await m.query(
            "UPDATE resource_documents SET title=$2,access=$3 WHERE id=$1",
            [id, input.title, input.access],
          );
        }
        if (input.action === "restore") {
          const [owner] = await m.query(
            "SELECT id,role,deleted_at FROM users WHERE id=$1",
            [row.owner_id],
          );
          if (owner.deleted_at)
            throw new ConflictException(
              "Khôi phục tài khoản sở hữu trước khi khôi phục tài nguyên",
            );
          const limits = await this.resources.limits(owner, m);
          const [{ count }] = await m.query(
            "SELECT count(*)::int count FROM resource_documents WHERE owner_id=$1 AND deleted_at IS NULL",
            [row.owner_id],
          );
          if (count >= limits.documentLimit)
            throw new ConflictException(
              "Tài khoản đã đạt hạn mức tài nguyên; hãy điều chỉnh hạn mức trước khi khôi phục",
            );
          await m.query(
            "UPDATE resource_documents SET deleted_at=NULL,access='private' WHERE id=$1",
            [id],
          );
          await m.query(
            "DELETE FROM resource_document_grants WHERE document_id=$1",
            [id],
          );
        }
        if (input.action === "purge") {
          if (input.confirmTitle !== row.title)
            throw new BadRequestException(
              "Nhập đúng tiêu đề tài nguyên để xác nhận",
            );
          const [account] = await m.query(
            "SELECT id FROM users WHERE id=$1 AND password_hash=$2",
            [actor.id, hash],
          );
          if (!account)
            throw new ForbiddenException("Thông tin xác thực đã thay đổi");
          await m.query("DELETE FROM resource_documents WHERE id=$1", [id]);
        }
        await recordAdminAction(m, {
          actorId: actor.id,
          action: {
            update: "RESOURCE_DOCUMENT_UPDATED",
            restore: "RESOURCE_DOCUMENT_RESTORED",
            purge: "RESOURCE_DOCUMENT_PURGED",
          }[input.action],
          targetType: "resource_document",
          targetId: id,
          reason: input.reason,
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
          metadata: {
            previous: {
              title: row.title,
              access: row.access,
              ownerId: row.owner_id,
              revision: row.revision,
            },
            ...(input.action === "update"
              ? { current: { title: input.title, access: input.access } }
              : {}),
          },
        });
      }
      return input.action === "purge"
        ? { id, purged: true }
        : (
            await m.query(
              `SELECT ${resourceFields} FROM resource_documents d JOIN users u ON u.id=d.owner_id WHERE d.id=$1`,
              [id],
            )
          )[0];
    });
  }
}
@AdminController("resources", "Admin - Resources")
export class AdminResourcesController extends BaseController {
  constructor(private readonly service: AdminResourcesService) {
    super();
  }
  @Get("documents") documents(@Query() query: AdminResourceQueryDto) {
    return this.service.documents(query);
  }
  @Get("accounts") accounts(@Query() query: AdminResourceQueryDto) {
    return this.service.accountsList(query);
  }
  @Post("retention/preview")
  @HttpCode(200)
  @RateLimited("write")
  retentionPreview(
    @Body() input: AdminRetentionPreviewDto,
    @CurrentUser() actor: UserIdentity,
  ) {
    return this.service.retentionPreview(input, actor);
  }
  @Post("retention/commit")
  @HttpCode(200)
  @RateLimited("sensitive")
  retentionCommit(
    @Body() input: AdminRetentionCommitDto,
    @CurrentUser() actor: UserIdentity,
    @Req() req: AdminRequest,
  ) {
    return this.service.retentionCommit(
      input,
      actor,
      this.actionContext(actor, req).meta,
    );
  }

  @Get("usage") usage() {
    return this.service.usage();
  }
  @Get("accounts/:id") account(@Param("id", UuidPipe) id: string) {
    return this.service.account(id);
  }
  @Patch("accounts/:id") @HttpCode(200) @RateLimited("write") plan(
    @Param("id", UuidPipe) id: string,
    @Body() input: AdminResourcePlanDto,
    @CurrentUser() actor: UserIdentity,
    @Req() req: AdminRequest,
  ) {
    return this.service.plan(
      id,
      input,
      actor,
      this.actionContext(actor, req).meta,
    );
  }
  @Get("documents/:id/grants") grants(
    @Param("id", UuidPipe) id: string,
    @Query() query: AdminResourceQueryDto,
  ) {
    return this.service.entries(id, "grants", query);
  }
  @Get("documents/:id/events") events(
    @Param("id", UuidPipe) id: string,
    @Query() query: AdminResourceQueryDto,
  ) {
    return this.service.entries(id, "events", query);
  }
  @Get("documents/:id") detail(@Param("id", UuidPipe) id: string) {
    return this.service.detail(id);
  }
  @Post("documents/:id/action") @HttpCode(200) @RateLimited("write") action(
    @Param("id", UuidPipe) id: string,
    @Body() input: AdminResourceActionDto,
    @CurrentUser() actor: UserIdentity,
    @Req() req: AdminRequest,
  ) {
    if (input.action === "purge")
      throw new BadRequestException(
        "Dùng endpoint purge để xác thực thao tác xóa vĩnh viễn",
      );
    return this.service.action(
      id,
      input,
      actor,
      this.actionContext(actor, req).meta,
    );
  }
  @Post("documents/:id/purge")
  @HttpCode(200)
  @RateLimited("sensitive")
  purge(
    @Param("id", UuidPipe) id: string,
    @Body() input: AdminResourceActionDto,
    @CurrentUser() actor: UserIdentity,
    @Req() req: AdminRequest,
  ) {
    if (input.action !== "purge")
      throw new BadRequestException("Chỉ chấp nhận thao tác purge");
    return this.service.action(
      id,
      input,
      actor,
      this.actionContext(actor, req).meta,
    );
  }
}
