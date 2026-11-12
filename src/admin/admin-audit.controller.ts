import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Roles } from "../auth/auth.guards";
import { AdminAuditLogQueryDto } from "./dto/admin.dto";
import { AdminAuditService } from "./admin-audit.service";

@ApiTags("Admin - Audit Logs")
@ApiBearerAuth()
@Roles("admin")
@Controller("admin/audit-logs")
export class AdminAuditController {
  constructor(private readonly service: AdminAuditService) {}

  @Get()
  @ApiOperation({ summary: "Xem nhật ký kiểm toán toàn bộ hành động của ban quản trị" })
  list(@Query() query: AdminAuditLogQueryDto) {
    return this.service.list(query);
  }
}

