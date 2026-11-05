import { Controller, Get, Header } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Public } from "../auth/auth.guards";

/** Liveness only: platform probes must not keep a sleeping Neon compute awake. */
@ApiExcludeController()
@Controller("health")
export class HealthController {
  @Public()
  @Get()
  @Header("Cache-Control", "no-store")
  check() {
    return { status: "ok" };
  }
}
