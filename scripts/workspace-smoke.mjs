import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { projectContext } from "./project-stack.mjs";
import { portsFor, workspaceRoot } from "./workspace-dev.mjs";

const desktop = process.argv.includes("--desktop");
const context = await projectContext();
const ports = portsFor(context.settings);
const output = path.join(
  workspaceRoot,
  ".local/workspace-verification",
  desktop ? "desktop" : "web",
);
await mkdir(output, { recursive: true, mode: 0o700 });
const results = {
  mode: desktop ? "desktop" : "web",
  checks: {},
  pageErrors: [],
};
let desktopVault;
if (desktop) {
  assert(
    process.env.ERU_USER_DATA_DIR,
    "Desktop smoke needs an isolated ERU_USER_DATA_DIR",
  );
  const profile = path.resolve(process.env.ERU_USER_DATA_DIR);
  assert(
    profile.startsWith(
      path.join(workspaceRoot, ".local/workspace-verification") + path.sep,
    ),
    "Use an owned profile inside .local/workspace-verification",
  );
  desktopVault = path.join(profile, "workspace-smoke-vault");
  await mkdir(desktopVault, { recursive: true, mode: 0o700 });
  assert.equal(
    (await readdir(desktopVault)).length,
    0,
    "Use a fresh empty smoke vault",
  );
}
const appBrowser = desktop
  ? await chromium.connectOverCDP(
      `http://127.0.0.1:${process.env.ERU_ELECTRON_DEBUG_PORT || 9239}`,
    )
  : await chromium.launch({ headless: true });
const adminBrowser = desktop
  ? await chromium.launch({ headless: true })
  : appBrowser;
try {
  const appContext = desktop
    ? appBrowser.contexts()[0]
    : await appBrowser.newContext();
  const page = desktop
    ? appContext
        .pages()
        .find((page) => page.url().startsWith(`http://127.0.0.1:${ports.app}`))
    : await appContext.newPage();
  assert(page, "Electron has not opened its editor window");
  page.setDefaultTimeout(60000);
  page.on("pageerror", (error) => results.pageErrors.push(error.message));
  if (!desktop) await page.goto(`http://127.0.0.1:${ports.app}`);
  await page.locator(".activity-bar").waitFor();
  // Desktop smoke requires an explicit isolated profile; never write to the user's vault.
  await page.evaluate(async (desktopVault) => {
    const { useVaultStore } = await import("/src/store/vault/index.ts");
    const state = useVaultStore.getState();
    assertDisposable(state);
    if (desktopVault) state.setDirPath(desktopVault);
    await state.createNoteWithContent(
      "Workspace smoke",
      "<h1>EruSentia workspace check</h1><p>Editor is ready.</p>",
    );
    function assertDisposable(state) {
      if (state.dirPath || state.dirHandle || state.activeNote)
        throw new Error("Refuse to modify an existing vault or draft");
    }
  }, desktopVault);
  await page.locator(".tiptap").waitFor();
  assert(
    (await page.locator(".tiptap").innerText()).includes("Editor is ready."),
  );
  await page.screenshot({ path: path.join(output, "app-editor.png") });
  results.checks.editor = "pass";

  const adminPage = await adminBrowser.newPage();
  adminPage.setDefaultTimeout(60000);
  adminPage.on("pageerror", (error) => results.pageErrors.push(error.message));
  await adminPage.goto(`http://127.0.0.1:${ports.admin}`);
  await adminPage.locator('input[autocomplete="username"]').waitFor();
  assert(
    await adminPage
      .locator('input[autocomplete="current-password"]')
      .isVisible(),
  );
  assert(
    await adminPage
      .getByRole("button", { name: "Đăng nhập", exact: true })
      .isVisible(),
  );
  await adminPage.screenshot({ path: path.join(output, "admin-login.png") });
  results.checks.adminLogin = "pass";
  for (const [name, url, status] of [
    ["apiHealth", `http://127.0.0.1:${ports.api}/health`, 200],
    ["adminHealthProxy", `http://127.0.0.1:${ports.admin}/api/health`, 200],
    [
      "adminRequiresAuth",
      `http://127.0.0.1:${ports.admin}/api/admin/users?page=1&size=10`,
      401,
    ],
  ]) {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, status, `${name} unexpected HTTP status`);
    const data = await response.json(); // HTML SPA fallbacks must not masquerade as API health.
    assert(data && typeof data === "object", `${name} did not return JSON`);
    results.checks[name] = response.status;
  }
  const cors = await fetch(`http://127.0.0.1:${ports.api}/health`, {
    headers: { Origin: `http://127.0.0.1:${ports.app}` },
  });
  assert.equal(
    cors.headers.get("access-control-allow-origin"),
    `http://127.0.0.1:${ports.app}`,
  );
  results.checks.appCors = "pass";
  assert.deepEqual(results.pageErrors, []);
  results.status = "pass";
} finally {
  await adminBrowser.close();
  if (desktop) await appBrowser.close();
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(results, null, 2) + "\n",
    { mode: 0o600 },
  );
}
console.log(JSON.stringify(results));
