import type { AppConfig } from "../config";
export function accountEmailConfig(
  env: NodeJS.ProcessEnv,
): AppConfig["accountEmail"] {
  const mode = env.ACCOUNT_EMAIL_MODE || "disabled";
  if (!["disabled", "mailpit"].includes(mode))
    throw Error("ACCOUNT_EMAIL_MODE must be disabled or mailpit");
  if (mode === "mailpit" && env.NODE_ENV === "production")
    throw Error(
      "Mailpit account email is local-only and forbidden in production",
    );
  const appUrl = env.ACCOUNT_EMAIL_APP_URL || "http://127.0.0.1:5173";
  if (mode === "mailpit") {
    const url = new URL(appUrl);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw Error("ACCOUNT_EMAIL_APP_URL must be a loopback HTTP origin");
    if (
      !["127.0.0.1", "localhost", "::1", "mailpit"].includes(
        env.SMTP_HOST || "127.0.0.1",
      )
    )
      throw Error("Account email SMTP must be local Mailpit");
  }
  return { enabled: mode === "mailpit", appUrl: new URL(appUrl).origin };
}
