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
import { assertPublicTemplate } from "./template-publication";
import {
  requireTemplateMatch,
  templateEtag,
  type RevisionsQueryDto,
} from "./template-revisions";

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
    if (
      query.deleted === true &&
      (!query.authorId ||
        (query.authorId !== viewer.id && viewer.role !== "admin"))
    )
      throw new ForbiddenException(
        "Deleted templates require an explicit owned author scope",
      );
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
    if (input.isPublic === true) assertPublicTemplate(input.contentJson);
    return this.store.create({ ...input, authorId: viewer.id });
  }
  async update(
    id: string,
    input: UpdateTemplateDto,
    viewer: UserIdentity,
    match?: string,
  ) {
    const current = await this.find(id, viewer);
    if (current.authorId !== viewer.id && viewer.role !== "admin")
      throw new ForbiddenException(
        "Only the author or an admin can modify this template",
      );
    if (!Object.values(input).some((value) => value !== undefined)) {
      throw new BadRequestException("At least one field must be provided");
    }
    if (input.isPublic ?? current.isPublic)
      assertPublicTemplate(input.contentJson ?? current.contentJson);
    const stamp = await this.cache.stamp(id);
    const row = await this.store.update(
      id,
      input,
      requireTemplateMatch(match),
      viewer,
    );
    await this.cache.invalidate(id, stamp);
    return row;
  }
  async remove(id: string, viewer: UserIdentity, match?: string) {
    const current = await this.find(id, viewer);
    if (current.authorId !== viewer.id && viewer.role !== "admin")
      throw new ForbiddenException(
        "Only the author or an admin can modify this template",
      );
    const stamp = await this.cache.stamp(id);
    const row = await this.store.remove(
      id,
      requireTemplateMatch(match),
      viewer,
    );
    await this.cache.invalidate(id, stamp);
    return row;
  }
  private async owned(id: string, viewer: UserIdentity) {
    const row = await this.store.find(id, true);
    if (!row || (row.authorId !== viewer.id && viewer.role !== "admin"))
      throw new NotFoundException("Template not found");
    return row;
  }
  async revisions(id: string, query: RevisionsQueryDto, viewer: UserIdentity) {
    const row = await this.owned(id, viewer);
    return {
      ...(await this.store.revisions(id, query)),
      templateId: id,
      currentEtag: templateEtag(row),
      deleted: !!row.deletedAt,
    };
  }
  async revision(id: string, revision: number, viewer: UserIdentity) {
    if (
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      revision > 2147483647
    )
      throw new BadRequestException(
        "Revision must be an integer from 1 to 2147483647",
      );
    await this.owned(id, viewer);
    const row = await this.store.revision(id, revision);
    if (!row) throw new NotFoundException("Revision not found");
    return row;
  }
  async restore(
    id: string,
    revision: number,
    viewer: UserIdentity,
    match?: string,
  ) {
    await this.owned(id, viewer);
    const stamp = await this.cache.stamp(id);
    const row = await this.store.restore(
      id,
      revision,
      requireTemplateMatch(match),
      viewer,
    );
    await this.cache.invalidate(id, stamp);
    return row;
  }
}
