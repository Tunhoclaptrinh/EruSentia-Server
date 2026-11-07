import { accountEmailConfig } from "../src/auth/account-email.config";
import { seedCommunityDemo } from "../src/infrastructure/database/community-demo";
import { seedProjectDemo } from "../src/infrastructure/database/project-demo";
import { dbPool } from "../src/infrastructure/database/postgres";
import {
  assertProjectDatabase,
  migrateProject,
  seedProject,
} from "../src/infrastructure/database/project-migrations";

async function main() {
  assertProjectDatabase(process.env.DB_DATABASE ?? "");
  if (process.env.DB_HOST?.includes("-pooler."))
    throw new Error(
      "Project migrations require a direct PostgreSQL endpoint, not a -pooler hostname",
    );
  if (
    (process.argv[2] === "demo" ||
      process.env.PROJECT_DEMO_ACCOUNTS === "true") &&
    process.env.NODE_ENV === "production"
  )
    throw new Error("Demo accounts are forbidden in production");
  const accountEmail = accountEmailConfig(process.env);
  switch (process.argv[2]) {
    case "migrate":
      console.log({
        applied: await migrateProject(dbPool, undefined, {
          accountEmail: accountEmail.enabled,
        }),
      });
      break;
    case "seed":
      await migrateProject(dbPool, undefined, {
        accountEmail: accountEmail.enabled,
      });
      console.log({
        demoFixtures: await seedProject(dbPool),
        demoOwnerCanLogin: false,
      });
      break;
    case "bootstrap":
      console.log({
        applied: await migrateProject(dbPool, undefined, {
          accountEmail: accountEmail.enabled,
        }),
        fixtures: await seedProject(dbPool),
      });
      if (process.env.PROJECT_COMMUNITY_DEMO !== "false")
        console.log(await seedCommunityDemo(dbPool));
      if (process.env.PROJECT_DEMO_ACCOUNTS === "true")
        console.log(await seedProjectDemo(dbPool));
      break;
    case "demo":
      await migrateProject(dbPool, undefined, {
        accountEmail: accountEmail.enabled,
      });
      await seedProject(dbPool);
      console.log(
        await seedProjectDemo(dbPool, {
          ...process.env,
          PROJECT_DEMO_ACCOUNTS: "true",
        }),
      );
      break;
    default:
      throw new Error(
        "Use pnpm project:migrate, project:seed or project:seed:demo",
      );
  }
}

main()
  .catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Project database operation failed",
    );
    process.exitCode = 1;
  })
  .finally(() => dbPool.end());
