import { BaseController } from "../common/controllers/base.controller";
import { AdminController } from "./admin-controller.decorator";
import { Get, Query } from "@nestjs/common";
import { ApiOperation } from "@nestjs/swagger";
import { AdminAuditLogQueryDto } from "./dto/admin.dto";
import { AdminAuditService } from "./admin-audit.service";

@AdminController("audit-logs", "Admin - Audit Logs")
export class AdminAuditController extends BaseController {
  constructor(private readonly service: AdminAuditService) {
    super();
  }

  @Get()
  @ApiOperation({
    summary: "Xem nhật ký kiểm toán toàn bộ hành động của ban quản trị",
  })
  list(@Query() query: AdminAuditLogQueryDto) {
    return this.service.list(query);
  }
}
