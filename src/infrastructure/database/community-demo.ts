import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { Passwords } from "../../auth/passwords";
import { withProjectLock } from "./project-migrations";
import { assertPublicTemplate } from "../../templates/template-publication";

export interface CommunityDemoCatalog {
  schemaVersion: number;
  dataset: string;
  authors: {
    id: string;
    email: string;
    username: string;
    displayName: string;
  }[];
  categories: { id: string; slug: string; name: string; key: string }[];
  templates: {
    id: string;
    author: number;
    category: string;
    slug: string;
    title: string;
    description: string;
    tags: string[];
    version: string;
    contentJson: { format: string; schemaVersion: number; html: string };
  }[];
}

export async function readCommunityDemoCatalog(): Promise<CommunityDemoCatalog> {
  const catalog = JSON.parse(
    await readFile(resolve("tools/community/catalog.json"), "utf8"),
  ) as CommunityDemoCatalog;
  if (
    catalog.dataset !== "erusentia-community-demo-v2" ||
    catalog.schemaVersion !== 1 ||
    catalog.templates.length !== 14
  )
    throw new Error("Unexpected community demo dataset");
  for (const template of catalog.templates) {
    assertPublicTemplate(template.contentJson);
    if (
      !catalog.authors[template.author] ||
      !catalog.categories.some(
        (category) => category.key === template.category,
      ) ||
      template.contentJson.format !== "erusentia-template-html" ||
      template.contentJson.schemaVersion !== 1 ||
      template.contentJson.html.length > 1_000_000 ||
      !template.tags.includes("community-demo")
    )
      throw new Error("Invalid community demo template");
  }
  return catalog;
}

/** Add by default. Explicit upgrades replace only fingerprint-matching originals after a backup. */
export function curatedTemplateFingerprint(row: Record<string, unknown>) {
  const sort = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sort)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, sort(item)]),
          )
        : value;
  const snapshot = {
    id: row.id,
    authorId: row.author_id,
    categoryId: row.category_id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    contentJson: row.content_json,
    thumbnailUrl: row.thumbnail_url,
    tags: row.tags,
    version: row.version,
    isPublic: row.is_public,
  };
  return createHash("sha256")
    .update(JSON.stringify(sort(snapshot)))
    .digest("hex");
}

export interface CommunitySeedOptions {
  upgradeExisting?: boolean;
  hideFoundationExamples?: boolean;
  dryRun?: boolean;
  /** Must finish a protected backup before any known original is replaced. Never includes user accounts. */
  beforeUpgrade?: (rows: Record<string, unknown>[]) => Promise<void>;
}

export async function seedCommunityDemo(
  pool: Pool,
  options: CommunitySeedOptions = {},
) {
  const catalog = await readCommunityDemoCatalog();
  const hash = await new Passwords().hash(randomBytes(48).toString("hex"));
  return withProjectLock(pool, async (client) => {
    // Add-only seeding supports C2; an explicit upgrade requires C3. This command never migrates.
    const journal = await client.query(
      "SELECT id FROM eru_schema_migrations WHERE id='07_template_cache_revision.sql'",
    );
    if (journal.rowCount !== 1)
      throw new Error(
        "Community demo requires the existing project schema; no migration was applied",
      );
    await client.query("BEGIN");
    try {
      let inserted = 0;
      let upgraded = 0;
      let hiddenFoundationExamples = 0;
      const eligible = new Set<string>();
      const hidden = new Set<string>();
      if (options.upgradeExisting || options.hideFoundationExamples) {
        const migration = await client.query(
          "SELECT id FROM eru_schema_migrations WHERE id='08_template_revisions.sql'",
        );
        if (migration.rowCount !== 1)
          throw new Error(
            "Community upgrades require C3 revision history; no migration was applied",
          );
        const original = JSON.parse(
          await readFile(resolve("tools/community/previous-v1.json"), "utf8"),
        ) as {
          templates: { id: string; sha256: string }[];
          foundationExamples: { id: string; sha256: string }[];
        };
        const existing = await client.query(
          "SELECT * FROM templates WHERE id=ANY($1) FOR UPDATE",
          [catalog.templates.map((template) => template.id)],
        );
        const originals = options.upgradeExisting
          ? existing.rows.filter(
              (row) =>
                !row.deleted_at &&
                original.templates.some(
                  (entry) =>
                    entry.id === row.id &&
                    entry.sha256 === curatedTemplateFingerprint(row),
                ),
            )
          : [];
        const foundation = options.hideFoundationExamples
          ? (
              await client.query(
                "SELECT t.* FROM templates t JOIN users u ON u.id=t.author_id WHERE t.id=ANY($1) AND u.is_active=false AND u.deleted_at IS NULL AND u.role='user' FOR UPDATE OF t",
                [original.foundationExamples.map((entry) => entry.id)],
              )
            ).rows.filter(
              (row) =>
                !row.deleted_at &&
                original.foundationExamples.some(
                  (entry) =>
                    entry.id === row.id &&
                    entry.sha256 === curatedTemplateFingerprint(row),
                ),
            )
          : [];
        const backups = [...originals, ...foundation];
        if (backups.length) {
          if (!options.dryRun && !options.beforeUpgrade)
            throw new Error(
              "Community upgrades require a completed backup handler",
            );
          if (!options.dryRun) await options.beforeUpgrade!(backups);
          originals.forEach((row) => eligible.add(row.id));
          foundation.forEach((row) => hidden.add(row.id));
        }
      }
      for (const author of catalog.authors) {
        const existing = await client.query(
          "SELECT id,email,role,is_active,deleted_at FROM users WHERE id=$1 OR LOWER(email)=LOWER($2)",
          [author.id, author.email],
        );
        if (
          existing.rows.some(
            (row) =>
              row.id !== author.id ||
              row.email !== author.email ||
              row.role !== "creator" ||
              row.is_active ||
              row.deleted_at,
          )
        )
          throw new Error(
            "Community demo author collision; existing account left unchanged",
          );
        await client.query(
          "INSERT INTO users(id,email,password_hash,role,is_active) VALUES($1,$2,$3,'creator',false) ON CONFLICT(id) DO NOTHING",
          [author.id, author.email, hash],
        );
        const profile = await client.query(
          "SELECT user_id,username FROM profiles WHERE user_id=$1 OR username=$2",
          [author.id, author.username],
        );
        if (
          profile.rows.some(
            (row) =>
              row.user_id !== author.id || row.username !== author.username,
          )
        )
          throw new Error(
            "Community demo profile collision; existing profile left unchanged",
          );
        await client.query(
          "INSERT INTO profiles(user_id,username,display_name,bio) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO NOTHING",
          [
            author.id,
            author.username,
            author.displayName,
            "Nhân vật minh họa của bộ dữ liệu demo EruSentia; không phải tài khoản cộng đồng thật.",
          ],
        );
      }
      for (const category of catalog.categories) {
        const collision = await client.query(
          "SELECT id,slug,name FROM categories WHERE id=$1 OR slug=$2 OR name=$3",
          [category.id, category.slug, category.name],
        );
        if (
          collision.rows.some(
            (row) =>
              row.id !== category.id ||
              row.slug !== category.slug ||
              row.name !== category.name,
          )
        )
          throw new Error(
            "Community demo category collision; existing data left unchanged",
          );
        await client.query(
          "INSERT INTO categories(id,name,slug,display_order) VALUES($1,$2,$3,20) ON CONFLICT(id) DO NOTHING",
          [category.id, category.name, category.slug],
        );
      }
      for (const template of catalog.templates) {
        const author = catalog.authors[template.author];
        const category = catalog.categories.find(
          (item) => item.key === template.category,
        )!;
        const collision = await client.query(
          "SELECT id,slug,author_id FROM templates WHERE id=$1 OR slug=$2",
          [template.id, template.slug],
        );
        if (
          collision.rows.some(
            (row) =>
              row.id !== template.id ||
              row.slug !== template.slug ||
              row.author_id !== author.id,
          )
        )
          throw new Error(
            "Community demo template collision; existing data left unchanged",
          );
        if (eligible.has(template.id)) {
          await client.query(
            `UPDATE templates SET category_id=$2,title=$3,description=$4,content_json=$5::jsonb,tags=$6,version=$7,updated_at=now() WHERE id=$1`,
            [
              template.id,
              category.id,
              template.title,
              template.description,
              JSON.stringify(template.contentJson),
              template.tags,
              template.version,
            ],
          );
          upgraded++;
          continue;
        }
        const result = await client.query(
          `INSERT INTO templates(id,author_id,category_id,title,slug,description,content_json,is_public,tags,version)
          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,true,$8,$9) ON CONFLICT(id) DO NOTHING RETURNING id`,
          [
            template.id,
            author.id,
            category.id,
            template.title,
            template.slug,
            template.description,
            JSON.stringify(template.contentJson),
            template.tags,
            template.version,
          ],
        );
        inserted += result.rowCount ?? 0;
      }
      if (hidden.size) {
        const changed = await client.query(
          "UPDATE templates SET is_public=false,updated_at=now() WHERE id=ANY($1)",
          [[...hidden]],
        );
        hiddenFoundationExamples = changed.rowCount ?? 0;
      }
      await client.query(options.dryRun ? "ROLLBACK" : "COMMIT");
      return {
        dataset: catalog.dataset,
        dryRun: !!options.dryRun,
        inserted,
        upgraded,
        hiddenFoundationExamples,
        preserved: catalog.templates.length - inserted - upgraded,
        loginAccountsCreated: 0,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}
