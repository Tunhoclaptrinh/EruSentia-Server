import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  CreateTemplateDto,
  QueryTemplatesDto,
  UpdateTemplateDto,
} from "../dto/template.dto";
import { pageOf, TemplateRecord, TemplateStore } from "../template-store";

@Injectable()
export class MemoryTemplateStore implements TemplateStore {
  private readonly rows = new Map<string, TemplateRecord>();
  private readonly authors = new Set([
    "a0000000-0000-0000-0000-000000000002",
    "a0000000-0000-0000-0000-000000000003",
  ]);
  private readonly categories = new Map([
    [
      "c0000000-0000-0000-0000-000000000001",
      {
        id: "c0000000-0000-0000-0000-000000000001",
        name: "Software Engineering",
        slug: "software-engineering",
      },
    ],
    [
      "c0000000-0000-0000-0000-000000000002",
      {
        id: "c0000000-0000-0000-0000-000000000002",
        name: "Project Management",
        slug: "project-management",
      },
    ],
  ]);

  async list(query: QueryTemplatesDto) {
    const rows = [...this.rows.values()].filter(
      (t) =>
        !t.deletedAt &&
        (!query.authorId || t.authorId === query.authorId) &&
        (!query.categoryId || t.categoryId === query.categoryId) &&
        (query.isPublic === undefined || t.isPublic === query.isPublic) &&
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

  async find(id: string) {
    const row = this.rows.get(id);
    return row && !row.deletedAt ? structuredClone(row) : null;
  }

  private validate(
    input: { authorId: string; categoryId: string; slug: string },
    current?: string,
  ) {
    if (
      !this.authors.has(input.authorId) ||
      !this.categories.has(input.categoryId)
    ) {
      throw new BadRequestException("Author or category does not exist");
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

  async create(input: CreateTemplateDto) {
    this.validate(input);
    const now = new Date();
    const row: TemplateRecord = {
      ...input,
      id: randomUUID(),
      thumbnailUrl: input.thumbnailUrl ?? null,
      version: input.version ?? "1.0.0",
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
    return structuredClone(row);
  }

  async update(id: string, input: UpdateTemplateDto) {
    const current = this.rows.get(id);
    if (!current || current.deletedAt) return null;
    const changes = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    );
    const row = {
      ...current,
      ...changes,
      updatedAt: new Date(),
    } as TemplateRecord;
    this.validate(row, id);
    row.category = this.categories.get(row.categoryId)!;
    this.rows.set(id, structuredClone(row));
    return structuredClone(row);
  }

  async remove(id: string) {
    const row = this.rows.get(id);
    if (!row || row.deletedAt) return false;
    row.deletedAt = new Date();
    row.updatedAt = row.deletedAt;
    return true;
  }
}
