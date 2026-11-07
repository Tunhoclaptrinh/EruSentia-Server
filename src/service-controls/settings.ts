export interface ServiceControlSettings {
  rateLimitsEnabled: boolean;
  loginPerIp: number;
  loginPerIdentity: number;
  registerPerIp: number;
  refreshPerIp: number;
  writesPerUser: number;
  maxTemplates: number;
  maxContentBytes: number;
  trustProxyHops: number;
}
export const SERVICE_CONTROL_SETTINGS = Symbol("SERVICE_CONTROL_SETTINGS");
export function serviceControlSettings(
  env: NodeJS.ProcessEnv,
): ServiceControlSettings {
  if (
    env.API_RATE_LIMITS_ENABLED !== undefined &&
    !["true", "false"].includes(env.API_RATE_LIMITS_ENABLED)
  )
    throw Error("API_RATE_LIMITS_ENABLED must be true or false");
  const integer = (name: string, fallback: number, max: number, min = 1) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw Error(`${name} must be an integer from ${min} to ${max}`);
    return value;
  };
  return {
    rateLimitsEnabled: env.API_RATE_LIMITS_ENABLED !== "false",
    loginPerIp: integer("AUTH_LOGIN_PER_IP", 200, 10000),
    loginPerIdentity: integer("AUTH_LOGIN_PER_IDENTITY", 20, 1000),
    registerPerIp: integer("AUTH_REGISTER_PER_IP", 40, 1000),
    refreshPerIp: integer("AUTH_REFRESH_PER_IP", 300, 10000),
    writesPerUser: integer("API_WRITES_PER_USER", 60, 10000),
    maxTemplates: integer("TEMPLATE_QUOTA_COUNT", 100, 10000),
    maxContentBytes: integer(
      "TEMPLATE_QUOTA_CONTENT_BYTES",
      20 * 1024 * 1024,
      1024 * 1024 * 1024,
    ),
    trustProxyHops: integer("TRUST_PROXY_HOPS", 0, 3, 0),
  };
}
