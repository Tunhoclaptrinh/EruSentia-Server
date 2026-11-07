import {
  BadRequestException,
  ConflictException,
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  PreconditionFailedException,
} from "@nestjs/common";
import {
  templateEtag,
  templateSnapshot,
  type TemplateRevision,
  type RevisionOperation,
  type RevisionsQueryDto,
} from "../template-revisions";
import { MEMORY_CATEGORIES } from "../../categories/categories";
import { randomUUID } from "node:crypto";
import {
  SERVICE_CONTROL_SETTINGS,
  ServiceControlSettings,
} from "../../service-controls/settings";
import { PolicyError } from "../../service-controls/policy-error";
import {
  assertTemplateQuota,
  assertRetainedQuota,
  contentBytes,
} from "../template-quota";
import { QueryTemplatesDto, UpdateTemplateDto } from "../dto/template.dto";
import {
  CreateTemplateInput,
  pageOf,
  TemplateRecord,
  TemplateStore,
} from "../template-store";
import {
  active,
  AUTH_STORE,
  AuthStore,
  UserIdentity,
} from "../../auth/auth-store";

@Injectable()
export class MemoryTemplateStore implements TemplateStore {
  private readonly rows = new Map<string, TemplateRecord>();
  private readonly history = new Map<string, TemplateRevision[]>();
  constructor(
    @Inject(AUTH_STORE) private readonly auth: AuthStore,
    @Inject(SERVICE_CONTROL_SETTINGS)
    private readonly limits: ServiceControlSettings,
  ) {}
  private readonly categories = new Map(
    MEMORY_CATEGORIES.map(({ id, name, slug }) => [id, { id, name, slug }]),
  );

  async list(query: QueryTemplatesDto, viewer: UserIdentity) {
    const rows = [...this.rows.values()].filter(
      (t) =>
        (query.deleted === true ? !!t.deletedAt : !t.deletedAt) &&
        (viewer.role === "admin" || t.isPublic || t.authorId === viewer.id) &&
        (!query.authorId || t.authorId === query.authorId) &&
        (!query.categoryId || t.categoryId === query.categoryId) &&
        (query.isPublic === undefined || t.isPublic === query.isPublic) &&
        (query.contentFormat === undefined ||
          t.contentJson?.format === query.contentFormat) &&
        (query.schemaVersion === undefined ||
          t.contentJson?.schemaVersion === query.schemaVersion) &&
        (!query.tag || t.tags.includes(query.tag)) &&
        (!query.search ||
          t.title.toLowerCase().includes(query.search.toLowerCase()) ||
          t.description.toLowerCase().includes(query.search.toLowerCase())),
    );
    const sign = query.order === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const left = query.sort === "title" ? a.title : a.createdAt.getTime();
      const right = query.sort === "title" ? b.title : b.createdAt.getTime();
      return (
        sign *
        (left < right
          ? -1
          : left > right
            ? 1
            : a.id < b.id
              ? -1
              : a.id > b.id
                ? 1
                : 0)
      );
    });
    const start = (query.page - 1) * query.size;
    return pageOf(
      structuredClone(rows.slice(start, start + query.size)),
      rows.length,
      query,
    );
  }

  moderationRecord(id: string) {
    return structuredClone(this.rows.get(id) ?? null);
  }
  applyModeration(
    id: string,
    state: "visible" | "hidden",
    reason: string,
    tag: string,
    actor: UserIdentity,
  ) {
    const current = this.rows.get(id);
    if (!current || current.deletedAt)
      throw new NotFoundException("Template not found");
    if (tag !== templateEtag(current))
      throw new PreconditionFailedException(
        "Template changed; reload before deciding",
      );
    const row = {
      ...current,
      isPublic: false,
      moderationState: state,
      moderationReason: reason,
      revision: current.revision + 1,
      updatedAt: new Date(),
    };
    this.rows.set(id, row);
    this.record(row, "update", actor.id);
    return structuredClone(row);
  }
  async purgeRecord(
    id: string,
    tag: string,
    actor: UserIdentity,
    slug: string,
    passwordHash: string,
  ) {
    const account = await this.auth.findCredentialsById(actor.id);
    if (!active(account) || account.passwordHash !== passwordHash)
      throw new ForbiddenException("Account changed; authenticate again");
    const row = this.rows.get(id);
    if (!row || row.authorId !== actor.id)
      throw new NotFoundException("Owned template not found");
    if (templateEtag(row) !== tag)
      throw new PreconditionFailedException(
        "Template changed; reload before permanent deletion",
      );
    if (!row.deletedAt || row.slug !== slug)
      throw new BadRequestException(
        "Permanent deletion requires a deleted template and exact slug confirmation",
      );
    this.rows.delete(id);
    this.history.delete(id);
  }
  async find(id: string, includeDeleted = false) {
    const row = this.rows.get(id);
    return row && (includeDeleted || !row.deletedAt)
      ? structuredClone(row)
      : null;
  }

  private retained(authorId: string) {
    const rows = [...this.rows.values()].filter(
        (row) => row.authorId === authorId,
      ),
      history = rows.flatMap((row) => this.history.get(row.id) || []);
    return {
      templates: rows.length,
      revisions: history.length,
      contentBytes:
        rows.reduce((n, row) => n + contentBytes(row.contentJson), 0) +
        history.reduce((n, row) => n + contentBytes(row.snapshot), 0),
    };
  }
  async retainedUsage(authorId: string) {
    return this.retained(authorId);
  }
  private used(authorId: string) {
    const rows = [...this.rows.values()].filter(
      (row) => row.authorId === authorId && !row.deletedAt,
    );
    return {
      templates: rows.length,
      contentBytes: rows.reduce(
        (total, row) => total + contentBytes(row.contentJson),
        0,
      ),
    };
  }
  async usage(authorId: string) {
    return this.used(authorId);
  }

  private validate(
    input: { authorId: string; categoryId: string; slug: string },
    current?: string,
  ) {
    if (!this.categories.has(input.categoryId)) {
      throw new BadRequestException("Category does not exist");
    }
    // The real UNIQUE(slug) also reserves slugs of soft-deleted rows.
    if (
      [...this.rows.values()].some(
        (row) => row.id !== current && row.slug === input.slug,
      )
    ) {
      throw new ConflictException("Template slug already exists");
    }
  }

  async create(input: CreateTemplateInput) {
    if (!active(await this.auth.findById(input.authorId)))
      throw new BadRequestException("Author does not exist or is inactive");
    this.validate(input);
    assertTemplateQuota(
      this.limits,
      this.used(input.authorId),
      { templates: 0, contentBytes: 0 },
      { templates: 1, contentBytes: contentBytes(input.contentJson) },
    );
    const now = new Date();
    const row: TemplateRecord = {
      ...input,
      id: randomUUID(),
      thumbnailUrl: input.thumbnailUrl ?? null,
      version: input.version ?? "1.0.0",
      revision: 1,
      isPublic: input.isPublic ?? false,
      moderationState: "visible",
      moderationReason: null,
      tags: input.tags ?? [],
      viewsCount: 0,
      forksCount: 0,
      ratingsCount: 0,
      ratingAvg: 0,
      isFeatured: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      author: { id: input.authorId },
      category: this.categories.get(input.categoryId)!,
    };
    const used = this.retained(row.authorId);
    assertRetainedQuota(this.limits, used, {
      templates: used.templates + 1,
      revisions: used.revisions + 1,
      contentBytes:
        used.contentBytes +
        contentBytes(row.contentJson) +
        contentBytes(templateSnapshot(row)),
    });
    this.rows.set(row.id, structuredClone(row));
    this.record(row, "create", input.authorId);
    return structuredClone(row);
  }

  private record(
    row: TemplateRecord,
    operation: RevisionOperation,
    actorId: string,
  ) {
    const entries = this.history.get(row.id) ?? [];
    entries.push({
      templateId: row.id,
      revision: row.revision,
      operation,
      actorId,
      createdAt: new Date(),
      snapshot: templateSnapshot(row),
    });
    this.history.set(row.id, entries);
  }

  private write(
    id: string,
    changes: Partial<TemplateRecord>,
    tag: string,
    actor: UserIdentity,
    operation: RevisionOperation,
  ) {
    const current = this.rows.get(id);
    if (!current || (current.deletedAt && operation !== "restore"))
      throw new NotFoundException("Template not found");
    if (current.authorId !== actor.id && actor.role !== "admin")
      throw new ForbiddenException(
        "Only the author or an admin can modify this template",
      );
    if (tag !== templateEtag(current))
      throw new PreconditionFailedException(
        "Template changed; keep your draft and reload the current revision",
      );
    const row = {
      ...current,
      ...changes,
      revision: current.revision + 1,
      updatedAt: new Date(),
    };
    if (current.moderationState === "hidden" && row.isPublic)
      throw new PolicyError("TEMPLATE_RESTRICTED");
    this.validate(row, id);
    assertTemplateQuota(
      this.limits,
      this.used(row.authorId),
      {
        templates: current.deletedAt ? 0 : 1,
        contentBytes: current.deletedAt ? 0 : contentBytes(current.contentJson),
      },
      {
        templates: row.deletedAt ? 0 : 1,
        contentBytes: row.deletedAt ? 0 : contentBytes(row.contentJson),
      },
    );
    if (operation !== "delete") {
      const used = this.retained(row.authorId);
      assertRetainedQuota(this.limits, used, {
        ...used,
        revisions: used.revisions + 1,
        contentBytes:
          used.contentBytes -
          contentBytes(current.contentJson) +
          contentBytes(row.contentJson) +
          contentBytes(templateSnapshot(row)),
      });
    }
    row.category = this.categories.get(row.categoryId)!;
    this.rows.set(id, structuredClone(row));
    this.record(row, operation, actor.id);
    return structuredClone(row);
  }

  async update(
    id: string,
    input: UpdateTemplateDto,
    tag: string,
    actor: UserIdentity,
  ) {
    const changes = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    );
    return this.write(id, changes, tag, actor, "update");
  }
  async remove(id: string, tag: string, actor: UserIdentity) {
    return this.write(id, { deletedAt: new Date() }, tag, actor, "delete");
  }
  async revisions(id: string, query: RevisionsQueryDto) {
    const rows = [...(this.history.get(id) ?? [])].reverse();
    return {
      data: rows
        .slice((query.page - 1) * query.size, query.page * query.size)
        .map(({ snapshot, ...row }) => ({
          ...row,
          title: snapshot.title,
          version: snapshot.version,
          isPublic: snapshot.isPublic,
        })),
      totalElements: rows.length,
      totalPages: Math.ceil(rows.length / query.size),
      page: query.page,
      size: query.size,
    };
  }
  async revision(id: string, revision: number) {
    return structuredClone(
      this.history.get(id)?.find((row) => row.revision === revision) ?? null,
    );
  }
  async restore(
    id: string,
    revision: number,
    tag: string,
    actor: UserIdentity,
  ) {
    const entry = await this.revision(id, revision);
    if (!entry) throw new NotFoundException("Revision not found");
    return this.write(
      id,
      { ...entry.snapshot, isPublic: false, deletedAt: null },
      tag,
      actor,
      "restore",
    );
  }
}
