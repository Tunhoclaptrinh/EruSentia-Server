import { AdminTemplateLifecycleService } from "./admin-template-lifecycle";
import {
  AdminRevisionQueryDto,
  AdminRestoreRevisionDto,
  AdminTemplateMetadataDto,
  AdminTemplatePurgeDto,
  AdminVersionReasonDto,
} from "./dto/lifecycle.dto";
import { AdminBatchCurationDto } from "./dto/batch.dto";
import { RateLimited } from "../service-controls/service-controls";
import { BaseController } from "../common/controllers/base.controller";
import { AdminController } from "./admin-controller.decorator";
import {
  Body,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiOperation } from "@nestjs/swagger";
import { CurrentUser } from "../auth/auth.guards";
import type { UserIdentity } from "../auth/auth-store";
import { UuidPipe } from "../common/uuid.pipe";
import {
  AdminCurateTemplateDto,
  AdminTemplateQueryDto,
  AdminForceHideDto,
} from "./dto/admin.dto";
import { AdminTemplatesService } from "./admin-templates.service";

import { type AdminRequest as ClientRequest } from "./request-meta";

@AdminController("templates", "Admin - Templates")
export class AdminTemplatesController extends BaseController {
  constructor(
    private readonly service: AdminTemplatesService,
    private readonly lifecycle: AdminTemplateLifecycleService,
  ) {
    super();
  }

  @Get()
  @ApiOperation({ summary: "Quản lý toàn bộ template trên hệ thống" })
  list(@Query() query: AdminTemplateQueryDto) {
    return this.service.list(query);
  }

  @Post("batch-curation")
  @HttpCode(200)
  @RateLimited("write")
  @ApiOperation({
    summary: "Tuyển chọn hoặc gỡ tuyển chọn tối đa 100 mẫu cùng lý do và audit",
  })
  curateMany(
    @Body() input: AdminBatchCurationDto,
    @CurrentUser() actor: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    const context = this.actionContext(actor, req);
    return this.service.curateMany(input, context.actorId, context.meta);
  }

  @Get(":id/revision")
  revision(
    @Param("id", UuidPipe) id: string,
    @Query() query: AdminRevisionQueryDto,
  ) {
    return this.lifecycle.revision(id, query.revision);
  }
  @Get(":id")
  @ApiOperation({
    summary: "Chi tiết template, báo cáo vi phạm và lịch sử phiên bản",
  })
  detail(@Param("id", UuidPipe) id: string) {
    return this.service.detail(id);
  }

  @Patch(":id/curation")
  @HttpCode(200)
  @ApiOperation({ summary: "Đánh dấu tuyển chọn (Curated) hoặc gỡ bỏ" })
  curate(
    @Param("id", UuidPipe) id: string,
    @Body() input: AdminCurateTemplateDto,
    @CurrentUser() admin: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    const { actorId, meta } = this.actionContext(admin, req);
    return this.service.curate(id, input, actorId, meta);
  }

  @Post(":id/force-hide")
  @HttpCode(200)
  @ApiOperation({ summary: "Buộc ẩn template vi phạm kèm lý do" })
  forceHide(
    @Param("id", UuidPipe) id: string,
    @Body() input: AdminForceHideDto,
    @CurrentUser() admin: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    const { actorId, meta } = this.actionContext(admin, req);
    return this.service.forceHide(
      id,
      input.reason,
      actorId,
      meta,
      input.revision,
    );
  }
  @Patch(":id/metadata")
  @HttpCode(200)
  @RateLimited("write")
  metadata(
    @Param("id", UuidPipe) id: string,
    @Body() input: AdminTemplateMetadataDto,
    @CurrentUser() actor: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    return this.lifecycle.change(
      id,
      "metadata",
      input,
      actor,
      this.actionContext(actor, req).meta,
    );
  }

  @Post(":id/release")
  @HttpCode(200)
  @RateLimited("write")
  release(
    @Param("id", UuidPipe) id: string,
    @Body() input: AdminVersionReasonDto,
    @CurrentUser() actor: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    return this.lifecycle.change(
      id,
      "release",
      input,
      actor,
      this.actionContext(actor, req).meta,
    );
  }

  @Post(":id/trash")
  @HttpCode(200)
  @RateLimited("write")
  trash(
    @Param("id", UuidPipe) id: string,
    @Body() input: AdminVersionReasonDto,
    @CurrentUser() actor: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    return this.lifecycle.change(
      id,
      "trash",
      input,
      actor,
      this.actionContext(actor, req).meta,
    );
  }

  @Post(":id/restore")
  @HttpCode(200)
  @RateLimited("write")
  restore(
    @Param("id", UuidPipe) id: string,
    @Body() input: AdminVersionReasonDto,
    @CurrentUser() actor: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    return this.lifecycle.change(
      id,
      "restore",
      input,
      actor,
      this.actionContext(actor, req).meta,
    );
  }

  @Post(":id/restore-revision")
  @HttpCode(200)
  @RateLimited("write")
  restore_revision(
    @Param("id", UuidPipe) id: string,
    @Body() input: AdminRestoreRevisionDto,
    @CurrentUser() actor: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    return this.lifecycle.change(
      id,
      "restore_revision",
      input,
      actor,
      this.actionContext(actor, req).meta,
    );
  }

  @Post(":id/purge")
  @HttpCode(200)
  @RateLimited("sensitive")
  purge(
    @Param("id", UuidPipe) id: string,
    @Body() input: AdminTemplatePurgeDto,
    @CurrentUser() actor: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    return this.lifecycle.change(
      id,
      "purge",
      input,
      actor,
      this.actionContext(actor, req).meta,
    );
  }
}
