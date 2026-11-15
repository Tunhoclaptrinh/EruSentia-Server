import { UnauthorizedException } from "@nestjs/common";
import type { UserIdentity } from "../../auth/auth-store";
import {
  getRequestMeta,
  type ClientRequest,
  type RequestMeta,
} from "../request-context";

export interface ActionContext {
  actorId: string;
  meta: RequestMeta;
}

/** Shared request context only. Concrete routes retain DTO, UUID, roles and business policies. */
export abstract class BaseController {
  protected actionContext(
    actor: UserIdentity | undefined,
    request: ClientRequest,
  ): ActionContext {
    if (!actor?.id)
      throw new UnauthorizedException("Authenticated actor required");
    return { actorId: actor.id, meta: getRequestMeta(request) };
  }
}
