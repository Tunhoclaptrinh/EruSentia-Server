import { Transform } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
export const REPORT_STORE = Symbol("REPORT_STORE");
export type Reason = "unsafe" | "copyright" | "spam" | "other";
export type ReportState = "open" | "resolved" | "dismissed";
export type Decision = "hide" | "dismiss" | "release";
export interface ReportRecord {
  id: string;
  templateId: string;
  reporterId: string;
  templateRevision: number;
  reportedTitle: string;
  reasonCode: Reason;
  description: string;
  state: ReportState;
  version: number;
  resolutionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface AuditRecord {
  id: string;
  reportId: string | null;
  templateId: string | null;
  actorId: string;
  action: Decision;
  reason: string;
  createdAt: Date;
}
const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;
export class SubmitReportDto {
  @ApiProperty({ enum: ["unsafe", "copyright", "spam", "other"] })
  @IsIn(["unsafe", "copyright", "spam", "other"])
  reasonCode!: Reason;
  @ApiProperty({ maxLength: 2000 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;
}
export class DecideReportDto {
  @ApiProperty({ enum: ["hide", "dismiss", "release"] })
  @IsIn(["hide", "dismiss", "release"])
  action!: Decision;
  @ApiProperty({
    maxLength: 2000,
    description:
      "Visible to the reporter and author; no confidential internal notes",
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  reportVersion!: number;
}
export class ReportQueryDto {
  @ApiPropertyOptional({
    default: "open",
    enum: ["open", "resolved", "dismissed", "all"],
  })
  @IsIn(["open", "resolved", "dismissed", "all"])
  state: ReportState | "all" = "open";
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 10000 })
  @Transform(({ value }) =>
    typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(10000)
  page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @Transform(({ value }) =>
    typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(50)
  size = 20;
}
export function receipt(row: ReportRecord) {
  const { reporterId, ...safe } = row;
  return safe;
}
