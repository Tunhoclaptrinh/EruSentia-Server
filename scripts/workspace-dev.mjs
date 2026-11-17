import assert from "node:assert/strict";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  projectContext,
  runStack,
  command,
  backendServices,
  serverRoot,
} from "./project-stack.mjs";
import { WorkspaceProcesses, requireFreePort } from "./workspace-processes.mjs";

export const workspaceRoot = path.resolve(serverRoot, "..");
function directories() {
  return {
    appDir: path.resolve(
      process.env.ERU_APP_DIR || path.join(workspaceRoot, "erusentia-app"),
    ),
    adminDir: path.resolve(
      process.env.ERU_ADMIN_DIR || path.join(workspaceRoot, "erusentia-admin"),
    ),
  };
}

async function checkout(directory, expected) {
  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(path.join(directory, "package.json"), "utf8"),
    );
  } catch {
    throw new Error(`Missing checkout: ${directory}`);
  }
  assert.equal(manifest.name, expected, `Unexpected checkout at ${directory}`);
}

export const profiles = {
  all: { app: "desktop", server: true, admin: true },
  full: { app: "desktop", server: true, admin: true },
  web: { app: "web", server: true, admin: true },
  "app-server": { app: "desktop", server: true },
  "app-server-web": { app: "web", server: true },
  "server-admin": { server: true, admin: true },
  app: { app: "desktop" },
  "app-web": { app: "web" },
  server: { server: true },
  admin: { admin: true },
};

export function portsFor(settings) {
  const ports = {
    app: Number(settings.PROJECT_WEB_PORT),
    admin: Number(settings.PROJECT_ADMIN_PORT || 5183),
    api: Number(settings.PROJECT_API_PORT),
  };
  const all = { ...settings, PROJECT_ADMIN_PORT: String(ports.admin) };
  const values = Object.entries(all)
    .filter(([key]) => key.endsWith("_PORT"))
    .map(([, value]) => Number(value));
  assert(
    values.every(
      (value) => Number.isInteger(value) && value > 0 && value <= 65535,
    ),
    "Invalid workspace port",
  );
  assert.equal(
    new Set(values).size,
    values.length,
    "All project ports, including App/Admin/API, must be distinct",
  );
  return ports;
}

async function updateEnv(file, values, label) {
  let previous = "";
  try {
    previous = await readFile(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const remaining = { ...values };
  const lines = previous
    .replace(/\n$/, "")
    .split(/\r?\n/)
    .filter((line, index) => line || index > 0)
    .map((line) => {
      const key = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(
        line,
      )?.[1];
      if (!key || !Object.hasOwn(values, key)) return line;
      delete remaining[key];
      return `${key}=${JSON.stringify(String(values[key]))}`;
    });
  lines.push(
    ...Object.entries(remaining).map(
      ([key, value]) => `${key}=${JSON.stringify(String(value))}`,
    ),
  );
  const next = lines.join("\n") + "\n";
  if (next !== previous) {
    if (previous) {
      const backup = path.join(
        workspaceRoot,
        ".local/backups/workspace-env",
        new Date().toISOString().replaceAll(/[:.]/g, "-"),
      );
      await mkdir(backup, { recursive: true, mode: 0o700 });
      await writeFile(path.join(backup, label), previous, {
        mode: 0o600,
        flag: "wx",
      });
    }
    await writeFile(file, next, { mode: 0o600 });
    console.log(
      `Configured ${path.relative(workspaceRoot, file)}${previous ? " (previous values backed up)" : ""}`,
    );
  }
  await chmod(file, 0o600);
}

export async function configure(
  profile = profiles.all,
  { dryRun = false } = {},
) {
  const { appDir, adminDir } = directories();
  const initial = await projectContext();
  const ports = portsFor(initial.settings);
  if (dryRun) return { context: initial, ports };
  const origins = new Set(
    initial.settings.PROJECT_CORS_ORIGINS.split(",").map((value) =>
      value.trim(),
    ),
  );
  for (const port of [ports.app, ports.admin])
    for (const host of ["127.0.0.1", "localhost"])
      origins.add(`http://${host}:${port}`);
  await updateEnv(
    initial.envFile,
    {
      PROJECT_ADMIN_PORT: ports.admin,
      PROJECT_CORS_ORIGINS: [...origins].join(","),
    },
    "project.env",
  );
  // Never replace the backend .env, hosted database config, credentials or vaults.
  if (profile.app)
    await updateEnv(
      path.join(appDir, ".env.local"),
      { VITE_ERU_API_BASE_URL: `http://127.0.0.1:${ports.api}` },
      "app.env.local",
    );
  if (profile.admin)
    await updateEnv(
      path.join(adminDir, ".env.local"),
      {
        VITE_ERU_API_BASE_URL: "/api",
        ERU_API_PROXY_TARGET: `http://127.0.0.1:${ports.api}`,
      },
      "admin.env.local",
    );
  return { context: await projectContext(), ports };
}

function pnpm(args, cwd) {
  return command(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, {
    cwd,
    shell: process.platform === "win32",
  });
}

async function setup() {
  const { appDir, adminDir } = directories();
  for (const [directory, name] of [
    [appDir, "erusentia"],
    [serverRoot, "sentia-hub-service"],
    [adminDir, "erusentia-admin"],
  ])
    await checkout(directory, name);
  for (const cwd of [appDir, serverRoot, adminDir])
    await pnpm(["install", "--frozen-lockfile"], cwd);
  const require = createRequire(path.join(appDir, "package.json"));
  try {
    await access(require("electron"));
  } catch {
    await command(
      process.execPath,
      [path.join(appDir, "node_modules/electron/install.js")],
      { cwd: appDir },
    );
  }
  await configure();
  console.log(
    "Three lockfiles installed. Use pnpm start or pnpm start:web from the workspace root.",
  );
}

export async function start(profileName, { dryRun = false } = {}) {
  assert(
    Object.hasOwn(profiles, profileName),
    `Choose a profile: ${Object.keys(profiles).join(", ")}`,
  );
  const profile = profiles[profileName];
  const { appDir, adminDir } = directories();
  if (profile.app) await checkout(appDir, "erusentia");
  if (profile.admin) await checkout(adminDir, "erusentia-admin");
  const { context, ports } = await configure(profile, { dryRun });
  const api = `http://127.0.0.1:${ports.api}`;
  const plan = {
    profile: profileName,
    backend: !!profile.server,
    app: profile.app ? `http://127.0.0.1:${ports.app}` : null,
    admin: profile.admin ? `http://127.0.0.1:${ports.admin}` : null,
    api,
    desktop: profile.app === "desktop",
  };
  if (dryRun) {
    console.log(JSON.stringify(plan));
    return plan;
  }
  const group = new WorkspaceProcesses();
  const interrupt = () => {
    void group.stop();
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    // Release only a legacy Docker frontend in this project's Compose stack.
    if (profile.server && profile.app) {
      const combined = await projectContext({ appDir });
      await runStack("stop", ["web"], { context: combined });
    }
    for (const [name, directory] of [
      ["app", appDir],
      ["admin", adminDir],
    ]) {
      if (!profile[name]) continue;
      await requireFreePort(ports[name], name);
      await access(path.join(directory, "node_modules/vite/bin/vite.js"));
    }
    if (profile.server) await runStack("up", backendServices, { context });
    if (group.stopping) return;
    const common = {
      ...process.env,
      ERU_API_BASE_URL: api,
      VITE_ERU_API_BASE_URL: api,
    };
    delete common.ELECTRON_RUN_AS_NODE;
    if (profile.app) {
      group.start(
        process.execPath,
        [
          path.join(appDir, "node_modules/vite/bin/vite.js"),
          "--host",
          "127.0.0.1",
          "--port",
          String(ports.app),
          "--strictPort",
        ],
        { cwd: appDir, env: common },
      );
    }
    if (profile.admin) {
      group.start(
        process.execPath,
        [
          path.join(adminDir, "node_modules/vite/bin/vite.js"),
          "--host",
          "127.0.0.1",
          "--port",
          String(ports.admin),
          "--strictPort",
        ],
        {
          cwd: adminDir,
          env: {
            ...common,
            VITE_ERU_API_BASE_URL: "/api",
            ERU_API_PROXY_TARGET: api,
          },
        },
      );
    }
    if (profile.app === "desktop") {
      await group.ready(`http://127.0.0.1:${ports.app}`);
      const require = createRequire(path.join(appDir, "package.json"));
      const args = ["."];
      if (process.env.ERU_ELECTRON_DEBUG_PORT) {
        assert(
          /^[0-9]+$/.test(process.env.ERU_ELECTRON_DEBUG_PORT),
          "Invalid debug port",
        );
        const port = Number(process.env.ERU_ELECTRON_DEBUG_PORT);
        assert(port > 1024 && port < 65536, "Invalid debug port");
        await requireFreePort(port, "Electron debug");
        args.push(
          "--remote-debugging-address=127.0.0.1",
          `--remote-debugging-port=${port}`,
        );
      }
      group.start(require("electron"), args, {
        cwd: appDir,
        env: { ...common, ERU_DEV_SERVER_URL: `http://127.0.0.1:${ports.app}` },
      });
    }
    console.log(JSON.stringify(plan));
    if (!profile.app && !profile.admin) return plan;
    console.log(
      "Ctrl+C closes only this frontend group. Backend data stays in Docker; pnpm stop stops the backend without deleting volumes.",
    );
    await group.wait();
  } catch (error) {
    if (!group.stopping || group.failure) throw error;
  } finally {
    await group.stop();
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}

// Keep the profile-first API already published on main alongside the outer
// manifest's action-first commands. Both use the same lifecycle implementation.
export function runWorkspace(action = "full", options = {}) {
  if (action === "setup") return setup();
  return start(action, options);
}

async function main() {
  assert.equal(
    Number(process.versions.node.split(".")[0]),
    24,
    "Use Node 24: run nvm use in the outer EruSentia directory",
  );
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((arg) => arg !== "--dry-run");
  const [action = "full", profile = "all", ...extra] = positional;
  assert.equal(extra.length, 0, "Unexpected launcher arguments");
  assert(
    action === "start" || positional.length <= 1,
    "Only start accepts a profile argument",
  );
  assert(
    !dryRun || action === "start" || Object.hasOwn(profiles, action),
    "Only profiles accept --dry-run",
  );
  if (Object.hasOwn(profiles, action)) return runWorkspace(action, { dryRun });
  if (action === "init") {
    for (const [name, content] of [
      [
        "package.json",
        await readFile(
          path.join(serverRoot, "scripts/workspace-package.json"),
          "utf8",
        ),
      ],
      [".nvmrc", "24.22.1\n"],
    ]) {
      try {
        await writeFile(path.join(workspaceRoot, name), content, {
          flag: "wx",
        });
        console.log(`Created outer ${name}`);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        console.log(`Kept existing outer ${name}`);
      }
    }
    return;
  }
  if (action === "setup") return setup();
  if (action === "configure") return configure();
  if (action === "start") return start(profile, { dryRun });
  if (action === "stop") return runStack("down");
  if (action === "check") {
    const { appDir, adminDir } = directories();
    const { context, ports } = await configure();
    const version = execFileSync(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["--version"],
      { encoding: "utf8", shell: process.platform === "win32" },
    ).trim();
    assert.equal(version, "12.11.2", "pnpm must match the lockfile toolchain");
    await command("docker", ["info", "--format", "Docker {{.ServerVersion}}"]);
    await command("docker", ["compose", "version"]);
    await command("docker", [...context.args, "config", "--quiet"], {
      env: context.env,
    });
    for (const directory of [appDir, serverRoot, adminDir])
      await access(path.join(directory, "node_modules"));
    console.log(
      JSON.stringify({
        node: process.versions.node,
        pnpm: version,
        project: context.settings.PROJECT_COMPOSE_NAME,
        ports,
        profiles: Object.keys(profiles),
      }),
    );
    return;
  }
  throw new Error("Use init, setup, configure, check, start <profile> or stop");
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    if (
      ["SIGINT", "SIGTERM"].includes(error.signal) ||
      [130, 143].includes(error.exitCode)
    )
      return;
    console.error(error.message);
    process.exitCode = 1;
  });
}
