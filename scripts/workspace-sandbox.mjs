// Ubuntu 24.04 per-application userns permission, following its release notes.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { workspaceRoot } from "./workspace-dev.mjs";
import { electronProfile, profileInstaller } from "./workspace-apparmor.mjs";

assert.equal(
  process.platform,
  "linux",
  "This helper configures Linux AppArmor only",
);
assert(
  process.argv.slice(2).every((value) => value === "--apply"),
  "Use --apply or no arguments",
);
const directory = path.join(workspaceRoot, ".local/system");
await mkdir(directory, { recursive: true, mode: 0o700 });
const profile = electronProfile(workspaceRoot);
const file = path.join(directory, "erusentia-workspace-electron.apparmor");
await writeFile(file, profile, { mode: 0o600 });
const helper = path.join(directory, "install-electron-apparmor.py");
await writeFile(helper, profileInstaller(profile), { mode: 0o600 });
const parsed = spawnSync("/usr/sbin/apparmor_parser", ["-Q", "-K", file], {
  stdio: "inherit",
});
assert.equal(
  parsed.status,
  0,
  "AppArmor profile did not compile; no system configuration changed",
);
console.log(
  `Prepared ${file}. Only this checkout's Electron gets userns permission. Global kernel policy and existing Electron sandbox settings are unchanged.`,
);
if (process.argv.includes("--apply")) {
  const result = spawnSync(
    "/usr/bin/pkexec",
    ["/usr/bin/python3", "-I", helper],
    {
      stdio: "inherit",
    },
  );
  if (result.status !== 0) process.exitCode = result.status || 1;
} else
  console.log("Apply with: pnpm setup:sandbox (Ubuntu authentication dialog).");
