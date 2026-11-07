import { dbPool } from "../src/infrastructure/database/postgres";
import {
  applyTechnicalRetention,
  prepareTechnicalRetention,
} from "../src/operations/technical-retention";
async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  if (args.length === 1 && args[0] === "--help") {
    console.log("pnpm data:retention [--as-of <ISO>] | --apply --as-of <reviewed ISO> --confirm <reviewed digest>");
    return;
  }
  const seen = new Set<string>();
  let apply = false;
  let asOf: string | undefined;
  let confirm: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (seen.has(key)) throw Error("RETENTION_ARGUMENTS");
    seen.add(key);
    if (key === "--apply") apply = true;
    else if (key === "--as-of" || key === "--confirm") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw Error("RETENTION_ARGUMENTS");
      if (key === "--as-of") asOf = value;
      else confirm = value;
    } else throw Error("RETENTION_ARGUMENTS");
  }
  if (confirm && !apply) throw Error("RETENTION_ARGUMENTS");
  if (apply && (!asOf || !confirm)) throw Error("RETENTION_CONFIRMATION_REQUIRED");
  const result = apply
    ? await applyTechnicalRetention(dbPool, asOf!, confirm!)
    : await prepareTechnicalRetention(dbPool, asOf);
  console.log(JSON.stringify({ ...result, dryRun: !apply }, null, 2));
}
main()
  .catch((error) => {
    const code =
      error instanceof Error && /^RETENTION_[A-Z_]+$/.test(error.message)
        ? error.message
        : "RETENTION_FAILED";
    console.error(
      JSON.stringify({
        code,
        message:
          "No private diagnostics emitted. Check the documented configuration and review a fresh dry-run.",
      }),
    );
    process.exitCode = 1;
  })
  .finally(() => dbPool.end());
