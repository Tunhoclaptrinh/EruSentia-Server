import * as fs from "fs";
import * as path from "path";
import {
  dbPool,
  withDatabaseClient,
} from "../src/infrastructure/database/postgres";

async function seed() {
  console.log(
    "================================================================",
  );
  console.log("🌱 SEEDING DATABASE: SENTIA HUB SERVICE");
  console.log(
    "================================================================\n",
  );

  await withDatabaseClient(async (client) => {
    await client.query("BEGIN");
    try {
      // 1. Run sql/03_seed.sql (Curated seed data)
      const seedSqlPath = path.resolve(process.cwd(), "sql/03_seed.sql");
      if (!fs.existsSync(seedSqlPath)) {
        throw new Error(`Seed SQL file not found: ${seedSqlPath}`);
      }
      console.log(
        "📦 Executing sql/03_seed.sql (Core Curated Templates & Users)...",
      );
      const sqlContent = fs.readFileSync(seedSqlPath, "utf-8");
      await client.query(sqlContent);
      console.log(
        "✅ Core templates, categories, and users seeded successfully!\n",
      );

      // 2. Generate 1,000 synthetic templates for Benchmark (EXPLAIN ANALYZE)
      console.log(
        "🚀 Generating 1,000 synthetic templates for performance benchmark...",
      );
      const categoriesRes = await client.query(
        "SELECT id FROM categories ORDER BY id LIMIT 8",
      );
      const usersRes = await client.query(
        "SELECT id FROM users ORDER BY id LIMIT 10",
      );

      if (categoriesRes.rows.length === 0 || usersRes.rows.length === 0) {
        throw new Error(
          "No categories or users found to generate synthetic templates.",
        );
      }

      const categoryIds = categoriesRes.rows.map((r) => r.id);
      const userIds = usersRes.rows.map((r) => r.id);

      const prefixes = [
        "Advanced",
        "Minimalist",
        "Masterclass",
        "Essential",
        "Ultimate",
        "Modern",
        "Agile",
        "Interactive",
        "System",
        "Modular",
      ];
      const subjects = [
        "React Architecture",
        "PostgreSQL Tuning",
        "Docker Compose",
        "Redis Caching",
        "Kubernetes Cluster",
        "DDD Modeling",
        "FastAPI Microservice",
        "Next.js App Router",
        "Tauri Desktop",
        "TipTap Editor Extension",
      ];

      let inserted = 0;
      for (let i = 1; i <= 1000; i++) {
        const prefix = prefixes[i % prefixes.length];
        const subject = subjects[i % subjects.length];
        const title = `${prefix} ${subject} Guide ${i}`;
        const slug = `${prefix.toLowerCase()}-${subject.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${i}`;
        const categoryId = categoryIds[i % categoryIds.length];
        const authorId = userIds[i % userIds.length];
        const ratingAvg = Number((3.5 + (i % 15) * 0.1).toFixed(2));
        const forksCount = (i * 7) % 500;
        const viewsCount = forksCount * 12 + (i % 200);
        const isPublic = i % 10 !== 0; // 90% public, 10% private

        const result = await client.query(
          `INSERT INTO templates (
          author_id, category_id, title, slug, description, content_json,
          version, is_public, forks_count, views_count, rating_avg, ratings_count, tags
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        ) ON CONFLICT (slug) DO NOTHING`,
          [
            authorId,
            categoryId,
            title,
            slug,
            `Automated benchmark template covering ${subject} with best practices and architecture blueprints.`,
            JSON.stringify({
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  text: `Sample benchmark content for ${title}`,
                },
              ],
            }),
            "1.0.0",
            isPublic,
            forksCount,
            viewsCount,
            ratingAvg,
            (i * 3) % 100,
            ["benchmark", "template", subject.toLowerCase().split(" ")[0]],
          ],
        );
        inserted += result.rowCount ?? 0;
      }

      const countRes = await client.query("SELECT count(*) FROM templates");
      await client.query("COMMIT");
      console.log(
        `Benchmark seed complete: ${inserted} new templates inserted.\n`,
      );

      // 3. Count summary
      console.log(`📊 Total templates in database: ${countRes.rows[0].count}`);
      console.log(
        "================================================================",
      );
      console.log(
        "🎉 Database seeding complete! Ready for EXPLAIN ANALYZE benchmark.",
      );
      console.log(
        "================================================================",
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

seed()
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(() => dbPool.end());
