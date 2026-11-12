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
import {
  AdminCurateTemplateDto,
  AdminTemplateQueryDto,
} from "./dto/admin.dto";
import { AdminTemplatesService } from "./admin-templates.service";

interface ClientRequest {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
}

function getRequestMeta(req: ClientRequest) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip =
    (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined) ||
    req.socket?.remoteAddress ||
    req.ip;
  const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined;
  return { ip, userAgent };
}

@ApiTags("Admin - Templates")
@ApiBearerAuth()
@Roles("admin")
@Controller("admin/templates")
export class AdminTemplatesController {
  constructor(private readonly service: AdminTemplatesService) {}

  @Get()
  @ApiOperation({ summary: "Quản lý toàn bộ template trên hệ thống" })
  list(@Query() query: AdminTemplateQueryDto) {
    return this.service.list(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Chi tiết template, báo cáo vi phạm và lịch sử phiên bản" })
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
    return this.service.curate(id, input, admin.id, getRequestMeta(req));
  }

  @Post(":id/force-hide")
  @HttpCode(200)
  @ApiOperation({ summary: "Buộc ẩn template vi phạm kèm lý do" })
  forceHide(
    @Param("id", UuidPipe) id: string,
    @Body("reason") reason: string,
    @CurrentUser() admin: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    return this.service.forceHide(id, reason || "Vi phạm tiêu chuẩn cộng đồng", admin.id, getRequestMeta(req));
  }
}
