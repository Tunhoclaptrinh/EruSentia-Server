import { HttpException } from "@nestjs/common";
import type { EntityManager } from "typeorm";
export async function lockDocumentQuota(
  manager: EntityManager,
  authorId: string,
) {
  await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "eru-document-retained:" + authorId,
  ]);
}
export async function assertDocumentRetention(
  manager: EntityManager,
  authorId: string,
) {
  const [usage] = await manager.query(
    "SELECT count(*)::int versions,COALESCE(sum(v.snapshot_bytes),0)::bigint bytes FROM community_document_versions v JOIN community_documents d ON d.id=v.document_id WHERE d.author_id=$1",
    [authorId],
  );
  if (Number(usage.bytes) > 67108864 || usage.versions > 5000)
    throw new HttpException(
      "DOCUMENT_RETAINED_QUOTA_EXCEEDED: lịch sử tài liệu đã đạt hạn mức lưu giữ; cần dọn lịch sử qua quản trị",
      429,
    );
}
