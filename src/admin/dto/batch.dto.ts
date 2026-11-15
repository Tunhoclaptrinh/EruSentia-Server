import { ApiProperty, OmitType } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsObject,
  Matches,
} from "class-validator";
import { UUID_PATTERN } from "../../common/uuid.pipe";
import { AdminCategoryDto, AdminReasonDto } from "./admin.dto";

export const ADMIN_BATCH_LIMIT = 100;
export class CategoryImportRowDto extends OmitType(AdminCategoryDto, [
  "reason",
] as const) {}
export class AdminCategoryImportDto extends AdminReasonDto {
  @ApiProperty({ type: [Object], minItems: 1, maxItems: ADMIN_BATCH_LIMIT })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ADMIN_BATCH_LIMIT)
  @IsObject({ each: true })
  rows!: Record<string, unknown>[];
}
export class AdminSelectionDto extends AdminReasonDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: ADMIN_BATCH_LIMIT })
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((id) => (typeof id === "string" ? id.toLowerCase() : id))
      : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ADMIN_BATCH_LIMIT)
  @ArrayUnique()
  @Matches(UUID_PATTERN, { each: true })
  ids!: string[];
}
export class AdminBatchCurationDto extends AdminSelectionDto {
  @ApiProperty() @IsBoolean() isCurated!: boolean;
}
