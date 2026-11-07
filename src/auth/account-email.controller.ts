import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiAcceptedResponse,
  ApiNoContentResponse,
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiServiceUnavailableResponse,
  ApiTooManyRequestsResponse,
  ApiProperty,
  PickType,
} from "@nestjs/swagger";
import { IsString, Length, Matches } from "class-validator";
import { CurrentUser, Public } from "./auth.guards";
import { LoginDto } from "./auth.dto";
import type { UserIdentity } from "./auth-store";
import { ApiErrorDto } from "../templates/dto/template-response.dto";
import { AccountEmailService } from "./account-email.service";
export class ForgotPasswordDto extends PickType(LoginDto, ["email"] as const) {}
export class EmailActionDto {
  @ApiProperty({
    description: "One-time code received by email",
    minLength: 43,
    maxLength: 43,
    writeOnly: true,
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;
}
export class ResetPasswordDto extends EmailActionDto {
  @ApiProperty({
    format: "password",
    minLength: 12,
    maxLength: 128,
    writeOnly: true,
  })
  @IsString()
  @Length(12, 128)
  password!: string;
}
export class EmailCapabilitiesDto {
  @ApiProperty() emailActionsEnabled!: boolean;
}
export class EmailStatusDto {
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  emailVerifiedAt!: Date | null;
}
export class EmailRequestAcceptedDto {
  @ApiProperty() message!: string;
}
type ClientRequest = { ip?: string; socket: { remoteAddress?: string } };
@ApiTags("Account email")
@ApiBadRequestResponse({ type: ApiErrorDto })
@ApiServiceUnavailableResponse({ type: ApiErrorDto })
@ApiTooManyRequestsResponse({ type: ApiErrorDto })
@Controller("auth/email")
export class AccountEmailController {
  constructor(private readonly email: AccountEmailService) {}
  @Public()
  @Get("capabilities")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Read whether local account email actions are enabled",
  })
  @ApiOkResponse({ type: EmailCapabilitiesDto })
  capabilities() {
    return { emailActionsEnabled: this.email.enabled() };
  }
  @Get("status")
  @ApiBearerAuth()
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: EmailStatusDto })
  status(@CurrentUser() user: UserIdentity) {
    return this.email.status(user.id);
  }
  @Post("verification/request")
  @ApiBearerAuth()
  @HttpCode(202)
  @Header("Cache-Control", "no-store")
  @ApiAcceptedResponse({ type: EmailRequestAcceptedDto })
  async requestVerification(
    @CurrentUser() user: UserIdentity,
    @Req() request: ClientRequest,
  ) {
    this.email.limit(request.ip || request.socket.remoteAddress || "unknown");
    await this.email.sendVerification(user.id);
    return {
      message: "If applicable, an email will be sent. Check your inbox.",
    };
  }
  @Public()
  @Post("verification/confirm")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  @ApiNoContentResponse()
  verify(@Body() body: EmailActionDto, @Req() request: ClientRequest) {
    this.email.limit(
      request.ip || request.socket.remoteAddress || "unknown",
      true,
    );
    return this.email.verify(body.token);
  }
  @Public()
  @Post("password/request")
  @HttpCode(202)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary:
      "Request a password reset without revealing whether the account exists",
  })
  @ApiAcceptedResponse({ type: EmailRequestAcceptedDto })
  async forgot(@Body() body: ForgotPasswordDto, @Req() request: ClientRequest) {
    this.email.limit(request.ip || request.socket.remoteAddress || "unknown");
    await this.email.forgot(body.email);
    return {
      message: "If applicable, an email will be sent. Check your inbox.",
    };
  }
  @Public()
  @Post("password/confirm")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary:
      "Use a one-time code to change the password and revoke all sessions",
  })
  @ApiNoContentResponse()
  reset(@Body() body: ResetPasswordDto, @Req() request: ClientRequest) {
    this.email.limit(
      request.ip || request.socket.remoteAddress || "unknown",
      true,
    );
    return this.email.reset(body.token, body.password);
  }
}
