import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { EntityManager } from "typeorm";
import { UUID_PATTERN } from "../common/uuid.pipe";
import { ADMIN_BATCH_LIMIT } from "./dto/batch.dto";

interface LockedAccount {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
  deleted_at?: Date | null;
}
async function lockAccounts(
  manager: EntityManager,
  ids: string[],
  write: boolean,
  deletedTarget?: string,
) {
  return manager.query<LockedAccount[]>(
    `SELECT id,email,role,is_active,deleted_at FROM users WHERE id=ANY($1::uuid[]) AND (deleted_at IS NULL OR id=$2::uuid) ORDER BY id ${write ? "FOR NO KEY UPDATE" : "FOR SHARE"}`,
    [ids, deletedTarget ?? null],
  );
}
function requireAdmin(rows: LockedAccount[], actorId: string) {
  const actor = rows.find((row) => row.id === actorId);
  if (!actor || actor.role !== "admin" || !actor.is_active || actor.deleted_at)
    throw new ForbiddenException(
      "Quyền quản trị đã thay đổi. Hãy đăng nhập lại để tiếp tục.",
    );
}
/** Keep administrative authority valid until the surrounding write transaction commits. */
export async function lockAdminActor(manager: EntityManager, actorId: string) {
  requireAdmin(await lockAccounts(manager, [actorId], false), actorId);
}
/** Actor and target identities share the same deterministic order as account mutations. */
export async function lockAdminTarget(
  manager: EntityManager,
  actorId: string,
  targetId: string,
  write = false,
  includeDeletedTarget = false,
) {
  const rows = await lockAccounts(
    manager,
    [actorId, targetId],
    write,
    includeDeletedTarget ? targetId : undefined,
  );
  requireAdmin(rows, actorId);
  const target = rows.find((row) => row.id === targetId);
  if (!target) throw new NotFoundException("Không tìm thấy tài khoản");
  return target;
}
export function selectedIds(ids: string[]) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > ADMIN_BATCH_LIMIT ||
    ids.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))
  )
    throw new BadRequestException("Chọn từ 1 đến 100 mã bản ghi hợp lệ.");
  const normalized = ids.map((id) => id.toLowerCase());
  if (new Set(normalized).size !== normalized.length)
    throw new BadRequestException("Danh sách chọn có mã bị trùng.");
  return normalized.sort();
}
