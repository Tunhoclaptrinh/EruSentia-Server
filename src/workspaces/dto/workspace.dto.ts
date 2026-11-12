import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Length, Matches } from "class-validator";
import { UUID_PATTERN } from "../../common/uuid.pipe";

export type WorkspaceRole = "owner" | "editor" | "viewer";

export class CreateWorkspaceDto {
  @ApiProperty({ example: "Engineering Vault", minLength: 2, maxLength: 128 })
  @IsString()
  @Length(2, 128)
  name!: string;

  @ApiProperty({ example: "engineering-vault", minLength: 2, maxLength: 128 })
  @IsString()
  @Length(2, 128)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "slug must contain lowercase alphanumeric characters and hyphens",
  })
  slug!: string;

  @ApiPropertyOptional({ example: "Shared workspace for engineering documentation" })
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateWorkspaceDto {
  @ApiPropertyOptional({ example: "Updated Workspace Name" })
  @IsOptional()
  @IsString()
  @Length(2, 128)
  name?: string;

  @ApiPropertyOptional({ example: "Updated description" })
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: ["owner", "editor", "viewer"] })
  @IsIn(["owner", "editor", "viewer"])
  role!: WorkspaceRole;
}

export class InviteMemberDto {
  @ApiProperty({ example: "collaborator@company.test" })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ["editor", "viewer"], default: "editor" })
  @IsIn(["editor", "viewer"])
  role: "editor" | "viewer" = "editor";
}

export class AddResourceDto {
  @ApiProperty({ example: "00000000-0000-0000-0000-000000000000" })
  @Matches(UUID_PATTERN, { message: "templateId must use UUID syntax" })
  templateId!: string;

  @ApiPropertyOptional({ enum: ["read_only", "read_write"], default: "read_write" })
  @IsOptional()
  @IsIn(["read_only", "read_write"])
  permission?: "read_only" | "read_write";
}

export class WorkspaceResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiProperty({ format: "uuid" })
  ownerId!: string;

  @ApiProperty({ enum: ["owner", "editor", "viewer"] })
  currentUserRole!: WorkspaceRole;

  @ApiProperty()
  membersCount!: number;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;
}

export class WorkspaceMemberItemDto {
  @ApiProperty({ format: "uuid" })
  userId!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: ["owner", "editor", "viewer"] })
  role!: WorkspaceRole;

  @ApiProperty({ format: "date-time" })
  joinedAt!: string;
}

