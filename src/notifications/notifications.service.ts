import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { createClient } from "redis";
import type { AppConfig } from "../config";
import type { UserIdentity } from "../auth/auth-store";
import {
  NotificationFeedDto,
  NotificationFeedQueryDto,
  NotificationItemDto,
  UnreadCountDto,
} from "./dto/notifications.dto";
import { CACHE_SETTINGS } from "../cache/template-cache";

interface NotificationRow {
  id: string;
  recipient_id: string;
  actor_id: string | null;
  type: string;
  title: string;
  payload: Record<string, unknown>;
  template_id: string | null;
  revision: number | null;
  is_read: boolean;
  created_at: Date;
  read_at: Date | null;
}

function encodeCursor(date: Date, id: string): string {
  return Buffer.from(`${date.toISOString()}:${id}`).toString("base64");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const raw = Buffer.from(cursor, "base64").toString("utf8");
    const lastColon = raw.lastIndexOf(":");
    if (lastColon <= 0) throw new Error("Invalid cursor format");
    const dateStr = raw.slice(0, lastColon);
    const id = raw.slice(lastColon + 1);
    const createdAt = new Date(dateStr);
    if (isNaN(createdAt.getTime()) || !id) {
      throw new Error("Invalid cursor values");
    }
    return { createdAt, id };
  } catch {
    throw new BadRequestException("Malformed or invalid pagination cursor");
  }
}

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  readonly redis?: ReturnType<typeof createClient>;

  constructor(
    @Inject(CACHE_SETTINGS) private readonly cacheSettings: AppConfig["cache"],
    @Optional() private readonly db?: DataSource,
  ) {
    if (this.cacheSettings.enabled) {
      this.redis = createClient({
        url: this.cacheSettings.url,
        disableOfflineQueue: true,
        commandsQueueMaxLength: 100,
        socket: {
          connectTimeout: 250,
          reconnectStrategy: (retries) => Math.min(100 + retries * 100, 1000),
        },
      });
      this.redis.on("error", () => {});
    }
  }

  async onModuleInit() {
    if (this.redis) {
      await this.redis.connect().catch(() => {});
    }
  }

  onModuleDestroy() {
    if (this.redis?.isOpen) {
      this.redis.destroy();
    }
  }

  private redisKey(userId: string): string {
    return `eru:unread_count:${userId}`;
  }

  async getFeed(
    user: UserIdentity,
    query: NotificationFeedQueryDto,
  ): Promise<NotificationFeedDto> {
    if (!this.db) {
      return { items: [], nextCursor: null, unreadCount: 0 };
    }

    const limit = query.limit ?? 20;
    const fetchLimit = limit + 1;

    let rows: NotificationRow[] = [];

    if (query.cursor) {
      const { createdAt, id } = decodeCursor(query.cursor);
      rows = await this.db.query<NotificationRow[]>(
        `SELECT id, recipient_id, actor_id, type, title, payload, template_id, revision, is_read, created_at, read_at
         FROM notifications
         WHERE recipient_id = $1
           AND (created_at < $2 OR (created_at = $2 AND id < $3))
         ORDER BY created_at DESC, id DESC
         LIMIT $4`,
        [user.id, createdAt, id, fetchLimit],
      );
    } else {
      rows = await this.db.query<NotificationRow[]>(
        `SELECT id, recipient_id, actor_id, type, title, payload, template_id, revision, is_read, created_at, read_at
         FROM notifications
         WHERE recipient_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2`,
        [user.id, fetchLimit],
      );
    }

    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const hasMoreRows = rows.slice(0, limit);
      const lastItem = hasMoreRows[hasMoreRows.length - 1];
      nextCursor = encodeCursor(lastItem.created_at, lastItem.id);
      rows = hasMoreRows;
    }

    const items: NotificationItemDto[] = rows.map((r) => ({
      id: r.id,
      recipientId: r.recipient_id,
      actorId: r.actor_id,
      type: r.type,
      title: r.title,
      payload: r.payload,
      templateId: r.template_id,
      revision: r.revision,
      isRead: r.is_read,
      createdAt: r.created_at.toISOString(),
      readAt: r.read_at ? r.read_at.toISOString() : null,
    }));

    const { count: unreadCount } = await this.getUnreadCount(user);

    return { items, nextCursor, unreadCount };
  }

  async getUnreadCount(user: UserIdentity): Promise<UnreadCountDto> {
    if (this.redis?.isOpen) {
      const cached = await this.redis.get(this.redisKey(user.id)).catch(() => null);
      if (cached !== null) {
        return { count: Math.max(0, Number(cached)) };
      }
    }

    if (!this.db) {
      return { count: 0 };
    }

    const res = await this.db.query<{ count: string }[]>(
      "SELECT count(*)::int AS count FROM notifications WHERE recipient_id = $1 AND is_read = FALSE",
      [user.id],
    );
    const count = res[0] ? Number(res[0].count) : 0;

    if (this.redis?.isOpen) {
      await this.redis
        .set(this.redisKey(user.id), count.toString(), { EX: 3600 })
        .catch(() => {});
    }

    return { count };
  }

  async markAsRead(id: string, user: UserIdentity): Promise<void> {
    if (!this.db) return;

    const res = await this.db.query(
      "UPDATE notifications SET is_read = TRUE, read_at = CURRENT_TIMESTAMP WHERE id = $1 AND recipient_id = $2 AND is_read = FALSE",
      [id, user.id],
    );

    if (res.rowCount && res.rowCount > 0 && this.redis?.isOpen) {
      const remaining = await this.redis.decr(this.redisKey(user.id)).catch(() => null);
      if (remaining !== null && remaining < 0) {
        await this.redis.set(this.redisKey(user.id), "0").catch(() => {});
      }
    }
  }

  async markAllAsRead(user: UserIdentity): Promise<void> {
    if (!this.db) return;

    await this.db.query(
      "UPDATE notifications SET is_read = TRUE, read_at = CURRENT_TIMESTAMP WHERE recipient_id = $1 AND is_read = FALSE",
      [user.id],
    );

    if (this.redis?.isOpen) {
      await this.redis.set(this.redisKey(user.id), "0", { EX: 3600 }).catch(() => {});
    }
  }
}
