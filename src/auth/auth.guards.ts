import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role, UserIdentity } from "./auth-store";
import { AuthService } from "./auth.service";

const PUBLIC = Symbol("public");
const ROLES = Symbol("roles");
export const Public = () => SetMetadata(PUBLIC, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);
export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): UserIdentity =>
    context.switchToHttp().getRequest().user,
);

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}
  async canActivate(context: ExecutionContext) {
    context.switchToHttp().getResponse().setHeader("Cache-Control", "no-store");
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest();
    const authorization: unknown = request.headers.authorization;
    const match =
      typeof authorization === "string"
        ? /^Bearer ([^\s]+)$/i.exec(authorization)
        : null;
    if (!match) throw new UnauthorizedException("Bearer access token required");
    request.user = await this.auth.authenticate(match[1]);
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles) return true;
    const user: UserIdentity | undefined = context
      .switchToHttp()
      .getRequest().user;
    if (!user || !roles.includes(user.role))
      throw new ForbiddenException("Insufficient role");
    return true;
  }
}
