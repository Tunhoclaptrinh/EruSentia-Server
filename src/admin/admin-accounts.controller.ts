import { BaseController } from "../common/controllers/base.controller";
import { AdminController } from "./admin-controller.decorator";
import {
  Body,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiOperation } from "@nestjs/swagger";
import { CurrentSession, CurrentUser } from "../auth/auth.guards";
import type { UserIdentity } from "../auth/auth-store";
import { UuidPipe } from "../common/uuid.pipe";
import {
  AdminPageQueryDto,
  AdminReasonDto,
  AdminSuspendUserDto,
  AdminUpdateRoleDto,
  AdminUserQueryDto,
  AdminRestoreAccountDto,
} from "./dto/admin.dto";
import { AdminUsersService } from "./admin-users.service";

import { type AdminRequest as ClientRequest } from "./request-meta";

@AdminController("accounts", "Admin - Accounts")
export class AdminAccountsController extends BaseController {
  constructor(private readonly service: AdminUsersService) {
    super();
  }

  @Get()
  @ApiOperation({
    summary: "Danh sách tài khoản người dùng có tìm kiếm, lọc và phân trang",
  })
  list(@Query() query: AdminUserQueryDto) {
    return this.service.list(query);
  }

  @Get(":id")
  @ApiOperation({
    summary: "Xem chi tiết tài khoản, dung lượng và danh sách phiên đăng nhập",
  })
  detail(@Param("id", UuidPipe) id: string) {
    return this.service.detail(id);
  }

  @Post(":id/restore")
  @HttpCode(200)
  restore(
    @Param("id", UuidPipe) id: string,
    @Body() input: AdminRestoreAccountDto,
    @CurrentUser() admin: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    const { actorId, meta } = this.actionContext(admin, req);
    return this.service.restore(id, input, actorId, meta);
  }

  @Patch(":id/role")
  @HttpCode(200)
  @ApiOperation({
    summary: "Thay đổi vai trò người dùng (user, creator, admin)",
  })
  updateRole(
    @Param("id", UuidPipe) id: string,
    @Body() input: AdminUpdateRoleDto,
    @CurrentUser() admin: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    const { actorId, meta } = this.actionContext(admin, req);
    return this.service.updateRole(id, input, actorId, meta);
  }

  @Post(":id/suspend")
  @HttpCode(200)
  @ApiOperation({
    summary: "Khóa tài khoản và hủy toàn bộ phiên làm việc tức thì",
  })
  suspend(
    @Param("id", UuidPipe) id: string,
    @Body() input: AdminSuspendUserDto,
    @CurrentUser() admin: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    const { actorId, meta } = this.actionContext(admin, req);
    return this.service.suspend(id, input, actorId, meta);
  }

  @Post(":id/activate")
  @HttpCode(200)
  @ApiOperation({ summary: "Mở khóa kích hoạt lại tài khoản" })
  activate(
    @Param("id", UuidPipe) id: string,
    @CurrentUser() admin: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    const { actorId, meta } = this.actionContext(admin, req);
    return this.service.activate(id, actorId, meta);
  }

  @Get(":id/sessions")
  @ApiOperation({
    summary:
      "Danh sách phiên đăng nhập còn hiệu lực, phân trang theo phiên đăng nhập",
  })
  sessions(
    @Param("id", UuidPipe) id: string,
    @Query() query: AdminPageQueryDto,
    @CurrentUser() admin: UserIdentity,
    @CurrentSession() current: string,
  ) {
    return this.service.sessions(id, query, admin.id, current);
  }

  @Post(":id/sessions/:sessionId/revoke")
  @HttpCode(200)
  @ApiOperation({
    summary: "Thu hồi một phiên đăng nhập kèm lý do, bao gồm các token đã xoay",
  })
  revokeSession(
    @Param("id", UuidPipe) id: string,
    @Param("sessionId", UuidPipe) sessionId: string,
    @Body() input: AdminReasonDto,
    @CurrentUser() admin: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    const { actorId, meta } = this.actionContext(admin, req);
    return this.service.revokeSession(
      id,
      sessionId,
      input.reason,
      actorId,
      meta,
    );
  }

  @Delete(":id/sessions")
  @HttpCode(200)
  @ApiOperation({
    summary: "Buộc đăng xuất toàn bộ phiên làm việc của người dùng",
  })
  revokeSessions(
    @Param("id", UuidPipe) id: string,
    @CurrentUser() admin: UserIdentity,
    @Req() req: ClientRequest,
  ) {
    const { actorId, meta } = this.actionContext(admin, req);
    return this.service.revokeSessions(id, actorId, meta);
  }
}
