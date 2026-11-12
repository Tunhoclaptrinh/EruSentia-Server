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
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Roles } from "../auth/auth.guards";
import type { UserIdentity } from "../auth/auth-store";
import { UuidPipe } from "../common/uuid.pipe";
import {
  AdminSuspendUserDto,
  AdminUpdateRoleDto,
  AdminUserQueryDto,
} from "./dto/admin.dto";
import { AdminUsersService } from "./admin-users.service";

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

@ApiTags("Admin - Accounts")
@ApiBearerAuth()
@Roles("admin")
@Controller("admin/accounts")
export class AdminAccountsController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: "Danh sách tài khoản người dùng có tìm kiếm, lọc và phân trang" })
  list(@Query() query: AdminUserQueryDto) {
    return this.service.list(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Xem chi tiết tài khoản, dung lượng và danh sách phiên đăng nhập" })
  detail(@Param("id", UuidPipe) id: string) {
    return this.service.detail(id);
  }

  @Patch(":id/role")
  @HttpCode(200)
  @ApiOperation({ summary: "Thay đổi vai trò người dùng (user, creator, admin)" })
  updateRole(
    @Param("id", UuidPipe) id: string,
    @Body() input: AdminUpdateRoleDto,
    @CurrentUser() admin: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    return this.service.updateRole(id, input, admin.id, getRequestMeta(req));
  }

  @Post(":id/suspend")
  @HttpCode(200)
  @ApiOperation({ summary: "Khóa tài khoản và hủy toàn bộ phiên làm việc tức thì" })
  suspend(
    @Param("id", UuidPipe) id: string,
    @Body() input: AdminSuspendUserDto,
    @CurrentUser() admin: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    return this.service.suspend(id, input, admin.id, getRequestMeta(req));
  }

  @Post(":id/activate")
  @HttpCode(200)
  @ApiOperation({ summary: "Mở khóa kích hoạt lại tài khoản" })
  activate(
    @Param("id", UuidPipe) id: string,
    @CurrentUser() admin: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    return this.service.activate(id, admin.id, getRequestMeta(req));
  }

  @Delete(":id/sessions")
  @HttpCode(200)
  @ApiOperation({ summary: "Buộc đăng xuất toàn bộ phiên làm việc của người dùng" })
  revokeSessions(
    @Param("id", UuidPipe) id: string,
    @CurrentUser() admin: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    return this.service.revokeSessions(id, admin.id, getRequestMeta(req));
  }
}

