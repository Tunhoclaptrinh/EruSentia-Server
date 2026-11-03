import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { ApiErrorDto } from "../templates/dto/template-response.dto";
import { AUTH_STORE, AuthStore, UserIdentity } from "./auth-store";
import { CurrentUser, Public, Roles } from "./auth.guards";
import {
  LoginDto,
  RefreshDto,
  RegisterDto,
  TokenPairDto,
  UserDto,
  UsersPageDto,
  UsersQueryDto,
} from "./auth.dto";
import { AuthService } from "./auth.service";

@ApiTags("Authentication")
@ApiBadRequestResponse({ type: ApiErrorDto })
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public()
  @Post("register")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Register a user account",
    description:
      "Role is always user; clients cannot submit role or account flags.",
  })
  @ApiCreatedResponse({ type: UserDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  register(@Body() body: RegisterDto) {
    return this.auth.register(body);
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Log in",
    description:
      "Returns a 15-minute JWT and a single-use refresh token. Copy accessToken into Authorize (without the Bearer prefix).",
  })
  @ApiOkResponse({ type: TokenPairDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  login(@Body() body: LoginDto) {
    return this.auth.login(body);
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Rotate a refresh token",
    description:
      "Use the newest refresh token once. Reuse revokes the whole login session, including its access tokens.",
  })
  @ApiOkResponse({ type: TokenPairDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  refresh(@Body() body: RefreshDto) {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post("logout")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Log out this session",
    description:
      "Revokes the refresh-token family. Access tokens for the session stop working on subsequent requests. Unknown tokens also return 204.",
  })
  @ApiNoContentResponse()
  logout(@Body() body: RefreshDto) {
    return this.auth.logout(body.refreshToken);
  }

  @Get("me")
  @Header("Cache-Control", "no-store")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Read the authenticated account" })
  @ApiOkResponse({ type: UserDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  me(@CurrentUser() user: UserIdentity) {
    return user;
  }
}

@ApiTags("Administration")
@ApiBearerAuth()
@Roles("admin")
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller("admin/users")
export class AdminUsersController {
  constructor(@Inject(AUTH_STORE) private readonly store: AuthStore) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "List user accounts (admin only)",
    description:
      "Paginated safe account fields, never password hashes or refresh tokens.",
  })
  @ApiOkResponse({ type: UsersPageDto })
  list(@Query() query: UsersQueryDto) {
    return this.store.listUsers(query.page, query.size);
  }
}
