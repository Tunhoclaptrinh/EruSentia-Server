// DB integration must be explicitly enabled against the disposable readiness database.
const enabled = process.env.WEEK6_DATABASE_TESTS === "true";
if (enabled && !/^project_test_week6_[a-z0-9_]+$/.test(process.env.DB_DATABASE || "")) {
  throw new Error("Week 6 tests require the isolated project_test_week6_ database");
}
module.exports = { skip: enabled ? false : "Run pnpm test:week6 with a local PostgreSQL server" };
