import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  NotFoundException,
} from "@nestjs/common";
import { createClient } from "redis";
import { DataSource } from "typeorm";
import { setTimeout as delay } from "node:timers/promises";
import type { AppConfig } from "../config";
import type { UserIdentity } from "../auth/auth-store";
import type { TemplateRecord } from "../templates/template-store";

export const CACHE_SETTINGS = Symbol("cache-settings");
export type CacheStatus =
  | "HIT"
  | "MISS"
  | "COALESCED"
  | "BYPASS_DISABLED"
  | "BYPASS_PRIVATE"
  | "BYPASS_REDIS";
export interface CacheStamp {
  revision: string;
  authorId: string;
  isPublic: boolean;
}
export function canRead(
  row: { authorId: string; isPublic: boolean },
  viewer: UserIdentity,
) {
  return row.isPublic || row.authorId === viewer.id || viewer.role === "admin";
}
export function cacheTtl(base: number, random = Math.random()) {
  return base + Math.floor(base * 0.2 * random);
}

@Injectable()
export class TemplateCache implements OnModuleInit, OnModuleDestroy {
  readonly client: ReturnType<typeof createClient>;
  private readonly pending = new Map<string, Promise<TemplateRecord | null>>();
  constructor(
    @Inject(CACHE_SETTINGS) readonly settings: AppConfig["cache"],
    @Optional() private readonly database?: DataSource,
  ) {
    this.client = createClient({
      url: settings.url,
      disableOfflineQueue: true,
      commandsQueueMaxLength: 100,
      socket: {
        connectTimeout: 250,
        reconnectStrategy: (retries) => Math.min(100 + retries * 100, 1000),
      },
    });
    this.client.on("error", () => {}); // Fail open without logging a Redis URL/credential.
  }
  async onModuleInit() {
    if (this.settings.enabled)
      await Promise.race([this.client.connect().catch(() => {}), delay(300)]);
  }
  onModuleDestroy() {
    if (this.client.isOpen) this.client.destroy();
  }
  key(id: string, revision: string) {
    return `${this.settings.namespace}:template:v1:${id}:${revision}`;
  }
  async stamp(id: string): Promise<CacheStamp | null> {
    if (!this.settings.enabled) return null;
    const rows = await this.database!.query(
      'SELECT cache_revision AS revision, author_id AS "authorId", is_public AS "isPublic" FROM templates WHERE id=$1 AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ?? null;
  }
  async invalidate(id: string, stamp: CacheStamp | null) {
    if (!stamp || !this.client.isReady) return;
    try {
      await this.client
        .withAbortSignal(AbortSignal.timeout(200))
        .del(this.key(id, stamp.revision));
    } catch {}
  }
  private visible(row: TemplateRecord | null, viewer: UserIdentity) {
    if (!row || !canRead(row, viewer))
      throw new NotFoundException("Template not found");
    return row;
  }
  async read(
    id: string,
    viewer: UserIdentity,
    load: () => Promise<TemplateRecord | null>,
  ): Promise<{ row: TemplateRecord; status: CacheStatus }> {
    if (!this.settings.enabled)
      return {
        row: this.visible(await load(), viewer),
        status: "BYPASS_DISABLED",
      };
    // Always consult current DB visibility/revision before using a public cache entry.
    const stamp = await this.stamp(id);
    if (!stamp || !canRead(stamp, viewer))
      throw new NotFoundException("Template not found");
    if (!stamp.isPublic)
      return {
        row: this.visible(await load(), viewer),
        status: "BYPASS_PRIVATE",
      };
    if (!this.client.isReady)
      return {
        row: this.visible(await load(), viewer),
        status: "BYPASS_REDIS",
      };
    const key = this.key(id, stamp.revision);
    try {
      const raw = await this.client
        .withAbortSignal(AbortSignal.timeout(200))
        .get(key);
      if (raw) {
        try {
          return { row: decodeRecord(raw, id, stamp), status: "HIT" };
        } catch {
          await this.client.withAbortSignal(AbortSignal.timeout(200)).del(key);
        }
      }
    } catch {
      return {
        row: this.visible(await load(), viewer),
        status: "BYPASS_REDIS",
      };
    }
    const existing = this.pending.get(key);
    if (existing)
      return { row: this.visible(await existing, viewer), status: "COALESCED" };
    const task = (async () => {
      const row = await load();
      // A write may have happened between the stamp and the full fetch. Recheck before filling.
      const after = await this.stamp(id);
      if (
        row &&
        row.isPublic &&
        after?.revision === stamp.revision &&
        after.isPublic
      ) {
        try {
          await this.client
            .withAbortSignal(AbortSignal.timeout(200))
            .set(key, JSON.stringify({ revision: stamp.revision, row }), {
              EX: cacheTtl(this.settings.ttlSeconds),
            });
        } catch {}
      }
      return row;
    })();
    this.pending.set(key, task);
    try {
      return { row: this.visible(await task, viewer), status: "MISS" };
    } finally {
      this.pending.delete(key);
    }
  }
}

function decodeRecord(
  raw: string,
  id: string,
  stamp: CacheStamp,
): TemplateRecord {
  const value = JSON.parse(raw),
    row = value?.row;
  const fields =
    "id authorId categoryId title slug description contentJson thumbnailUrl version isPublic tags viewsCount forksCount ratingAvg ratingsCount isFeatured createdAt updatedAt deletedAt author category".split(
      " ",
    );
  if (
    value.revision !== stamp.revision ||
    !row ||
    Object.keys(row).sort().join() !== fields.sort().join() ||
    row.id !== id ||
    row.authorId !== stamp.authorId ||
    row.isPublic !== true ||
    !["categoryId", "title", "slug", "description", "version"].every(
      (k) => typeof row[k] === "string",
    ) ||
    !["viewsCount", "forksCount", "ratingAvg", "ratingsCount"].every(
      (k) => typeof row[k] === "number" && Number.isFinite(row[k]),
    ) ||
    typeof row.isFeatured !== "boolean" ||
    !(row.thumbnailUrl === null || typeof row.thumbnailUrl === "string") ||
    !Array.isArray(row.tags) ||
    !row.tags.every((t: unknown) => typeof t === "string") ||
    !row.contentJson ||
    typeof row.contentJson !== "object" ||
    Array.isArray(row.contentJson) ||
    !row.author ||
    Object.keys(row.author).join() !== "id" ||
    row.author.id !== stamp.authorId ||
    !row.category ||
    Object.keys(row.category).sort().join() !== "id,name,slug" ||
    row.category.id !== row.categoryId ||
    typeof row.category.name !== "string" ||
    typeof row.category.slug !== "string" ||
    row.deletedAt !== null ||
    ![row.createdAt, row.updatedAt].every(
      (v) => typeof v === "string" && Number.isFinite(Date.parse(v)),
    )
  )
    throw new Error("CORRUPT_CACHE");
  return {
    ...row,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
