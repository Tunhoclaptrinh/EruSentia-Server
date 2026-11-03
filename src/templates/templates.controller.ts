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
  Res,
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
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
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
import { CurrentUser } from "../auth/auth.guards";
import type { UserIdentity } from "../auth/auth-store";

@ApiTags("Templates")
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@ApiBadRequestResponse({ type: ApiErrorDto })
@ApiInternalServerErrorResponse({ type: ApiErrorDto })
@Controller("templates")
export class TemplatesController {
  constructor(private readonly service: TemplatesService) {}
  @Get()
  @ApiOperation({ summary: "List and paginate templates" })
  @ApiOkResponse({ type: TemplatePageDto })
  list(@Query() query: QueryTemplatesDto, @CurrentUser() user: UserIdentity) {
    return this.service.list(query, user);
  }
  @Get(":id")
  @ApiOperation({ summary: "Read a template" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({
    type: TemplateResponseDto,
    headers: {
      "X-Cache": {
        description:
          "Server-side projection cache path; authorization is always evaluated first.",
        schema: {
          type: "string",
          enum: [
            "HIT",
            "MISS",
            "COALESCED",
            "BYPASS_DISABLED",
            "BYPASS_PRIVATE",
            "BYPASS_REDIS",
          ],
        },
      },
    },
  })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  async find(
    @Param("id", UuidPipe) id: string,
    @CurrentUser() user: UserIdentity,
    @Res({ passthrough: true })
    response: { setHeader(name: string, value: string): void },
  ) {
    const result = await this.service.read(id, user);
    response.setHeader("X-Cache", result.status);
    return result.row;
  }
  @Post()
  @ApiOperation({ summary: "Create a template" })
  @ApiCreatedResponse({ type: TemplateResponseDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiPayloadTooLargeResponse({ type: ApiErrorDto })
  create(@Body() body: CreateTemplateDto, @CurrentUser() user: UserIdentity) {
    return this.service.create(body, user);
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
  update(
    @Param("id", UuidPipe) id: string,
    @Body() body: UpdateTemplateDto,
    @CurrentUser() user: UserIdentity,
  ) {
    return this.service.update(id, body, user);
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
  remove(@Param("id", UuidPipe) id: string, @CurrentUser() user: UserIdentity) {
    return this.service.remove(id, user);
  }
}
