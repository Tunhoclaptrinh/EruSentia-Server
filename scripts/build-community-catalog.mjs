import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../tools/community/", import.meta.url));
const manifest = JSON.parse(
  await readFile(path.join(root, "manifest.json"), "utf8"),
);
const theme = await readFile(path.join(root, "theme.css"), "utf8");
const templates = [];
for (const entry of manifest.templates) {
  const { htmlFile, ...template } = entry;
  if (!/^templates\/[a-z0-9-]+\.html$/.test(htmlFile))
    throw Error("Invalid authored HTML path");
  const source = await readFile(path.join(root, htmlFile), "utf8");
  if (!source.includes("/* @community-theme */"))
    throw Error("Missing inline theme slot: " + htmlFile);
  templates.push({
    ...template,
    contentJson: {
      ...template.contentJson,
      html: source.replace("/* @community-theme */", theme.trim()),
    },
  });
}
const result = JSON.stringify({ ...manifest, templates }, null, 2) + "\n";
const output = path.join(root, "catalog.json");
if (process.argv.includes("--check")) {
  if ((await readFile(output, "utf8")) !== result)
    throw Error("Catalog is stale: run pnpm community:build");
  console.log(
    "14 authored templates and generated self-contained catalog match.",
  );
} else {
  await writeFile(output, result);
  console.log("Built 14 self-contained community templates.");
}
