import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
  PreconditionFailedException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { randomUUID } from "node:crypto";
import { TEMPLATE_STORE, TemplateStore } from "../templates/template-store";
import { MemoryTemplateStore } from "../templates/persistence/memory-template.store";
import { templateEtag } from "../templates/template-revisions";
import type { UserIdentity } from "../auth/auth-store";
import {
  AuditRecord,
  DecideReportDto,
  ReportQueryDto,
  ReportRecord,
  SubmitReportDto,
} from "./contracts";
const projection = `id, template_id AS "templateId", reporter_id AS "reporterId", template_revision AS "templateRevision",
 reported_title AS "reportedTitle", reason_code AS "reasonCode", description, state, version,
 resolution_reason AS "resolutionReason", created_at AS "createdAt", updated_at AS "updatedAt"`;
const absent = () =>
  new NotFoundException("Report or public template not found");
const stale = () =>
  new PreconditionFailedException(
    "Report or template changed; reload before deciding",
  );
@Injectable()
export class ReportStore implements OnModuleInit {
  private readonly reports = new Map<string, ReportRecord>();
  private readonly audit: AuditRecord[] = [];
  constructor(
    @Inject(TEMPLATE_STORE) private readonly templates: TemplateStore,
    @Optional() private readonly db?: DataSource,
  ) {}
  async onModuleInit() {
    if (this.db) {
      try {
        await this.db.query(
          "SELECT moderation_state,moderation_reason FROM templates LIMIT 0",
        );
        await this.db.query("SELECT version FROM template_reports LIMIT 0");
        await this.db.query("SELECT action FROM moderation_audit LIMIT 0");
      } catch {
        throw Error(
          "MODERATION_SCHEMA_NOT_READY: run project migrations before starting",
        );
      }
    }
  }
  async submit(
    id: string,
    input: SubmitReportDto,
    user: UserIdentity,
  ): Promise<ReportRecord> {
    if (!this.db) {
      const row = (this.templates as MemoryTemplateStore).moderationRecord(id);
      if (
        !row ||
        row.deletedAt ||
        !row.isPublic ||
        row.moderationState !== "visible"
      )
        throw absent();
      const existing = [...this.reports.values()].find(
        (r) =>
          r.templateId === id &&
          r.reporterId === user.id &&
          r.templateRevision === row.revision,
      );
      if (existing) return structuredClone(existing);
      const now = new Date(),
        report: ReportRecord = {
          id: randomUUID(),
          templateId: id,
          reporterId: user.id,
          templateRevision: row.revision,
          reportedTitle: row.title,
          ...input,
          state: "open",
          version: 1,
          resolutionReason: null,
          createdAt: now,
          updatedAt: now,
        };
      this.reports.set(report.id, report);
      return structuredClone(report);
    }
    return this.db.transaction(async (manager) => {
      const [hint] = await manager.query(
        "SELECT author_id FROM templates WHERE id=$1",
        [id],
      );
      if (!hint) throw absent();
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        ["eru-template-quota:" + hint.author_id],
      );
      const [row] = await manager.query(
        "SELECT title,revision FROM templates WHERE id=$1 AND deleted_at IS NULL AND is_public=true AND moderation_state='visible'",
        [id],
      );
      if (!row) throw absent();
      const [report] = await manager.query(
        `INSERT INTO template_reports(template_id,reporter_id,template_revision,reported_title,reason_code,description)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (template_id,reporter_id,template_revision) DO NOTHING RETURNING ${projection}`,
        [
          id,
          user.id,
          row.revision,
          row.title,
          input.reasonCode,
          input.description,
        ],
      );
      if (report) return report;
      return (
        await manager.query(
          `SELECT ${projection} FROM template_reports WHERE template_id=$1 AND reporter_id=$2 AND template_revision=$3`,
          [id, user.id, row.revision],
        )
      )[0];
    });
  }
  async list(query: ReportQueryDto, reporter?: string) {
    if (!this.db) {
      const rows = [...this.reports.values()]
        .filter(
          (r) =>
            (!reporter || r.reporterId === reporter) &&
            (query.state === "all" || query.state === r.state),
        )
        .sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            b.id.localeCompare(a.id),
        );
      return this.page(
        structuredClone(
          rows.slice((query.page - 1) * query.size, query.page * query.size),
        ),
        rows.length,
        query,
      );
    }
    const args: unknown[] = [],
      conditions: string[] = [];
    if (reporter) {
      args.push(reporter);
      conditions.push(`reporter_id=$${args.length}`);
    }
    if (query.state !== "all") {
      args.push(query.state);
      conditions.push(`state=$${args.length}`);
    }
    const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
    const [count] = await this.db.query(
      "SELECT count(*)::int n FROM template_reports" + where,
      args,
    );
    args.push(query.size, (query.page - 1) * query.size);
    const rows = await this.db.query(
      `SELECT ${projection} FROM template_reports${where} ORDER BY created_at DESC,id DESC LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    );
    return this.page(rows, count.n, query);
  }
  private page(data: ReportRecord[], count: number, query: ReportQueryDto) {
    return {
      data,
      page: query.page,
      size: query.size,
      totalElements: count,
      totalPages: Math.ceil(count / query.size),
    };
  }
  async templateIdForReport(id: string): Promise<string> {
    const templateId = this.db
      ? (
          await this.db.query(
            "SELECT template_id AS id FROM template_reports WHERE id=$1",
            [id],
          )
        )[0]?.id
      : this.reports.get(id)?.templateId;
    if (!templateId) throw absent();
    return templateId;
  }
  async detail(id: string) {
    const report: ReportRecord | undefined = this.db
      ? (
          await this.db.query(
            `SELECT ${projection} FROM template_reports WHERE id=$1`,
            [id],
          )
        )[0]
      : structuredClone(this.reports.get(id));
    if (!report) throw absent();
    const resource = await this.templates.find(report.templateId, true);
    const audit: AuditRecord[] = this.db
      ? await this.db.query(
          `SELECT id,report_id AS "reportId",template_id AS "templateId",actor_id AS "actorId",action,reason,created_at AS "createdAt" FROM (SELECT * FROM moderation_audit WHERE report_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100) recent ORDER BY created_at,id`,
          [id],
        )
      : structuredClone(
          this.audit.filter((a) => a.reportId === id).slice(-100),
        );
    return {
      report,
      resource,
      etag: resource ? templateEtag(resource) : null,
      audit,
    };
  }
  private assertDecision(
    report: ReportRecord,
    resource: { moderationState: string; deletedAt: Date | null } | null,
    input: DecideReportDto,
  ) {
    if (report.version !== input.reportVersion) throw stale();
    if (input.action === "release") {
      if (
        !resource ||
        resource.deletedAt ||
        resource.moderationState !== "hidden"
      )
        throw new ConflictException(
          "Template is not an active restricted resource",
        );
    } else if (report.state !== "open")
      throw new ConflictException("Report has already been decided");
    if (input.action === "hide" && (!resource || resource.deletedAt))
      throw new ConflictException("Deleted resources cannot be hidden");
  }
  async decide(
    id: string,
    input: DecideReportDto,
    tag: string,
    actor: UserIdentity,
  ): Promise<ReportRecord> {
    if (!this.db) {
      const current = this.reports.get(id);
      if (!current) throw absent();
      const store = this.templates as MemoryTemplateStore,
        resource = store.moderationRecord(current.templateId);
      this.assertDecision(current, resource, input);
      if (!resource || templateEtag(resource) !== tag) throw stale();
      if (input.action !== "dismiss")
        store.applyModeration(
          resource.id,
          input.action === "hide" ? "hidden" : "visible",
          input.reason,
          tag,
          actor,
        );
      const report = {
        ...current,
        version: current.version + 1,
        state:
          input.action === "hide"
            ? ("resolved" as const)
            : input.action === "dismiss"
              ? ("dismissed" as const)
              : current.state,
        resolutionReason: input.reason,
        updatedAt: new Date(),
      };
      this.reports.set(id, report);
      this.audit.push({
        id: randomUUID(),
        reportId: id,
        templateId: current.templateId,
        actorId: actor.id,
        action: input.action,
        reason: input.reason,
        createdAt: new Date(),
      });
      return structuredClone(report);
    }
    return this.db.transaction(async (manager) => {
      const [hint] = await manager.query(
        "SELECT r.template_id,t.author_id FROM template_reports r JOIN templates t ON t.id=r.template_id WHERE r.id=$1",
        [id],
      );
      if (!hint) throw absent();
      // Lock order is shared with owner writes; do not lock a report before the owner.
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        ["eru-template-quota:" + hint.author_id],
      );
      const [report]: ReportRecord[] = await manager.query(
        `SELECT ${projection} FROM template_reports WHERE id=$1 FOR UPDATE`,
        [id],
      );
      if (!report) throw absent();
      const [resource] = await manager.query(
        'SELECT id,revision,moderation_state AS "moderationState",deleted_at AS "deletedAt" FROM templates WHERE id=$1 FOR UPDATE',
        [report.templateId],
      );
      this.assertDecision(report, resource, input);
      if (!resource || tag !== templateEtag(resource)) throw stale();
      if (input.action !== "dismiss") {
        await manager.query(
          "SELECT set_config('eru.actor_id',$1,true),set_config('eru.template_operation','update',true)",
          [actor.id],
        );
        await manager.query(
          "UPDATE templates SET moderation_state=$2,moderation_reason=$3,is_public=false,updated_at=now() WHERE id=$1",
          [
            report.templateId,
            input.action === "hide" ? "hidden" : "visible",
            input.reason,
          ],
        );
      }
      const [result] = await manager.query(
        `WITH changed AS (UPDATE template_reports SET state=$2,resolution_reason=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING *) SELECT ${projection} FROM changed`,
        [
          id,
          input.action === "hide"
            ? "resolved"
            : input.action === "dismiss"
              ? "dismissed"
              : report.state,
          input.reason,
        ],
      );
      await manager.query(
        "INSERT INTO moderation_audit(report_id,template_id,actor_id,action,reason) VALUES($1,$2,$3,$4,$5)",
        [id, report.templateId, actor.id, input.action, input.reason],
      );
      return result;
    });
  }
}
