import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from "class-validator";
import type { Role } from "../../auth/auth-store";

const absent = (_: unknown, value: unknown) => value !== undefined;
const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;
const toInt = ({ value }: { value: unknown }) =>
  typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value;
const toBool = ({ value }: { value: unknown }) =>
  value === "true" || value === true
    ? true
    : value === "false" || value === false
      ? false
      : value;

export class AdminUserQueryDto {
  @ApiPropertyOptional({ description: "Search by email or name" })
  @ValidateIf(absent)
  @Transform(trim)
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ["user", "creator", "admin"] })
  @ValidateIf(absent)
  @IsIn(["user", "creator", "admin"])
  role?: Role;

  @ApiPropertyOptional({ enum: ["active", "suspended"] })
  @ValidateIf(absent)
  @IsIn(["active", "suspended"])
  status?: "active" | "suspended";

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Transform(toInt)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(100)
  size: number = 20;
}

export class AdminSuspendUserDto {
  @ApiProperty({
    description: "Lý do khóa tài khoản",
    minLength: 1,
    maxLength: 1000,
  })
  @Transform(trim)
  @IsString()
  @Length(1, 1000)
  reason!: string;
}

export class AdminUpdateRoleDto {
  @ApiProperty({ enum: ["user", "creator", "admin"] })
  @IsIn(["user", "creator", "admin"])
  role!: Role;
}

export class AdminTemplateQueryDto {
  @ApiPropertyOptional({ description: "Tìm theo tiêu đề hoặc slug" })
  @ValidateIf(absent)
  @Transform(trim)
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: "Lọc theo Author ID" })
  @ValidateIf(absent)
  @IsUUID()
  authorId?: string;

  @ApiPropertyOptional({ description: "Lọc trạng thái công khai" })
  @ValidateIf(absent)
  @Transform(toBool)
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional({ enum: ["visible", "hidden"] })
  @ValidateIf(absent)
  @IsIn(["visible", "hidden"])
  moderationState?: "visible" | "hidden";

  @ApiPropertyOptional({ description: "Chỉ hiển thị template được tuyển chọn" })
  @ValidateIf(absent)
  @Transform(toBool)
  @IsBoolean()
  isCurated?: boolean;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Transform(toInt)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(100)
  size: number = 20;
}

export class AdminCurateTemplateDto {
  @ApiProperty({ description: "Đánh dấu tuyển chọn hay không" })
  @IsBoolean()
  isCurated!: boolean;
}

export class AdminAuditLogQueryDto {
  @ApiPropertyOptional({ description: "Lọc theo ID Quản trị viên" })
  @ValidateIf(absent)
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ description: "Lọc theo loại đối tượng tác động" })
  @ValidateIf(absent)
  @IsString()
  targetType?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Transform(toInt)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(100)
  size: number = 20;
}
