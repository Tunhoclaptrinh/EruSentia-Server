import { UUID_PATTERN } from "../../common/uuid.pipe";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  IsISO8601,
  Matches,
  Length,
  Max,
  Min,
  ValidateIf,
} from "class-validator";
import type { Role } from "../../auth/auth-store";

import {
  SearchPageQueryDto,
  present as absent,
  trimText as trim,
  booleanQuery as toBool,
} from "../../common/dto/pagination.dto";

export class AdminUserQueryDto extends SearchPageQueryDto {
  @ApiPropertyOptional({ enum: ["user", "creator", "admin"] })
  @ValidateIf(absent)
  @IsIn(["user", "creator", "admin"])
  role?: Role;

  @ApiPropertyOptional({ enum: ["active", "suspended", "deleted", "all"] })
  @ValidateIf(absent)
  @IsIn(["active", "suspended", "deleted", "all"])
  status?: "active" | "suspended" | "deleted" | "all";
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

  @ApiPropertyOptional({ description: "Lý do thay đổi quyền", maxLength: 1000 })
  @ValidateIf(absent)
  @Transform(trim)
  @IsString()
  @Length(1, 1000)
  reason?: string;
}

export class AdminTemplateQueryDto extends SearchPageQueryDto {
  @ApiPropertyOptional({ enum: ["active", "trash", "all"] })
  @ValidateIf(absent)
  @IsIn(["active", "trash", "all"])
  status?: "active" | "trash" | "all";

  @ApiPropertyOptional({ description: "Lọc theo Author ID" })
  @ValidateIf(absent)
  @Matches(UUID_PATTERN)
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
}

export class AdminCurateTemplateDto {
  @ApiProperty({ description: "Đánh dấu tuyển chọn hay không" })
  @IsBoolean()
  isCurated!: boolean;
}

export class AdminAuditLogQueryDto extends SearchPageQueryDto {
  @ApiPropertyOptional({ description: "Mã hành động, ví dụ USER_ROLE_UPDATED" })
  @ValidateIf(absent)
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{0,63}$/)
  action?: string;

  @ApiPropertyOptional({ description: "ID đối tượng tác động" })
  @ValidateIf(absent)
  @Matches(UUID_PATTERN)
  targetId?: string;

  @ApiPropertyOptional({ description: "Thời điểm bắt đầu (ISO 8601, bao gồm)" })
  @ValidateIf(absent)
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    description: "Thời điểm kết thúc (ISO 8601, không bao gồm)",
  })
  @ValidateIf(absent)
  @IsISO8601({ strict: true })
  to?: string;
  @ApiPropertyOptional({ description: "Lọc theo ID Quản trị viên" })
  @ValidateIf(absent)
  @Matches(UUID_PATTERN)
  actorId?: string;

  @ApiPropertyOptional({ description: "Lọc theo loại đối tượng tác động" })
  @ValidateIf(absent)
  @IsString()
  targetType?: string;
}

export class AdminPageQueryDto extends SearchPageQueryDto {}

export class AdminReasonDto {
  @ApiProperty({ minLength: 1, maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @Length(1, 1000)
  reason!: string;
}

export class AdminCategoryDto extends AdminReasonDto {
  @ApiProperty({ maxLength: 64 })
  @Transform(trim)
  @IsString()
  @Length(1, 64)
  name!: string;

  @ApiProperty({ maxLength: 64 })
  @Transform(trim)
  @IsString()
  @Length(1, 64)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @ValidateIf(absent)
  @Transform(trim)
  @IsString()
  @Length(0, 255)
  description?: string;

  @ApiProperty({ minimum: 0, maximum: 9999 })
  @IsInt()
  @Min(0)
  @Max(9999)
  displayOrder!: number;
}

export class AdminRestoreAccountDto extends AdminSuspendUserDto {
  @ApiProperty({ description: "Thời điểm xóa đã được đối chiếu" })
  @IsISO8601({ strict: true })
  expectedDeletedAt!: string;
}

export class AdminForceHideDto extends AdminReasonDto {
  @ApiPropertyOptional()
  @ValidateIf(absent)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  revision?: number;
}
