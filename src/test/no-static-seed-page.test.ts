import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production source hygiene", () => {
  it("does not ship the retired static seed page", () => {
    expect(existsSync(resolve(process.cwd(), "src/pages/SeedPage.tsx"))).toBe(false);
  });
});
