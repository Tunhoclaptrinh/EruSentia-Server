import "reflect-metadata";
import { config } from "dotenv";
import { createApplication } from "./app";
import { readConfig } from "./config";

async function bootstrap() {
  config();
  const settings = readConfig();
  if (!process.env.JWT_SECRET)
    console.warn(
      "JWT_SECRET is unset: using a temporary development signing key. Configure a stable random key for persistent access tokens.",
    );
  const app = await createApplication(settings);
  app.enableShutdownHooks();
  try {
    await app.listen(settings.port, settings.host);
    console.log(
      `Template API (${settings.store}) listening at ${await app.getUrl()}`,
    );
  } catch (error) {
    await app.close();
    throw error;
  }
}
bootstrap().catch((error: Error) => {
  console.error("API startup failed:", error.message);
  process.exitCode = 1;
});
