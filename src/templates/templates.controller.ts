import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { UuidPipe } from "../common/uuid.pipe";
import {
  CreateTemplateDto,
  QueryTemplatesDto,
  UpdateTemplateDto,
} from "./dto/template.dto";
import { TemplatesService } from "./templates.service";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  ApiErrorDto,
  TemplatePageDto,
  TemplateResponseDto,
} from "./dto/template-response.dto";

@ApiTags("Templates")
@ApiBadRequestResponse({ type: ApiErrorDto })
@ApiInternalServerErrorResponse({ type: ApiErrorDto })
@Controller("templates")
export class TemplatesController {
  constructor(private readonly service: TemplatesService) {}
  @Get()
  @ApiOperation({ summary: "List and paginate templates" })
  @ApiOkResponse({ type: TemplatePageDto })
  list(@Query() query: QueryTemplatesDto) {
    return this.service.list(query);
  }
  @Get(":id")
  @ApiOperation({ summary: "Read a template" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ type: TemplateResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  find(@Param("id", UuidPipe) id: string) {
    return this.service.find(id);
  }
  @Post()
  @ApiOperation({ summary: "Create a template" })
  @ApiCreatedResponse({ type: TemplateResponseDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiPayloadTooLargeResponse({ type: ApiErrorDto })
  create(@Body() body: CreateTemplateDto) {
    return this.service.create(body);
  }
  @Patch(":id")
  @ApiOperation({
    summary: "Update a template",
    description:
      "Supply at least one field. authorId is immutable; contentJson replaces the entire envelope.",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ type: TemplateResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiPayloadTooLargeResponse({ type: ApiErrorDto })
  update(@Param("id", UuidPipe) id: string, @Body() body: UpdateTemplateDto) {
    return this.service.update(id, body);
  }
  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({
    summary: "Soft-delete a template",
    description:
      "Keeps the database row and reserves the slug. Repeated deletion returns 404.",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiNoContentResponse({ description: "Deleted; empty response body." })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  remove(@Param("id", UuidPipe) id: string) {
    return this.service.remove(id);
  }
}
