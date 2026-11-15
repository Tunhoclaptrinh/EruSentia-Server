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
import { integerQuery, present, trimText } from "../common/dto/pagination.dto";
import { UUID_PATTERN } from "../common/uuid.pipe";
import { DocumentVersionDto } from "./contracts";
import { SearchPageQueryDto } from "../common/dto/pagination.dto";
export class DocumentHistoryQueryDto extends SearchPageQueryDto {}
export class DocumentSnapshotQueryDto {
  @ApiProperty()
  @Transform(integerQuery)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  version!: number;
}
export class DocumentRestoreDto extends DocumentVersionDto {
  @ApiProperty() @IsInt() @Min(1) @Max(2147483647) sourceVersion!: number;
  @ApiProperty()
  @Transform(trimText)
  @IsString()
  @Length(1, 2000)
  reason!: string;
  @ApiPropertyOptional()
  @ValidateIf(present)
  @Matches(UUID_PATTERN)
  categoryId?: string;
}
export class DocumentReportDto {
  @ApiProperty() @IsIn(["unsafe", "copyright", "spam", "other"]) reasonCode!:
    "unsafe" | "copyright" | "spam" | "other";
  @ApiProperty()
  @Transform(trimText)
  @IsString()
  @Length(1, 2000)
  description!: string;
}
export class DocumentReportQueryDto extends SearchPageQueryDto {
  @ApiPropertyOptional()
  @ValidateIf(present)
  @IsIn(["open", "resolved", "dismissed", "all"])
  state?: string;
}
export class DocumentReportDecisionDto {
  @ApiProperty() @IsInt() @Min(1) @Max(2147483647) reportVersion!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(2147483647) documentVersion!: number;
  @ApiProperty() @IsIn(["dismiss", "archive"]) action!: "dismiss" | "archive";
  @ApiProperty()
  @Transform(trimText)
  @IsString()
  @Length(1, 2000)
  reason!: string;
}
