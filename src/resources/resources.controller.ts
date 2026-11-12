import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { ServerResponse } from "node:http";
import type { UserIdentity } from "../auth/auth-store";
import { CurrentUser, Roles } from "../auth/auth.guards";
import { UuidPipe } from "../common/uuid.pipe";
import { RateLimited } from "../service-controls/service-controls";
import { ResourcesService } from "./resources.service";
import {
  ResourceDocumentDto,
  ResourceGrantDto,
  ResourcePlanDto,
  ResourceRequestDto,
} from "./resource.dto";
@ApiTags("Hosted resources")
@ApiBearerAuth()
@Controller("resource-gateway")
export class ResourceGatewayController {
  constructor(private readonly service: ResourcesService) {}
  @Get("me")
  @ApiOperation({
    summary:
      "Current resource-service identity, plan, quota and allowed targets",
  })
  me(@CurrentUser() user: UserIdentity) {
    return this.service.me(user);
  }
  @Post("requests")
  @HttpCode(200)
  @RateLimited("write")
  @ApiOperation({
    summary: "Authenticated, quota-limited relay to an approved public API",
  })
  async request(
    @Body() body: ResourceRequestDto,
    @CurrentUser() user: UserIdentity,
    @Res({ passthrough: true }) response: ServerResponse,
  ) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    response.on("close", abort);
    try {
      return await this.service.request(user, body, controller.signal);
    } finally {
      response.removeListener("close", abort);
    }
  }
}
@ApiTags("Protected resource documents")
@ApiBearerAuth()
@Controller("resource-documents")
export class ResourceDocumentsController {
  constructor(private readonly service: ResourcesService) {}
  @Post() @RateLimited("write") create(
    @Body() body: ResourceDocumentDto,
    @CurrentUser() user: UserIdentity,
  ) {
    return this.service.create(body, user);
  }
  @Get() list(@CurrentUser() user: UserIdentity) {
    return this.service.list(user);
  }
  @Get(":id")
  @ApiOperation({
    summary:
      "Read authorized HTML as JSON; user-authored scripts never execute on the API origin",
  })
  read(@Param("id", UuidPipe) id: string, @CurrentUser() user: UserIdentity) {
    return this.service.read(id, user);
  }
  @Get(":id/access-events") events(
    @Param("id", UuidPipe) id: string,
    @CurrentUser() user: UserIdentity,
  ) {
    return this.service.events(id, user);
  }
  @Get(":id/grants") grants(
    @Param("id", UuidPipe) id: string,
    @CurrentUser() user: UserIdentity,
  ) {
    return this.service.grants(id, user);
  }
  @Post(":id/grants") @RateLimited("write") grant(
    @Param("id", UuidPipe) id: string,
    @Body() body: ResourceGrantDto,
    @CurrentUser() user: UserIdentity,
  ) {
    return this.service.grant(id, body.userId, user);
  }
  @Delete(":id/grants/:userId") @HttpCode(204) @RateLimited("write") revoke(
    @Param("id", UuidPipe) id: string,
    @Param("userId", UuidPipe) userId: string,
    @CurrentUser() user: UserIdentity,
  ) {
    return this.service.revoke(id, userId, user);
  }
  @Delete(":id") @HttpCode(204) @RateLimited("write") remove(
    @Param("id", UuidPipe) id: string,
    @CurrentUser() user: UserIdentity,
  ) {
    return this.service.remove(id, user);
  }
}
@ApiTags("Resource plans")
@ApiBearerAuth()
@Roles("admin")
@Controller("admin/resource-plans")
export class ResourcePlansController {
  constructor(private readonly service: ResourcesService) {}
  @Patch(":userId") @RateLimited("write") update(
    @Param("userId", UuidPipe) id: string,
    @Body() body: ResourcePlanDto,
    @CurrentUser() user: UserIdentity,
  ) {
    return this.service.updatePlan(id, body, user);
  }
}
