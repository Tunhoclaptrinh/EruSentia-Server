import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFile, access } from "node:fs/promises";
import net from "node:net";
import {
  projectContext,
  runStack,
  command,
  serverRoot,
} from "./project-stack.mjs";

export const profiles = {
  full: { backend: true, app: "desktop", admin: true },
  web: { backend: true, app: "web", admin: true },
  "app-server": { backend: true, app: "desktop" },
  "app-server-web": { backend: true, app: "web" },
  "server-admin": { backend: true, admin: true },
  app: { app: "desktop" },
  "app-web": { app: "web" },
  admin: { admin: true },
  server: { backend: true },
};

async function checkout(directory, expected) {
  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(path.join(directory, "package.json"), "utf8"),
    );
  } catch {
    throw new Error(`Missing checkout: ${directory}`);
  }
  if (manifest.name !== expected)
    throw new Error(`Unexpected checkout at ${directory}`);
}

async function portAvailable(port, label) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", () =>
      reject(
        new Error(
          `${label}: port ${port} is occupied or unavailable. Stop the other frontend or change PROJECT_${label === "Admin" ? "ADMIN" : "WEB"}_PORT.`,
        ),
      ),
    );
    server.listen(Number(port), "127.0.0.1", () => server.close(resolve));
  });
}

export async function runWorkspace(action, { dryRun = false } = {}) {
  const appDir = path.resolve(
    process.env.ERU_APP_DIR || path.join(serverRoot, "../erusentia-app"),
  );
  const adminDir = path.resolve(
    process.env.ERU_ADMIN_DIR || path.join(serverRoot, "../erusentia-admin"),
  );
  if (action === "setup") {
    for (const [directory, name] of [
      [appDir, "erusentia"],
      [serverRoot, "sentia-hub-service"],
      [adminDir, "erusentia-admin"],
    ]) {
      await checkout(directory, name);
      await command("pnpm", ["install", "--frozen-lockfile"], {
        cwd: directory,
      });
    }
    return;
  }
  const internal = action.startsWith("frontend-");
  const profile =
    profiles[action] ||
    (internal
      ? { app: action !== "frontend-admin", admin: action === "frontend-admin" }
      : null);
  if (
    !profile ||
    (internal &&
      !["frontend-app", "frontend-admin", "frontend-desktop"].includes(action))
  )
    throw new Error(`Choose: ${Object.keys(profiles).join(", ")}, setup`);
  if (profile.app) await checkout(appDir, "erusentia");
  if (profile.admin) await checkout(adminDir, "erusentia-admin");
  const context = await projectContext({ ...(profile.app && { appDir }) });
  const api = `http://127.0.0.1:${context.settings.PROJECT_API_PORT}`;
  const web = `http://127.0.0.1:${context.settings.PROJECT_WEB_PORT}`;
  const admin = `http://127.0.0.1:${context.settings.PROJECT_ADMIN_PORT}`;
  const env = {
    ...context.env,
    ERU_APP_DIR: appDir,
    ERU_ADMIN_DIR: adminDir,
    VITE_ERU_API_BASE_URL: api,
    ERU_API_BASE_URL: api,
    ERU_DEV_SERVER_URL: web,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  if (internal) {
    if (action === "frontend-admin") {
      await command(
        "pnpm",
        [
          "exec",
          "vite",
          "--host",
          "127.0.0.1",
          "--port",
          context.settings.PROJECT_ADMIN_PORT,
          "--strictPort",
        ],
        {
          cwd: adminDir,
          env: {
            ...env,
            VITE_ERU_API_BASE_URL: "/api",
            ERU_API_PROXY_TARGET: api,
          },
        },
      );
    } else if (action === "frontend-app") {
      await command(
        "pnpm",
        [
          "exec",
          "vite",
          "--host",
          "127.0.0.1",
          "--port",
          context.settings.PROJECT_WEB_PORT,
          "--strictPort",
        ],
        { cwd: appDir, env },
      );
    } else {
      await command("pnpm", ["exec", "wait-on", "--timeout", "60000", web], {
        cwd: appDir,
        env,
      });
      await command("pnpm", ["exec", "electron", "."], { cwd: appDir, env });
    }
    return;
  }
  const jobs = [];
  if (profile.app) jobs.push(["app", "frontend-app"]);
  if (profile.admin) jobs.push(["admin", "frontend-admin"]);
  if (profile.app === "desktop") jobs.push(["desktop", "frontend-desktop"]);
  const plan = {
    profile: action,
    backend: !!profile.backend,
    app: profile.app ? web : null,
    admin: profile.admin ? admin : null,
    api,
    desktop: profile.app === "desktop",
  };
  if (dryRun) {
    console.log(JSON.stringify(plan));
    return plan;
  }
  for (const [directory, needed] of [
    [appDir, profile.app],
    [adminDir, profile.admin],
  ]) {
    if (needed) {
      try {
        await access(path.join(directory, "node_modules/vite/package.json"));
      } catch {
        throw new Error(
          `Dependencies missing in ${directory}. Run pnpm setup:all at the workspace root.`,
        );
      }
    }
  }
  // Release only the Docker web service owned by this project when switching to host Vite.
  if (profile.backend && profile.app)
    await runStack("stop", ["web"], { context });
  if (profile.app)
    await portAvailable(context.settings.PROJECT_WEB_PORT, "App");
  if (profile.admin)
    await portAvailable(context.settings.PROJECT_ADMIN_PORT, "Admin");
  if (profile.backend) await runStack("up", [], { context });
  console.log(plan);
  if (!jobs.length) return plan;
  console.log(
    "Ctrl+C closes this terminal's frontends. Docker stays running; pnpm stop stops it without deleting data.",
  );
  if (jobs.length === 1) return runWorkspace(jobs[0][1]);
  // Fixed subcommands, with no shell-interpolated paths or user input.
  await command(
    process.execPath,
    [
      path.join(appDir, "node_modules/concurrently/dist/bin/concurrently.js"),
      "--kill-others",
      "--names",
      jobs.map(([name]) => name).join(","),
      ...jobs.map(([, task]) => `node scripts/workspace-dev.mjs ${task}`),
    ],
    { env },
  );
  return plan;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  runWorkspace(process.argv[2] || "full", {
    dryRun: process.argv.includes("--dry-run"),
  }).catch((error) => {
    if (
      ["SIGINT", "SIGTERM"].includes(error.signal) ||
      [130, 143].includes(error.exitCode)
    )
      return;
    console.error(error.message);
    process.exitCode = 1;
  });
}
