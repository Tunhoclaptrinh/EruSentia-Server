import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Roles } from "../auth/auth.guards";
import { AdminSystemService } from "./admin-system.service";

@ApiTags("Admin - System")
@ApiBearerAuth()
@Roles("admin")
@Controller("admin/system")
export class AdminSystemController {
  constructor(private readonly service: AdminSystemService) {}

  @Get("overview")
  @ApiOperation({ summary: "Thống kê KPI và số liệu tổng quan toàn hệ thống" })
  getOverview() {
    return this.service.getOverview();
  }

  @Get("health")
  @ApiOperation({ summary: "Trạng thái sức khỏe hạ tầng, kết nối DB và bộ nhớ tiến trình" })
  getHealth() {
    return this.service.getHealth();
  }
}

