import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
  HttpException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { randomUUID } from "node:crypto";
import type { UserIdentity } from "../auth/auth-store";
import { RESOURCE_SETTINGS, ResourceSettings } from "./resource-settings";
import type {
  ResourceDocumentDto,
  ResourcePlanDto,
  ResourceRequestDto,
} from "./resource.dto";
import { relayResource } from "./resource-relay";
type Plan = "free" | "premium" | "blocked";
type DocumentRow = {
  id: string;
  owner_id: string;
  title: string;
  html: string;
  access: "private" | "shared" | "premium";
  created_at: Date;
  deleted_at: Date | null;
};
@Injectable()
export class ResourcesService implements OnModuleInit {
  private readonly memoryPlans = new Map<
    string,
    { plan: Plan; expiresAt?: string }
  >();
  private readonly memoryUsage = new Map<string, number>();
  private readonly memoryDocuments = new Map<string, DocumentRow>();
  private readonly memoryGrants = new Set<string>();
  private readonly memoryEvents: Record<string, unknown>[] = [];
  private inFlight = 0;
  constructor(
    @Inject(RESOURCE_SETTINGS) readonly settings: ResourceSettings,
    @Optional() private readonly db?: DataSource,
  ) {}
  async onModuleInit() {
    if (this.db) {
      const [row] = await this.db.query(
        "SELECT to_regclass('public.resource_account_plans') AS plans, to_regclass('public.resource_documents') AS documents, to_regclass('public.resource_daily_usage') AS usage, to_regclass('public.resource_access_events') AS events, to_regclass('public.resource_document_grants') AS grants",
      );
      if (
        !row.plans ||
        !row.documents ||
        !row.usage ||
        !row.events ||
        !row.grants
      )
        throw Error("RESOURCE_SCHEMA_NOT_READY: run project migrations");
    }
  }
  private enabled() {
    if (!this.settings.enabled)
      throw new ServiceUnavailableException("RESOURCE_GATEWAY_DISABLED");
  }
  async plan(user: UserIdentity): Promise<Plan> {
    const row = this.db
      ? (
          await this.db.query(
            'SELECT plan, expires_at AS "expiresAt" FROM resource_account_plans WHERE user_id=$1',
            [user.id],
          )
        )[0]
      : this.memoryPlans.get(user.id);
    if (row?.expiresAt && new Date(row.expiresAt).getTime() <= Date.now())
      return "free";
    return row?.plan || "free";
  }
  async audit(
    user: UserIdentity,
    action: string,
    outcome: string,
    documentId?: string,
    origin?: string,
  ) {
    if (this.db)
      await this.db.query(
        "INSERT INTO resource_access_events(user_id,document_id,action,outcome,target_origin) VALUES($1,$2,$3,$4,$5)",
        [user.id, documentId || null, action, outcome, origin || null],
      );
    else {
      this.memoryEvents.push({
        userId: user.id,
        userEmail: user.email,
        documentId: documentId || null,
        action,
        outcome,
        targetOrigin: origin || null,
        createdAt: new Date().toISOString(),
      });
      if (this.memoryEvents.length > 500) this.memoryEvents.shift();
    }
  }
  async me(user: UserIdentity) {
    this.enabled();
    const plan = await this.plan(user),
      limit =
        plan === "blocked"
          ? 0
          : plan === "premium" || user.role === "admin"
            ? this.settings.premiumDailyLimit
            : this.settings.freeDailyLimit;
    const key = user.id + ":" + new Date().toISOString().slice(0, 10);
    const used = this.db
      ? Number(
          (
            await this.db.query(
              "SELECT requests FROM resource_daily_usage WHERE user_id=$1 AND usage_day=(now() AT TIME ZONE 'UTC')::date",
              [user.id],
            )
          )[0]?.requests || 0,
        )
      : this.memoryUsage.get(key) || 0;
    return {
      user: { id: user.id, email: user.email },
      plan,
      enabled: limit > 0,
      dailyLimit: limit,
      used,
      remaining: Math.max(0, limit - used),
      targetOrigins: this.settings.targetOrigins,
    };
  }
  async updatePlan(
    userId: string,
    input: ResourcePlanDto,
    actor: UserIdentity,
  ) {
    if (actor.role !== "admin")
      throw new ForbiddenException("RESOURCE_ADMIN_REQUIRED");
    if (
      this.db &&
      !(
        await this.db.query(
          "SELECT 1 FROM users WHERE id=$1 AND deleted_at IS NULL",
          [userId],
        )
      ).length
    )
      throw new NotFoundException("RESOURCE_USER_NOT_FOUND");
    if (
      input.expiresAt &&
      (!Number.isFinite(Date.parse(input.expiresAt)) ||
        Date.parse(input.expiresAt) <= Date.now())
    )
      throw new BadRequestException("PLAN_EXPIRY_MUST_BE_IN_FUTURE");
    if (this.db)
      await this.db.query(
        "INSERT INTO resource_account_plans(user_id,plan,expires_at,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET plan=EXCLUDED.plan,expires_at=EXCLUDED.expires_at,updated_by=EXCLUDED.updated_by,updated_at=now()",
        [userId, input.plan, input.expiresAt || null, actor.id],
      );
    else
      this.memoryPlans.set(userId, {
        plan: input.plan,
        expiresAt: input.expiresAt,
      });
    await this.audit(actor, "plan.changed", input.plan);
    return { userId, plan: input.plan, expiresAt: input.expiresAt || null };
  }
  private async claim(user: UserIdentity) {
    const info = await this.me(user);
    if (!info.enabled) {
      await this.audit(user, "proxy.request", "plan_denied");
      throw new ForbiddenException("RESOURCE_PLAN_REQUIRED_OR_BLOCKED");
    }
    if (this.db) {
      const rows = await this.db.query(
        "INSERT INTO resource_daily_usage(user_id,usage_day,requests) VALUES($1,(now() AT TIME ZONE 'UTC')::date,1) ON CONFLICT(user_id,usage_day) DO UPDATE SET requests=resource_daily_usage.requests+1 WHERE resource_daily_usage.requests<$2 RETURNING requests",
        [user.id, info.dailyLimit],
      );
      if (!rows.length)
        throw new HttpException("RESOURCE_DAILY_QUOTA_EXCEEDED", 429);
    } else {
      const key = user.id + ":" + new Date().toISOString().slice(0, 10),
        used = this.memoryUsage.get(key) || 0;
      if (used >= info.dailyLimit)
        throw new HttpException("RESOURCE_DAILY_QUOTA_EXCEEDED", 429);
      this.memoryUsage.set(key, used + 1);
    }
    return info;
  }
  async request(
    user: UserIdentity,
    input: ResourceRequestDto,
    signal?: AbortSignal,
  ) {
    this.enabled();
    if (input.documentId) await this.allowedDocument(input.documentId, user);
    if (this.inFlight >= 8)
      throw new HttpException("RESOURCE_SERVICE_BUSY", 429);
    this.inFlight++;
    let origin: string | undefined;
    try {
      origin = new URL(input.url).origin;
    } catch {
      /* relay validates */
    }
    try {
      await this.claim(user);
      const result = await relayResource(input, this.settings, signal);
      await this.audit(
        user,
        "proxy.request",
        `http_${result.status}`,
        input.documentId,
        origin,
      );
      return result;
    } catch (error) {
      await this.audit(
        user,
        "proxy.request",
        "failed",
        input.documentId,
        origin,
      );
      throw error;
    } finally {
      this.inFlight--;
    }
  }
  private async document(id: string) {
    const row: DocumentRow | undefined = this.db
      ? (
          await this.db.query(
            "SELECT id,owner_id,title,html,access,created_at,deleted_at FROM resource_documents WHERE id=$1 AND deleted_at IS NULL",
            [id],
          )
        )[0]
      : this.memoryDocuments.get(id);
    if (!row || row.deleted_at)
      throw new NotFoundException("RESOURCE_DOCUMENT_NOT_FOUND");
    return row;
  }
  private metadata(row: DocumentRow) {
    return {
      id: row.id,
      ownerId: row.owner_id,
      title: row.title,
      access: row.access,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }
  async allowedDocument(id: string, user: UserIdentity) {
    this.enabled();
    const row = await this.document(id),
      plan = await this.plan(user);
    let allowed =
      plan !== "blocked" && (row.owner_id === user.id || user.role === "admin");
    if (!allowed && plan !== "blocked" && row.access === "premium")
      allowed = plan === "premium";
    if (!allowed && plan !== "blocked" && row.access === "shared")
      allowed = this.db
        ? !!(
            await this.db.query(
              "SELECT 1 FROM resource_document_grants WHERE document_id=$1 AND user_id=$2",
              [id, user.id],
            )
          ).length
        : this.memoryGrants.has(id + ":" + user.id);
    if (!allowed) {
      await this.audit(user, "document.open", "denied", id);
      throw new ForbiddenException("RESOURCE_DOCUMENT_ACCESS_DENIED");
    }
    return row;
  }
  private async owner(id: string, user: UserIdentity) {
    this.enabled();
    const row = await this.document(id);
    if (row.owner_id !== user.id && user.role !== "admin")
      throw new ForbiddenException("RESOURCE_DOCUMENT_OWNER_REQUIRED");
    return row;
  }
  async create(input: ResourceDocumentDto, user: UserIdentity) {
    this.enabled();
    if (Buffer.byteLength(input.html, "utf8") > 524288)
      throw new BadRequestException("RESOURCE_DOCUMENT_TOO_LARGE");
    if ((await this.plan(user)) === "blocked")
      throw new ForbiddenException("RESOURCE_ACCOUNT_BLOCKED");
    const limit =
      (await this.plan(user)) === "premium" || user.role === "admin" ? 100 : 10;
    const row: DocumentRow = this.db
      ? await this.db.transaction(async (manager) => {
          await manager.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
            user.id,
          ]);
          const [count] = await manager.query(
            "SELECT count(*)::int AS count FROM resource_documents WHERE owner_id=$1 AND deleted_at IS NULL",
            [user.id],
          );
          if (Number(count.count) >= limit)
            throw new HttpException("RESOURCE_DOCUMENT_QUOTA_EXCEEDED", 429);
          return (
            await manager.query(
              "INSERT INTO resource_documents(owner_id,title,html,access) VALUES($1,$2,$3,$4) RETURNING id,owner_id,title,html,access,created_at,deleted_at",
              [user.id, input.title, input.html, input.access],
            )
          )[0];
        })
      : {
          id: randomUUID(),
          owner_id: user.id,
          title: input.title,
          html: input.html,
          access: input.access,
          created_at: new Date(),
          deleted_at: null,
        };
    if (
      !this.db &&
      [...this.memoryDocuments.values()].filter(
        (document) => document.owner_id === user.id && !document.deleted_at,
      ).length >= limit
    )
      throw new HttpException("RESOURCE_DOCUMENT_QUOTA_EXCEEDED", 429);
    if (!this.db) this.memoryDocuments.set(row.id, row);
    await this.audit(user, "document.created", "allowed", row.id);
    return this.metadata(row);
  }
  async list(user: UserIdentity) {
    this.enabled();
    const rows: DocumentRow[] = this.db
      ? await this.db.query(
          "SELECT id,owner_id,title,access,created_at FROM resource_documents WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100",
          [user.id],
        )
      : [...this.memoryDocuments.values()].filter(
          (row) => row.owner_id === user.id && !row.deleted_at,
        );
    return rows.map((row) => this.metadata(row));
  }
  async read(id: string, user: UserIdentity) {
    const row = await this.allowedDocument(id, user);
    await this.claim(user);
    await this.audit(user, "document.open", "allowed", id);
    return { ...this.metadata(row), html: row.html };
  }
  async grant(id: string, userId: string, actor: UserIdentity) {
    const row = await this.owner(id, actor);
    if (row.access !== "shared")
      throw new BadRequestException("DOCUMENT_MUST_USE_SHARED_ACCESS");
    if (
      this.db &&
      !(
        await this.db.query(
          "SELECT 1 FROM users WHERE id=$1 AND deleted_at IS NULL",
          [userId],
        )
      ).length
    )
      throw new NotFoundException("RESOURCE_USER_NOT_FOUND");
    if (this.db)
      await this.db.query(
        "INSERT INTO resource_document_grants(document_id,user_id,granted_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [id, userId, actor.id],
      );
    else this.memoryGrants.add(id + ":" + userId);
    await this.audit(actor, "document.grant", "allowed", id);
    return { documentId: id, userId };
  }
  async grants(id: string, user: UserIdentity) {
    await this.owner(id, user);
    return this.db
      ? this.db.query(
          'SELECT g.user_id AS "userId",u.email AS "userEmail" FROM resource_document_grants g JOIN users u ON u.id=g.user_id WHERE g.document_id=$1 ORDER BY g.created_at,g.user_id',
          [id],
        )
      : [...this.memoryGrants]
          .filter((key) => key.startsWith(id + ":"))
          .map((key) => ({ userId: key.slice(id.length + 1) }));
  }
  async revoke(id: string, userId: string, actor: UserIdentity) {
    await this.owner(id, actor);
    if (this.db)
      await this.db.query(
        "DELETE FROM resource_document_grants WHERE document_id=$1 AND user_id=$2",
        [id, userId],
      );
    else this.memoryGrants.delete(id + ":" + userId);
    await this.audit(actor, "document.revoke", "allowed", id);
  }
  async remove(id: string, user: UserIdentity) {
    await this.owner(id, user);
    if (this.db)
      await this.db.query(
        "UPDATE resource_documents SET deleted_at=now() WHERE id=$1",
        [id],
      );
    else this.memoryDocuments.get(id)!.deleted_at = new Date();
    await this.audit(user, "document.deleted", "allowed", id);
  }
  async events(id: string, user: UserIdentity) {
    await this.owner(id, user);
    return this.db
      ? this.db.query(
          'SELECT e.user_id AS "userId",u.email AS "userEmail",e.action,e.outcome,e.created_at AS "createdAt" FROM resource_access_events e JOIN users u ON u.id=e.user_id WHERE e.document_id=$1 ORDER BY e.id DESC LIMIT 50',
          [id],
        )
      : this.memoryEvents
          .filter((event) => event.documentId === id)
          .slice(-50)
          .reverse();
  }
}
