import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

export const serverRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const backendServices = [
  "postgres",
  "rabbitmq",
  "redis",
  "mailpit",
  "api",
  "worker",
];
const defaults = {
  PROJECT_COMPOSE_NAME: "erusentia-project",
  PROJECT_API_PORT: "3001",
  PROJECT_ACCOUNT_EMAIL_MODE: "mailpit",
  PROJECT_WEB_PORT: "5173",
  PROJECT_POSTGRES_PORT: "5433",
  PROJECT_AMQP_PORT: "5673",
  PROJECT_RABBIT_UI_PORT: "15673",
  PROJECT_REDIS_PORT: "6380",
  PROJECT_SMTP_PORT: "1026",
  PROJECT_MAIL_UI_PORT: "8026",
  PROJECT_DB_PASSWORD: "eru_project_dev_password",
  PROJECT_RABBIT_PASSWORD: "eru_project_queue_password",
};
export async function projectContext({ appDir } = {}) {
  if (process.env.NODE_ENV === "production")
    throw new Error("The project stack is for local development only");
  const envFile = path.resolve(
    process.env.ERU_PROJECT_ENV_FILE ||
      path.join(serverRoot, "docker/.env.project.local"),
  );
  await mkdir(path.dirname(envFile), { recursive: true });
  try {
    await writeFile(
      envFile,
      "# Local development only. Keep this file private.\n" +
        Object.entries({
          ...defaults,
          PROJECT_JWT_SECRET: randomBytes(48).toString("base64url"),
        })
          .map(([key, value]) => `${key}=${value}`)
          .join("\n") +
        "\n",
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const configured = parseEnv(await readFile(envFile, "utf8"));
  const overrides = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.startsWith("PROJECT_")),
  );
  const settings = { ...defaults, ...configured, ...overrides };
  if (!/^[a-z][a-z0-9_-]{1,47}$/.test(settings.PROJECT_COMPOSE_NAME))
    throw new Error("Invalid PROJECT_COMPOSE_NAME");
  const ports = Object.entries(settings).filter(([key]) =>
    key.endsWith("_PORT"),
  );
  for (const [key, value] of ports)
    if (!/^\d+$/.test(value) || +value < 1 || +value > 65535)
      throw new Error(`Invalid ${key}`);
  if (new Set(ports.map(([, value]) => +value)).size !== ports.length)
    throw new Error("Project host ports must be distinct");
  for (const key of ["PROJECT_DB_PASSWORD", "PROJECT_RABBIT_PASSWORD"])
    if (!/^[A-Za-z0-9_-]{12,128}$/.test(settings[key]))
      throw new Error(`${key} must be 12–128 URL-safe letters/digits/_/-`);
  if (Buffer.byteLength(settings.PROJECT_JWT_SECRET || "") < 32)
    throw new Error("PROJECT_JWT_SECRET requires at least 32 bytes");
  settings.PROJECT_ACCOUNT_EMAIL_APP_URL ||= `http://127.0.0.1:${settings.PROJECT_WEB_PORT}`;
  if (!["disabled", "mailpit"].includes(settings.PROJECT_ACCOUNT_EMAIL_MODE))
    throw new Error("PROJECT_ACCOUNT_EMAIL_MODE must be disabled or mailpit");
  const emailApp = new URL(settings.PROJECT_ACCOUNT_EMAIL_APP_URL);
  if (
    emailApp.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(emailApp.hostname) ||
    emailApp.origin !== settings.PROJECT_ACCOUNT_EMAIL_APP_URL ||
    emailApp.username ||
    emailApp.password
  )
    throw new Error(
      "PROJECT_ACCOUNT_EMAIL_APP_URL must be a loopback HTTP origin",
    );
  settings.PROJECT_CORS_ORIGINS ||= `http://localhost:${settings.PROJECT_WEB_PORT},http://127.0.0.1:${settings.PROJECT_WEB_PORT}`;
  for (const origin of settings.PROJECT_CORS_ORIGINS.split(",")) {
    const url = new URL(origin.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.origin !== origin.trim() ||
      url.username ||
      url.password ||
      origin.includes("*")
    )
      throw new Error("PROJECT_CORS_ORIGINS requires exact HTTP(S) origins");
  }
  const args = [
    "compose",
    "--project-directory",
    serverRoot,
    "--env-file",
    envFile,
    "--project-name",
    settings.PROJECT_COMPOSE_NAME,
    "-f",
    path.join(serverRoot, "docker/compose.project.yml"),
  ];
  if (appDir) {
    appDir = path.resolve(appDir);
    const app = JSON.parse(
      await readFile(path.join(appDir, "package.json"), "utf8"),
    );
    if (app.name !== "erusentia")
      throw new Error("The sibling App checkout is not EruSentia");
    await access(path.join(appDir, "docker-compose.yml"));
    args.push("-f", path.join(appDir, "docker-compose.yml"));
  }
  return {
    settings,
    envFile,
    appDir,
    args,
    env: {
      ...process.env,
      ...settings,
      ...(appDir && { ERU_APP_DIR: appDir }),
    },
  };
}
export function command(program, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd: serverRoot,
      stdio: "inherit",
      ...options,
    });
    const interrupt = () => child.kill("SIGINT");
    const terminate = () => child.kill("SIGTERM");
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", terminate);
    const cleanup = () => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      code === 0
        ? resolve()
        : reject(
            Object.assign(new Error(`${program} exited ${signal || code}`), {
              signal,
              exitCode: code,
            }),
          );
    });
  });
}
export async function runStack(action, services = [], options = {}) {
  const context = options.context || (await projectContext(options));
  const allowed = [...backendServices, ...(context.appDir ? ["web"] : [])];
  if (services.some((name) => !allowed.includes(name)))
    throw new Error(`Choose services: ${allowed.join(", ")}`);
  const compose = (args) =>
    command("docker", [...context.args, ...args], { env: context.env });
  switch (action) {
    case "up": {
      const selected = services.length
        ? services
        : [
            ...backendServices,
            ...(options.includeWeb && context.appDir ? ["web"] : []),
          ];
      const needsBackend = selected.some((name) =>
        ["api", "worker", "web"].includes(name),
      );
      if (needsBackend)
        await compose([
          "build",
          "api",
          ...(selected.includes("web") ? ["web"] : []),
        ]);
      if (needsBackend) {
        await compose(["up", "-d", "--wait", "postgres"]);
        await compose(["run", "--rm", "--no-deps", "setup"]);
      }
      await compose([
        "up",
        "-d",
        "--no-build",
        "--wait",
        "--wait-timeout",
        "180",
        ...selected,
      ]);
      console.log(
        `API: http://127.0.0.1:${context.settings.PROJECT_API_PORT}/docs`,
      );
      if (selected.includes("web"))
        console.log(
          `App: http://127.0.0.1:${context.settings.PROJECT_WEB_PORT}`,
        );
      console.log(
        "Demo accounts and commands: docs/LOCAL_DEVELOPMENT.md. Stop without deleting data: pnpm stack:down",
      );
      break;
    }
    case "down":
      if (services.length)
        throw new Error("Use stack:stop for selected services");
      await compose(["down", "--timeout", "15"]);
      break;
    case "stop":
      await compose(["stop", "--timeout", "15", ...services]);
      break;
    case "status":
      await compose(["ps", "--all", ...services]);
      break;
    case "logs":
      await compose(["logs", "--follow", "--tail", "100", ...services]);
      break;
    case "seed":
      await compose(["build", "api"]);
      await compose(["up", "-d", "--wait", "postgres"]);
      await compose(["run", "--rm", "--no-deps", "setup"]);
      break;
    case "config":
      await compose(["config", "--quiet"]);
      console.log({
        project: context.settings.PROJECT_COMPOSE_NAME,
        config: context.envFile,
        api: `http://127.0.0.1:${context.settings.PROJECT_API_PORT}`,
        web: `http://127.0.0.1:${context.settings.PROJECT_WEB_PORT}`,
        database: `127.0.0.1:${context.settings.PROJECT_POSTGRES_PORT}/eru_project_docker`,
        services: allowed,
      });
      break;
    default:
      throw new Error(
        "Use stack:up, stack:down, stack:stop, stack:status, stack:logs, stack:seed or stack:config",
      );
  }
  return context;
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  runStack(
    process.argv[2],
    process.argv.slice(3).filter((arg) => arg !== "--"),
  ).catch((error) => {
    if (
      ["SIGINT", "SIGTERM"].includes(error.signal) ||
      [130, 143].includes(error.exitCode)
    )
      return;
    console.error(error.message);
    process.exitCode = 1;
  });
}
