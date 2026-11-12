import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class FollowStatusDto {
  @ApiProperty({ description: "Whether the calling user follows this template" })
  isFollowing!: boolean;

  @ApiProperty({ description: "Total number of followers for this template" })
  followerCount!: number;
}

export class NotificationItemDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  recipientId!: string;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  actorId!: string | null;

  @ApiProperty({ example: "template.version_published" })
  type!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: Object })
  payload!: Record<string, unknown>;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  templateId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  revision!: number | null;

  @ApiProperty()
  isRead!: boolean;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiPropertyOptional({ format: "date-time", nullable: true })
  readAt!: string | null;
}

export class NotificationFeedQueryDto {
  @ApiPropertyOptional({
    description: "Cursor for fetching the next page (compound base64 timestamp and ID)",
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: "Number of items to fetch",
    default: 20,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Transform(({ value }) => (value !== undefined ? Number(value) : 20))
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}

export class NotificationFeedDto {
  @ApiProperty({ type: [NotificationItemDto] })
  items!: NotificationItemDto[];

  @ApiPropertyOptional({
    nullable: true,
    description: "Opaque cursor for retrieving the next page, or null if on the last page",
  })
  nextCursor!: string | null;

  @ApiProperty({ description: "Current count of unread notifications for this user" })
  unreadCount!: number;
}

export class UnreadCountDto {
  @ApiProperty({ description: "Total unread notifications" })
  count!: number;
}

