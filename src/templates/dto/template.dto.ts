import { Transform, Type } from "class-transformer";
import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from "@nestjs/swagger";
import { UUID_PATTERN } from "../../common/uuid.pipe";
import { TemplateContentDto } from "./template-content.dto";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";

// OpenAPI patterns have no JavaScript RegExp flags; include both hex cases.
const uuidPattern = UUID_PATTERN.source.replaceAll("a-f", "a-fA-F");

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;
// Optional means absent; null is still invalid except for nullable thumbnailUrl.
const absent = (_: unknown, value: unknown) => value !== undefined;

export class CreateTemplateDto {
  @ApiProperty({
    example: "a0000000-0000-0000-0000-000000000002",
    pattern: uuidPattern,
    description:
      "Existing active author. Authentication is not implemented yet.",
  })
  @Transform(({ value }) =>
    typeof value === "string" ? value.toLowerCase() : value,
  )
  @Matches(UUID_PATTERN, { message: "authorId must use UUID syntax" })
  authorId!: string;
  @ApiProperty({
    example: "c0000000-0000-0000-0000-000000000001",
    pattern: uuidPattern,
  })
  @Transform(({ value }) =>
    typeof value === "string" ? value.toLowerCase() : value,
  )
  @Matches(UUID_PATTERN, { message: "categoryId must use UUID syntax" })
  categoryId!: string;
  @ApiProperty({ minLength: 3, maxLength: 255, example: "Study planner" })
  @Transform(trim)
  @IsString()
  @Length(3, 255)
  title!: string;
  @ApiProperty({
    minLength: 1,
    maxLength: 280,
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    example: "study-planner-demo",
    description:
      "Unique, including soft-deleted templates; choose a new slug for each POST.",
  })
  @Transform(trim)
  @IsString()
  @Length(1, 280)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;
  @ApiProperty({
    minLength: 1,
    maxLength: 10000,
    example: "A weekly learning plan",
  })
  @Transform(trim)
  @IsString()
  @Length(1, 10000)
  description!: string;
  @ApiProperty({
    type: () => TemplateContentDto,
    description:
      "HTML envelope. PATCH replaces the whole object, including metadata.",
  })
  @IsObject()
  @ValidateNested()
  @Type(() => TemplateContentDto)
  contentJson!: TemplateContentDto;
  @ApiPropertyOptional({ minLength: 1, maxLength: 32, default: "1.0.0" })
  @ValidateIf(absent)
  @IsString()
  @Length(1, 32)
  version?: string;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 512,
    example: null,
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  thumbnailUrl?: string | null;
  @ApiPropertyOptional({ default: true, example: false })
  @ValidateIf(absent)
  @IsBoolean()
  isPublic?: boolean;
  @ApiPropertyOptional({
    type: [String],
    maxItems: 20,
    uniqueItems: true,
    example: ["study"],
    description: "Each tag has 1–64 characters.",
  })
  @ValidateIf(absent)
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 64, { each: true })
  tags?: string[];
}

export class UpdateTemplateDto extends PartialType(
  OmitType(CreateTemplateDto, ["authorId"] as const),
  { skipNullProperties: false },
) {}

export class QueryTemplatesDto {
  @ApiPropertyOptional({
    type: "integer",
    minimum: 1,
    maximum: 10000,
    default: 1,
  })
  @Transform(({ value }) =>
    typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(10000)
  page = 1;
  @ApiPropertyOptional({
    type: "integer",
    minimum: 1,
    maximum: 100,
    default: 10,
  })
  @Transform(({ value }) =>
    typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(100)
  size = 10;
  @ApiPropertyOptional({ pattern: uuidPattern })
  @ValidateIf(absent)
  @Transform(({ value }) =>
    typeof value === "string" ? value.toLowerCase() : value,
  )
  @Matches(UUID_PATTERN)
  authorId?: string;
  @ApiPropertyOptional({ pattern: uuidPattern })
  @ValidateIf(absent)
  @Transform(({ value }) =>
    typeof value === "string" ? value.toLowerCase() : value,
  )
  @Matches(UUID_PATTERN)
  categoryId?: string;
  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 100,
    description: "Case-insensitive literal substring in title or description.",
  })
  @ValidateIf(absent)
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  search?: string;
  @ApiPropertyOptional({ minLength: 1, maxLength: 64 })
  @ValidateIf(absent)
  @Transform(trim)
  @IsString()
  @Length(1, 64)
  tag?: string;
  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf(absent)
  @Transform(({ value }) =>
    value === "true" ? true : value === "false" ? false : value,
  )
  @IsBoolean()
  isPublic?: boolean;
  @ApiPropertyOptional({ enum: ["createdAt", "title"], default: "createdAt" })
  @IsIn(["createdAt", "title"])
  sort: "createdAt" | "title" = "createdAt";
  @ApiPropertyOptional({ enum: ["asc", "desc"], default: "desc" })
  @IsIn(["asc", "desc"])
  order: "asc" | "desc" = "desc";
}
