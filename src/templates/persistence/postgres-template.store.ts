import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Repository } from "typeorm";
import { QueryTemplatesDto, UpdateTemplateDto } from "../dto/template.dto";
import {
  CreateTemplateInput,
  pageOf,
  TemplateRecord,
  TemplateStore,
} from "../template-store";
import type { UserIdentity } from "../../auth/auth-store";
import { AuthorEntity, CategoryEntity, TemplateEntity } from "./entities";

@Injectable()
export class PostgresTemplateStore implements TemplateStore {
  constructor(
    @InjectRepository(TemplateEntity)
    private readonly templates: Repository<TemplateEntity>,
    @InjectRepository(AuthorEntity)
    private readonly authors: Repository<AuthorEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categories: Repository<CategoryEntity>,
  ) {}

  private project(row: TemplateEntity): TemplateRecord {
    const { author, category, ...template } = row;
    return {
      ...template,
      author: { id: row.authorId },
      category: { id: category.id, name: category.name, slug: category.slug },
    };
  }

  private query() {
    // Join category instead of issuing a lookup for every row; never load credentials.
    return this.templates
      .createQueryBuilder("t")
      .leftJoinAndSelect("t.category", "category");
  }

  async list(input: QueryTemplatesDto, viewer: UserIdentity) {
    const query = this.query();
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
    const [rows, total] = await query.getManyAndCount();
    return pageOf(
      rows.map((row) => this.project(row)),
      total,
      input,
    );
  }

  async find(id: string) {
    const row = await this.query().where("t.id = :id", { id }).getOne();
    return row ? this.project(row) : null;
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
    const row = await this.templates.save(this.templates.create(input));
    return (await this.find(row.id))!;
  }

  async update(id: string, input: UpdateTemplateDto) {
    // Atomic partial UPDATE avoids save() re-inserting a concurrently removed entity.
    // Explicit deletedAt predicate prevents PATCH from changing a soft-deleted row.
    await this.checkReferences(undefined, input.categoryId);
    const { contentJson, ...columns } = input;
    // Bind the whole JSON document; QueryDeepPartialEntity is not a JSON schema.
    const query = this.templates
      .createQueryBuilder()
      .update()
      .set({
        ...columns,
        ...(contentJson === undefined ? {} : { contentJson: () => ":content" }),
      })
      .where("id = :id", { id })
      .andWhere("deleted_at IS NULL");
    if (contentJson !== undefined)
      query.setParameter("content", JSON.stringify(contentJson));
    const result = await query.execute();
    return result.affected ? this.find(id) : null;
  }

  async remove(id: string) {
    const result = await this.templates.softDelete({ id, deletedAt: IsNull() });
    return result.affected === 1;
  }
}
