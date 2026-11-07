import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength, MaxLength } from "class-validator";
export class PurgeTemplateDto {
  @ApiProperty({ minLength: 1, maxLength: 128, writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
  @ApiProperty({
    minLength: 1,
    maxLength: 280,
    description: "Exact slug of an already soft-deleted owned template",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(280)
  confirmSlug!: string;
}
