const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

test("workspace profiles isolate checkouts, honor ports and fail before starting services", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eru-launcher-"));
  const keys = [
    "ERU_APP_DIR",
    "ERU_ADMIN_DIR",
    "ERU_PROJECT_ENV_FILE",
    "PROJECT_WEB_PORT",
    "PROJECT_ADMIN_PORT",
    "PROJECT_API_PORT",
    "PROJECT_CORS_ORIGINS",
  ];
  const original = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  t.after(async () => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  process.env.ERU_PROJECT_ENV_FILE = path.join(root, ".env.project.local");
  process.env.ERU_APP_DIR = path.join(root, "missing-app");
  process.env.ERU_ADMIN_DIR = path.join(root, "admin");
  process.env.PROJECT_WEB_PORT = "25173";
  process.env.PROJECT_ADMIN_PORT = "25183";
  process.env.PROJECT_API_PORT = "23001";
  delete process.env.PROJECT_CORS_ORIGINS;
  await fs.mkdir(process.env.ERU_ADMIN_DIR);
  await fs.writeFile(
    path.join(process.env.ERU_ADMIN_DIR, "package.json"),
    JSON.stringify({ name: "erusentia-admin" }),
  );
  const { runWorkspace } = await import("../scripts/workspace-dev.mjs");
  const { projectContext } = await import("../scripts/project-stack.mjs");
  await t.test(
    "server/admin does not require an App checkout and uses custom ports",
    async () => {
      const plan = await runWorkspace("server-admin", { dryRun: true });
      assert.equal(plan.app, null);
      assert.equal(plan.admin, "http://127.0.0.1:25183");
      assert.equal(plan.api, "http://127.0.0.1:23001");
      const context = await projectContext();
      assert(context.settings.PROJECT_CORS_ORIGINS.includes(plan.admin));
      await assert.rejects(
        fs.access(path.join(process.env.ERU_ADMIN_DIR, ".env.local")),
        { code: "ENOENT" },
      );
      await assert.rejects(fs.access(process.env.ERU_APP_DIR), {
        code: "ENOENT",
      });
    },
  );
  await t.test("App/server does not require an Admin checkout", async () => {
    process.env.ERU_APP_DIR = path.join(root, "app");
    await fs.mkdir(process.env.ERU_APP_DIR);
    await fs.writeFile(
      path.join(process.env.ERU_APP_DIR, "package.json"),
      JSON.stringify({ name: "erusentia" }),
    );
    await fs.writeFile(
      path.join(process.env.ERU_APP_DIR, "docker-compose.yml"),
      "services: {}\n",
    );
    process.env.ERU_ADMIN_DIR = path.join(root, "missing-admin");
    const plan = await runWorkspace("app-server", { dryRun: true });
    assert.equal(plan.admin, null);
    assert.equal(plan.desktop, true);
    process.env.ERU_ADMIN_DIR = path.join(root, "admin");
  });
  await t.test(
    "published and outer-manifest CLI forms share the dry-run plan",
    async () => {
      const { execFileSync } = require("node:child_process");
      const launcher = path.resolve(__dirname, "../scripts/workspace-dev.mjs");
      for (const args of [
        ["full", "--dry-run"],
        ["start", "all", "--dry-run"],
      ]) {
        const output = execFileSync(process.execPath, [launcher, ...args], {
          encoding: "utf8",
        });
        const plan = JSON.parse(output.trim());
        assert.equal(plan.backend, true);
        assert.equal(plan.desktop, true);
        assert.equal(plan.app, "http://127.0.0.1:25173");
        assert.equal(plan.admin, "http://127.0.0.1:25183");
      }
      await assert.rejects(
        fs.access(path.join(process.env.ERU_APP_DIR, ".env.local")),
        { code: "ENOENT" },
      );
      await assert.rejects(
        fs.access(path.join(process.env.ERU_ADMIN_DIR, ".env.local")),
        { code: "ENOENT" },
      );
    },
  );
  await t.test("colliding frontend ports are rejected", async () => {
    process.env.PROJECT_ADMIN_PORT = process.env.PROJECT_WEB_PORT;
    await assert.rejects(
      runWorkspace("server-admin", { dryRun: true }),
      /ports must be distinct/,
    );
    process.env.PROJECT_ADMIN_PORT = "25183";
  });
  await t.test(
    "an occupied Admin port is reported without starting Docker or killing the owner",
    async () => {
      await fs.mkdir(
        path.join(process.env.ERU_ADMIN_DIR, "node_modules/vite"),
        { recursive: true },
      );
      await fs.writeFile(
        path.join(process.env.ERU_ADMIN_DIR, "node_modules/vite/package.json"),
        "{}",
      );
      const server = net.createServer();
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      try {
        process.env.PROJECT_ADMIN_PORT = String(server.address().port);
        await assert.rejects(
          runWorkspace("admin"),
          /port .* occupied or unavailable/,
        );
        assert.equal(server.listening, true);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    },
  );
});
