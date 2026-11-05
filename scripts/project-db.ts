import { seedProjectDemo } from "../src/infrastructure/database/project-demo";
import { dbPool } from "../src/infrastructure/database/postgres";
import {
  assertProjectDatabase,
  migrateProject,
  seedProject,
} from "../src/infrastructure/database/project-migrations";

async function main() {
  assertProjectDatabase(process.env.DB_DATABASE ?? "");
  if (
    (process.argv[2] === "demo" ||
      process.env.PROJECT_DEMO_ACCOUNTS === "true") &&
    process.env.NODE_ENV === "production"
  )
    throw new Error("Demo accounts are forbidden in production");
  switch (process.argv[2]) {
    case "migrate":
      console.log({ applied: await migrateProject(dbPool) });
      break;
    case "seed":
      await migrateProject(dbPool);
      console.log({
        demoFixtures: await seedProject(dbPool),
        demoOwnerCanLogin: false,
      });
      break;
    case "bootstrap":
      console.log({
        applied: await migrateProject(dbPool),
        fixtures: await seedProject(dbPool),
      });
      if (process.env.PROJECT_DEMO_ACCOUNTS === "true")
        console.log(await seedProjectDemo(dbPool));
      break;
    case "demo":
      await migrateProject(dbPool);
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
