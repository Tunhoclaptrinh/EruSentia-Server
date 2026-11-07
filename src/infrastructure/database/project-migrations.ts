import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool, PoolClient } from "pg";
import { Passwords } from "../../auth/passwords";

const migrationFiles = [
  "01_schema.sql",
  "02_indexes.sql",
  "05_auth_sessions.sql",
  "06_message_queue.sql",
  "07_template_cache_revision.sql",
  "08_template_revisions.sql",
  "10_service_controls.sql",
];
const optionalMigration = "09_account_email.sql";
const lockName = "erusentia-project-migrations-v1";

export function assertProjectDatabase(name: string) {
  if (!/^(eru_project_|project_test_)[a-z0-9_]+$/.test(name)) {
    throw new Error(
      "Project commands require an explicit DB_DATABASE beginning with eru_project_ or project_test_",
    );
  }
}

export async function withProjectLock<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ name: string }>(
      "SELECT current_database() AS name",
    );
    assertProjectDatabase(rows[0].name);
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockName]);
    try {
      return await operation(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]);
    }
  } finally {
    client.release();
  }
}

/** Additive, checksummed journal for a new project database; never silently adopts a legacy DB. */
export async function migrateProject(
  pool: Pool,
  sqlRoot = resolve(process.cwd(), "sql"),
  options: { accountEmail?: boolean } = {},
) {
  const migrations = await Promise.all(
    migrationFiles.map(async (id) => {
      const source = (await readFile(resolve(sqlRoot, id), "utf8")).replace(
        /\r\n/g,
        "\n",
      );
      return {
        id,
        checksum: createHash("sha256").update(source).digest("hex"),
        // Known historical files wrap their entire script in BEGIN/COMMIT.
        // PL/pgSQL BEGIN blocks have no semicolon and are deliberately preserved.
        sql: source.replace(/^BEGIN;\s*$/gm, "").replace(/^COMMIT;\s*$/gm, ""),
      };
    }),
  );
  let optional: (typeof migrations)[number] | undefined;
  try {
    const source = (
      await readFile(resolve(sqlRoot, optionalMigration), "utf8")
    ).replace(/\r\n/g, "\n");
    optional = {
      id: optionalMigration,
      checksum: createHash("sha256").update(source).digest("hex"),
      sql: source,
    };
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "ENOENT" ||
      options.accountEmail
    )
      throw error;
  }
  return withProjectLock(pool, async (client) => {
    const existing = await client.query(
      "SELECT to_regclass('public.eru_schema_migrations') AS journal",
    );
    if (!existing.rows[0].journal) {
      const tables = await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public'",
      );
      if (tables.rowCount)
        throw new Error(
          "Refusing to adopt a database with untracked tables; use a new project database",
        );
    }
    await client.query(`CREATE TABLE IF NOT EXISTS eru_schema_migrations (
      id text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = (
      await client.query<{ id: string; checksum: string }>(
        "SELECT id, checksum FROM eru_schema_migrations ORDER BY id",
      )
    ).rows;
    for (const row of applied) {
      const migration = [...migrations, ...(optional ? [optional] : [])].find(
        (item) => item.id === row.id,
      );
      if (!migration || migration.checksum !== row.checksum)
        throw new Error(`Migration history mismatch: ${row.id}`);
    }
    const completed: string[] = [];
    for (const migration of [
      ...migrations,
      ...(options.accountEmail && optional ? [optional] : []),
    ]) {
      if (applied.some((row) => row.id === migration.id)) continue;
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO eru_schema_migrations(id, checksum) VALUES($1,$2)",
          [migration.id, migration.checksum],
        );
        await client.query("COMMIT");
        completed.push(migration.id);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return completed;
  });
}

/** Neutral demo data only. No App templates, shared passwords, legacy benchmark seed or resets. */
export async function seedProject(pool: Pool) {
  const passwords = new Passwords();
  const passwordHash = await passwords.hash(randomBytes(32).toString("hex"));
  return withProjectLock(pool, async (client) => {
    const journal = await client.query("SELECT id FROM eru_schema_migrations");
    if (
      !migrationFiles.every((id) =>
        journal.rows.some((row) => row.id === id),
      ) ||
      journal.rows.some(
        (row) =>
          !migrationFiles.includes(row.id) && row.id !== optionalMigration,
      )
    )
      throw new Error("Run project:migrate before project:seed");
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO users(id,email,password_hash,is_active)
        VALUES ('e0000000-0000-0000-0000-000000000001','demo-owner@example.test',$1,false)
        ON CONFLICT (id) DO NOTHING`,
        [passwordHash],
      );
      await client.query(`INSERT INTO categories(id,name,slug,display_order) VALUES
        ('c0000000-0000-0000-0000-000000000001','Learning','learning',1),
        ('c0000000-0000-0000-0000-000000000002','Planning','planning',2)
        ON CONFLICT (id) DO NOTHING`);
      const fixtures = [
        {
          id: "e1000000-0000-0000-0000-000000000001",
          slug: "demo-study-checklist",
          title: "Kế hoạch học tập mẫu",
          public: true,
          content: {
            format: "erusentia-template-html",
            schemaVersion: 1,
            html: "<section><h2>Kế hoạch học tập</h2><p>Ghi mục tiêu và tự đánh giá sau buổi học.</p></section>",
            subjectCategory: "study",
            allowHeightResize: false,
          },
        },
        {
          id: "e1000000-0000-0000-0000-000000000002",
          slug: "demo-private-draft",
          title: "Private fixture",
          public: false,
          content: {
            format: "erusentia-template-html",
            schemaVersion: 1,
            html: "<section><p>Private test content.</p></section>",
          },
        },
        {
          id: "e1000000-0000-0000-0000-000000000003",
          slug: "demo-legacy-format",
          title: "Legacy compatibility fixture",
          public: true,
          content: {
            blocks: [
              {
                type: "text",
                text: "Legacy format; do not execute as an HTML template.",
              },
            ],
          },
        },
      ];
      for (const fixture of fixtures) {
        await client.query(
          `INSERT INTO templates(id,author_id,category_id,title,slug,description,content_json,is_public,tags)
          VALUES($1,'e0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',$2,$3,$4,$5::jsonb,$6,ARRAY['integration-demo'])
          ON CONFLICT (id) DO NOTHING`,
          [
            fixture.id,
            fixture.title,
            fixture.slug,
            "Neutral integration fixture; not App content.",
            JSON.stringify(fixture.content),
            fixture.public,
          ],
        );
      }
      await client.query("COMMIT");
      return fixtures.length;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}
