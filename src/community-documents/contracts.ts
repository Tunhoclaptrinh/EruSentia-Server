import {
  PaginationQueryDto,
  trimText as trim,
  integerQuery as integer,
  present as optional,
} from "../common/dto/pagination.dto";
import { UUID_PATTERN } from "../common/uuid.pipe";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  Equals,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";

export const documentStates = [
  "draft",
  "pending",
  "changes_requested",
  "published",
  "archived",
] as const;
export type DocumentState = (typeof documentStates)[number];

export class DocumentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  search?: string;
  @ApiPropertyOptional({ enum: [...documentStates, "all"] })
  @ValidateIf(optional)
  @IsIn([...documentStates, "all"])
  status?: DocumentState | "all";
  @ApiPropertyOptional()
  @ValidateIf(optional)
  @Matches(UUID_PATTERN)
  categoryId?: string;
  @ApiPropertyOptional({ default: 1 })
  @Transform(integer)
  @IsInt()
  @Min(1)
  @Max(10000)
  override page = 1;
  @ApiPropertyOptional({ default: 10 })
  @Transform(integer)
  @IsInt()
  @Min(1)
  @Max(50)
  override size = 10;
}
export class DocumentDraftDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 160) title!: string;
  @ApiProperty() @Transform(trim) @IsString() @MaxLength(600) summary = "";
  @ApiProperty() @Matches(UUID_PATTERN) categoryId!: string;
  @ApiProperty() @IsString() @Length(1, 524288) html!: string;
  @ApiProperty({ enum: ["MIT", "CC-BY-4.0"] })
  @IsIn(["MIT", "CC-BY-4.0"])
  license!: "MIT" | "CC-BY-4.0";
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 160)
  attribution!: string;
}
export class DocumentVersionDto {
  @ApiProperty() @IsInt() @Min(1) @Max(2147483647) version!: number;
}
export class DocumentUpdateDto extends DocumentDraftDto {
  @ApiProperty() @IsInt() @Min(1) @Max(2147483647) version!: number;
}
export class DocumentSubmitDto extends DocumentVersionDto {
  @ApiProperty({ description: "Xác nhận quyền chia sẻ và giấy phép" })
  @Equals(true)
  permissionConfirmed!: true;
}
export class DocumentDecisionDto extends DocumentVersionDto {
  @ApiProperty({ enum: ["approve", "request_changes", "archive"] })
  @IsIn(["approve", "request_changes", "archive"])
  action!: "approve" | "request_changes" | "archive";
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 2000) reason!: string;
}
