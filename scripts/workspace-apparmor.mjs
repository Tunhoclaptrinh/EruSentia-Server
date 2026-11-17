import assert from "node:assert/strict";
import path from "node:path";

export function electronProfile(root) {
  assert(
    typeof root === "string" && path.posix.isAbsolute(root),
    "Use an absolute Linux checkout path",
  );
  // Quotes are escaped below; reject policy controls/globs in the user-selected
  // directory so only the intentional Electron-version wildcard grants userns.
  assert(
    !/[\x00-\x1f\x7f*?\[\]{}]/.test(root),
    "Checkout path contains AppArmor controls or wildcard characters",
  );
  const app = path.posix
    .join(root, "erusentia-app")
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"');
  return `# EruSentia development Electron only. Generated for this checkout.\nabi <abi/4.0>,\ninclude <tunables/global>\nprofile erusentia-workspace-electron "${app}/node_modules/.pnpm/electron@*/node_modules/electron/dist/electron" flags=(unconfined) {\n  userns,\n}\n`;
}

export function profileInstaller(profile) {
  return `# Generated installer: installs one exact per-checkout AppArmor profile.\nfrom pathlib import Path\nimport os, subprocess, tempfile\nexpected = ${JSON.stringify(profile)}\ndestination = Path('/etc/apparmor.d/erusentia-workspace-electron')\nif destination.exists() and destination.read_text() != expected:\n    raise SystemExit('Existing profile differs. Review it before replacing; nothing changed.')\nwith tempfile.NamedTemporaryFile(mode='w', prefix='.erusentia-check-', delete=False) as stream:\n    stream.write(expected)\n    temporary = Path(stream.name)\ntry:\n    subprocess.run(['/usr/sbin/apparmor_parser', '-Q', '-K', str(temporary)], check=True)\nfinally:\n    temporary.unlink(missing_ok=True)\nwith tempfile.NamedTemporaryFile(mode='w', dir=destination.parent, prefix='.erusentia-install-', delete=False) as stream:\n    stream.write(expected)\n    pending = Path(stream.name)\nos.chmod(pending, 0o644)\nos.replace(pending, destination)\nsubprocess.run(['/usr/sbin/apparmor_parser', '-r', str(destination)], check=True)\nprint('Installed and loaded:', destination)\n`;
}
