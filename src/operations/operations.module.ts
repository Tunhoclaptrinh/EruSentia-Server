import { Controller, Get, Module, Optional } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { DataSource } from "typeorm";
import { Roles } from "../auth/auth.guards";
import { ApiOperations } from "./api-operations";
@ApiTags("Operations")
@ApiBearerAuth()
@Controller("admin/operations")
@Roles("admin")
class OperationsController {
  constructor(
    private readonly metrics: ApiOperations,
    @Optional() private readonly database?: DataSource,
  ) {}
  @Get()
  @ApiOperation({
    summary:
      "Read bounded process metrics and on-demand database readiness; no user data or raw diagnostics",
  })
  async read() {
    let database: "not-configured" | "ready" | "unavailable" = this.database
      ? "unavailable"
      : "not-configured";
    if (this.database)
      try {
        await this.database.query("SELECT 1");
        database = "ready";
      } catch {}
    return { ...this.metrics.snapshot(), database };
  }
}
@Module({
  providers: [ApiOperations],
  controllers: [OperationsController],
  exports: [ApiOperations],
})
export class OperationsModule {}
