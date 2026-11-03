import {
  BadRequestException,
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

@Injectable()
export class TemplatesService {
  constructor(@Inject(TEMPLATE_STORE) private readonly store: TemplateStore) {}
  list(query: QueryTemplatesDto) {
    return this.store.list(query);
  }
  async find(id: string) {
    const row = await this.store.find(id);
    if (!row) throw new NotFoundException("Template not found");
    return row;
  }
  create(input: CreateTemplateDto) {
    return this.store.create(input);
  }
  async update(id: string, input: UpdateTemplateDto) {
    if (!Object.values(input).some((value) => value !== undefined)) {
      throw new BadRequestException("At least one field must be provided");
    }
    await this.find(id);
    const row = await this.store.update(id, input);
    if (!row) throw new NotFoundException("Template not found");
    return row;
  }
  async remove(id: string) {
    if (!(await this.store.remove(id)))
      throw new NotFoundException("Template not found");
  }
}
