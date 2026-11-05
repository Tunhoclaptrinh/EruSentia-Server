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
  constructor(@Inject(AUTH_STORE) private readonly auth: AuthStore) {}
  private readonly categories = new Map(
    MEMORY_CATEGORIES.map(({ id, name, slug }) => [id, { id, name, slug }]),
  );

  async list(query: QueryTemplatesDto, viewer: UserIdentity) {
    const rows = [...this.rows.values()].filter(
      (t) =>
        !t.deletedAt &&
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

  async find(id: string, includeDeleted = false) {
    const row = this.rows.get(id);
    return row && (includeDeleted || !row.deletedAt)
      ? structuredClone(row)
      : null;
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
    const now = new Date();
    const row: TemplateRecord = {
      ...input,
      id: randomUUID(),
      thumbnailUrl: input.thumbnailUrl ?? null,
      version: input.version ?? "1.0.0",
      revision: 1,
      isPublic: input.isPublic ?? true,
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
    this.validate(row, id);
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
