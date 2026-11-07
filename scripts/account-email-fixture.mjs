import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(path.join(root, "package.json"));
const { Pool } = require("pg");
const load = (file) =>
  import(pathToFileURL(path.join(root, "dist", file)).href);
export async function startAccountEmailInfrastructure() {
  const suffix = Date.now() + "-" + randomBytes(3).toString("hex"),
    pg = "eru-email-test-" + suffix + "-pg",
    mail = "eru-email-test-" + suffix + "-mail",
    password = randomBytes(24).toString("hex");
  const names = [];
  function docker(args, env = process.env) {
    const result = spawnSync("docker", args, {
      env,
      encoding: "utf8",
      timeout: 60000,
    });
    if (result.status !== 0)
      throw Error("Account email disposable infrastructure failed: " + args[0]);
    return result.stdout.trim();
  }
  const close = async () => {
    for (const name of names.reverse())
      try {
        docker(["rm", "-fv", name]);
      } catch {}
  };
  try {
    docker(
      [
        "run",
        "--rm",
        "-d",
        "--name",
        pg,
        "--label",
        "io.erusentia.test=account-email",
        "-p",
        "127.0.0.1::5432",
        "-e",
        "POSTGRES_PASSWORD",
        "-e",
        "POSTGRES_DB=project_test_email",
        "postgres:16-alpine",
      ],
      { ...process.env, POSTGRES_PASSWORD: password },
    );
    names.push(pg);
    docker([
      "run",
      "--rm",
      "-d",
      "--name",
      mail,
      "--label",
      "io.erusentia.test=account-email",
      "-p",
      "127.0.0.1::8025",
      "-p",
      "127.0.0.1::1025",
      "axllent/mailpit:v1.32.0",
    ]);
    names.push(mail);
    let ready = false;
    for (let n = 0; n < 60; n++) {
      try {
        docker(["exec", pg, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]);
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    if (!ready) throw Error("Disposable PostgreSQL not ready");
    const port = (name, internal) =>
      docker(["port", name, internal]).split(":").at(-1);
    const mailOrigin = "http://127.0.0.1:" + port(mail, "8025/tcp");
    for (let n = 0; n < 30; n++) {
      try {
        if ((await fetch(mailOrigin + "/api/v1/messages")).ok) break;
      } catch {}
      if (n === 29) throw Error("Disposable Mailpit not ready");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const env = {
      NODE_ENV: "test",
      TEMPLATE_STORE: "postgres",
      DB_HOST: "127.0.0.1",
      DB_PORT: port(pg, "5432/tcp"),
      DB_USERNAME: "postgres",
      DB_PASSWORD: password,
      DB_DATABASE: "project_test_email",
      DB_SSL: "false",
      ACCOUNT_EMAIL_MODE: "mailpit",
      ACCOUNT_EMAIL_APP_URL: "http://127.0.0.1:5198",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: port(mail, "1025/tcp"),
      QUEUE_ENABLED: "false",
      CACHE_ENABLED: "false",
      JWT_SECRET: randomBytes(40).toString("hex"),
    };
    return {
      env,
      mailOrigin,
      close,
      async startApi({ port = 0, origin = "http://127.0.0.1:5198" } = {}) {
        const { readConfig } = await load("src/config.js"),
          { migrateProject } = await load(
            "src/infrastructure/database/project-migrations.js",
          ),
          { createApplication } = await load("src/app.js");
        const settings = readConfig({
            ...env,
            CORS_ORIGINS: origin,
            SWAGGER_ENABLED: "true",
          }),
          pool = new Pool({
            ...settings.database,
            user: settings.database.username,
          });
        try {
          await migrateProject(pool, path.join(root, "sql"), {
            accountEmail: true,
          });
        } finally {
          await pool.end();
        }
        const app = await createApplication(settings, false);
        await app.listen(port, "127.0.0.1");
        return { app, origin: await app.getUrl() };
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
