import "reflect-metadata";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { readConfig } from "../src/config";
import { createApplication } from "../src/app";
import { TemplateCache } from "../src/cache/template-cache";
import { setTimeout as delay } from "node:timers/promises";

async function main() {
  config();
  if (!/^week5_test_[a-z0-9_]+$/.test(process.env.DB_DATABASE ?? ""))
    throw new Error("Use a prepared week5_test_* database");
  const settings = readConfig({
    ...process.env,
    CACHE_ENABLED: "true",
    QUEUE_ENABLED: "false",
    CACHE_NAMESPACE: `week5bench_${randomUUID().replaceAll("-", "")}`,
    CACHE_TTL_SECONDS: "300",
  });
  const cached = await createApplication(settings, false);
  const plain = await createApplication(
    { ...settings, cache: { ...settings.cache, enabled: false } },
    false,
  );
  const cache = cached.get(TemplateCache);
  let token = "",
    id = "";
  try {
    await cached.listen(0, "127.0.0.1");
    await plain.listen(0, "127.0.0.1");
    const end = Date.now() + 5000;
    while (!cache.client.isReady && Date.now() < end) await delay(30);
    if (!cache.client.isReady) throw new Error("Redis not ready");
    const base = await cached.getUrl();
    const credentials = {
      email: `benchmark-${randomUUID()}@example.test`,
      password: randomUUID(),
    };
    const call = async (method: string, route: string, body: unknown) =>
      fetch(base + route, {
        method,
        headers: {
          "content-type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
    if ((await call("POST", "/auth/register", credentials)).status !== 201)
      throw new Error("Registration failed");
    token = (await (await call("POST", "/auth/login", credentials)).json())
      .accessToken;
    const html =
      "<main>" +
      "<p>Template cache benchmark: kế hoạch học tập.</p>".repeat(10000) +
      "</main>";
    const created = await call("POST", "/templates", {
      categoryId: "c0000000-0000-0000-0000-000000000001",
      title: "Cache benchmark",
      slug: `cache-bench-${randomUUID()}`,
      description: "Local generated HTML, no App assets",
      isPublic: true,
      contentJson: {
        format: "erusentia-template-html",
        schemaVersion: 1,
        html,
      },
    });
    if (created.status !== 201) throw new Error("Template creation failed");
    id = (await created.json()).id;
    async function measure(origin: string, expected: string) {
      const start = performance.now();
      const r = await fetch(origin + "/templates/" + id, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.arrayBuffer();
      const ms = performance.now() - start;
      if (r.status !== 200 || r.headers.get("x-cache") !== expected)
        throw new Error("Unexpected cache path");
      return { ms, bytes: data.byteLength };
    }
    const plainBase = await plain.getUrl();
    for (let i = 0; i < 5; i++) {
      await measure(plainBase, "BYPASS_DISABLED");
      if (i === 0) await measure(base, "MISS");
      else await measure(base, "HIT");
    }
    const samples: { disabled: number[]; hit: number[]; miss: number[] } = {
      disabled: [],
      hit: [],
      miss: [],
    };
    let bytes = 0;
    for (let i = 0; i < 40; i++) {
      // Alternate order to reduce a systematic warmup/sequence advantage.
      const order = i % 2 ? ["hit", "disabled"] : ["disabled", "hit"];
      for (const mode of order) {
        const r = await measure(
          mode === "hit" ? base : plainBase,
          mode === "hit" ? "HIT" : "BYPASS_DISABLED",
        );
        samples[mode as "hit" | "disabled"].push(r.ms);
        bytes = r.bytes;
      }
    }
    const stamp = await cache.stamp(id);
    for (let i = 0; i < 20; i++) {
      await cache.client.del(cache.key(id, stamp!.revision));
      samples.miss.push((await measure(base, "MISS")).ms);
    }
    function stats(values: number[]) {
      const sorted = [...values].sort((a, b) => a - b);
      return {
        n: values.length,
        meanMs: Number(
          (values.reduce((a, b) => a + b, 0) / values.length).toFixed(3),
        ),
        medianMs: Number(
          (
            (sorted[Math.floor((sorted.length - 1) / 2)] +
              sorted[Math.floor(sorted.length / 2)]) /
            2
          ).toFixed(3),
        ),
        p95Ms: Number(sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(3)),
      };
    }
    console.log(
      JSON.stringify(
        {
          date: "2026-11-04",
          scope:
            "localhost HTTP including JWT/user/session checks, full response body, no artificial DB delay",
          responseBytes: bytes,
          warmup: 5,
          concurrency: 1,
          disabled: stats(samples.disabled),
          hit: stats(samples.hit),
          miss: stats(samples.miss),
          hitMedianSpeedup: Number(
            (
              stats(samples.disabled).medianMs / stats(samples.hit).medianMs
            ).toFixed(3),
          ),
        },
        null,
        2,
      ),
    );
  } finally {
    if (cache.client.isReady) {
      const keys = await cache.client.keys(settings.cache.namespace + ":*");
      if (keys.length) await cache.client.del(keys);
    }
    await cached.close();
    await plain.close();
  }
}
main().catch((error: Error) => {
  console.error("Cache benchmark failed:", error.message);
  process.exitCode = 1;
});
