const test = require("node:test"),
  assert = require("node:assert/strict");
const {
    ApiExceptionFilter,
  } = require("../dist/src/common/api-exception.filter"),
  { ApiOperations } = require("../dist/src/operations/api-operations"),
  { ServiceUnavailableException } = require("@nestjs/common"),
  { QueryFailedError } = require("typeorm");
test("server errors and logs contain a generated correlation ID without raw SQL, request headers, HTML or secrets", () => {
  for (const error of [
    new Error("private-canary"),
    new ServiceUnavailableException("private-canary"),
    new QueryFailedError(
      "SELECT private-canary",
      [],
      new Error("private-canary"),
    ),
  ]) {
    const logs = [],
      filter = new ApiExceptionFilter({ error: (v) => logs.push(v) }),
      headers = {},
      response = {
        setHeader: (k, v) => (headers[k] = v),
        status(s) {
          this.statusCode = s;
          return this;
        },
        json(v) {
          this.body = v;
        },
      },
      request = {
        path: "/templates",
        requestId: "not-a-server-id-private-canary",
        headers: { authorization: "private-canary" },
      };
    filter.catch(error, {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    });
    assert.match(headers["X-Request-Id"], /^[0-9a-f-]{36}$/);
    assert.equal(response.body.requestId, headers["X-Request-Id"]);
    assert(
      !JSON.stringify({ logs, body: response.body, headers }).includes(
        "private-canary",
      ),
    );
    assert.deepEqual(Object.keys(JSON.parse(logs[0])).sort(), [
      "code",
      "event",
      "requestId",
      "status",
    ]);
  }
});
test("request metrics use bounded route patterns rather than actual resource IDs or arbitrary method/path values", () => {
  const ops = new ApiOperations(),
    handlers = {};
  let next = 0;
  const request = {
      method: "GET",
      route: { path: "/templates/:id" },
      path: "/templates/private-canary",
      headers: { "x-request-id": "private-canary" },
    },
    response = {
      statusCode: 200,
      writableFinished: true,
      setHeader() {},
      once: (event, fn) => (handlers[event] = fn),
    };
  ops.middleware()(request, response, () => next++);
  handlers.finish();
  handlers.close();
  assert.equal(next, 1);
  const s = ops.snapshot();
  assert.equal(s.routes[0].route, "GET /templates/:id");
  assert.equal(s.routes[0].requests, 1);
  assert(!JSON.stringify(s).includes("private-canary"));
  assert.match(request.requestId, /^[0-9a-f-]{36}$/);
  for (let i = 0; i < 100; i++) {
    ops.middleware()(
      { method: "CUSTOM" + i, route: { path: "/route" + i } },
      response,
      () => {},
    );
    handlers.finish();
  }
  assert(ops.snapshot().routes.length <= 65);
});
test('operations requires the real admin role and exposes correlation headers without accepting a client supplied ID',async t=>{
 const {createApplication}=require('../dist/src/app'),{readConfig}=require('../dist/src/config'),{AUTH_STORE}=require('../dist/src/auth/auth-store'),{Passwords}=require('../dist/src/auth/passwords');
 const app=await createApplication(readConfig({TEMPLATE_STORE:'memory',NODE_ENV:'test',JWT_SECRET:'operations-test-only-at-least-32-characters',QUEUE_ENABLED:'false',CACHE_ENABLED:'false'}),false);t.after(()=>app.close());await app.listen(0,'127.0.0.1');const origin=await app.getUrl(),password='OperationsTestOnly!2026';
 const health=await fetch(origin+'/health',{headers:{'X-Request-Id':'private-canary'}});assert.equal(health.status,200);assert.match(health.headers.get('x-request-id'),/^[0-9a-f-]{36}$/);
 const login=async role=>{const email=role+'-ops@example.test';await app.get(AUTH_STORE).createUser({email,passwordHash:await app.get(Passwords).hash(password),role});const r=await fetch(origin+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200);return (await r.json()).accessToken};
 assert.equal((await fetch(origin+'/admin/operations')).status,401);for(const role of ['user','creator'])assert.equal((await fetch(origin+'/admin/operations',{headers:{Authorization:'Bearer '+await login(role)}})).status,403);
 const result=await fetch(origin+'/admin/operations',{headers:{Authorization:'Bearer '+await login('admin')}});assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');const data=await result.json();assert.equal(data.database,'not-configured');assert.equal(data.scope,'process');assert(!JSON.stringify(data).includes('@example.test'));assert(data.routes.every(r=>!r.route.includes('example.test')));
});
