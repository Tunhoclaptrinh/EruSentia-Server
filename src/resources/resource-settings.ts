export interface ResourceSettings {
  enabled: boolean;
  targetOrigins: string[];
  freeDailyLimit: number;
  premiumDailyLimit: number;
  allowLocalTargets: boolean;
}
export const RESOURCE_SETTINGS = Symbol("RESOURCE_SETTINGS");
export function resourceSettings(env: NodeJS.ProcessEnv): ResourceSettings {
  const limit = (name: string, fallback: number) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value < 0 || value > 10000)
      throw Error(`${name} must be 0..10000`);
    return value;
  };
  if (
    env.RESOURCE_ALLOW_LOCAL_TARGETS === "true" &&
    env.NODE_ENV === "production"
  )
    throw Error("Local relay targets are forbidden in production");
  const targetOrigins = (
    env.RESOURCE_TARGET_ORIGINS || "https://erusentia-api.onrender.com"
  )
    .split(",")
    .map((value) => {
      const url = new URL(value.trim());
      if (
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        (url.protocol !== "https:" &&
          !(
            env.RESOURCE_ALLOW_LOCAL_TARGETS === "true" &&
            url.protocol === "http:"
          ))
      )
        throw Error("RESOURCE_TARGET_ORIGINS requires exact HTTPS origins");
      return url.origin;
    });
  return {
    enabled: env.RESOURCE_GATEWAY_ENABLED !== "false",
    targetOrigins: [...new Set(targetOrigins)],
    freeDailyLimit: limit("RESOURCE_FREE_DAILY_LIMIT", 30),
    premiumDailyLimit: limit("RESOURCE_PREMIUM_DAILY_LIMIT", 500),
    allowLocalTargets: env.RESOURCE_ALLOW_LOCAL_TARGETS === "true",
  };
}
