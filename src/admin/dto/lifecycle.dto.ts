import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from "class-validator";
import { AdminReasonDto } from "./admin.dto";
import { UUID_PATTERN } from "../../common/uuid.pipe";
import {
  integerQuery,
  present,
  trimText,
} from "../../common/dto/pagination.dto";
export class AdminVersionReasonDto extends AdminReasonDto {
  @ApiProperty() @IsInt() @Min(1) @Max(2147483647) revision!: number;
}
export class AdminTemplateMetadataDto extends AdminVersionReasonDto {
  @ApiProperty()
  @Transform(trimText)
  @IsString()
  @Length(1, 255)
  title!: string;
  @ApiProperty() @IsString() @Length(0, 5000) description!: string;
  @ApiProperty() @Matches(UUID_PATTERN) categoryId!: string;
}
export class AdminTemplatePurgeDto extends AdminVersionReasonDto {
  @ApiProperty() @IsString() @Length(1, 255) confirmSlug!: string;
  @ApiProperty() @IsString() @Length(1, 128) password!: string;
}
export class AdminRestoreRevisionDto extends AdminVersionReasonDto {
  @ApiPropertyOptional()
  @ValidateIf(present)
  @Matches(UUID_PATTERN)
  categoryId?: string;
  @ApiProperty() @IsInt() @Min(1) @Max(2147483647) sourceRevision!: number;
}
export class AdminRevisionQueryDto {
  @ApiProperty()
  @Transform(integerQuery)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  revision!: number;
}
export class AdminTrashQueryDto {
  @ApiPropertyOptional({ enum: ["active", "trash", "all"] })
  @ValidateIf(present)
  @IsIn(["active", "trash", "all"])
  status?: "active" | "trash" | "all";
}

export class AdminCategoryTransferPreviewDto {
  @ApiProperty()
  @Transform(({ value }) =>
    typeof value === "string" ? value.toLowerCase() : value,
  )
  @Matches(UUID_PATTERN)
  targetCategoryId!: string;
}
export class AdminCategoryTransferDto extends AdminCategoryTransferPreviewDto {
  @ApiProperty()
  @Transform(trimText)
  @IsString()
  @Length(1, 1000)
  reason!: string;
  @ApiProperty() @IsString() @Matches(/^[a-f0-9]{64}$/) previewToken!: string;
}
