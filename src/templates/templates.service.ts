import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CreateTemplateDto,
  QueryTemplatesDto,
  UpdateTemplateDto,
} from "./dto/template.dto";
import { TemplateCache } from "../cache/template-cache";
import {
  TEMPLATE_STORE,
  TemplateStore,
  summarizeTemplate,
} from "./template-store";
import type { UserIdentity } from "../auth/auth-store";

@Injectable()
export class TemplatesService {
  constructor(
    @Inject(TEMPLATE_STORE) private readonly store: TemplateStore,
    private readonly cache: TemplateCache,
  ) {}
  read(id: string, viewer: UserIdentity) {
    return this.cache.read(id, viewer, () => this.store.find(id));
  }
  async list(query: QueryTemplatesDto, viewer: UserIdentity) {
    const page = await this.store.list(query, viewer);
    return query.projection === "summary"
      ? { ...page, data: page.data.map(summarizeTemplate) }
      : page;
  }
  async find(id: string, viewer: UserIdentity) {
    const row = await this.store.find(id);
    if (
      !row ||
      (!row.isPublic && row.authorId !== viewer.id && viewer.role !== "admin")
    )
      throw new NotFoundException("Template not found");
    return row;
  }
  create(input: CreateTemplateDto, viewer: UserIdentity) {
    return this.store.create({ ...input, authorId: viewer.id });
  }
  async update(id: string, input: UpdateTemplateDto, viewer: UserIdentity) {
    const current = await this.find(id, viewer);
    if (current.authorId !== viewer.id && viewer.role !== "admin")
      throw new ForbiddenException(
        "Only the author or an admin can modify this template",
      );
    if (!Object.values(input).some((value) => value !== undefined)) {
      throw new BadRequestException("At least one field must be provided");
    }
    const stamp = await this.cache.stamp(id);
    const row = await this.store.update(id, input);
    if (!row) throw new NotFoundException("Template not found");
    await this.cache.invalidate(id, stamp);
    return row;
  }
  async remove(id: string, viewer: UserIdentity) {
    const current = await this.find(id, viewer);
    if (current.authorId !== viewer.id && viewer.role !== "admin")
      throw new ForbiddenException(
        "Only the author or an admin can modify this template",
      );
    const stamp = await this.cache.stamp(id);
    if (!(await this.store.remove(id)))
      throw new NotFoundException("Template not found");
    await this.cache.invalidate(id, stamp);
  }
}
