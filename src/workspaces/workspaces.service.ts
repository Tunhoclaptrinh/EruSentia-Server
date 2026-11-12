import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { createClient } from "redis";
import { randomBytes } from "node:crypto";
import type { AppConfig } from "../config";
import type { UserIdentity } from "../auth/auth-store";
import { CACHE_SETTINGS } from "../cache/template-cache";
import {
  AddResourceDto,
  CreateWorkspaceDto,
  InviteMemberDto,
  UpdateMemberRoleDto,
  UpdateWorkspaceDto,
  WorkspaceMemberItemDto,
  WorkspaceResponseDto,
  WorkspaceRole,
} from "./dto/workspace.dto";

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  owner_id: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface MemberRow {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  created_at: Date;
  email?: string;
}

@Injectable()
export class WorkspacesService implements OnModuleInit, OnModuleDestroy {
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

  private permCacheKey(workspaceId: string, userId: string): string {
    return `eru:ws_perm:${workspaceId}:${userId}`;
  }

  private async getCachedRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
    if (this.redis?.isOpen) {
      const cached = await this.redis.get(this.permCacheKey(workspaceId, userId)).catch(() => null);
      if (cached === "owner" || cached === "editor" || cached === "viewer") {
        return cached;
      }
    }
    return null;
  }

  private async setCachedRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void> {
    if (this.redis?.isOpen) {
      await this.redis.set(this.permCacheKey(workspaceId, userId), role, { EX: 600 }).catch(() => {});
    }
  }

  private async invalidateCachedRole(workspaceId: string, userId: string): Promise<void> {
    if (this.redis?.isOpen) {
      await this.redis.del(this.permCacheKey(workspaceId, userId)).catch(() => {});
    }
  }

  async resolveRole(workspaceId: string, user: UserIdentity): Promise<WorkspaceRole> {
    if (!this.db) throw new NotFoundException("Workspace not found");

    const cached = await this.getCachedRole(workspaceId, user.id);
    if (cached) return cached;

    const res = await this.db.query<MemberRow[]>(
      "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, user.id],
    );
    if (!res.length) {
      throw new ForbiddenException("You are not a member of this workspace");
    }

    const role = res[0].role;
    await this.setCachedRole(workspaceId, user.id, role);
    return role;
  }

  async requireRole(workspaceId: string, user: UserIdentity, allowed: WorkspaceRole[]): Promise<WorkspaceRole> {
    const role = await this.resolveRole(workspaceId, user);
    if (!allowed.includes(role)) {
      throw new ForbiddenException(
        `Action requires one of roles [${allowed.join(", ")}], but you have role [${role}]`,
      );
    }
    return role;
  }

  async create(input: CreateWorkspaceDto, user: UserIdentity): Promise<WorkspaceResponseDto> {
    if (!this.db) throw new BadRequestException("Database not available");

    return this.db.transaction(async (manager) => {
      // Check slug uniqueness
      const existing = await manager.query(
        "SELECT 1 FROM workspaces WHERE slug = $1 AND deleted_at IS NULL",
        [input.slug],
      );
      if (existing.length) {
        throw new ConflictException("Workspace slug already exists");
      }

      // Create workspace
      const [ws] = await manager.query<WorkspaceRow[]>(
        `INSERT INTO workspaces (name, slug, description, owner_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, slug, description, owner_id, created_at`,
        [input.name, input.slug, input.description ?? null, user.id],
      );

      // Add creator as owner
      await manager.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [ws.id, user.id],
      );

      // Audit log
      await manager.query(
        `INSERT INTO workspace_audit_logs (workspace_id, actor_id, action, details)
         VALUES ($1, $2, 'workspace.created', $3::jsonb)`,
        [ws.id, user.id, JSON.stringify({ name: ws.name, slug: ws.slug })],
      );

      await this.setCachedRole(ws.id, user.id, "owner");

      return {
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        description: ws.description,
        ownerId: ws.owner_id,
        currentUserRole: "owner",
        membersCount: 1,
        createdAt: ws.created_at.toISOString(),
      };
    });
  }

  async list(user: UserIdentity): Promise<WorkspaceResponseDto[]> {
    if (!this.db) return [];

    const rows = await this.db.query<
      (WorkspaceRow & { role: WorkspaceRole; members_count: string })[]
    >(
      `SELECT w.id, w.name, w.slug, w.description, w.owner_id, w.created_at,
              m.role,
              (SELECT count(*)::int FROM workspace_members wm WHERE wm.workspace_id = w.id) AS members_count
       FROM workspaces w
       INNER JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $1
       WHERE w.deleted_at IS NULL
       ORDER BY w.created_at DESC`,
      [user.id],
    );

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      ownerId: r.owner_id,
      currentUserRole: r.role,
      membersCount: Number(r.members_count),
      createdAt: r.created_at.toISOString(),
    }));
  }

  async get(workspaceId: string, user: UserIdentity): Promise<WorkspaceResponseDto> {
    if (!this.db) throw new NotFoundException("Workspace not found");

    const role = await this.resolveRole(workspaceId, user);
    const rows = await this.db.query<
      (WorkspaceRow & { members_count: string })[]
    >(
      `SELECT w.id, w.name, w.slug, w.description, w.owner_id, w.created_at,
              (SELECT count(*)::int FROM workspace_members wm WHERE wm.workspace_id = w.id) AS members_count
       FROM workspaces w
       WHERE w.id = $1 AND w.deleted_at IS NULL`,
      [workspaceId],
    );

    if (!rows.length) throw new NotFoundException("Workspace not found");
    const r = rows[0];

    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      ownerId: r.owner_id,
      currentUserRole: role,
      membersCount: Number(r.members_count),
      createdAt: r.created_at.toISOString(),
    };
  }

  async update(workspaceId: string, input: UpdateWorkspaceDto, user: UserIdentity): Promise<WorkspaceResponseDto> {
    await this.requireRole(workspaceId, user, ["owner"]);
    if (!this.db) throw new NotFoundException("Workspace not found");

    const sets: string[] = [];
    const params: unknown[] = [workspaceId];

    if (input.name !== undefined) {
      params.push(input.name);
      sets.push(`name = $${params.length}`);
    }
    if (input.description !== undefined) {
      params.push(input.description);
      sets.push(`description = $${params.length}`);
    }

    if (sets.length > 0) {
      sets.push("updated_at = CURRENT_TIMESTAMP");
      await this.db.query(
        `UPDATE workspaces SET ${sets.join(", ")} WHERE id = $1 AND deleted_at IS NULL`,
        params,
      );
    }

    return this.get(workspaceId, user);
  }

  async delete(workspaceId: string, user: UserIdentity): Promise<void> {
    await this.requireRole(workspaceId, user, ["owner"]);
    if (!this.db) return;

    await this.db.query(
      "UPDATE workspaces SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND deleted_at IS NULL",
      [workspaceId],
    );
  }

  async listMembers(workspaceId: string, user: UserIdentity): Promise<WorkspaceMemberItemDto[]> {
    await this.resolveRole(workspaceId, user);
    if (!this.db) return [];

    const rows = await this.db.query<(MemberRow & { email: string })[]>(
      `SELECT m.user_id, m.role, m.created_at, u.email
       FROM workspace_members m
       INNER JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = $1
       ORDER BY m.created_at ASC`,
      [workspaceId],
    );

    return rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      role: r.role,
      joinedAt: r.created_at.toISOString(),
    }));
  }

  // -------------------------------------------------------------
  // THE LAST OWNER PROBLEM: Concurrency Lock via SELECT ... FOR UPDATE
  // -------------------------------------------------------------
  async updateMemberRole(
    workspaceId: string,
    targetUserId: string,
    input: UpdateMemberRoleDto,
    actor: UserIdentity,
  ): Promise<void> {
    await this.requireRole(workspaceId, actor, ["owner"]);
    if (!this.db) return;

    await this.db.transaction(async (manager) => {
      // PESSIMISTIC LOCK: Lock all owner rows to serialize concurrent requests
      const owners = await manager.query<{ user_id: string }[]>(
        "SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND role = 'owner' FOR UPDATE",
        [workspaceId],
      );

      const target = await manager.query<MemberRow[]>(
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE",
        [workspaceId, targetUserId],
      );
      if (!target.length) throw new NotFoundException("Member not found in this workspace");

      const currentRole = target[0].role;

      // CONCURRENCY CHOKING POINT: Prevent demoting the last owner
      if (currentRole === "owner" && input.role !== "owner") {
        if (owners.length <= 1) {
          throw new ConflictException(
            "Cannot demote the last remaining owner of the workspace. Promote another member to owner first.",
          );
        }
      }

      await manager.query(
        "UPDATE workspace_members SET role = $3, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = $1 AND user_id = $2",
        [workspaceId, targetUserId, input.role],
      );

      await manager.query(
        `INSERT INTO workspace_audit_logs (workspace_id, actor_id, target_id, action, details)
         VALUES ($1, $2, $3, 'role.changed', $4::jsonb)`,
        [workspaceId, actor.id, targetUserId, JSON.stringify({ oldRole: currentRole, newRole: input.role })],
      );

      await this.invalidateCachedRole(workspaceId, targetUserId);
    });
  }

  async removeMember(workspaceId: string, targetUserId: string, actor: UserIdentity): Promise<void> {
    const actorRole = await this.resolveRole(workspaceId, actor);
    const isSelf = targetUserId === actor.id;

    if (!isSelf && actorRole !== "owner") {
      throw new ForbiddenException("Only workspace owners can remove other members");
    }

    if (!this.db) return;

    await this.db.transaction(async (manager) => {
      // PESSIMISTIC LOCK: Lock all owner rows
      const owners = await manager.query<{ user_id: string }[]>(
        "SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND role = 'owner' FOR UPDATE",
        [workspaceId],
      );

      const target = await manager.query<MemberRow[]>(
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE",
        [workspaceId, targetUserId],
      );
      if (!target.length) throw new NotFoundException("Member not found in this workspace");

      const targetRole = target[0].role;

      // CONCURRENCY CHOKING POINT: Prevent removing the last owner
      if (targetRole === "owner") {
        if (owners.length <= 1) {
          throw new ConflictException(
            "Cannot remove the last remaining owner of the workspace. Transfer ownership or add another owner first.",
          );
        }
      }

      await manager.query(
        "DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
        [workspaceId, targetUserId],
      );

      await manager.query(
        `INSERT INTO workspace_audit_logs (workspace_id, actor_id, target_id, action, details)
         VALUES ($1, $2, $3, 'member.removed', $4::jsonb)`,
        [workspaceId, actor.id, targetUserId, JSON.stringify({ role: targetRole, isSelf })],
      );

      await this.invalidateCachedRole(workspaceId, targetUserId);
    });
  }

  // -------------------------------------------------------------
  // INVITATIONS
  // -------------------------------------------------------------
  async createInvite(workspaceId: string, input: InviteMemberDto, actor: UserIdentity) {
    await this.requireRole(workspaceId, actor, ["owner"]);
    if (!this.db) throw new BadRequestException("Database not available");

    const token = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.db.query(
      `INSERT INTO workspace_invites (workspace_id, invited_by, email, role, token, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [workspaceId, actor.id, input.email, input.role, token, expiresAt],
    );

    return { token, email: input.email, role: input.role, expiresAt: expiresAt.toISOString() };
  }

  async acceptInvite(token: string, user: UserIdentity) {
    if (!this.db) throw new BadRequestException("Database not available");

    return this.db.transaction(async (manager) => {
      const invites = await manager.query<
        { id: string; workspace_id: string; email: string; role: WorkspaceRole; expires_at: Date; accepted_at: Date | null }[]
      >(
        "SELECT i.id, i.workspace_id, i.email, i.role, i.expires_at, i.accepted_at FROM workspace_invites i INNER JOIN workspaces w ON w.id = i.workspace_id WHERE i.token = $1 AND w.deleted_at IS NULL FOR UPDATE OF i",
        [token],
      );
      if (!invites.length) throw new NotFoundException("Invalid or nonexistent invitation token");

      const invite = invites[0];
      if (invite.accepted_at) throw new ConflictException("Invitation has already been used");
      if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
        throw new ForbiddenException("Invitation belongs to another email address");
      }
      if (new Date() > invite.expires_at) throw new BadRequestException("Invitation token has expired");

      // An invitation must never downgrade an existing member, especially the last owner.
      await manager.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [invite.workspace_id, user.id, invite.role],
      );

      await manager.query(
        "UPDATE workspace_invites SET accepted_at = CURRENT_TIMESTAMP, accepted_by = $2 WHERE id = $1",
        [invite.id, user.id],
      );

      await this.invalidateCachedRole(invite.workspace_id, user.id);
      return { success: true, workspaceId: invite.workspace_id, role: invite.role };
    });
  }

  // -------------------------------------------------------------
  // RESOURCE SHARING
  // -------------------------------------------------------------
  async shareTemplate(workspaceId: string, input: AddResourceDto, actor: UserIdentity) {
    // Only owner or editor can share template to workspace
    await this.requireRole(workspaceId, actor, ["owner", "editor"]);
    if (!this.db) return;

    await this.db.query(
      `INSERT INTO workspace_resources (workspace_id, template_id, added_by, permission)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, template_id) DO UPDATE SET permission = EXCLUDED.permission`,
      [workspaceId, input.templateId, actor.id, input.permission ?? "read_write"],
    );
    return { success: true };
  }

  async listResources(workspaceId: string, user: UserIdentity) {
    await this.resolveRole(workspaceId, user);
    if (!this.db) return [];

    const rows = await this.db.query(
      `SELECT r.template_id, r.permission, r.created_at,
              t.title, t.version, t.is_public
       FROM workspace_resources r
       INNER JOIN templates t ON t.id = r.template_id
       WHERE r.workspace_id = $1 AND t.deleted_at IS NULL
       ORDER BY r.created_at DESC`,
      [workspaceId],
    );
    return rows;
  }
}
