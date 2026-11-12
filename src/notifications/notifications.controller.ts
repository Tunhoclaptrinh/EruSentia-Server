import {
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
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
import { NotificationsService } from "./notifications.service";
import {
  NotificationFeedDto,
  NotificationFeedQueryDto,
  UnreadCountDto,
} from "./dto/notifications.dto";

@ApiTags("Notifications")
@Controller("notifications")
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: "Requires authentication" })
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: "Get notification feed with cursor-based pagination",
    description: "Returns notifications ordered newest first. Supply nextCursor to fetch the next page.",
  })
  @ApiOkResponse({ type: NotificationFeedDto })
  getFeed(
    @CurrentUser() user: UserIdentity,
    @Query() query: NotificationFeedQueryDto,
  ): Promise<NotificationFeedDto> {
    return this.notificationsService.getFeed(user, query);
  }

  @Get("unread-count")
  @ApiOperation({ summary: "Get current count of unread notifications (cached with Redis)" })
  @ApiOkResponse({ type: UnreadCountDto })
  getUnreadCount(@CurrentUser() user: UserIdentity): Promise<UnreadCountDto> {
    return this.notificationsService.getUnreadCount(user);
  }

  @Patch(":id/read")
  @HttpCode(204)
  @RateLimited("write")
  @ApiOperation({ summary: "Mark a single notification as read" })
  @ApiParam({ name: "id", format: "uuid" })
  markAsRead(
    @Param("id", UuidPipe) id: string,
    @CurrentUser() user: UserIdentity,
  ): Promise<void> {
    return this.notificationsService.markAsRead(id, user);
  }

  @Post("read-all")
  @HttpCode(204)
  @RateLimited("write")
  @ApiOperation({ summary: "Mark all notifications as read for current user" })
  markAllAsRead(@CurrentUser() user: UserIdentity): Promise<void> {
    return this.notificationsService.markAllAsRead(user);
  }
}

