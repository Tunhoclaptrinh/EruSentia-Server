export interface ClientRequest {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
}
export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}
export function getRequestMeta(request: ClientRequest): RequestMeta {
  // Express applies the configured trust-proxy policy. Never trust forwarded headers directly.
  const agent = request.headers["user-agent"];
  return {
    ip: request.ip || request.socket?.remoteAddress,
    userAgent: typeof agent === "string" ? agent.slice(0, 1024) : undefined,
  };
}
