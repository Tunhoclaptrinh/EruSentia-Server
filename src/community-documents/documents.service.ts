import { lockDocumentQuota, assertDocumentRetention } from "./document-history";
import { lockAdminActor } from "../admin/admin-authorization";
import { BaseService } from "../common/services/base.service";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { AdminAuditService } from "../admin/admin-audit.service";
import type { AdminRequestMeta } from "../admin/request-meta";
import type { UserIdentity } from "../auth/auth-store";
import { assertPublicTemplate } from "../templates/template-publication";
import {
  DocumentDecisionDto,
  DocumentDraftDto,
  DocumentQueryDto,
  DocumentState,
  DocumentUpdateDto,
} from "./contracts";

export interface DocumentRow {
  id: string;
  authorId: string;
  categoryId: string;
  title: string;
  summary: string;
  html: string;
  license: string;
  attribution: string;
  status: DocumentState;
  version: number;
  reviewReason: string | null;
  reviewedAt: Date | null;
  publishedAt: Date | null;
}
const fields = `d.id,d.author_id AS "authorId",d.category_id AS "categoryId",d.title,d.summary,d.license,d.attribution,d.status,d.version,
  d.submitted_at AS "submittedAt",d.reviewed_at AS "reviewedAt",d.review_reason AS "reviewReason",d.published_at AS "publishedAt",
  d.created_at AS "createdAt",d.updated_at AS "updatedAt",octet_length(d.html)::int AS "contentBytes"`;

@Injectable()
export class CommunityDocumentsService extends BaseService {
  constructor(
    dataSource: DataSource,
    private readonly audit: AdminAuditService,
  ) {
    super(dataSource);
  }

  async list(
    query: DocumentQueryDto,
    scope: "catalog" | "own" | "admin",
    user: UserIdentity,
  ) {
    const clauses: string[] = [],
      params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      clauses.push(sql.replace("?", "$" + params.length));
    };
    if (scope === "catalog") clauses.push("d.status='published'");
    if (scope === "own") add("d.author_id=?", user.id);
    if (scope !== "catalog" && query.status && query.status !== "all")
      add("d.status=?", query.status);
    if (query.categoryId) add("d.category_id=?", query.categoryId);
    if (query.search) {
      params.push("%" + query.search + "%");
      clauses.push(
        `(d.title ILIKE $${params.length} OR d.summary ILIKE $${params.length})`,
      );
    }
    // Both search expressions intentionally use the same bound parameter.
    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
    return this.paginate(query, async (manager, { size, offset }) => {
      const [{ total }] = await manager.query(
        `SELECT count(*)::int total FROM community_documents d ${where}`,
        params,
      );
      const [{ pending }] =
        scope === "catalog"
          ? [{ pending: 0 }]
          : await manager.query(
              `SELECT count(*)::int pending FROM community_documents d ${scope === "own" ? "WHERE d.author_id=$1 AND d.status='pending'" : "WHERE d.status='pending'"}`,
              scope === "own" ? [user.id] : [],
            );
      const rows = await manager.query(
        `SELECT ${fields},c.name AS "categoryName",COALESCE(p.display_name,'Tác giả EruSentia') AS "authorName"
        ${scope === "admin" ? ',u.email AS "authorEmail"' : ""}
        FROM community_documents d JOIN categories c ON c.id=d.category_id JOIN users u ON u.id=d.author_id
        LEFT JOIN profiles p ON p.user_id=d.author_id ${where}
        ORDER BY ${scope === "catalog" ? "d.published_at" : "d.updated_at"} DESC,d.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, size, offset],
      );
      return {
        data:
          scope === "catalog"
            ? rows.map(
                ({
                  reviewReason,
                  reviewedAt,
                  submittedAt,
                  ...safe
                }: Record<string, unknown>) => safe,
              )
            : rows,
        total,
        extra: scope !== "catalog" ? { pendingCount: pending } : {},
      };
    });
  }

  private async row(
    manager: EntityManager,
    id: string,
    lock = false,
  ): Promise<DocumentRow> {
    if (lock) {
      const [hint] = await manager.query(
        "SELECT author_id FROM community_documents WHERE id=$1",
        [id],
      );
      if (!hint) throw new NotFoundException("Không tìm thấy tài liệu");
      await lockDocumentQuota(manager, hint.author_id);
    }
    const [row] = await manager.query(
      `SELECT ${fields},d.html FROM community_documents d WHERE d.id=$1 ${lock ? "FOR UPDATE" : ""}`,
      [id],
    );
    if (!row) throw new NotFoundException("Không tìm thấy tài liệu");
    return row;
  }
  private owner(row: DocumentRow, user: UserIdentity) {
    if (row.authorId !== user.id)
      throw new NotFoundException("Không tìm thấy tài liệu của bạn");
  }
  private version(row: DocumentRow, expected: number) {
    if (row.version !== expected)
      throw new ConflictException(
        "Tài liệu đã thay đổi. Hãy tải lại để đối chiếu; nội dung đang nhập được giữ lại.",
      );
  }
  private async event(
    manager: EntityManager,
    row: DocumentRow,
    action: string,
    actorId: string,
    reason?: string,
  ) {
    await manager.query(
      "UPDATE community_document_versions SET actor_id=$3 WHERE document_id=$1 AND version=$2",
      [row.id, row.version, actorId],
    );
    if (!["withdrawn", "archive"].includes(action))
      await assertDocumentRetention(manager, row.authorId);
    await manager.query(
      "INSERT INTO community_document_events(document_id,actor_id,action,reason,version) VALUES($1,$2,$3,$4,$5)",
      [row.id, actorId, action, reason || null, row.version],
    );
  }
  private async category(manager: EntityManager, id: string) {
    if (
      !(await manager.query("SELECT id FROM categories WHERE id=$1", [id]))
        .length
    )
      throw new BadRequestException("Chuyên mục không còn tồn tại");
  }
  private content(input: DocumentDraftDto) {
    if (!input.html.trim() || Buffer.byteLength(input.html, "utf8") > 524288)
      throw new BadRequestException(
        "Nội dung HTML phải có dữ liệu và tối đa 512 KiB",
      );
  }
  async detail(
    id: string,
    scope: "catalog" | "own" | "admin",
    user: UserIdentity,
  ) {
    return this.snapshot(async (manager) => {
      const document = await this.row(manager, id);
      if (scope === "own") this.owner(document, user);
      if (scope === "catalog" && document.status !== "published")
        throw new NotFoundException(
          "Tài liệu chưa được xuất bản hoặc đã được thu hồi",
        );
      const history =
        scope === "catalog"
          ? []
          : await manager.query(
              `SELECT id,action,reason,version,created_at AS "createdAt" FROM community_document_events WHERE document_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`,
              [id],
            );
      if (scope === "catalog") {
        const { reviewReason, reviewedAt, ...safe } = document;
        return { document: safe, history: [] };
      }
      return { document, history };
    });
  }
  async create(input: DocumentDraftDto, user: UserIdentity) {
    this.content(input);
    return this.transaction(async (manager) => {
      await manager.query(
        "SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE",
        [user.id],
      );
      await lockDocumentQuota(manager, user.id);
      const [{ count }] = await manager.query(
        "SELECT count(*)::int count FROM community_documents WHERE author_id=$1",
        [user.id],
      );
      if (count >= 50)
        throw new HttpException(
          "Bạn đã đạt giới hạn 50 tài liệu cộng đồng. Hãy sử dụng các bản nháp hiện có.",
          429,
        );
      await this.category(manager, input.categoryId);
      const [{ id }] = await manager.query(
        `INSERT INTO community_documents(author_id,category_id,title,summary,html,license,attribution) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          user.id,
          input.categoryId,
          input.title,
          input.summary,
          input.html,
          input.license,
          input.attribution,
        ],
      );
      const row = await this.row(manager, id);
      await this.event(manager, row, "created", user.id);
      return row;
    });
  }
  async update(id: string, input: DocumentUpdateDto, user: UserIdentity) {
    this.content(input);
    return this.transaction(async (manager) => {
      const row = await this.row(manager, id, true);
      this.owner(row, user);
      this.version(row, input.version);
      if (["pending", "published"].includes(row.status))
        throw new ConflictException(
          "Hãy rút yêu cầu hoặc thu hồi bản xuất bản trước khi chỉnh sửa.",
        );
      await this.category(manager, input.categoryId);
      await manager.query(
        `UPDATE community_documents SET title=$2,summary=$3,category_id=$4,html=$5,license=$6,attribution=$7,status='draft',version=version+1,updated_at=now() WHERE id=$1`,
        [
          id,
          input.title,
          input.summary,
          input.categoryId,
          input.html,
          input.license,
          input.attribution,
        ],
      );
      const updated = await this.row(manager, id);
      await this.event(manager, updated, "edited", user.id);
      return updated;
    });
  }
  async submit(id: string, version: number, user: UserIdentity) {
    return this.transaction(async (manager) => {
      const row = await this.row(manager, id, true);
      this.owner(row, user);
      this.version(row, version);
      if (!["draft", "changes_requested", "archived"].includes(row.status))
        throw new ConflictException(
          "Tài liệu không ở trạng thái có thể gửi duyệt.",
        );
      assertPublicTemplate({
        html: row.html,
        sharing: {
          license: row.license,
          attribution: row.attribution,
          permissionConfirmed: true,
        },
      });
      await manager.query(
        "UPDATE community_documents SET status='pending',submitted_at=now(),version=version+1,updated_at=now() WHERE id=$1",
        [id],
      );
      const updated = await this.row(manager, id);
      await this.event(manager, updated, "submitted", user.id);
      return updated;
    });
  }
  async withdraw(id: string, version: number, user: UserIdentity) {
    return this.transaction(async (manager) => {
      const row = await this.row(manager, id, true);
      this.owner(row, user);
      this.version(row, version);
      if (!["pending", "published"].includes(row.status))
        throw new ConflictException(
          "Chỉ rút yêu cầu đang chờ hoặc thu hồi tài liệu đang xuất bản.",
        );
      await manager.query(
        "UPDATE community_documents SET status=$2,version=version+1,updated_at=now() WHERE id=$1",
        [id, row.status === "pending" ? "draft" : "archived"],
      );
      const updated = await this.row(manager, id);
      await this.event(manager, updated, "withdrawn", user.id);
      return updated;
    });
  }
  async decide(
    id: string,
    input: DocumentDecisionDto,
    actor: UserIdentity,
    meta: AdminRequestMeta,
  ) {
    return this.transaction(async (manager) => {
      await lockAdminActor(manager, actor.id);
      const row = await this.row(manager, id, true);
      this.version(row, input.version);
      if (row.authorId === actor.id && input.action === "approve")
        throw new ForbiddenException(
          "Không thể tự phê duyệt tài liệu của chính mình.",
        );
      if (
        input.action === "archive"
          ? !["published", "pending"].includes(row.status)
          : row.status !== "pending"
      )
        throw new ConflictException(
          "Trạng thái tài liệu đã thay đổi; hãy tải lại trước khi quyết định.",
        );
      if (input.action === "approve")
        assertPublicTemplate({
          html: row.html,
          sharing: {
            license: row.license,
            attribution: row.attribution,
            permissionConfirmed: true,
          },
        });
      const next =
        input.action === "approve"
          ? "published"
          : input.action === "request_changes"
            ? "changes_requested"
            : "archived";
      await manager.query(
        "UPDATE community_documents SET status=$2::varchar,review_reason=$3,reviewed_by=$4,reviewed_at=now(),published_at=CASE WHEN $2::varchar='published' THEN now() ELSE published_at END,version=version+1,updated_at=now() WHERE id=$1",
        [id, next, input.reason, actor.id],
      );
      const updated = await this.row(manager, id);
      await this.event(manager, updated, input.action, actor.id, input.reason);
      await this.audit.record(
        {
          actorId: actor.id,
          action:
            input.action === "approve"
              ? "DOCUMENT_APPROVED"
              : input.action === "request_changes"
                ? "DOCUMENT_CHANGES_REQUESTED"
                : "DOCUMENT_ARCHIVED",
          targetType: "community_document",
          targetId: id,
          reason: input.reason,
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
          metadata: {
            title: row.title,
            previousStatus: row.status,
            status: next,
            version: updated.version,
          },
        },
        manager,
      );
      return updated;
    });
  }
}
