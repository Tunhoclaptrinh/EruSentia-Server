import type { Pool } from "pg";
import { Passwords } from "../../auth/passwords";
import { withProjectLock } from "./project-migrations";

export const demoPassword = "EruSentiaDemo!2026";
export const demoAccounts = [
  {
    id: "ed000000-0000-4000-8000-000000000001",
    role: "user",
    email: "user@erusentia.test",
    name: "Người dùng mẫu",
  },
  {
    id: "ed000000-0000-4000-8000-000000000002",
    role: "creator",
    email: "creator@erusentia.test",
    name: "Người sáng tạo mẫu",
  },
  {
    id: "ed000000-0000-4000-8000-000000000003",
    role: "admin",
    email: "admin@erusentia.test",
    name: "Quản trị viên mẫu",
  },
] as const;
export const demoTemplates = [
  {
    id: "ed100000-0000-4000-8000-000000000001",
    owner: 0,
    slug: "demo-user-private-note",
    title: "Ghi chú cá nhân mẫu",
    public: false,
    html: "<section><h2>Ghi chú cá nhân</h2><p>Ghi lại điều đã học và bước tiếp theo.</p></section>",
  },
  {
    id: "ed100000-0000-4000-8000-000000000002",
    owner: 0,
    slug: "demo-user-weekly-goals",
    title: "Mục tiêu tuần mẫu",
    public: true,
    html: "<section><h2>Mục tiêu tuần</h2><ul><li>Chọn một mục tiêu cụ thể.</li><li>Dành thời gian tổng kết kết quả.</li></ul></section>",
  },
  {
    id: "ed100000-0000-4000-8000-000000000003",
    owner: 1,
    slug: "demo-creator-project-plan",
    title: "Kế hoạch dự án mẫu",
    public: true,
    html: "<section><h2>Kế hoạch dự án</h2><p>Mục tiêu, công việc cần làm và tiêu chí hoàn thành.</p></section>",
  },
  {
    id: "ed100000-0000-4000-8000-000000000004",
    owner: 2,
    slug: "demo-admin-private-note",
    title: "Theo dõi quản trị mẫu",
    public: false,
    html: "<section><h2>Theo dõi quản trị</h2><p>Ghi nhận các hạng mục cần kiểm tra trong môi trường phát triển.</p></section>",
  },
] as const;

/** Explicit development fixtures. Never elevate/reset an existing account by email. */
export async function seedProjectDemo(
  pool: Pool,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env.NODE_ENV === "production")
    throw new Error("Demo accounts are forbidden in production");
  if (env.PROJECT_DEMO_ACCOUNTS !== "true")
    throw new Error(
      "Set PROJECT_DEMO_ACCOUNTS=true to seed development accounts",
    );
  const passwords = new Passwords();
  const passwordHash = await passwords.hash(demoPassword);
  return withProjectLock(pool, async (client) => {
    await client.query("SELECT id FROM eru_schema_migrations LIMIT 1");
    await client.query("BEGIN");
    try {
      for (const account of demoAccounts) {
        const collision = await client.query(
          "SELECT id, email FROM users WHERE id=$1 OR LOWER(email)=LOWER($2)",
          [account.id, account.email],
        );
        if (
          collision.rows.some(
            (row) => row.id !== account.id || row.email !== account.email,
          )
        )
          throw new Error(
            `Demo identity collision for ${account.email}; existing account left unchanged`,
          );
        await client.query(
          `INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`,
          [account.id, account.email, passwordHash, account.role],
        );
        await client.query(
          `INSERT INTO profiles(user_id,username,display_name) VALUES($1,$2,$3) ON CONFLICT(user_id) DO NOTHING`,
          [account.id, `eru-demo-${account.role}`, account.name],
        );
      }
      for (const template of demoTemplates) {
        await client.query(
          `INSERT INTO templates(id,author_id,category_id,title,slug,description,content_json,is_public,tags)
           VALUES($1,$2,'c0000000-0000-0000-0000-000000000001',$3,$4,$5,$6::jsonb,$7,ARRAY['project-demo'])
           ON CONFLICT(id) DO NOTHING`,
          [
            template.id,
            demoAccounts[template.owner].id,
            template.title,
            template.slug,
            "Mẫu trung tính cho môi trường phát triển EruSentia.",
            JSON.stringify({
              format: "erusentia-template-html",
              schemaVersion: 1,
              html: template.html,
            }),
            template.public,
          ],
        );
      }
      await client.query("COMMIT");
      return {
        accounts: demoAccounts.map(({ email, role }) => ({ email, role })),
        templates: demoTemplates.length,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}
