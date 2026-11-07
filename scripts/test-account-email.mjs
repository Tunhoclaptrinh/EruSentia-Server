import { spawn } from "node:child_process";
import { startAccountEmailInfrastructure } from "./account-email-fixture.mjs";
const fixture = await startAccountEmailInfrastructure();
let child;
const stop = () => child?.kill("SIGTERM");
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
try {
  child = spawn(process.execPath, ["--test", "test/account-email.test.cjs"], {
    stdio: "inherit",
    env: {
      ...process.env,
      ...fixture.env,
      RUN_ACCOUNT_EMAIL_TESTS: "1",
      ACCOUNT_EMAIL_MAILPIT_URL: fixture.mailOrigin,
    },
  });
  process.exitCode = await new Promise((resolve) =>
    child.once("exit", (code) => resolve(code ?? 1)),
  );
} finally {
  await fixture.close();
  process.removeListener("SIGTERM", stop);
  process.removeListener("SIGINT", stop);
}
