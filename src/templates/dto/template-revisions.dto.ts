import { ApiProperty, PickType } from "@nestjs/swagger";
import { TemplateResponseDto } from "./template-response.dto";
import { editableFields } from "../template-revisions";

export class TemplateSnapshotDto extends PickType(
  TemplateResponseDto,
  editableFields,
) {}
export class RevisionSummaryDto {
  @ApiProperty({ format: "uuid" }) templateId!: string;
  @ApiProperty({ minimum: 1 }) revision!: number;
  @ApiProperty({ enum: ["baseline", "create", "update", "delete", "restore"] })
  operation!: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) actorId!:
    string | null;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date;
  @ApiProperty() title!: string;
  @ApiProperty() version!: string;
  @ApiProperty() isPublic!: boolean;
}
export class TemplateRevisionDto extends PickType(RevisionSummaryDto, [
  "templateId",
  "revision",
  "operation",
  "actorId",
  "createdAt",
] as const) {
  @ApiProperty({ type: () => TemplateSnapshotDto })
  snapshot!: TemplateSnapshotDto;
}
export class RevisionsPageDto {
  @ApiProperty({ format: "uuid" }) templateId!: string;
  @ApiProperty({
    description:
      "Current resource ETag to send in If-Match, including when the template is deleted",
  })
  currentEtag!: string;
  @ApiProperty() deleted!: boolean;
  @ApiProperty({ type: [RevisionSummaryDto] }) data!: RevisionSummaryDto[];
  @ApiProperty() page!: number;
  @ApiProperty() size!: number;
  @ApiProperty() totalElements!: number;
  @ApiProperty() totalPages!: number;
}
