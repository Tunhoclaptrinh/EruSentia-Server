import { BaseController } from "../common/controllers/base.controller";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Roles } from "../auth/auth.guards";
import type { UserIdentity } from "../auth/auth-store";
import { UuidPipe } from "../common/uuid.pipe";
import { RateLimited } from "../service-controls/service-controls";
import { type AdminRequest } from "../admin/request-meta";
import { CommunityDocumentsService } from "./documents.service";
import {
  DocumentDecisionDto,
  DocumentDraftDto,
  DocumentQueryDto,
  DocumentSubmitDto,
  DocumentUpdateDto,
  DocumentVersionDto,
} from "./contracts";

@ApiTags("Community documents")
@ApiBearerAuth()
@Controller()
export class CommunityDocumentsController extends BaseController {
  constructor(private readonly service: CommunityDocumentsService) {
    super();
  }
  @Get("community/documents")
  @ApiOperation({
    summary:
      "Thư viện tài liệu đã được phê duyệt; không trả HTML trong danh sách",
  })
  catalog(@Query() query: DocumentQueryDto, @CurrentUser() user: UserIdentity) {
    return this.service.list(query, "catalog", user);
  }
  @Get("community/documents/:id")
  read(@Param("id", UuidPipe) id: string, @CurrentUser() user: UserIdentity) {
    return this.service.detail(id, "catalog", user);
  }
  @Get("account/community-documents")
  own(@Query() query: DocumentQueryDto, @CurrentUser() user: UserIdentity) {
    return this.service.list(query, "own", user);
  }
  @Get("account/community-documents/:id")
  detail(@Param("id", UuidPipe) id: string, @CurrentUser() user: UserIdentity) {
    return this.service.detail(id, "own", user);
  }
  @Post("account/community-documents")
  @RateLimited("write")
  create(@Body() input: DocumentDraftDto, @CurrentUser() user: UserIdentity) {
    return this.service.create(input, user);
  }
  @Patch("account/community-documents/:id")
  @RateLimited("write")
  update(
    @Param("id", UuidPipe) id: string,
    @Body() input: DocumentUpdateDto,
    @CurrentUser() user: UserIdentity,
  ) {
    return this.service.update(id, input, user);
  }
  @Post("account/community-documents/:id/submit")
  @HttpCode(200)
  @RateLimited("write")
  submit(
    @Param("id", UuidPipe) id: string,
    @Body() input: DocumentSubmitDto,
    @CurrentUser() user: UserIdentity,
  ) {
    return this.service.submit(id, input.version, user);
  }
  @Post("account/community-documents/:id/withdraw")
  @HttpCode(200)
  @RateLimited("write")
  withdraw(
    @Param("id", UuidPipe) id: string,
    @Body() input: DocumentVersionDto,
    @CurrentUser() user: UserIdentity,
  ) {
    return this.service.withdraw(id, input.version, user);
  }
  @Get("admin/community-documents")
  @Roles("admin")
  admin(@Query() query: DocumentQueryDto, @CurrentUser() user: UserIdentity) {
    return this.service.list(query, "admin", user);
  }
  @Get("admin/community-documents/:id")
  @Roles("admin")
  inspect(
    @Param("id", UuidPipe) id: string,
    @CurrentUser() user: UserIdentity,
  ) {
    return this.service.detail(id, "admin", user);
  }
  @Post("admin/community-documents/:id/decision")
  @HttpCode(200)
  @Roles("admin")
  @RateLimited("write")
  @ApiOperation({
    summary:
      "Phê duyệt, yêu cầu chỉnh sửa hoặc thu hồi tài liệu với phiên bản và lý do",
  })
  decision(
    @Param("id", UuidPipe) id: string,
    @Body() input: DocumentDecisionDto,
    @CurrentUser() user: UserIdentity,
    @Req() req: AdminRequest,
  ) {
    return this.service.decide(
      id,
      input,
      user,
      this.actionContext(user, req).meta,
    );
  }
}
