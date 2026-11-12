import { Transform } from "class-transformer";
import {
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
export class ResourceRequestDto {
  @ApiProperty() @IsString() @MaxLength(2048) url!: string;
  @ApiProperty({
    enum: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
  @IsIn(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
  method = "GET";
  @ApiPropertyOptional() @IsOptional() @IsObject() headers?: Record<
    string,
    string
  >;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(524288)
  body?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID("all") documentId?: string;
}
export class ResourcePlanDto {
  @ApiProperty({ enum: ["free", "premium", "blocked"] })
  @IsIn(["free", "premium", "blocked"])
  plan!: "free" | "premium" | "blocked";
  @ApiPropertyOptional() @IsOptional() @IsISO8601() expiresAt?: string;
}
export class ResourceDocumentDto {
  @ApiProperty()
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @Length(1, 160)
  title!: string;
  @ApiProperty() @IsString() @MaxLength(524288) html!: string;
  @ApiProperty({ enum: ["private", "shared", "premium"] })
  @IsIn(["private", "shared", "premium"])
  access: "private" | "shared" | "premium" = "private";
}
export class ResourceGrantDto {
  @ApiProperty() @IsUUID("all") userId!: string;
}
