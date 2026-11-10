import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";
import {
  expectedRevision,
  type RevisionsQueryDto,
  type TemplateRevision,
} from "../template-revisions";
import { QueryTemplatesDto, UpdateTemplateDto } from "../dto/template.dto";
import {
  CreateTemplateInput,
  pageOf,
  TemplateRecord,
  TemplateStore,
} from "../template-store";
import type { UserIdentity } from "../../auth/auth-store";
import { PolicyError } from "../../service-controls/policy-error";
import { AuthorEntity, CategoryEntity, TemplateEntity } from "./entities";
import {
  SERVICE_CONTROL_SETTINGS,
  ServiceControlSettings,
} from "../../service-controls/settings";
import { assertTemplateQuota, TemplateUsage } from "../template-quota";

@Injectable()
export class PostgresTemplateStore implements TemplateStore {
  constructor(
    @InjectRepository(TemplateEntity)
    private readonly templates: Repository<TemplateEntity>,
    @InjectRepository(AuthorEntity)
    private readonly authors: Repository<AuthorEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categories: Repository<CategoryEntity>,
    @Inject(SERVICE_CONTROL_SETTINGS)
    private readonly limits: ServiceControlSettings,
  ) {}

  private project(row: TemplateEntity): TemplateRecord {
    const { author, category, ...template } = row;
    return {
      ...template,
      author: { id: row.authorId },
      category: { id: category.id, name: category.name, slug: category.slug },
    };
  }

  private query(manager?: EntityManager) {
    // Join category instead of issuing a lookup for every row; never load credentials.
    return (manager ? manager.getRepository(TemplateEntity) : this.templates)
      .createQueryBuilder("t")
      .leftJoinAndSelect("t.category", "category");
  }

  async list(input: QueryTemplatesDto, viewer: UserIdentity) {
    const query = this.query();
    if (input.deleted === true)
      query.withDeleted().andWhere("t.deletedAt IS NOT NULL");
    if (viewer.role !== "admin")
      query.andWhere("(t.isPublic = TRUE OR t.authorId = :viewerId)", {
        viewerId: viewer.id,
      });
    if (input.authorId)
      query.andWhere("t.authorId = :author", { author: input.authorId });
    if (input.categoryId)
      query.andWhere("t.categoryId = :category", {
        category: input.categoryId,
      });
    if (input.isPublic !== undefined)
      query.andWhere("t.isPublic = :public", { public: input.isPublic });
    if (input.contentFormat !== undefined)
      query.andWhere("t.content_json ->> 'format' = :contentFormat", {
        contentFormat: input.contentFormat,
      });
    if (input.schemaVersion !== undefined)
      query.andWhere(
        "t.content_json -> 'schemaVersion' = to_jsonb(CAST(:schemaVersion AS integer))",
        { schemaVersion: input.schemaVersion },
      );
    if (input.projection === "summary") {
      // Never transfer large HTML from PostgreSQL for a catalog request.
      query.select(
        this.templates.metadata.columns
          .filter((column) => column.propertyName !== "contentJson")
          .map((column) => `t.${column.propertyName}`),
      );
      query.addSelect("category");
      query.addSelect(
        "jsonb_build_object('format', t.content_json -> 'format', 'schemaVersion', t.content_json -> 'schemaVersion')",
        "catalog_content_meta",
      );
    }
    if (input.tag)
      query.andWhere("t.tags @> :tags::text[]", { tags: [input.tag] });
    if (input.search) {
      // Literal substring search; escape LIKE wildcards so '%'/'_' match memory mode.
      const value = input.search.replace(/[\\%_]/g, "\\$&");
      query.andWhere("(t.title ILIKE :search OR t.description ILIKE :search)", {
        search: `%${value}%`,
      });
    }
    const sort = input.sort === "title" ? "t.title" : "t.createdAt";
    const direction = input.order === "asc" ? "ASC" : "DESC";
    query
      .orderBy(sort, direction)
      .addOrderBy("t.id", direction)
      .skip((input.page - 1) * input.size)
      .take(input.size);
    if (input.projection === "summary") {
      const total = await query.getCount();
      const { entities, raw } = await query.getRawAndEntities();
      const metadata = new Map(
        raw.map((row) => [row.t_id, row.catalog_content_meta]),
      );
      return pageOf(
        entities.map((row) =>
          this.project({ ...row, contentJson: metadata.get(row.id) }),
        ),
        total,
        input,
      );
    }
    const [rows, total] = await query.getManyAndCount();
    return pageOf(
      rows.map((row) => this.project(row)),
      total,
      input,
    );
  }

  async find(id: string, includeDeleted = false, manager?: EntityManager) {
    const query = this.query(manager).where("t.id = :id", { id });
    if (includeDeleted) query.withDeleted();
    const row = await query.getOne();
    return row ? this.project(row) : null;
  }

  async usage(
    authorId: string,
    manager = this.templates.manager,
  ): Promise<TemplateUsage> {
    const [row] = await manager.query(
      "SELECT count(*)::int AS templates, COALESCE(sum(content_bytes),0)::bigint AS bytes FROM templates WHERE author_id=$1 AND deleted_at IS NULL",
      [authorId],
    );
    return { templates: row.templates, contentBytes: Number(row.bytes) };
  }
  private async quotaLock(authorId: string, manager: EntityManager) {
    await manager.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      ["eru-template-quota:" + authorId],
    );
  }
  private async charge(content: unknown, manager: EntityManager) {
    const [row] = await manager.query(
      "SELECT octet_length($1::jsonb::text)::bigint AS bytes",
      [JSON.stringify(content)],
    );
    return Number(row.bytes);
  }

  private async checkReferences(authorId?: string, categoryId?: string) {
    if (
      authorId &&
      !(await this.authors.existsBy({ id: authorId, isActive: true }))
    ) {
      throw new BadRequestException("Author does not exist or is inactive");
    }
    if (categoryId && !(await this.categories.existsBy({ id: categoryId }))) {
      throw new BadRequestException("Category does not exist");
    }
  }

  async create(input: CreateTemplateInput) {
    await this.checkReferences(input.authorId, input.categoryId);
    return this.templates.manager.transaction(async (manager) => {
      await this.quotaLock(input.authorId, manager);
      assertTemplateQuota(
        this.limits,
        await this.usage(input.authorId, manager),
        { templates: 0, contentBytes: 0 },
        {
          templates: 1,
          contentBytes: await this.charge(input.contentJson, manager),
        },
      );
      await manager.query("SELECT set_config('eru.actor_id', $1, true)", [
        input.authorId,
      ]);
      const repository = manager.getRepository(TemplateEntity);
      const row = await repository.save(
        repository.create({ ...input, isPublic: input.isPublic ?? false }),
      );
      return (await this.find(row.id, false, manager))!;
    });
  }

  private async write(
    id: string,
    input: Omit<UpdateTemplateDto, "contentJson"> & {
      contentJson?: unknown;
      deletedAt?: Date | null;
    },
    tag: string,
    actor: UserIdentity,
    operation: "update" | "delete" | "restore",
  ) {
    const revision = expectedRevision(id, tag);
    await this.checkReferences(undefined, input.categoryId);
    return this.templates.manager.transaction(async (manager) => {
      const [hint] = await manager.query(
        "SELECT author_id FROM templates WHERE id=$1",
        [id],
      );
      if (!hint || (actor.role !== "admin" && hint.author_id !== actor.id))
        throw new PreconditionFailedException(
          "Template changed; keep your draft and reload the current revision",
        );
      await this.quotaLock(hint.author_id, manager);
      const [current] = await manager.query(
        "SELECT revision,deleted_at,content_bytes,moderation_state FROM templates WHERE id=$1",
        [id],
      );
      if (
        !current ||
        current.revision !== revision ||
        (current.deleted_at && operation !== "restore")
      )
        throw new PreconditionFailedException(
          "Template changed; keep your draft and reload the current revision",
        );
      if (current.moderation_state === "hidden" && input.isPublic === true)
        throw new PolicyError("TEMPLATE_RESTRICTED");
      const afterDeleted = operation === "delete",
        afterBytes =
          input.contentJson === undefined
            ? Number(current.content_bytes)
            : await this.charge(input.contentJson, manager);
      assertTemplateQuota(
        this.limits,
        await this.usage(hint.author_id, manager),
        {
          templates: current.deleted_at ? 0 : 1,
          contentBytes: current.deleted_at ? 0 : Number(current.content_bytes),
        },
        {
          templates: afterDeleted ? 0 : 1,
          contentBytes: afterDeleted ? 0 : afterBytes,
        },
      );
      await manager.query(
        "SELECT set_config('eru.actor_id', $1, true), set_config('eru.template_operation', $2, true)",
        [actor.id, operation],
      );
      const { contentJson, ...columns } = input;
      const query = manager
        .getRepository(TemplateEntity)
        .createQueryBuilder()
        .update()
        .set({
          ...columns,
          ...(contentJson === undefined
            ? {}
            : { contentJson: () => ":content" }),
        })
        .where("id = :id", { id })
        .andWhere("revision = :revision", { revision });
      if (operation !== "restore") query.andWhere("deleted_at IS NULL");
      if (actor.role !== "admin")
        query.andWhere("author_id = :actorId", { actorId: actor.id });
      if (contentJson !== undefined)
        query.setParameter("content", JSON.stringify(contentJson));
      const result = await query.execute();
      if (result.affected !== 1)
        throw new PreconditionFailedException(
          "Template changed; keep your draft and reload the current revision",
        );
      const updated = (await this.find(id, true, manager))!;
      if (
        operation === "update" &&
        updated.isPublic &&
        updated.moderationState !== "hidden"
      ) {
        const outboxTable = await manager.query(
          "SELECT to_regclass('public.message_outbox') AS exists",
        );
        if (outboxTable[0]?.exists) {
          await manager.query(
            `INSERT INTO message_outbox (id, event_type, payload, created_at)
             VALUES (gen_random_uuid(), 'template.version_published', $1, CURRENT_TIMESTAMP)`,
            [
              JSON.stringify({
                templateId: updated.id,
                revision: updated.revision,
                title: updated.title,
                version: updated.version,
                isPublic: updated.isPublic,
                actorId: actor.id,
                authorId: updated.authorId,
                slug: updated.slug,
                occurredAt: new Date().toISOString(),
              }),
            ],
          );
        }
      }
      return updated;
    });
  }
  update(
    id: string,
    input: UpdateTemplateDto,
    tag: string,
    actor: UserIdentity,
  ) {
    return this.write(id, input, tag, actor, "update");
  }
  remove(id: string, tag: string, actor: UserIdentity) {
    return this.write(id, { deletedAt: new Date() }, tag, actor, "delete");
  }
  async revisions(id: string, query: RevisionsQueryDto) {
    const [{ count }] = await this.templates.manager.query(
      "SELECT count(*)::int count FROM template_revisions WHERE template_id=$1",
      [id],
    );
    const data = await this.templates.manager.query(
      `SELECT template_id AS "templateId", revision, operation, actor_id AS "actorId", created_at AS "createdAt",
      snapshot->>'title' AS title, snapshot->>'version' AS version, (snapshot->>'isPublic')::boolean AS "isPublic"
      FROM template_revisions WHERE template_id=$1 ORDER BY revision DESC LIMIT $2 OFFSET $3`,
      [id, query.size, (query.page - 1) * query.size],
    );
    return {
      data,
      page: query.page,
      size: query.size,
      totalElements: count,
      totalPages: Math.ceil(count / query.size),
    };
  }
  async revision(
    id: string,
    revision: number,
  ): Promise<TemplateRevision | null> {
    const rows = await this.templates.manager.query(
      `SELECT template_id AS "templateId", revision, operation, actor_id AS "actorId", created_at AS "createdAt", snapshot
      FROM template_revisions WHERE template_id=$1 AND revision=$2`,
      [id, revision],
    );
    return rows[0] ?? null;
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
