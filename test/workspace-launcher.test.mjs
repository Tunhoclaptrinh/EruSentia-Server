import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  WorkspaceProcesses,
  requireFreePort,
} from "../scripts/workspace-processes.mjs";
import { portsFor, profiles, start } from "../scripts/workspace-dev.mjs";

test("unknown and prototype profile names fail before touching local configuration", async () => {
  for (const profile of ["unknown", "constructor", "__proto__", "toString"])
    await assert.rejects(start(profile), /Choose a profile/);
});

test("fresh clones can initialize the outer manifest without overwriting local files", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "eru-workspace-init-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scripts = path.join(root, "erusentia-server/scripts");
  await mkdir(scripts, { recursive: true });
  for (const file of [
    "workspace-dev.mjs",
    "workspace-processes.mjs",
    "project-stack.mjs",
    "workspace-package.json",
  ])
    await copyFile(
      fileURLToPath(new URL(`../scripts/${file}`, import.meta.url)),
      path.join(scripts, file),
    );
  const initialize = () =>
    execFileSync(
      process.execPath,
      [path.join(scripts, "workspace-dev.mjs"), "init"],
      { encoding: "utf8" },
    );
  initialize();
  const manifest = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  assert.equal(
    manifest.scripts.start,
    "node erusentia-server/scripts/workspace-dev.mjs start all",
  );
  assert.equal(manifest.packageManager, "pnpm@12.11.2");
  await writeFile(path.join(root, "package.json"), '{"keep":"local"}\n');
  await writeFile(path.join(root, ".nvmrc"), "keep-local-node\n");
  initialize();
  assert.equal(
    await readFile(path.join(root, "package.json"), "utf8"),
    '{"keep":"local"}\n',
  );
  assert.equal(
    await readFile(path.join(root, ".nvmrc"), "utf8"),
    "keep-local-node\n",
  );
});

async function listener() {
  const server = http.createServer((_request, response) =>
    response.end("unrelated service"),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}
async function unusedPort() {
  const server = await listener();
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function released(port) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await requireFreePort(port, "owned child");
      return;
    } catch {
      await delay(50);
    }
  }
  assert.fail(`Owned port ${port} was not released`);
}

test("all requested profiles select exactly the intended components", () => {
  assert.deepEqual(profiles, {
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
  });
});

test("reject invalid or overlapping ports, including infrastructure ports", () => {
  const settings = {
    PROJECT_WEB_PORT: "5184",
    PROJECT_API_PORT: "3001",
    PROJECT_POSTGRES_PORT: "5433",
  };
  assert.deepEqual(portsFor(settings), { app: 5184, admin: 5183, api: 3001 });
  for (const value of ["5184", "3001", "5433", "NaN", "65536", "0"])
    assert.throws(() => portsFor({ ...settings, PROJECT_ADMIN_PORT: value }));
});

test("port collision reports the owner conflict without killing the listener", async (t) => {
  const server = await listener();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  await assert.rejects(requireFreePort(port, "Admin"), /already in use/);
  assert.equal(
    await (await fetch(`http://127.0.0.1:${port}`)).text(),
    "unrelated service",
  );
});

test(
  "cleanup closes the owned descendant tree while leaving unrelated listeners running",
  { skip: process.platform === "win32", timeout: 12000 },
  async (t) => {
    const unrelated = await listener();
    t.after(() => new Promise((resolve) => unrelated.close(resolve)));
    const port = await unusedPort();
    const group = new WorkspaceProcesses();
    t.after(() => group.stop());
    const serverCode = `require('node:http').createServer((req,res)=>res.end('owned')).listen(${port}, '127.0.0.1')`;
    const parentCode = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(serverCode)}], {stdio:'ignore'}); setInterval(()=>{},1000)`;
    group.start(process.execPath, ["-e", parentCode], { stdio: "ignore" });
    await group.ready(`http://127.0.0.1:${port}`, 6000);
    await group.stop();
    await released(port);
    assert.equal(
      await (
        await fetch(`http://127.0.0.1:${unrelated.address().port}`)
      ).text(),
      "unrelated service",
    );
  },
);

test(
  "an unexpected child failure stops its frontend siblings and propagates failure",
  { skip: process.platform === "win32", timeout: 12000 },
  async (t) => {
    const port = await unusedPort();
    const group = new WorkspaceProcesses();
    t.after(() => group.stop());
    group.start(
      process.execPath,
      [
        "-e",
        `require('node:http').createServer((req,res)=>res.end('owned')).listen(${port}, '127.0.0.1')`,
      ],
      { stdio: "ignore" },
    );
    await group.ready(`http://127.0.0.1:${port}`, 6000);
    group.start(process.execPath, ["-e", "process.exit(3)"], {
      stdio: "ignore",
    });
    await assert.rejects(group.wait(), /exited \(3\)/);
    await released(port);
  },
);
