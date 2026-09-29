import { Template } from '../entities/Template';

export interface TemplateFilterOptions {
  categoryId?: string;
  authorId?: string;
  tags?: string[];
  searchQuery?: string;
  isPublic?: boolean;
  limit?: number;
  offset?: number;
}

export interface ITemplateRepository {
  findById(id: string): Promise<Template | null>;
  findBySlug(slug: string): Promise<Template | null>;
  findMany(options: TemplateFilterOptions): Promise<{ items: Template[]; total: number }>;
  findTopRated(limit: number): Promise<Template[]>;
  save(template: Template): Promise<void>;
  incrementViewCount(id: string): Promise<void>;
  softDelete(id: string): Promise<void>;
}
