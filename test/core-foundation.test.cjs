require("reflect-metadata");
const test = require("node:test");
const assert = require("node:assert/strict");
const { plainToInstance } = require("class-transformer");
const { validate } = require("class-validator");
const {
  BaseService,
  pageWindow,
  queryRows,
} = require("../dist/src/common/services/base.service");
const {
  BaseController,
} = require("../dist/src/common/controllers/base.controller");
const {
  AdminUserQueryDto,
  AdminTemplateQueryDto,
  AdminAuditLogQueryDto,
  AdminPageQueryDto,
} = require("../dist/src/admin/dto/admin.dto");
const { ReportQueryDto } = require("../dist/src/moderation/contracts");
const {
  DocumentQueryDto,
} = require("../dist/src/community-documents/contracts");
const { getRequestMeta } = require("../dist/src/common/request-context");

for (const Dto of [
  AdminUserQueryDto,
  AdminTemplateQueryDto,
  AdminAuditLogQueryDto,
  AdminPageQueryDto,
  DocumentQueryDto,
  ReportQueryDto,
]) {
  test(`${Dto.name} validates inherited paging without coercing invalid input`, async () => {
    const parse = (input) =>
      validate(plainToInstance(Dto, input), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
    const value = plainToInstance(Dto, { page: "2", size: "10" });
    assert.equal(value.page, 2);
    assert.equal(value.size, 10);
    assert.deepEqual(await parse({ page: "2", size: "10" }), []);
    for (const value of [
      "1.5",
      "1e2",
      "Infinity",
      "NaN",
      "9007199254740993",
      -1,
      0,
      null,
      [],
      ["2"],
    ]) {
      assert((await parse({ page: value })).length > 0, JSON.stringify(value));
    }
    for (const value of [0, 101, "false", null, []])
      assert((await parse({ size: value })).length > 0);
    assert(
      (await parse({ sortBy: "role" })).length > 0,
      "Unknown sort/filter keys are rejected",
    );
    if (Dto === DocumentQueryDto || Dto === ReportQueryDto) {
      assert((await parse({ size: 51 })).length > 0);
      assert((await parse({ page: 10001 })).length > 0);
    } else assert((await parse({ search: "x".repeat(201) })).length > 0);
  });
}

test("page window rejects unsafe offsets even for internal callers", () => {
  assert.deepEqual(pageWindow({ page: 2, size: 20 }), {
    page: 2,
    size: 20,
    offset: 20,
  });
  for (const value of [
    { page: Infinity },
    { page: 1.1 },
    { size: 101 },
    { page: Number.MAX_SAFE_INTEGER, size: 100 },
  ])
    assert.throws(() => pageWindow(value));
});

test("base service reads count and page through one repeatable-read manager and propagates failure", async () => {
  const manager = { tag: "same-snapshot" };
  let calls = 0;
  class Service extends BaseService {
    read(work) {
      return this.paginate({ page: 3, size: 10 }, work);
    }
  }
  const service = new Service({
    transaction: async (isolation, work) => {
      assert.equal(isolation, "REPEATABLE READ");
      calls++;
      return work(manager);
    },
  });
  const page = await service.read(async (db, window) => {
    assert.equal(db, manager);
    assert.equal(window.offset, 20);
    return { data: [{ id: "one" }], total: 31, extra: { pendingCount: 4 } };
  });
  assert.deepEqual(page, {
    data: [{ id: "one" }],
    page: 3,
    size: 10,
    totalElements: 31,
    totalPages: 4,
    pendingCount: 4,
  });
  assert.equal(calls, 1);
  const cause = new Error("database unavailable");
  await assert.rejects(
    service.read(async () => {
      throw cause;
    }),
    (error) => error === cause,
  );
  await assert.rejects(service.read(async () => ({ data: [], total: NaN })));
});

test("base controller derives actor and bounded metadata from the authenticated request", () => {
  class Controller extends BaseController {
    context(user, request) {
      return this.actionContext(user, request);
    }
  }
  const controller = new Controller();
  const request = {
    ip: "127.0.0.1",
    headers: { "x-forwarded-for": "attacker", "user-agent": "x".repeat(2000) },
  };
  const context = controller.context({ id: "actor" }, request);
  assert.equal(context.actorId, "actor");
  assert.equal(context.meta.ip, "127.0.0.1");
  assert.equal(context.meta.userAgent.length, 1024);
  assert.throws(() => controller.context(undefined, request));
  assert.equal(
    getRequestMeta({ headers: { "user-agent": ["spoofed"] } }).userAgent,
    undefined,
  );
});

test("Admin UUID filters use the same PostgreSQL UUID syntax as route parameters and seed data", async () => {
  const seed = "00000000-0000-0000-0000-000000000001";
  for (const [Dto, query] of [
    [AdminTemplateQueryDto, { authorId: seed }],
    [AdminAuditLogQueryDto, { actorId: seed, targetId: seed }],
  ]) {
    assert.deepEqual(await validate(plainToInstance(Dto, query)), []);
  }
});

test("queryRows normalizes actual PostgreSQL UPDATE/DELETE tuples including a missing record", async () => {
  const row = { id: "record", name: "Saved" };
  for (const raw of [[row], [[row], 1]])
    assert.deepEqual(await queryRows({ query: async () => raw }, "owned SQL"), [
      row,
    ]);
  assert.deepEqual(
    await queryRows({ query: async () => [[], 0] }, "DELETE RETURNING"),
    [],
  );
  await assert.rejects(
    queryRows({ query: async () => null }, "invalid driver result"),
  );
});

test("database conflicts use resource-neutral messages without exposing query or driver details", () => {
  const {
    ApiExceptionFilter,
  } = require("../dist/src/common/api-exception.filter");
  const { QueryFailedError } = require("typeorm");
  for (const [code, status] of [
    ["23505", 409],
    ["23503", 400],
  ]) {
    const response = {
      setHeader() {},
      status(value) {
        this.statusCode = value;
        return this;
      },
      json(body) {
        this.body = body;
      },
    };
    const error = new QueryFailedError(
      "PRIVATE_SQL",
      [],
      Object.assign(new Error("PRIVATE_DRIVER"), { code }),
    );
    new ApiExceptionFilter({ error() {} }).catch(error, {
      switchToHttp: () => ({
        getRequest: () => ({ path: "/admin/accounts" }),
        getResponse: () => response,
      }),
    });
    assert.equal(response.statusCode, status);
    assert(!JSON.stringify(response.body).includes("PRIVATE_"));
    assert(!response.body.message.includes("Template"));
  }
});
