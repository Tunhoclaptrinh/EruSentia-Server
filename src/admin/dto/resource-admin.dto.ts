import { ApiProperty, ApiPropertyOptional, OmitType } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsIn,
  IsISO8601,
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from "class-validator";
import {
  SearchPageQueryDto,
  present,
  trimText,
} from "../../common/dto/pagination.dto";
import { UUID_PATTERN } from "../../common/uuid.pipe";
import { ResourcePlanDto } from "../../resources/resource.dto";
import { AdminVersionReasonDto } from "./lifecycle.dto";
export class AdminResourceQueryDto extends SearchPageQueryDto {
  @ApiPropertyOptional()
  @ValidateIf(present)
  @IsIn(["active", "trash", "all"])
  status?: "active" | "trash" | "all";
  @ApiPropertyOptional()
  @ValidateIf(present)
  @Matches(UUID_PATTERN)
  ownerId?: string;
  @ApiPropertyOptional()
  @ValidateIf(present)
  @IsIn(["private", "shared", "premium"])
  access?: string;
  @ApiPropertyOptional()
  @ValidateIf(present)
  @IsIn(["free", "premium", "blocked"])
  plan?: string;
}
export class AdminResourcePlanDto extends OmitType(ResourcePlanDto, [
  "reason",
  "revision",
] as const) {
  @ApiProperty()
  @Transform(trimText)
  @IsString()
  @Length(1, 1000)
  reason!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(2147483647) revision!: number;
}
export class AdminResourceActionDto extends AdminVersionReasonDto {
  @ApiProperty({
    enum: ["update", "grant", "revoke", "trash", "restore", "purge"],
  })
  @IsIn(["update", "grant", "revoke", "trash", "restore", "purge"])
  action!: "update" | "grant" | "revoke" | "trash" | "restore" | "purge";
  @ApiPropertyOptional()
  @ValidateIf((o) => o.action === "update")
  @Transform(trimText)
  @IsString()
  @Length(1, 160)
  title?: string;
  @ApiPropertyOptional()
  @ValidateIf((o) => o.action === "update")
  @IsIn(["private", "shared", "premium"])
  access?: string;
  @ApiPropertyOptional()
  @ValidateIf((o) => ["grant", "revoke"].includes(o.action))
  @Matches(UUID_PATTERN)
  userId?: string;
  @ApiPropertyOptional()
  @ValidateIf((o) => o.action === "purge")
  @IsString()
  @Length(1, 160)
  confirmTitle?: string;
  @ApiPropertyOptional()
  @ValidateIf((o) => o.action === "purge")
  @IsString()
  @Length(1, 128)
  password?: string;
}

export class AdminRetentionPreviewDto {
  @ApiProperty() @Matches(UUID_PATTERN) ownerId!: string;
}
export class AdminRetentionCommitDto extends AdminRetentionPreviewDto {
  @ApiProperty() @IsISO8601({ strict: true }) cutoff!: string;
  @ApiProperty() @Matches(/^[a-f0-9]{64}$/) previewToken!: string;
  @ApiProperty() @IsString() @Length(1, 128) password!: string;
  @ApiProperty() @IsIn(["XÓA VĨNH VIỄN"]) confirmText!: string;
  @ApiProperty()
  @Transform(trimText)
  @IsString()
  @Length(1, 1000)
  reason!: string;
}
