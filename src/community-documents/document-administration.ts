import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { BaseService } from "../common/services/base.service";
import { BaseController } from "../common/controllers/base.controller";
import { lockAdminActor } from "../admin/admin-authorization";
import { AdminController } from "../admin/admin-controller.decorator";
import { recordAdminAction } from "../admin/admin-audit-record";
import { CurrentUser } from "../auth/auth.guards";
import type { UserIdentity } from "../auth/auth-store";
import type { ClientRequest, RequestMeta } from "../common/request-context";
import { UuidPipe } from "../common/uuid.pipe";
import { RateLimited } from "../service-controls/service-controls";
import {
  DocumentHistoryQueryDto,
  DocumentSnapshotQueryDto,
  DocumentRestoreDto,
  DocumentReportDto,
  DocumentReportQueryDto,
  DocumentReportDecisionDto,
} from "./history-contracts";
import { lockDocumentQuota, assertDocumentRetention } from "./document-history";
@Injectable()
export class DocumentAdministrationService extends BaseService {
  constructor(db: DataSource) {
    super(db);
  }
  async history(id: string, query: DocumentHistoryQueryDto) {
    return this.paginate(query, async (m, { size, offset }) => {
      if (
        !(await m.query("SELECT id FROM community_documents WHERE id=$1", [id]))
          .length
      )
        throw new NotFoundException("Không tìm thấy tài liệu");
      const [{ total }] = await m.query(
        "SELECT count(*)::int total FROM community_document_versions WHERE document_id=$1",
        [id],
      );
      const data = await m.query(
        `SELECT version,actor_id AS "actorId",created_at AS "createdAt",snapshot->>'title' AS title,snapshot->>'status' AS status,snapshot_bytes AS "contentBytes" FROM community_document_versions WHERE document_id=$1 ORDER BY version DESC LIMIT $2 OFFSET $3`,
        [id, size, offset],
      );
      return { data, total };
    });
  }
  async versionSnapshot(id: string, version: number) {
    const [row] = await this.dataSource.query(
      'SELECT version,created_at AS "createdAt",snapshot FROM community_document_versions WHERE document_id=$1 AND version=$2',
      [id, version],
    );
    if (!row) throw new NotFoundException("Không tìm thấy phiên bản tài liệu");
    return row;
  }
  async restore(
    id: string,
    input: DocumentRestoreDto,
    actor: UserIdentity,
    meta: RequestMeta,
  ) {
    return this.transaction(async (m) => {
      await lockAdminActor(m, actor.id);
      const [hint] = await m.query(
        "SELECT author_id FROM community_documents WHERE id=$1",
        [id],
      );
      if (!hint) throw new NotFoundException("Không tìm thấy tài liệu");
      await lockDocumentQuota(m, hint.author_id);
      const [current] = await m.query(
        "SELECT * FROM community_documents WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (current.version !== input.version)
        throw new ConflictException(
          "Tài liệu đã thay đổi. Hãy tải lại trước khi khôi phục",
        );
      const [history] = await m.query(
        "SELECT snapshot FROM community_document_versions WHERE document_id=$1 AND version=$2",
        [id, input.sourceVersion],
      );
      if (!history)
        throw new NotFoundException("Không tìm thấy phiên bản khôi phục");
      const value = history.snapshot,
        category = input.categoryId || value.categoryId;
      if (
        !(await m.query("SELECT id FROM categories WHERE id=$1", [category]))
          .length
      )
        throw new ConflictException(
          "Chuyên mục cũ không còn tồn tại. Hãy chọn chuyên mục thay thế",
        );
      await m.query("SELECT set_config('eru.actor_id',$1,true)", [actor.id]);
      const [row] = await this.rows<{ version: number }>(
        m,
        `UPDATE community_documents SET title=$2,summary=$3,html=$4,category_id=$5,license=$6,attribution=$7,status='draft',version=version+1,review_reason=NULL,reviewed_by=NULL,reviewed_at=NULL,published_at=NULL,updated_at=now() WHERE id=$1 RETURNING version`,
        [
          id,
          value.title,
          value.summary,
          value.html,
          category,
          value.license,
          value.attribution,
        ],
      );
      await assertDocumentRetention(m, hint.author_id);
      await m.query(
        "INSERT INTO community_document_events(document_id,actor_id,action,reason,version) VALUES($1,$2,'restored',$3,$4)",
        [id, actor.id, input.reason, row.version],
      );
      await recordAdminAction(m, {
        actorId: actor.id,
        action: "DOCUMENT_REVISION_RESTORED",
        targetType: "community_document",
        targetId: id,
        reason: input.reason,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
        metadata: {
          sourceVersion: input.sourceVersion,
          previousVersion: current.version,
          version: row.version,
          status: "draft",
        },
      });
      return { id, version: row.version, status: "draft" };
    });
  }
  async submitReport(id: string, input: DocumentReportDto, user: UserIdentity) {
    return this.transaction(async (m) => {
      await m.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "eru-document-report:" + user.id,
      ]);
      const [doc] = await m.query(
        "SELECT id,title,version FROM community_documents WHERE id=$1 AND status='published' FOR SHARE",
        [id],
      );
      if (!doc)
        throw new NotFoundException("Tài liệu chưa xuất bản hoặc đã thu hồi");
      const [existing] = await m.query(
        'SELECT id,state,created_at AS "createdAt" FROM community_document_reports WHERE document_id=$1 AND reporter_id=$2 AND document_version=$3',
        [id, user.id, doc.version],
      );
      if (existing) return existing;
      const [{ count, retained }] = await m.query(
        "SELECT count(*) FILTER(WHERE state='open')::int count,count(*)::int retained FROM community_document_reports WHERE reporter_id=$1",
        [user.id],
      );
      if (count >= 20 || retained >= 1000)
        throw new ConflictException(
          "Bạn đã đạt giới hạn báo cáo đang chờ xử lý hoặc lưu giữ",
        );
      return (
        await m.query(
          'INSERT INTO community_document_reports(document_id,reporter_id,document_version,reported_title,reason_code,description) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,state,created_at AS "createdAt"',
          [
            id,
            user.id,
            doc.version,
            doc.title,
            input.reasonCode,
            input.description,
          ],
        )
      )[0];
    });
  }
  async reports(query: DocumentReportQueryDto) {
    const conditions: string[] = [],
      values: unknown[] = [];
    if (query.state !== "all") {
      values.push(query.state || "open");
      conditions.push(`r.state=$${values.length}`);
    }
    if (query.search) {
      values.push(`%${query.search}%`);
      conditions.push(
        `(r.reported_title ILIKE $${values.length} OR r.description ILIKE $${values.length} OR u.email ILIKE $${values.length})`,
      );
    }
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    return this.paginate(query, async (m, { size, offset }) => {
      const [{ total }] = await m.query(
        `SELECT count(*)::int total FROM community_document_reports r JOIN users u ON u.id=r.reporter_id ${where}`,
        values,
      );
      const data = await m.query(
        `SELECT r.id,r.document_id AS "documentId",r.reported_title AS title,r.reporter_id AS "reporterId",u.email AS "reporterEmail",r.document_version AS "documentVersion",r.reason_code AS "reasonCode",r.description,r.state,r.version,r.created_at AS "createdAt" FROM community_document_reports r JOIN users u ON u.id=r.reporter_id ${where} ORDER BY r.created_at DESC,r.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, size, offset],
      );
      return { data, total };
    });
  }
  async report(id: string) {
    return this.snapshot(async (m) => {
      const [report] = await m.query(
        'SELECT id,document_id AS "documentId",reporter_id AS "reporterId",document_version AS "documentVersion",reported_title AS title,reason_code AS "reasonCode",description,state,version,resolution_reason AS "resolutionReason" FROM community_document_reports WHERE id=$1',
        [id],
      );
      if (!report) throw new NotFoundException("Không tìm thấy báo cáo");
      const [document] = await m.query(
        "SELECT id,title,html,status,version FROM community_documents WHERE id=$1",
        [report.documentId],
      );
      const [reported] = await m.query(
        "SELECT snapshot FROM community_document_versions WHERE document_id=$1 AND version=$2",
        [report.documentId, report.documentVersion],
      );
      return { report, document, reportedSnapshot: reported?.snapshot ?? null };
    });
  }
  async decideReport(
    id: string,
    input: DocumentReportDecisionDto,
    actor: UserIdentity,
    meta: RequestMeta,
  ) {
    return this.transaction(async (m) => {
      await lockAdminActor(m, actor.id);
      const [hint] = await m.query(
        "SELECT d.id,d.author_id FROM community_document_reports r JOIN community_documents d ON d.id=r.document_id WHERE r.id=$1",
        [id],
      );
      if (!hint) throw new NotFoundException("Không tìm thấy báo cáo");
      await lockDocumentQuota(m, hint.author_id);
      const [doc] = await m.query(
        "SELECT id,status,version FROM community_documents WHERE id=$1 FOR UPDATE",
        [hint.id],
      );
      const [report] = await m.query(
        "SELECT id,state,version FROM community_document_reports WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (
        doc.version !== input.documentVersion ||
        report.version !== input.reportVersion ||
        report.state !== "open"
      )
        throw new ConflictException(
          "Tài liệu hoặc báo cáo đã thay đổi. Hãy tải lại để đối chiếu",
        );
      if (input.action === "archive") {
        if (!["published", "pending", "archived"].includes(doc.status))
          throw new ConflictException(
            "Tài liệu không còn ở trạng thái có thể thu hồi",
          );
        if (doc.status !== "archived") {
          await m.query("SELECT set_config('eru.actor_id',$1,true)", [
            actor.id,
          ]);
          await m.query(
            "UPDATE community_documents SET status='archived',version=version+1,review_reason=$2,reviewed_by=$3,reviewed_at=now(),updated_at=now() WHERE id=$1",
            [hint.id, input.reason, actor.id],
          );
          await m.query(
            "INSERT INTO community_document_events(document_id,actor_id,action,reason,version) VALUES($1,$2,'archive',$3,$4)",
            [hint.id, actor.id, input.reason, doc.version + 1],
          );
        }
      }
      await m.query(
        "UPDATE community_document_reports SET state=$2,resolution_reason=$3,version=version+1,updated_at=now() WHERE id=$1",
        [
          id,
          input.action === "archive" ? "resolved" : "dismissed",
          input.reason,
        ],
      );
      await recordAdminAction(m, {
        actorId: actor.id,
        action:
          input.action === "archive"
            ? "DOCUMENT_REPORT_ARCHIVED"
            : "DOCUMENT_REPORT_DISMISSED",
        targetType: "document_report",
        targetId: id,
        reason: input.reason,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
        metadata: {
          documentId: hint.id,
          reportVersion: report.version,
          documentVersion: doc.version,
        },
      });
      return {
        id,
        state: input.action === "archive" ? "resolved" : "dismissed",
      };
    });
  }
}
@AdminController("community-documents", "Admin - Document history")
export class DocumentHistoryController extends BaseController {
  constructor(private readonly service: DocumentAdministrationService) {
    super();
  }
  @Get(":id/revisions") history(
    @Param("id", UuidPipe) id: string,
    @Query() query: DocumentHistoryQueryDto,
  ) {
    return this.service.history(id, query);
  }
  @Get(":id/revision") snapshot(
    @Param("id", UuidPipe) id: string,
    @Query() query: DocumentSnapshotQueryDto,
  ) {
    return this.service.versionSnapshot(id, query.version);
  }
  @Post(":id/restore-revision") @HttpCode(200) @RateLimited("write") restore(
    @Param("id", UuidPipe) id: string,
    @Body() input: DocumentRestoreDto,
    @CurrentUser() actor: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    return this.service.restore(
      id,
      input,
      actor,
      this.actionContext(actor, req).meta,
    );
  }
}
@AdminController("document-reports", "Admin - Document reports")
export class DocumentReportsController extends BaseController {
  constructor(private readonly service: DocumentAdministrationService) {
    super();
  }
  @Get() list(@Query() query: DocumentReportQueryDto) {
    return this.service.reports(query);
  }
  @Get(":id") detail(@Param("id", UuidPipe) id: string) {
    return this.service.report(id);
  }
  @Post(":id/decision") @HttpCode(200) @RateLimited("write") decide(
    @Param("id", UuidPipe) id: string,
    @Body() input: DocumentReportDecisionDto,
    @CurrentUser() actor: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    return this.service.decideReport(
      id,
      input,
      actor,
      this.actionContext(actor, req).meta,
    );
  }
}
@Controller("community/documents")
export class DocumentPublicReportController {
  constructor(private readonly service: DocumentAdministrationService) {}
  @Post(":id/reports") @HttpCode(202) @RateLimited("report") report(
    @Param("id", UuidPipe) id: string,
    @Body() input: DocumentReportDto,
    @CurrentUser() user: UserIdentity,
  ) {
    return this.service.submitReport(id, input, user);
  }
}
