import { describe, expect, it } from "vitest";
import { assertPortableImports, externalSpecifier } from "../../integrations/lovable-mcp-compat/scripts/portable-imports.mjs";

describe("MCP compatibility: portable generated imports", () => {
  it.each(["C:\\repo\\src\\index.ts", "C:/repo/src/index.ts", "D:src/index.ts", "\\\\server\\share\\index.ts", "/repo/src/index.ts", "./src/index.ts", "../tool.ts"])("keeps local entry %s inside the bundle", (entry) => {
    expect(externalSpecifier(entry, {}, "0.23.0")).toBeNull();
  });
  it("pins SDK subpaths and preserves declared npm dependency ranges", () => {
    expect(externalSpecifier("@lovable.dev/mcp-js/stacks/supabase", {}, "0.23.0")).toBe("npm:@lovable.dev/mcp-js@0.23.0/stacks/supabase");
    expect(externalSpecifier("zod", { zod: "^3.25.76" }, "0.23.0")).toBe("npm:zod@^3.25.76");
    expect(externalSpecifier("node:crypto", {}, "0.23.0")).toBe("node:crypto");
  });
  it.each(["npm:C:\\repo\\src\\index.ts", "npm:C:/repo/src/index.ts", "file:///repo/index.ts", "/repo/index.ts", "./src/index.ts", "../index.ts", "zod"])("rejects nonportable generated import %s", (specifier) => {
    expect(() => assertPortableImports(`import mcp from ${JSON.stringify(specifier)};`)).toThrow();
    expect(() => assertPortableImports(`export { mcp } from ${JSON.stringify(specifier)};`)).toThrow();
    expect(() => assertPortableImports(`const mcp = import(${JSON.stringify(specifier)});`)).toThrow();
  });
  it("rejects unresolved dynamic imports", () => {
    expect(() => assertPortableImports("const mcp = import(localPath);")).toThrow("unresolved dynamic import");
  });
  it("allows portable runtime imports and ignores examples in strings/comments", () => {
    expect(() => assertPortableImports('import { defineMcp } from "npm:@lovable.dev/mcp-js@0.23.0";\n'
      + 'import { createClient } from "npm:@supabase/supabase-js@^2.97.0";\n'
      + '// import x from "npm:C:/example";\nconst example = "C:/example";')).not.toThrow();
  });
});
