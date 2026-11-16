import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  electronProfile,
  profileInstaller,
} from "../scripts/workspace-apparmor.mjs";

test("AppArmor permission stays inside the selected checkout and follows Electron upgrades", () => {
  const profile = electronProfile("/srv/Eru Sentia");
  assert(
    profile.includes(
      '"/srv/Eru Sentia/erusentia-app/node_modules/.pnpm/electron@*/node_modules/electron/dist/electron"',
    ),
  );
  assert.equal(profile.split("*").length - 1, 1);
  assert(profile.includes("userns,"));
  assert(!profile.includes("sysctl"));
  assert(!profile.includes("--no-sandbox"));
});

test("paths cannot inject a policy rule or widen the per-checkout attachment", () => {
  for (const root of [
    "relative",
    "/srv/*",
    "/srv/?",
    "/srv/[ab]",
    "/srv/{a,b}",
    "/srv/unsafe\nprofile unrestricted /** { userns, }",
    "/srv/\0bad",
  ])
    assert.throws(() => electronProfile(root));
  assert(electronProfile('/srv/a"b').includes('/srv/a\\"b/erusentia-app'));
});

test(
  "generated privileged installer is valid Python without executing any system mutation",
  { skip: process.platform === "win32" },
  () => {
    const source = profileInstaller(electronProfile("/srv/Eru Sentia"));
    const result = spawnSync(
      "python3",
      ["-I", "-c", "import ast,sys; ast.parse(sys.stdin.read())"],
      { input: source, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  },
);
