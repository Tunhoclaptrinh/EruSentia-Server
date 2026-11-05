// Existing CRUD contracts read the current representation before conditional writes.
// Concurrency tests supply their own exact/missing/stale headers instead of this helper.
async function conditionalHeaders(base, method, route, headers) {
  if (
    !["PATCH", "DELETE"].includes(method) ||
    !/^\/templates\/[0-9a-f-]{36}$/i.test(route)
  )
    return headers;
  const response = await fetch(base + route, { headers });
  const etag = response.headers.get("etag");
  await response.arrayBuffer();
  return response.ok && etag ? { ...headers, "if-match": etag } : headers;
}
module.exports = { conditionalHeaders };
