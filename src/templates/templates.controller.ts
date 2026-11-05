import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Headers,
  ParseIntPipe,
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
  ApiExtraModels,
  ApiHeader,
  ApiResponse,
  getSchemaPath,
} from "@nestjs/swagger";
import {
  ApiErrorDto,
  TemplatePageDto,
  TemplateResponseDto,
  TemplateSummaryPageDto,
} from "./dto/template-response.dto";
import { CurrentUser } from "../auth/auth.guards";
import type { UserIdentity } from "../auth/auth-store";
import {
  RevisionsPageDto,
  TemplateRevisionDto,
} from "./dto/template-revisions.dto";
import {
  templateEtag,
  RevisionsQueryDto,
  RestoreTemplateDto,
} from "./template-revisions";

type ResponseHeaders = { setHeader(name: string, value: string): void };
const etagHeader = {
  ETag: {
    description: "Strong resource tag for conditional PATCH, DELETE or restore",
    schema: { type: "string" },
  },
};
const matchHeader = {
  name: "If-Match",
  required: true,
  description:
    'One exact ETag returned by GET or a successful write, for example "template:<uuid>:1"',
};

@ApiTags("Templates")
@ApiExtraModels(TemplatePageDto, TemplateSummaryPageDto)
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@ApiBadRequestResponse({ type: ApiErrorDto })
@ApiInternalServerErrorResponse({ type: ApiErrorDto })
@Controller("templates")
export class TemplatesController {
  constructor(private readonly service: TemplatesService) {}
  @Get()
  @ApiOperation({
    summary: "List and paginate templates",
    description:
      "Use projection=summary for a catalog without HTML. contentFormat/schemaVersion filters apply before count and pagination. Defaults preserve the full week-2 contract.",
  })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(TemplatePageDto) },
        { $ref: getSchemaPath(TemplateSummaryPageDto) },
      ],
    },
  })
  list(@Query() query: QueryTemplatesDto, @CurrentUser() user: UserIdentity) {
    return this.service.list(query, user);
  }
  @Get(":id")
  @ApiOperation({ summary: "Read a template" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({
    type: TemplateResponseDto,
    headers: {
      ...etagHeader,
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
    response.setHeader("ETag", templateEtag(result.row));
    return result.row;
  }
  @Post()
  @ApiOperation({ summary: "Create a template" })
  @ApiCreatedResponse({ type: TemplateResponseDto, headers: etagHeader })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiPayloadTooLargeResponse({ type: ApiErrorDto })
  async create(
    @Body() body: CreateTemplateDto,
    @CurrentUser() user: UserIdentity,
    @Res({ passthrough: true }) response: ResponseHeaders,
  ) {
    const row = await this.service.create(body, user);
    response.setHeader("ETag", templateEtag(row));
    return row;
  }
  @Patch(":id")
  @ApiOperation({
    summary: "Update a template",
    description:
      "Supply at least one field. authorId is immutable; contentJson replaces the entire envelope.",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ type: TemplateResponseDto, headers: etagHeader })
  @ApiHeader(matchHeader)
  @ApiResponse({
    status: 412,
    type: ApiErrorDto,
    description:
      "Stale revision; keep the draft and reload. Never automatically retry.",
  })
  @ApiResponse({
    status: 428,
    type: ApiErrorDto,
    description: "Missing If-Match",
  })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiPayloadTooLargeResponse({ type: ApiErrorDto })
  async update(
    @Param("id", UuidPipe) id: string,
    @Body() body: UpdateTemplateDto,
    @CurrentUser() user: UserIdentity,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) response: ResponseHeaders,
  ) {
    const row = await this.service.update(id, body, user, match);
    response.setHeader("ETag", templateEtag(row));
    return row;
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
  @ApiHeader(matchHeader)
  @ApiResponse({ status: 412, type: ApiErrorDto })
  @ApiResponse({ status: 428, type: ApiErrorDto })
  async remove(
    @Param("id", UuidPipe) id: string,
    @CurrentUser() user: UserIdentity,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) response: ResponseHeaders,
  ) {
    const row = await this.service.remove(id, user, match);
    response.setHeader("ETag", templateEtag(row));
  }
  @Get(":id/revisions")
  @ApiOkResponse({ type: RevisionsPageDto })
  @ApiOperation({
    summary: "List revision metadata (owner/admin only)",
    description:
      "Includes currentEtag for conditional restore, including a soft-deleted template. No HTML in this list.",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  revisions(
    @Param("id", UuidPipe) id: string,
    @Query() query: RevisionsQueryDto,
    @CurrentUser() user: UserIdentity,
  ) {
    return this.service.revisions(id, query, user);
  }
  @Get(":id/revisions/:revision")
  @ApiOkResponse({ type: TemplateRevisionDto })
  @ApiOperation({ summary: "Read a historical snapshot (owner/admin only)" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiParam({
    name: "revision",
    schema: { type: "integer", minimum: 1, maximum: 2147483647 },
  })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  revision(
    @Param("id", UuidPipe) id: string,
    @Param("revision", ParseIntPipe) revision: number,
    @CurrentUser() user: UserIdentity,
  ) {
    return this.service.revision(id, revision, user);
  }
  @Post(":id/restore")
  @HttpCode(200)
  @ApiOperation({
    summary: "Restore a snapshot as a new private revision",
    description:
      "Does not reset the revision counter, ownership, metrics or previous history. Also restores a soft-deleted template. Slug conflicts remain 409.",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiHeader(matchHeader)
  @ApiOkResponse({ type: TemplateResponseDto, headers: etagHeader })
  @ApiResponse({ status: 412, type: ApiErrorDto })
  @ApiResponse({ status: 428, type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  async restore(
    @Param("id", UuidPipe) id: string,
    @Body() body: RestoreTemplateDto,
    @CurrentUser() user: UserIdentity,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) response: ResponseHeaders,
  ) {
    const row = await this.service.restore(id, body.revision, user, match);
    response.setHeader("ETag", templateEtag(row));
    return row;
  }
}
