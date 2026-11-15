import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { BaseService } from "../common/services/base.service";
import {
  TEMPLATE_STORE,
  type TemplateStore,
} from "../templates/template-store";
import { PostgresTemplateStore } from "../templates/persistence/postgres-template.store";
import { TemplateCache } from "../cache/template-cache";
import { templateEtag } from "../templates/template-revisions";
import {
  AUTH_STORE,
  type AuthStore,
  type UserIdentity,
} from "../auth/auth-store";
import { Passwords } from "../auth/passwords";
import { lockAdminActor } from "./admin-authorization";
import { recordAdminAction } from "./admin-audit-record";
import type { RequestMeta } from "../common/request-context";
import {
  AdminTemplateMetadataDto,
  AdminTemplatePurgeDto,
  AdminRestoreRevisionDto,
  AdminVersionReasonDto,
} from "./dto/lifecycle.dto";

@Injectable()
export class AdminTemplateLifecycleService extends BaseService {
  constructor(
    db: DataSource,
    @Inject(TEMPLATE_STORE) private readonly store: TemplateStore,
    private readonly cache: TemplateCache,
    @Inject(AUTH_STORE) private readonly accounts: AuthStore,
    private readonly passwords: Passwords,
  ) {
    super(db);
  }
  async revision(id: string, revision: number) {
    const [row] = await this.dataSource.query(
      'SELECT template_id AS "templateId",revision,operation,created_at AS "createdAt",snapshot FROM template_revisions WHERE template_id=$1 AND revision=$2',
      [id, revision],
    );
    if (!row) throw new NotFoundException("Không tìm thấy phiên bản mẫu");
    return row;
  }
  async change(
    id: string,
    action:
      | "metadata"
      | "release"
      | "trash"
      | "restore"
      | "restore_revision"
      | "purge",
    input: AdminVersionReasonDto &
      Partial<
        AdminTemplateMetadataDto &
          AdminTemplatePurgeDto &
          AdminRestoreRevisionDto
      >,
    actor: UserIdentity,
    meta: RequestMeta,
  ) {
    let passwordHash: string | undefined;
    if (action === "purge") {
      const account = await this.accounts.findCredentialsById(actor.id);
      if (
        !account ||
        !input.password ||
        !(await this.passwords.verify(input.password, account.passwordHash))
      )
        throw new ForbiddenException("Mật khẩu xác nhận chưa đúng");
      passwordHash = account.passwordHash;
    }
    const stamp = await this.cache.stamp(id);
    const result = await this.transaction(async (manager) => {
      await lockAdminActor(manager, actor.id);
      const [hint] = await manager.query(
        "SELECT author_id FROM templates WHERE id=$1",
        [id],
      );
      if (!hint) throw new NotFoundException("Không tìm thấy mẫu");
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        ["eru-template-quota:" + hint.author_id],
      );
      const [row] = await manager.query(
        "SELECT id,author_id,category_id,title,slug,description,revision,deleted_at,moderation_state,is_public FROM templates WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (row.revision !== input.revision)
        throw new ConflictException(
          "Mẫu đã thay đổi. Hãy tải lại để đối chiếu; nội dung đang nhập được giữ lại.",
        );
      if (
        action === "restore"
          ? !row.deleted_at
          : action !== "purge" && !!row.deleted_at
      )
        throw new ConflictException(
          "Trạng thái thùng rác đã thay đổi. Hãy tải lại mẫu.",
        );
      const changes: Record<string, unknown> = {};
      let operation: "update" | "delete" | "restore" = "update";
      if (action === "metadata")
        Object.assign(changes, {
          title: input.title,
          description: input.description,
          categoryId: input.categoryId,
        });
      if (action === "release") {
        if (row.moderation_state !== "hidden")
          throw new ConflictException("Mẫu không còn bị hạn chế");
        Object.assign(changes, {
          moderationState: "visible",
          moderationReason: input.reason,
          isPublic: false,
        });
      }
      if (action === "trash")
        (Object.assign(changes, { deletedAt: new Date(), isPublic: false }),
          (operation = "delete"));
      if (action === "restore")
        (Object.assign(changes, { deletedAt: null, isPublic: false }),
          (operation = "restore"));
      if (action === "restore_revision") {
        const [history] = await manager.query(
          "SELECT snapshot FROM template_revisions WHERE template_id=$1 AND revision=$2",
          [id, input.sourceRevision],
        );
        if (!history)
          throw new NotFoundException("Không tìm thấy phiên bản cần khôi phục");
        for (const key of [
          "title",
          "slug",
          "description",
          "categoryId",
          "contentJson",
          "thumbnailUrl",
          "version",
          "tags",
        ])
          changes[key] = history.snapshot[key];
        if (input.categoryId) changes.categoryId = input.categoryId;
        changes.isPublic = false;
        operation = "restore";
      }
      await manager.query(
        "SELECT set_config('eru.actor_id',$1,true),set_config('eru.template_operation',$2,true)",
        [actor.id, operation],
      );
      let updated: unknown;
      if (action === "purge") {
        const [account] = await manager.query(
          "SELECT id FROM users WHERE id=$1 AND password_hash=$2",
          [actor.id, passwordHash],
        );
        if (!account)
          throw new ForbiddenException("Thông tin xác thực đã thay đổi");
        if (!row.deleted_at || input.confirmSlug !== row.slug)
          throw new BadRequestException(
            "Chỉ xóa vĩnh viễn mẫu trong thùng rác khi nhập đúng đường dẫn xác nhận",
          );
        const [{ pending }] = await manager.query(
          "SELECT EXISTS(SELECT 1 FROM template_reports WHERE template_id=$1 AND state='open') AS pending",
          [id],
        );
        if (pending)
          throw new ConflictException(
            "Mẫu đang có báo cáo chờ xử lý; hãy xử lý báo cáo trước khi xóa vĩnh viễn",
          );
        await manager.query("DELETE FROM templates WHERE id=$1", [id]);
        updated = { id, purged: true };
      } else {
        if (!(this.store instanceof PostgresTemplateStore))
          throw new Error("PostgreSQL template store required");
        updated = await this.store.adminWrite(
          manager,
          id,
          changes,
          templateEtag(row),
          actor,
          operation,
        );
      }
      await recordAdminAction(manager, {
        actorId: actor.id,
        action: {
          metadata: "TEMPLATE_METADATA_UPDATED",
          release: "TEMPLATE_RESTRICTION_RELEASED",
          trash: "TEMPLATE_TRASHED",
          restore: "TEMPLATE_RESTORED",
          restore_revision: "TEMPLATE_REVISION_RESTORED",
          purge: "TEMPLATE_PURGED",
        }[action],
        targetType: "template",
        targetId: id,
        reason: input.reason,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
        metadata: {
          previous: {
            title: row.title,
            categoryId: row.category_id,
            revision: row.revision,
            deletedAt: row.deleted_at,
            moderationState: row.moderation_state,
          },
          ...(action === "metadata"
            ? {
                current: {
                  title: input.title,
                  description: input.description,
                  categoryId: input.categoryId,
                },
              }
            : {}),
          ...(input.sourceRevision
            ? { sourceRevision: input.sourceRevision }
            : {}),
        },
      });
      return updated;
    });
    await this.cache.invalidate(id, stamp);
    return result;
  }
}
