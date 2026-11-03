import { ApiProperty } from "@nestjs/swagger";
import { TemplatePage, TemplateRecord } from "../template-store";

class AuthorReferenceDto {
  @ApiProperty({ format: "uuid" }) id!: string;
}

class CategoryReferenceDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
}

export class TemplateResponseDto implements TemplateRecord {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) authorId!: string;
  @ApiProperty({ format: "uuid" }) categoryId!: string;
  @ApiProperty() title!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() description!: string;
  @ApiProperty({
    type: "object",
    additionalProperties: true,
    description:
      "Stored JSONB. New writes use the HTML envelope; week-1 seed rows may contain legacy content.",
  })
  contentJson!: Record<string, unknown>;
  @ApiProperty({ type: String, nullable: true }) thumbnailUrl!: string | null;
  @ApiProperty() version!: string;
  @ApiProperty() isPublic!: boolean;
  @ApiProperty({ type: [String] }) tags!: string[];
  @ApiProperty({ type: "integer" }) viewsCount!: number;
  @ApiProperty({ type: "integer" }) forksCount!: number;
  @ApiProperty() ratingAvg!: number;
  @ApiProperty({ type: "integer" }) ratingsCount!: number;
  @ApiProperty() isFeatured!: boolean;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date;
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: Date;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  deletedAt!: Date | null;
  @ApiProperty({ type: () => AuthorReferenceDto }) author!: AuthorReferenceDto;
  @ApiProperty({ type: () => CategoryReferenceDto })
  category!: CategoryReferenceDto;
}

export class TemplatePageDto implements TemplatePage {
  @ApiProperty({ type: [TemplateResponseDto] }) data!: TemplateResponseDto[];
  @ApiProperty({ type: "integer" }) page!: number;
  @ApiProperty({ type: "integer" }) size!: number;
  @ApiProperty({ type: "integer" }) totalPages!: number;
  @ApiProperty({ type: "integer" }) totalElements!: number;
}

export class ApiErrorDto {
  @ApiProperty({ example: 400 }) statusCode!: number;
  @ApiProperty({ example: "BAD_REQUEST" }) code!: string;
  @ApiProperty({ example: "Request validation failed" }) message!: string;
  @ApiProperty({ type: [String] }) details!: string[];
  @ApiProperty({ example: "/templates" }) path!: string;
  @ApiProperty({ format: "date-time" }) timestamp!: string;
}
