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
import { TEMPLATE_STORE, TemplateStore } from "./template-store";
import type { UserIdentity } from "../auth/auth-store";

@Injectable()
export class TemplatesService {
  constructor(@Inject(TEMPLATE_STORE) private readonly store: TemplateStore) {}
  list(query: QueryTemplatesDto, viewer: UserIdentity) {
    return this.store.list(query, viewer);
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
    const row = await this.store.update(id, input);
    if (!row) throw new NotFoundException("Template not found");
    return row;
  }
  async remove(id: string, viewer: UserIdentity) {
    const current = await this.find(id, viewer);
    if (current.authorId !== viewer.id && viewer.role !== "admin")
      throw new ForbiddenException(
        "Only the author or an admin can modify this template",
      );
    if (!(await this.store.remove(id)))
      throw new NotFoundException("Template not found");
  }
}
