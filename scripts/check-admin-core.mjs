import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative, join } from "node:path";
const root = resolve(import.meta.dirname, "..");
const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory()
      ? files(join(dir, item.name))
      : item.name.endsWith(".ts")
        ? [join(dir, item.name)]
        : [],
  );
const errors = [],
  routes = [];
const decorators = (node) =>
  ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
const call = (decorator) =>
  ts.isCallExpression(decorator.expression) ? decorator.expression : undefined;
const name = (decorator) => call(decorator)?.expression.getText();
const textArg = (decorator) => {
  const arg = call(decorator)?.arguments[0];
  return arg && ts.isStringLiteral(arg) ? arg.text : "";
};
const hasAdmin = (node) =>
  decorators(node).some((item) => {
    if (name(item) !== "Roles") return false;
    const args = call(item).arguments;
    return (
      args.length > 0 &&
      args.every((arg) => ts.isStringLiteral(arg) && arg.text === "admin")
    );
  });
let services = 0,
  controllers = 0;
for (const file of files(resolve(root, "src"))) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  for (const node of source.statements) {
    if (!ts.isClassDeclaration(node)) continue;
    for (const clause of node.heritageClauses ?? [])
      for (const type of clause.types) {
        if (type.expression.getText(source) === "BaseService") services++;
        if (type.expression.getText(source) === "BaseController") controllers++;
      }
    const controller = decorators(node).find((item) =>
      ["Controller", "AdminController"].includes(name(item)),
    );
    if (!controller) continue;
    const composed = name(controller) === "AdminController";
    const prefix = (composed ? "admin/" : "") + textArg(controller);
    for (const method of node.members) {
      if (!ts.isMethodDeclaration(method)) continue;
      const route = decorators(method).find((item) =>
        ["Get", "Post", "Patch", "Put", "Delete"].includes(name(item)),
      );
      if (!route) continue;
      const path = [prefix, textArg(route)]
        .filter(Boolean)
        .join("/")
        .replace(/^\//, "");
      if (!/^admin(?:\/|$)/.test(path)) continue;
      const location =
        relative(root, file) +
        ":" +
        (source.getLineAndCharacterOfPosition(method.getStart(source)).line +
          1);
      routes.push({ method: name(route).toUpperCase(), path, location });
      const publicRoute = [...decorators(node), ...decorators(method)].some(
        (item) => name(item) === "Public",
      );
      // Method metadata overrides class policy in RolesGuard.
      const methodPolicy = decorators(method).some(
        (item) => name(item) === "Roles",
      );
      if (
        publicRoute ||
        !(methodPolicy ? hasAdmin(method) : composed || hasAdmin(node))
      )
        errors.push(location + ": Admin route lacks the admin role policy");
      for (const param of method.parameters) {
        const input = decorators(param).find((item) =>
          ["Query", "Body"].includes(name(item)),
        );
        if (
          input &&
          (!param.type ||
            !ts.isTypeReferenceNode(param.type) ||
            !param.type.getText(source).endsWith("Dto"))
        )
          errors.push(
            location + ": Body/Query must retain a concrete validated DTO",
          );
        const id = decorators(param).find((item) => name(item) === "Param");
        if (
          id &&
          !call(id).arguments.some(
            (arg) => ts.isIdentifier(arg) && arg.text === "UuidPipe",
          )
        )
          errors.push(location + ": Admin resource ID lacks UuidPipe");
      }
    }
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Admin core boundaries pass: ${routes.length} protected routes; ${services} BaseService consumers; ${controllers} BaseController consumers. DTO and UUID policies retained.`,
  );
