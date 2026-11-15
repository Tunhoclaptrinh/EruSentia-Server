import { BaseController } from "../common/controllers/base.controller";
import { AdminController } from "./admin-controller.decorator";
import { Get } from "@nestjs/common";
import { ApiOperation } from "@nestjs/swagger";
import { AdminSystemService } from "./admin-system.service";

@AdminController("system", "Admin - System")
export class AdminSystemController extends BaseController {
  constructor(private readonly service: AdminSystemService) {
    super();
  }

  @Get("overview")
  @ApiOperation({ summary: "Thống kê KPI và số liệu tổng quan toàn hệ thống" })
  getOverview() {
    return this.service.getOverview();
  }

  @Get("health")
  @ApiOperation({
    summary: "Trạng thái sức khỏe hạ tầng, kết nối DB và bộ nhớ tiến trình",
  })
  getHealth() {
    return this.service.getHealth();
  }
}
