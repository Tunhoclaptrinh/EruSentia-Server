const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, randomBytes, createHash } = require("node:crypto");
const { Pool } = require("pg");
const { createApplication } = require("../dist/src/app");
const { readConfig } = require("../dist/src/config");
const { AUTH_STORE } = require("../dist/src/auth/auth-store");
const { Passwords } = require("../dist/src/auth/passwords");
const {
  AccountEmailService,
} = require("../dist/src/auth/account-email.service");
const { AccountEmailMailer } = require("../dist/src/auth/account-email.mailer");
const {
  migrateProject,
} = require("../dist/src/infrastructure/database/project-migrations");
const token = () => randomBytes(32).toString("base64url");
const digest = (value) => createHash("sha256").update(value).digest("hex");

test("account email is disabled by default and local Mailpit cannot be enabled in production or redirected", async (t) => {
  assert.equal(
    readConfig({ TEMPLATE_STORE: "memory" }).accountEmail.enabled,
    false,
  );
  for (const env of [
    { NODE_ENV: "production", JWT_SECRET: "x".repeat(40) },
    { ACCOUNT_EMAIL_APP_URL: "https://foreign.test" },
    { ACCOUNT_EMAIL_APP_URL: "http://127.0.0.1/path" },
    { SMTP_HOST: "smtp.foreign.test" },
  ])
    assert.throws(() =>
      readConfig({
        TEMPLATE_STORE: "memory",
        ACCOUNT_EMAIL_MODE: "mailpit",
        ...env,
      }),
    );
  const app = await createApplication(
    readConfig({ TEMPLATE_STORE: "memory" }),
    false,
  );
  t.after(() => app.close());
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  assert.deepEqual(
    await (await fetch(base + "/auth/email/capabilities")).json(),
    { emailActionsEnabled: false },
  );
  const response = await fetch(base + "/auth/email/password/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "absent@example.test" }),
  });
  assert.equal(response.status, 503);
});

async function contract(t, persistence) {
  const settings = readConfig({
    ...process.env,
    NODE_ENV: "test",
    TEMPLATE_STORE: persistence,
    ACCOUNT_EMAIL_MODE: "mailpit",
    ACCOUNT_EMAIL_APP_URL: "http://127.0.0.1:5173",
    SMTP_HOST: "127.0.0.1",
    QUEUE_ENABLED: "false",
    CACHE_ENABLED: "false",
    JWT_SECRET: "local-account-email-test-only-key-at-least-32-bytes",
  });
  let pool;
  if (persistence === "postgres") {
    assert.match(settings.database.database, /^project_test_email[a-z0-9_]*$/);
    pool = new Pool({ ...settings.database, user: settings.database.username });
    t.after(() => pool.end());
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'",
        )
      ).rows[0].n,
      0,
    );
    await migrateProject(pool);
    const before = (
      await pool.query("SELECT * FROM eru_schema_migrations ORDER BY id")
    ).rows;
    assert.equal(before.length, 7);
    const missing = await createApplication(settings, false);
    try {
      await assert.rejects(
        missing.listen(0, "127.0.0.1"),
        /ACCOUNT_EMAIL_SCHEMA_NOT_READY/,
      );
    } finally {
      await missing.close();
    }

    assert.deepEqual(
      await migrateProject(pool, undefined, { accountEmail: true }),
      ["09_account_email.sql"],
    );
    assert.deepEqual(await migrateProject(pool), []);
    assert.deepEqual(
      await migrateProject(pool, undefined, { accountEmail: true }),
      [],
    );
    assert.deepEqual(
      (
        await pool.query(
          "SELECT * FROM eru_schema_migrations WHERE id<>'09_account_email.sql' ORDER BY id",
        )
      ).rows,
      before,
    );
  }
  const app = await createApplication(settings, false);
  t.after(() => app.close());
  const mailer = app.get(AccountEmailMailer),
    outbox = [];
  mailer.available = () => true;
  mailer.send = (email, purpose, code) => outbox.push({ email, purpose, code });
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl(),
    store = app.get(AUTH_STORE),
    passwords = app.get(Passwords);
  async function call(method, path, status, body, access) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(access ? { Authorization: "Bearer " + access } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, status, method + " " + path);
    if (status !== 404)
      assert.equal(response.headers.get("cache-control"), "no-store");
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  const credentials = {
    email: randomUUID() + "@example.test",
    password: "MailpitTestOnly!2026",
  };
  let currentPassword = credentials.password;
  const register = async (email) =>
    call("POST", "/auth/register", 201, {
      email,
      password: credentials.password,
    });
  const login = async (email = credentials.email, password = currentPassword) =>
    call("POST", "/auth/login", 200, { email, password });
  const user = await register(credentials.email),
    first = await login(),
    second = await login();
  const bobEmail = randomUUID() + "@example.test";
  await register(bobEmail);
  const bob = await login(bobEmail, credentials.password);
  await t.test(
    "registration delivers only through the enabled mailer; verification is explicit, expiring and single-use",
    async () => {
      assert.equal(
        outbox.filter((m) => m.email === user.email && m.purpose === "verify")
          .length,
        1,
      );
      const code = outbox.find((m) => m.email === user.email).code;
      assert.match(code, /^[A-Za-z0-9_-]{43}$/);
      assert.deepEqual(
        await call("GET", "/auth/email/status", 200, null, first.accessToken),
        { emailVerifiedAt: null },
      );
      await call(
        "POST",
        "/auth/email/verification/request",
        202,
        {},
        first.accessToken,
      );
      assert.equal(outbox.filter((m) => m.email === user.email).length, 1);
      await call("GET", "/auth/email/verification/confirm?token=" + code, 404);
      await call("POST", "/auth/email/verification/confirm", 204, {
        token: code,
      });
      const status = await call(
        "GET",
        "/auth/email/status",
        200,
        null,
        first.accessToken,
      );
      assert(Number.isFinite(Date.parse(status.emailVerifiedAt)));
      await call("POST", "/auth/email/verification/confirm", 400, {
        token: code,
      });
      await call("POST", "/auth/email/verification/request", 401, {});
      await call("POST", "/auth/email/verification/confirm", 400, {
        token: "invalid",
      });
      if (pool) {
        const rows = (
          await pool.query("SELECT token_hash FROM auth_email_actions")
        ).rows;
        assert(
          rows.every(
            (row) => row.token_hash.length === 64 && row.token_hash !== code,
          ),
        );
      }
    },
  );
  await t.test(
    "forgot-password responses conceal membership and issue no duplicate email during cooldown",
    async () => {
      const start = Date.now(),
        known = await call("POST", "/auth/email/password/request", 202, {
          email: credentials.email,
        }),
        elapsed = Date.now() - start;
      const unknown = await call("POST", "/auth/email/password/request", 202, {
        email: randomUUID() + "@example.test",
      });
      assert.deepEqual(known, unknown);
      assert(elapsed >= 230);
      await call("POST", "/auth/email/password/request", 202, {
        email: credentials.email,
      });
      assert.equal(
        outbox.filter((m) => m.email === user.email && m.purpose === "reset")
          .length,
        1,
      );
      await call("POST", "/auth/email/password/request", 400, {
        email: credentials.email,
        redirectUrl: "https://foreign.test",
      });
    },
  );
  await t.test(
    "reset consumes only a reset code, changes the password and revokes every old login without logging in automatically",
    async () => {
      const code = outbox.find(
        (m) => m.email === user.email && m.purpose === "reset",
      ).code;
      await call("POST", "/auth/email/verification/confirm", 400, {
        token: code,
      });
      await call("POST", "/auth/email/password/confirm", 400, {
        token: code,
        password: "short",
      });
      currentPassword = "NewLocalPassword!2026";
      assert.equal(
        await call("POST", "/auth/email/password/confirm", 204, {
          token: code,
          password: currentPassword,
        }),
        null,
      );
      for (const pair of [first, second]) {
        await call("GET", "/auth/me", 401, null, pair.accessToken);
        await call("POST", "/auth/refresh", 401, {
          refreshToken: pair.refreshToken,
        });
      }
      await call("POST", "/auth/login", 401, credentials);
      await call("GET", "/auth/me", 200, null, bob.accessToken);
      await login();
      await call("POST", "/auth/email/password/confirm", 400, {
        token: code,
        password: "AnotherPassword!2026",
      });
      assert.equal(
        outbox.filter((m) => m.email === user.email && m.purpose === "changed")
          .length,
        1,
      );
    },
  );
  await t.test(
    "expired/superseded/cross-purpose codes fail and reset does not implicitly verify another email",
    async () => {
      const candidate = await store.createUser({
        email: randomUUID() + "@example.test",
        passwordHash: await passwords.hash(credentials.password),
        role: "user",
      });
      const old = token(),
        next = token(),
        now = Date.now();
      await store.issueEmailAction(
        candidate.id,
        "reset",
        digest(old),
        new Date(now - 120000),
        new Date(now - 1000),
      );
      await call("POST", "/auth/email/password/confirm", 400, {
        token: old,
        password: "TemporaryPassword!2026",
      });
      await store.issueEmailAction(
        candidate.id,
        "reset",
        digest(next),
        new Date(),
        new Date(Date.now() + 900000),
      );
      await call("POST", "/auth/email/password/confirm", 400, {
        token: old,
        password: "TemporaryPassword!2026",
      });
      await call("POST", "/auth/email/verification/confirm", 400, {
        token: next,
      });
      await call("POST", "/auth/email/password/confirm", 204, {
        token: next,
        password: "TemporaryPassword!2026",
      });
      assert.equal(await store.emailVerifiedAt(candidate.id), null);
    },
  );
  await t.test(
    "a password verified before reset cannot create a late old-password session",
    async () => {
      const candidate = await store.createUser({
        email: randomUUID() + "@example.test",
        passwordHash: await passwords.hash(credentials.password),
        role: "user",
      });
      let release, entered;
      const gate = new Promise((resolve) => (release = resolve)),
        ready = new Promise((resolve) => (entered = resolve)),
        original = passwords.verify.bind(passwords);
      passwords.verify = async (...args) => {
        const result = await original(...args);
        entered();
        await gate;
        return result;
      };
      const oldLogin = call("POST", "/auth/login", 401, {
        email: candidate.email,
        password: credentials.password,
      });
      await ready;
      try {
        const code = token();
        await store.issueEmailAction(
          candidate.id,
          "reset",
          digest(code),
          new Date(),
          new Date(Date.now() + 900000),
        );
        await call("POST", "/auth/email/password/confirm", 204, {
          token: code,
          password: "RaceSafePassword!2026",
        });
      } finally {
        passwords.verify = original;
        release();
      }
      await oldLogin;
      assert.equal(
        (await store.listSessions(candidate.id, 1, 10, new Date()))
          .totalElements,
        0,
      );
    },
  );
  await t.test(
    "concurrent reset and refresh complete without a deadlock or usable child session",
    async () => {
      const candidate = await store.createUser({
          email: randomUUID() + "@example.test",
          passwordHash: await passwords.hash(credentials.password),
          role: "user",
        }),
        pair = await login(candidate.email, credentials.password),
        code = token();
      await store.issueEmailAction(
        candidate.id,
        "reset",
        digest(code),
        new Date(),
        new Date(Date.now() + 900000),
      );
      const rotation = fetch(base + "/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: pair.refreshToken }),
        signal: AbortSignal.timeout(10000),
      });
      await call("POST", "/auth/email/password/confirm", 204, {
        token: code,
        password: "ResetRacePassword!2026",
      });
      const result = await rotation;
      assert([200, 401].includes(result.status));
      if (result.status === 200) {
        const child = await result.json();
        await call("GET", "/auth/me", 401, null, child.accessToken);
        await call("POST", "/auth/refresh", 401, {
          refreshToken: child.refreshToken,
        });
      }
      assert.equal(
        (await store.listSessions(candidate.id, 1, 10, new Date()))
          .totalElements,
        0,
      );
    },
  );

  await t.test(
    "concurrent reset confirmations have one winner and cannot reuse the code",
    async () => {
      const candidate = await store.createUser({
          email: randomUUID() + "@example.test",
          passwordHash: await passwords.hash(credentials.password),
          role: "user",
        }),
        code = token();
      await store.issueEmailAction(
        candidate.id,
        "reset",
        digest(code),
        new Date(),
        new Date(Date.now() + 900000),
      );
      const passwordsToTry = [
        "ConcurrentWinnerA!2026",
        "ConcurrentWinnerB!2026",
      ];
      const results = await Promise.all(
        passwordsToTry.map((password) =>
          fetch(base + "/auth/email/password/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: code, password }),
          }),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [204, 400]);
      const winner = results.findIndex((r) => r.status === 204);
      await login(candidate.email, passwordsToTry[winner]);
      await call("POST", "/auth/login", 401, {
        email: candidate.email,
        password: passwordsToTry[1 - winner],
      });
    },
  );
  if (pool)
    await t.test(
      "failure recording token use rolls back password and every session revocation",
      async () => {
        const candidate = await store.createUser({
            email: randomUUID() + "@example.test",
            passwordHash: await passwords.hash(credentials.password),
            role: "user",
          }),
          pair = await login(candidate.email, credentials.password),
          code = token();
        await store.issueEmailAction(
          candidate.id,
          "reset",
          digest(code),
          new Date(),
          new Date(Date.now() + 900000),
        );
        const beforeHash = (await store.findByEmail(candidate.email))
          .passwordHash;
        await pool.query(`CREATE FUNCTION email_test_fail_reset() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'email_reset_expected_rollback'; END$$;
      CREATE TRIGGER email_test_rollback BEFORE UPDATE ON auth_email_actions FOR EACH ROW WHEN (NEW.used_at IS NOT NULL) EXECUTE FUNCTION email_test_fail_reset()`);
        try {
          await call("POST", "/auth/email/password/confirm", 500, {
            token: code,
            password: "RollbackSafePassword!2026",
          });
        } finally {
          await pool.query(
            "DROP TRIGGER email_test_rollback ON auth_email_actions; DROP FUNCTION email_test_fail_reset()",
          );
        }
        assert.equal(
          (await store.findByEmail(candidate.email)).passwordHash,
          beforeHash,
        );
        await call("GET", "/auth/me", 200, null, pair.accessToken);
        assert.equal(
          (
            await pool.query(
              "SELECT used_at FROM auth_email_actions WHERE token_hash=$1",
              [digest(code)],
            )
          ).rows[0].used_at,
          null,
        );
        await call("POST", "/auth/email/password/confirm", 204, {
          token: code,
          password: "RollbackSafePassword!2026",
        });
      },
    );
  await t.test(
    "a failed initial email request does not turn a created account into a false registration failure",
    async () => {
      const service = app.get(AccountEmailService),
        original = service.sendVerification;
      service.sendVerification = async () => {
        throw Error("simulated email request failure");
      };
      const email = randomUUID() + "@example.test";
      try {
        await register(email);
        assert(await store.findByEmail(email));
      } finally {
        service.sendVerification = original;
      }
    },
  );
  await t.test(
    "request rate limits are IP-wide and do not create unbounded email jobs",
    async () => {
      for (let n = 0; n < 21; n++) {
        const response = await fetch(base + "/auth/email/password/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: randomUUID() + "@example.test" }),
        });
        assert([202, 429].includes(response.status));
        if (response.status === 429) {
          assert(Number(response.headers.get("retry-after")) >= 1);
          return;
        }
      }
      assert.fail("Expected an IP-wide request limit");
    },
  );
}
test(
  "local account email tokens, reset and session races (memory)",
  { timeout: 60000 },
  (t) => contract(t, "memory"),
);
test(
  "local account email tokens and atomic reset (PostgreSQL)",
  { skip: process.env.RUN_ACCOUNT_EMAIL_TESTS !== "1", timeout: 60000 },
  (t) => contract(t, "postgres"),
);

test(
  "Mailpit receives real bilingual verification/reset email and a completion notice",
  { skip: !process.env.ACCOUNT_EMAIL_MAILPIT_URL, timeout: 30000 },
  async (t) => {
    const app = await createApplication(
      readConfig({
        ...process.env,
        TEMPLATE_STORE: "memory",
        ACCOUNT_EMAIL_MODE: "mailpit",
        QUEUE_ENABLED: "false",
        CACHE_ENABLED: "false",
      }),
      false,
    );
    t.after(() => app.close());
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const credentials = {
      email: randomUUID() + "@example.test",
      password: "SmtpLocalTest!2026",
    };
    const post = (path, body) =>
      fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    async function message(subject) {
      for (let n = 0; n < 80; n++) {
        const page = await (
          await fetch(
            process.env.ACCOUNT_EMAIL_MAILPIT_URL +
              "/api/v1/search?query=" +
              encodeURIComponent("to:" + credentials.email),
          )
        ).json();
        const match = page.messages?.find((m) => m.Subject.includes(subject));
        if (match)
          return (
            await fetch(
              process.env.ACCOUNT_EMAIL_MAILPIT_URL +
                "/api/v1/message/" +
                match.ID,
            )
          ).json();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw Error("Expected local email not delivered");
    }
    assert.equal((await post("/auth/register", credentials)).status, 201);
    const verification = await message("Xác minh");
    assert(verification.HTML.includes("Verify email"));
    assert(verification.HTML.includes("#account-action=verify"));
    const verify = /One-time code: ([A-Za-z0-9_-]{43})/.exec(
      verification.Text,
    )[1];
    assert.equal(
      (await post("/auth/email/verification/confirm", { token: verify }))
        .status,
      204,
    );
    assert.equal(
      (await post("/auth/email/password/request", { email: credentials.email }))
        .status,
      202,
    );
    const reset = await message("Đặt lại");
    assert(reset.HTML.includes("Reset password"));
    const code = /One-time code: ([A-Za-z0-9_-]{43})/.exec(reset.Text)[1];
    assert.equal(
      (
        await post("/auth/email/password/confirm", {
          token: code,
          password: "NewSmtpPassword!2026",
        })
      ).status,
      204,
    );
    const changed = await message("Mật khẩu");
    assert(!changed.Text.includes(code));
    assert(!changed.Text.includes("NewSmtpPassword"));
  },
);
