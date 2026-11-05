const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { readConfig } = require("../dist/src/config");
const { createApplication } = require("../dist/src/app");
const example = require("../tools/examples/create-template.json");

const categoryId = "c0000000-0000-0000-0000-000000000001";
const category2 = "c0000000-0000-0000-0000-000000000002";

async function contract(t, store) {
  const settings = readConfig({ ...process.env, TEMPLATE_STORE: store });
  const app = await createApplication(settings, false);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  t.after(() => app.close());
  const suffix = randomUUID();
  const tag = `week2-${suffix}`;
  const ids = [];
  const credentials = {
    email: `catalog-${suffix}@example.test`,
    password: "LearningPass!2026",
  };
  const registered = await fetch(base + "/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials),
  });
  assert.equal(registered.status, 201);
  const authorId = (await registered.json()).id;
  const loggedIn = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials),
  });
  assert.equal(loggedIn.status, 200);
  const accessToken = (await loggedIn.json()).accessToken;
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`,
  };
  async function request(method, route, expected, body) {
    const response = await fetch(base + route, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    assert.equal(response.status, expected, `${method} ${route}: ${text}`);
    if (expected === 204) {
      assert.equal(text, "");
      return;
    }
    const json = JSON.parse(text);
    if (expected >= 400) {
      assert.equal(json.statusCode, expected);
      assert.equal(typeof json.code, "string");
      assert.equal(typeof json.message, "string");
      assert(Array.isArray(json.details));
      assert.equal(typeof json.timestamp, "string");
      assert(!text.includes("password_hash"));
    }
    return json;
  }
  const payload = (n, extra = {}) => ({
    categoryId,
    title: `Week 2 study planner ${n}`,
    slug: `week2-${suffix}-${n}`,
    description: `Study and planning ${n}`,
    contentJson: structuredClone(example.contentJson),
    tags: [tag],
    ...extra,
  });
  try {
    await t.test(
      "DTO validation: malformed IDs, pagination, nulls and unknown fields",
      async () => {
        await request("GET", "/templates/not-a-uuid", 400);
        const malformed = await fetch(base + "/templates", {
          method: "POST",
          headers,
          body: "{",
        });
        assert.equal(malformed.status, 400);
        assert.equal((await malformed.json()).statusCode, 400);
        for (const query of [
          "page=0",
          "page=1.5",
          "page=10001",
          "size=101",
          "size=",
          "sort=slug",
          "order=drop",
          "isPublic=0",
          "isPublic=wat",
          "page=1&page=2",
          "unknown=1",
          "authorId=invalid",
        ]) {
          await request("GET", `/templates?${query}`, 400);
        }
        await request("POST", "/templates", 400, {
          ...payload("bad"),
          title: "  ",
        });
        await request("POST", "/templates", 400, {
          ...payload("bad"),
          title: "x".repeat(256),
        });
        await request("POST", "/templates", 400, {
          ...payload("bad"),
          contentJson: [],
        });
        for (const contentJson of [
          {},
          { ...example.contentJson, html: "  " },
          { ...example.contentJson, schemaVersion: 2 },
          { ...example.contentJson, allowHeightResize: "false" },
          { ...example.contentJson, level: "partial" },
          { ...example.contentJson, subjectCategory: "education" },
          { ...example.contentJson, unexpected: "not allowed" },
          { ...example.contentJson, html: null },
          { ...example.contentJson, html: "x".repeat(1000001) },
        ]) {
          await request("POST", "/templates", 400, {
            ...payload("bad"),
            contentJson,
          });
        }
        await request("POST", "/templates", 413, {
          ...payload("too-large"),
          contentJson: { ...example.contentJson, html: "x".repeat(2200000) },
        });
        await request("POST", "/templates", 400, {
          ...payload("bad"),
          isPublic: "false",
        });
        await request("POST", "/templates", 400, {
          ...payload("bad"),
          isPublic: null,
        });
        await request("POST", "/templates", 400, {
          ...payload("bad"),
          viewsCount: 100,
        });
        await request("POST", "/templates", 400, {
          ...payload("bad"),
          categoryId: randomUUID(),
        });
        await request("POST", "/templates", 400, {
          ...payload("bad"),
          authorId: randomUUID(),
        });
      },
    );
    let first;
    await t.test(
      "create, mapped relations, defaults and literal false",
      async () => {
        first = await request(
          "POST",
          "/templates",
          201,
          payload("one", { title: "  Week 2 planner  ", isPublic: false }),
        );
        ids.push(first.id);
        assert.equal(first.title, "Week 2 planner");
        assert.equal(first.isPublic, false);
        assert.equal(first.category.id, categoryId);
        assert.equal(first.category.name, "Software Engineering");
        assert.equal(first.author.id, authorId);
        assert.deepEqual(Object.keys(first.author), ["id"]);
        assert.equal(first.viewsCount, 0);
        assert.equal(first.ratingAvg, 0);
        assert.equal(first.version, "1.0.0");
        assert.equal(first.deletedAt, null);
        assert.deepEqual(first.contentJson, example.contentJson);
        assert(!JSON.stringify(first).includes("password"));
        const second = await request("POST", "/templates", 201, payload("two"));
        ids.push(second.id);
        assert.equal(second.isPublic, true);
        const third = await request(
          "POST",
          "/templates",
          201,
          payload("three"),
        );
        ids.push(third.id);
      },
    );
    await t.test("list, count, stable pagination and filters", async () => {
      const list = await request(
        "GET",
        `/templates?tag=${tag}&size=2&order=asc`,
        200,
      );
      assert.equal(list.page, 1);
      assert.equal(list.size, 2);
      assert.equal(list.totalElements, 3);
      assert.equal(list.totalPages, 2);
      const next = await request(
        "GET",
        `/templates?tag=${tag}&size=2&page=2&order=asc`,
        200,
      );
      assert.equal(next.data.length, 1);
      assert.equal(
        new Set([...list.data, ...next.data].map((x) => x.id)).size,
        3,
      );
      const privateOnly = await request(
        "GET",
        `/templates?tag=${tag}&isPublic=false`,
        200,
      );
      assert.equal(privateOnly.totalElements, 1);
      assert.equal(privateOnly.data[0].id, first.id);
      const refs = await request(
        "GET",
        `/templates?tag=${tag}&authorId=${authorId}&categoryId=${categoryId}`,
        200,
      );
      assert.equal(refs.totalElements, 3);
      const empty = await request(
        "GET",
        `/templates?tag=absent-${suffix}`,
        200,
      );
      assert.equal(empty.totalElements, 0);
      assert.equal(empty.totalPages, 0);
      assert.deepEqual(empty.data, []);
      const beyond = await request("GET", `/templates?tag=${tag}&page=9`, 200);
      assert.equal(beyond.totalElements, 3);
      assert.deepEqual(beyond.data, []);
      assert.equal(
        (await request("GET", `/templates?tag=${tag}&search=%25`, 200))
          .totalElements,
        0,
      );
    });
    await t.test(
      "App HTML metadata round-trip, large HTML and immutable content on GET",
      async () => {
        const contentJson = {
          ...example.contentJson,
          html: `<article lang="vi">${"Kế hoạch 📝 ".repeat(12000)}</article>`,
        };
        const created = await request(
          "POST",
          "/templates",
          201,
          payload("html", { contentJson }),
        );
        ids.push(created.id);
        assert.deepEqual(created.contentJson, contentJson);
        const loaded = await request("GET", `/templates/${created.id}`, 200);
        assert.deepEqual(loaded.contentJson, contentJson);
        assert.equal(loaded.contentJson.allowHeightResize, false);
        await request("PATCH", `/templates/${created.id}`, 400, {
          contentJson: { html: "<p>Incomplete envelope</p>" },
        });
        const minimal = {
          format: "erusentia-template-html",
          schemaVersion: 1,
          html: "<p>Updated</p>",
        };
        const updated = await request(
          "PATCH",
          `/templates/${created.id}`,
          200,
          { contentJson: minimal },
        );
        assert.deepEqual(
          updated.contentJson,
          minimal,
          "JSONB document is replaced, not deep-merged",
        );
        await request("DELETE", `/templates/${created.id}`, 204);
      },
    );
    await t.test(
      "GET and PATCH have no view-count side effects; ownership/metrics are immutable",
      async () => {
        assert.equal(
          (await request("GET", `/templates/${first.id}`, 200)).viewsCount,
          0,
        );
        assert.equal(
          (await request("GET", `/templates/${first.id}`, 200)).viewsCount,
          0,
        );
        await request("PATCH", `/templates/${first.id}`, 400, {});
        await request("PATCH", `/templates/${first.id}`, 400, { authorId });
        for (const property of [
          "title",
          "tags",
          "isPublic",
          "version",
          "categoryId",
          "contentJson",
        ]) {
          await request("PATCH", `/templates/${first.id}`, 400, {
            [property]: null,
          });
        }
        await request("PATCH", `/templates/${first.id}`, 400, {
          viewsCount: 100,
        });
        const changed = await request("PATCH", `/templates/${first.id}`, 200, {
          title: "Updated study planner",
          categoryId: category2,
          contentJson: {
            format: "erusentia-template-html",
            schemaVersion: 1,
            html: "<p>Updated planner</p>",
            allowHeightResize: false,
          },
          thumbnailUrl: "https://example.test/image.png",
        });
        assert.equal(changed.category.id, category2);
        assert.equal(changed.category.name, "Project Management");
        assert.equal(changed.viewsCount, 0);
        assert.equal(changed.contentJson.html, "<p>Updated planner</p>");
        assert.equal(changed.description, first.description);
        assert.equal(
          (
            await request("PATCH", `/templates/${first.id}`, 200, {
              thumbnailUrl: null,
            })
          ).thumbnailUrl,
          null,
        );
      },
    );
    await t.test(
      "slug conflicts including concurrent writes and PATCH",
      async () => {
        await request("POST", "/templates", 409, payload("one"));
        await request("PATCH", `/templates/${first.id}`, 409, {
          slug: payload("two").slug,
        });
        const body = payload("race");
        const results = await Promise.all(
          [1, 2].map(() =>
            fetch(base + "/templates", {
              method: "POST",
              headers,
              body: JSON.stringify(body),
            }),
          ),
        );
        assert.deepEqual(results.map((x) => x.status).sort(), [201, 409]);
        for (const result of results) {
          const json = await result.json();
          if (result.status === 201) ids.push(json.id);
        }
      },
    );
    await t.test("soft deletion, missing rows and reserved slug", async () => {
      await request("DELETE", `/templates/${first.id}`, 204);
      await request("GET", `/templates/${first.id}`, 404);
      await request("PATCH", `/templates/${first.id}`, 404, {
        title: "New title",
      });
      await request("DELETE", `/templates/${first.id}`, 404);
      await request("POST", "/templates", 409, payload("one"));
      const list = await request("GET", `/templates?tag=${tag}`, 200);
      assert(!list.data.some((x) => x.id === first.id));
      await request("GET", `/templates/${randomUUID()}`, 404);
      await request("DELETE", `/templates/${randomUUID()}`, 404);
      await request("GET", "/not-found", 404);
    });
  } finally {
    for (const id of ids)
      await fetch(`${base}/templates/${id}`, { method: "DELETE", headers });
  }
  return { ids, tag };
}
module.exports = { contract };
