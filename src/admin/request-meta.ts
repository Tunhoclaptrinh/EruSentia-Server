// Compatibility exports: the shared request policy belongs to common, not the Admin feature.
export { getRequestMeta } from "../common/request-context";
export type {
  ClientRequest as AdminRequest,
  RequestMeta as AdminRequestMeta,
} from "../common/request-context";
