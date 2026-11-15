import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

function origin(name) {
  const input = process.env[name];
  assert(input, `Set ${name} to the real HTTPS origin`);
  const url = new URL(input);
  assert(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash,
    `${name} must be an HTTPS origin without a path`,
  );
  return url.origin;
}
const api = origin("PUBLIC_API_URL");
const origins = [origin("APP_ORIGIN"), origin("ADMIN_ORIGIN")];
const deadline = Date.now() + 120_000;
let awake = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch(api + "/health", {
      signal: AbortSignal.timeout(10_000),
    });
    awake = response.ok && (await response.json()).status === "ok";
    if (awake) break;
  } catch {
    /* Render Free may still be starting. */
  }
  await delay(2000);
}
assert(awake, "API liveness did not become ready within 120 seconds");
for (const path of ["/auth/me", "/admin/accounts"]) {
  const response = await fetch(api + path, {
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(
    response.status,
    401,
    `${path} must reject unauthenticated requests`,
  );
}
for (const allowed of origins) {
  const response = await fetch(api + "/admin/accounts", {
    method: "OPTIONS",
    headers: {
      Origin: allowed,
      "Access-Control-Request-Method": "PATCH",
      "Access-Control-Request-Headers": "authorization,content-type,if-match",
    },
    signal: AbortSignal.timeout(20_000),
  });
  assert(response.ok, `Preflight failed for ${allowed}`);
  assert.equal(response.headers.get("access-control-allow-origin"), allowed);
  const headers =
    response.headers.get("access-control-allow-headers")?.toLowerCase() || "";
  for (const name of ["authorization", "content-type", "if-match"])
    assert(headers.includes(name));
  console.log(`CORS ready: ${allowed}`);
}
console.log(
  "API liveness, authentication boundary and App/Admin CORS passed. No data was written; database business flows still require an authenticated smoke check.",
);
