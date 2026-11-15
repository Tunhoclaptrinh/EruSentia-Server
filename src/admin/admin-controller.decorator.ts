import { applyDecorators, Controller } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "../auth/auth.guards";

/** One policy for every Admin-only controller; it adds no implicit CRUD routes. */
export function AdminController(path: string, tag: string): ClassDecorator {
  return applyDecorators(
    Controller("admin/" + path),
    Roles("admin"),
    ApiBearerAuth(),
    ApiTags(tag),
  );
}
