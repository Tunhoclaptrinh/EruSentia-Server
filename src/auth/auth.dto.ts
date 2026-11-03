import { ApiProperty, PickType } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail, IsString, Length, Matches, MaxLength } from "class-validator";
import type { Role, UserIdentity } from "./auth-store";
import { QueryTemplatesDto } from "../templates/dto/template.dto";

export class LoginDto {
  @ApiProperty({ example: "learner@example.test", maxLength: 255 })
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  email!: string;
  @ApiProperty({
    format: "password",
    minLength: 1,
    maxLength: 128,
    example: "LearningPass!2026",
  })
  @IsString()
  @Length(1, 128)
  password!: string;
}
export class RegisterDto extends PickType(LoginDto, ["email"] as const) {
  @ApiProperty({
    format: "password",
    minLength: 12,
    maxLength: 128,
    example: "LearningPass!2026",
  })
  @IsString()
  @Length(12, 128)
  password!: string;
}
export class RefreshDto {
  @ApiProperty({
    minLength: 43,
    maxLength: 43,
    description:
      "The latest opaque refreshToken returned by login/refresh. Each token is usable once.",
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  refreshToken!: string;
}
export class UserDto implements UserIdentity {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: ["user", "creator", "admin"] }) role!: Role;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date;
}
export class TokenPairDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ enum: ["Bearer"] }) tokenType!: "Bearer";
  @ApiProperty({ example: 900 }) expiresIn!: number;
  @ApiProperty({
    type: String,
    format: "date-time",
    description: "Absolute expiry of this login's refresh-token family.",
  })
  refreshExpiresAt!: Date;
  @ApiProperty({ type: () => UserDto }) user!: UserDto;
}
export class UsersQueryDto extends PickType(QueryTemplatesDto, [
  "page",
  "size",
] as const) {}
export class UsersPageDto {
  @ApiProperty({ type: [UserDto] }) data!: UserDto[];
  @ApiProperty() page!: number;
  @ApiProperty() size!: number;
  @ApiProperty() totalPages!: number;
  @ApiProperty() totalElements!: number;
}
