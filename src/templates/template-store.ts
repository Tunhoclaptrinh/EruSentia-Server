import {
  CreateTemplateDto,
  QueryTemplatesDto,
  UpdateTemplateDto,
} from "./dto/template.dto";

export const TEMPLATE_STORE = Symbol("TEMPLATE_STORE");
export interface TemplateRecord {
  id: string;
  authorId: string;
  categoryId: string;
  title: string;
  slug: string;
  description: string;
  contentJson: Record<string, unknown>;
  thumbnailUrl: string | null;
  version: string;
  isPublic: boolean;
  tags: string[];
  viewsCount: number;
  forksCount: number;
  ratingAvg: number;
  ratingsCount: number;
  isFeatured: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  author: { id: string };
  category: { id: string; name: string; slug: string };
}
export interface TemplatePage {
  data: TemplateRecord[];
  page: number;
  size: number;
  totalPages: number;
  totalElements: number;
}

// Catalog projection for HTTP. The week-1 ITemplateRepository remains an entity-oriented
// domain port; this port includes pagination and related author/category projections.
export interface TemplateStore {
  list(query: QueryTemplatesDto): Promise<TemplatePage>;
  find(id: string): Promise<TemplateRecord | null>;
  create(input: CreateTemplateDto): Promise<TemplateRecord>;
  update(id: string, input: UpdateTemplateDto): Promise<TemplateRecord | null>;
  remove(id: string): Promise<boolean>;
}

export function pageOf(
  data: TemplateRecord[],
  total: number,
  query: QueryTemplatesDto,
): TemplatePage {
  return {
    data,
    page: query.page,
    size: query.size,
    totalPages: Math.ceil(total / query.size),
    totalElements: total,
  };
}
