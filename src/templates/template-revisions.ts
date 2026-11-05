import {
  BadRequestException,
  HttpException,
  PreconditionFailedException,
} from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsInt, Max, Min } from "class-validator";
import type { TemplateRecord } from "./template-store";

export const editableFields = [
  "categoryId",
  "title",
  "slug",
  "description",
  "contentJson",
  "thumbnailUrl",
  "version",
  "isPublic",
  "tags",
] as const;
export type TemplateSnapshot = Pick<
  TemplateRecord,
  (typeof editableFields)[number]
>;
export type RevisionOperation =
  "baseline" | "create" | "update" | "delete" | "restore";
export interface TemplateRevision {
  templateId: string;
  revision: number;
  operation: RevisionOperation;
  actorId: string | null;
  createdAt: Date;
  snapshot: TemplateSnapshot;
}
export interface RevisionSummary extends Omit<TemplateRevision, "snapshot"> {
  title: string;
  version: string;
  isPublic: boolean;
}
export interface RevisionPage {
  data: RevisionSummary[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}
export function templateSnapshot(row: TemplateRecord): TemplateSnapshot {
  return structuredClone(
    Object.fromEntries(editableFields.map((key) => [key, row[key]])),
  ) as TemplateSnapshot;
}
export function templateEtag(row: Pick<TemplateRecord, "id" | "revision">) {
  return `"template:${row.id}:${row.revision}"`;
}
export function requireTemplateMatch(value: string | undefined) {
  if (value === undefined)
    throw new HttpException(
      "Read the template and send its strong ETag in If-Match",
      428,
    );
  const match =
    /^"template:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:([1-9][0-9]{0,9})"$/.exec(
      value,
    );
  if (!match || Number(match[1]) > 2147483647)
    throw new BadRequestException(
      "If-Match requires one exact strong template ETag; wildcards, lists and weak tags are not supported",
    );
  return value;
}
export function expectedRevision(id: string, tag: string) {
  const expected = Number(tag.slice(1, -1).split(":").at(-1));
  if (tag !== templateEtag({ id, revision: expected }))
    throw new PreconditionFailedException(
      "Template changed; keep your draft and reload the current revision",
    );
  return expected;
}
const integer = ({ value }: { value: unknown }) =>
  typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value;
export class RevisionsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 10000 })
  @Transform(integer)
  @IsInt()
  @Min(1)
  @Max(10000)
  page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @Transform(integer)
  @IsInt()
  @Min(1)
  @Max(50)
  size = 20;
}
export class RestoreTemplateDto {
  @ApiProperty({ type: "integer", minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  revision!: number;
}
