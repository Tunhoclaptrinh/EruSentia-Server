import {
  Equals,
  IsBoolean,
  IsIn,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
  IsUrl,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const absent = (_: unknown, value: unknown) => value !== undefined;

export class TemplateSharingDto {
  @ApiProperty({ enum: ["MIT", "CC-BY-4.0"] })
  @IsIn(["MIT", "CC-BY-4.0"])
  license!: "MIT" | "CC-BY-4.0";
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @Length(1, 500)
  @Matches(/\S/)
  attribution!: string;
  @ApiProperty({
    enum: [true],
    description:
      "The publisher explicitly confirms the right to share this selected template.",
  })
  @Equals(true)
  permissionConfirmed!: true;
  @ApiPropertyOptional({ maxLength: 512 })
  @ValidateIf(absent)
  @IsUrl({
    protocols: ["https", "http"],
    require_protocol: true,
    require_tld: false,
  })
  @MaxLength(512)
  sourceUrl?: string;
}

// Storage envelope for the App's current standalone HTML templates. The HTTP API
// does not execute HTML or turn local official/custom tabs into publishing roles.
export class TemplateContentDto {
  [key: string]: unknown;

  @ApiPropertyOptional({
    type: () => TemplateSharingDto,
    description:
      "Required for public writes; private drafts may omit this. Applies only to the selected template, not the App source.",
  })
  @ValidateIf(absent)
  @ValidateNested()
  @Type(() => TemplateSharingDto)
  sharing?: TemplateSharingDto;

  @ApiProperty({ enum: ["erusentia-template-html"] })
  @Equals("erusentia-template-html")
  format!: "erusentia-template-html";
  @ApiProperty({ enum: [1], type: Number })
  @Equals(1)
  schemaVersion!: 1;
  @ApiProperty({
    minLength: 1,
    maxLength: 1000000,
    pattern: "\\S",
    example: "<section><h2>Study planner</h2></section>",
  })
  @IsString()
  @Length(1, 1000000)
  @Matches(/\S/)
  html!: string;
  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 128,
    example: "local-planner",
  })
  @ValidateIf(absent)
  @IsString()
  @Length(1, 128)
  originId?: string;
  @ApiPropertyOptional({
    maxLength: 100000,
    example: "Fill in your weekly study plan.",
  })
  @ValidateIf(absent)
  @IsString()
  @MaxLength(100000)
  guide?: string;
  @ApiPropertyOptional({ minLength: 1, maxLength: 64, example: "BookOpen" })
  @ValidateIf(absent)
  @IsString()
  @Length(1, 64)
  iconName?: string;
  @ApiPropertyOptional({
    enum: ["study", "productivity", "math", "interactive", "visual", "finance"],
    example: "study",
  })
  @ValidateIf(absent)
  @IsIn(["study", "productivity", "math", "interactive", "visual", "finance"])
  subjectCategory?: string;
  @ApiPropertyOptional({ enum: ["full", "semi", "basic"], example: "semi" })
  @ValidateIf(absent)
  @IsIn(["full", "semi", "basic"])
  level?: string;
  @ApiPropertyOptional({ minLength: 1, maxLength: 64, example: "100%" })
  @ValidateIf(absent)
  @IsString()
  @Length(1, 64)
  defaultWidth?: string;
  @ApiPropertyOptional({ minLength: 1, maxLength: 64, example: "auto" })
  @ValidateIf(absent)
  @IsString()
  @Length(1, 64)
  defaultHeight?: string;
  @ApiPropertyOptional({
    enum: ["fit-template", "fit-page", "fixed"],
    example: "fit-page",
  })
  @ValidateIf(absent)
  @IsIn(["fit-template", "fit-page", "fixed"])
  fitMode?: string;
  @ApiPropertyOptional({ minLength: 1, maxLength: 32, example: "auto" })
  @ValidateIf(absent)
  @IsString()
  @Length(1, 32)
  aspectRatio?: string;
  @ApiPropertyOptional({ example: false })
  @ValidateIf(absent)
  @IsBoolean()
  allowHeightResize?: boolean;
}
