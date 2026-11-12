import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { UuidPipe } from "../common/uuid.pipe";
import { CurrentUser } from "../auth/auth.guards";
import type { UserIdentity } from "../auth/auth-store";
import { RateLimited } from "../service-controls/service-controls";
import { TemplateFollowsService } from "./template-follows.service";
import { FollowStatusDto } from "./dto/notifications.dto";

@ApiTags("Template Follows")
@Controller("templates/:id")
export class TemplateFollowsController {
  constructor(private readonly followsService: TemplateFollowsService) {}

  @Post("follow")
  @HttpCode(200)
  @ApiBearerAuth()
  @RateLimited("write")
  @ApiOperation({ summary: "Follow a public template to receive update notifications" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ type: FollowStatusDto })
  @ApiUnauthorizedResponse({ description: "Requires authentication" })
  follow(
    @Param("id", UuidPipe) id: string,
    @CurrentUser() user: UserIdentity,
  ): Promise<FollowStatusDto> {
    return this.followsService.follow(id, user);
  }

  @Delete("follow")
  @HttpCode(200)
  @ApiBearerAuth()
  @RateLimited("write")
  @ApiOperation({ summary: "Unfollow a template" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ type: FollowStatusDto })
  @ApiUnauthorizedResponse({ description: "Requires authentication" })
  unfollow(
    @Param("id", UuidPipe) id: string,
    @CurrentUser() user: UserIdentity,
  ): Promise<FollowStatusDto> {
    return this.followsService.unfollow(id, user);
  }

  @Get("follow-status")
  @ApiOperation({ summary: "Get follow status and follower count for a template" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ type: FollowStatusDto })
  getStatus(
    @Param("id", UuidPipe) id: string,
    @CurrentUser() user?: UserIdentity,
  ): Promise<FollowStatusDto> {
    return this.followsService.getStatus(id, user);
  }
}

