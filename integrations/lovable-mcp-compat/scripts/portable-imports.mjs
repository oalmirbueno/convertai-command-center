import path from "node:path";
import ts from "typescript";

/** A Windows drive is a local file path, never an npm package name. */
export function externalSpecifier(specifier, versions, sdkVersion) {
  if (specifier.startsWith(".") || path.posix.isAbsolute(specifier)
    || path.win32.isAbsolute(specifier) || /^[A-Za-z]:/.test(specifier)) return null;
  if (/^(npm|node|jsr|https?|data):/.test(specifier)) return specifier;
  const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
  const subpath = specifier.slice(name.length);
  if (name === "@lovable.dev/mcp-js") return `npm:${name}@${sdkVersion}${subpath}`;
  const range = versions[name];
  const version = typeof range === "string" && /^[\dv^~>=]|^latest$/.test(range) ? range : null;
  return `npm:${name}${version ? `@${version}` : ""}${subpath}`;
}

/** Inspect syntax, including dynamic imports, so comments cannot satisfy the check. */
export function assertPortableImports(source) {
  const file = ts.createSourceFile("generated-mcp.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports = [];
  function inspect(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      imports.push(node.moduleSpecifier);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (node.arguments.length !== 1) throw new Error("Generated legacy function contains an unresolved dynamic import");
      imports.push(node.arguments[0]);
    }
    ts.forEachChild(node, inspect);
  }
  inspect(file);
  for (const node of imports) {
    if (!ts.isStringLiteralLike(node)) throw new Error("Generated legacy function contains an unresolved dynamic import");
    const specifier = node.text;
    const dependency = specifier.replace(/^npm:/, "");
    if (specifier.includes("\\") || /^(?:[A-Za-z]:|file:|\/|\.)/.test(dependency)
      || !/^(npm|node|jsr|https?|data):/.test(specifier)) {
      throw new Error("Generated legacy function contains a local, bare or invalid import; regenerate with the portable compatibility build");
    }
    if (specifier.startsWith("npm:") && !/^(?:@[^/@:\s]+\/)?[^/@:\s]+(?:@[^/\s]+)?(?:\/.*)?$/.test(dependency)) {
      throw new Error("Generated legacy function contains an invalid npm import");
    }
  }
}
