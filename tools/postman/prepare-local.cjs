// Build a disposable Postman v3 local view from the canonical v2.1 collection.
// No network, Postman login, cloud manifest, Git initialization or dependencies.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const output = path.resolve(
  process.argv[2] || path.join(os.tmpdir(), "eru-week2-postman-local"),
);
if (fs.existsSync(output) && fs.readdirSync(output).length) {
  console.error(`Folder already contains files: ${output}`);
  console.error(
    "Open the existing folder in Postman, or pass a new output path.",
  );
  process.exit(1);
}
const collection = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "templates.postman_collection.json"),
    "utf8",
  ),
);
const environment = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "erusentia-local.postman_environment.json"),
    "utf8",
  ),
);
if (
  collection.item.some(
    (item) => item.item || typeof item.request.url !== "string",
  )
) {
  throw new Error(
    "Review conversion before adding folders or structured request URLs",
  );
}
const root = path.join(output, "postman", "collections", "EruSentia Week 2");
function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // JSON is also valid YAML 1.2: preserve body/script strings without a YAML dependency.
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}
write(path.join(root, ".resources", "definition.yaml"), {
  $kind: "collection",
  name: "EruSentia Week 2 — Templates (local)",
  description:
    "Local-only API practice. Generated from the verified v2.1 collection. Do not Push to Cloud.",
  variables: collection.variable,
  auth: { type: "noauth" },
});
collection.item.forEach((item, index) => {
  const request = item.request;
  const name = item.name.replace(/[\\/:*?"<>|]/g, "-");
  const query = request.url.split("?")[1];
  write(path.join(root, `${name}.request.yaml`), {
    $kind: "http-request",
    name: item.name,
    order: (index + 1) * 1000,
    method: request.method,
    url: request.url,
    ...(request.header ? { headers: request.header } : {}),
    ...(query
      ? {
          queryParams: [...new URLSearchParams(query)].map(([key, value]) => ({
            key,
            value,
          })),
        }
      : {}),
    ...(request.body
      ? { body: { type: "json", content: request.body.raw } }
      : {}),
    scripts: (item.event || []).map((event) => ({
      type: event.listen === "prerequest" ? "beforeRequest" : "afterResponse",
      language: "text/javascript",
      code: event.script.exec.join("\n"),
    })),
  });
});
write(
  path.join(
    output,
    "postman",
    "environments",
    "EruSentia Local.environment.yaml",
  ),
  {
    name: environment.name,
    values: environment.values,
  },
);
console.log(
  `Prepared ${collection.item.length} requests and one local environment.`,
);
console.log(`Postman: Open Folder → ${output} → Local Items.`);
console.log(
  "Do not use Push to Cloud. Regeneration never overwrites an existing folder.",
);
