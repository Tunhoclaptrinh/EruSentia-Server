import "reflect-metadata";
import { config } from "dotenv";
import { createApplication } from "./app";
import { readConfig } from "./config";

async function bootstrap() {
  config();
  const settings = readConfig();
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
