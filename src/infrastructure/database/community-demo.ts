import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { Passwords } from "../../auth/passwords";
import { withProjectLock } from "./project-migrations";

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
    catalog.dataset !== "erusentia-community-demo-v1" ||
    catalog.schemaVersion !== 1 ||
    catalog.templates.length !== 14
  )
    throw new Error("Unexpected community demo dataset");
  for (const template of catalog.templates) {
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

/** Add content only. No migration, reset, password reset, login-capable demo account or fake popularity. */
export async function seedCommunityDemo(pool: Pool) {
  const catalog = await readCommunityDemoCatalog();
  const hash = await new Passwords().hash(randomBytes(48).toString("hex"));
  return withProjectLock(pool, async (client) => {
    // Works with the deployed C2 schema. Never brings pending C3 migrations into a hosted database.
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
      await client.query("COMMIT");
      return {
        dataset: catalog.dataset,
        inserted,
        preserved: catalog.templates.length - inserted,
        loginAccountsCreated: 0,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}
