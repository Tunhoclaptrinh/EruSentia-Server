import type { EntityManager } from "typeorm";

export interface LogAdminActionParams {
  actorId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

/** One SQL writer, always supplied with the caller's transaction manager. */
export async function recordAdminAction(
  manager: Pick<EntityManager, "query">,
  params: LogAdminActionParams,
): Promise<void> {
  return recordAdminActions(manager, [params]);
}
export async function recordAdminActions(
  manager: Pick<EntityManager, "query">,
  entries: LogAdminActionParams[],
): Promise<void> {
  if (!entries.length) return;
  await manager.query(
    `INSERT INTO admin_audit_logs(actor_id,action,target_type,target_id,ip_address,user_agent,reason,metadata,created_at)
    SELECT "actorId",action,"targetType","targetId","ipAddress","userAgent",reason,COALESCE(metadata,'{}'::jsonb),now()
    FROM jsonb_to_recordset($1::jsonb) AS x("actorId" uuid,action text,"targetType" text,"targetId" text,"ipAddress" text,"userAgent" text,reason text,metadata jsonb)`,
    [JSON.stringify(entries)],
  );
}
