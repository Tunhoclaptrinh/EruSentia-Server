import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsInt, IsString, Length, Max, Min, ValidateIf } from "class-validator";

export const present = (_: unknown, value: unknown) => value !== undefined;
export const trimText = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;
export const integerQuery = ({ value }: { value: unknown }) =>
  typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value;
export const booleanQuery = ({ value }: { value: unknown }) =>
  value === "true" || value === true
    ? true
    : value === "false" || value === false
      ? false
      : value;

/** Explicit conversion only: arrays, null, exponent notation and unsafe integers fail validation. */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    default: 1,
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @Transform(integerQuery)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Transform(integerQuery)
  @IsInt()
  @Min(1)
  @Max(100)
  size = 20;
}

export class SearchPageQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @ValidateIf(present)
  @Transform(trimText)
  @IsString()
  @Length(0, 200)
  search?: string;
}

export interface PageResult<T> {
  data: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}
