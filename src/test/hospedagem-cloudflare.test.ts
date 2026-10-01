import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 30/09: o front é publicado na Cloudflare (docs/hospedagem/CLOUDFLARE-PAGES.md).
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("hospedagem do painel na Cloudflare", () => {
  it("rotas do painel caem no index.html e a pasta publicada é o dist", () => {
    const conf = ler("wrangler.jsonc");
    expect(conf).toContain('"name": "aceleriq-painel"');
    expect(conf).toContain('"directory": "./dist"');
    expect(conf).toContain('"not_found_handling": "single-page-application"');
  });

  it("assets com hash ficam em cache para sempre e version.json nunca", () => {
    const h = ler("public/_headers");
    expect(h).toMatch(/\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
    expect(h).toMatch(/\/version\.json\n\s+Cache-Control: no-store/);
    expect(existsSync(resolve(process.cwd(), "public/404.html"))).toBe(false);
  });

  it("publicar é build + wrangler deploy, aqui e no GitHub", () => {
    expect(JSON.parse(ler("package.json")).scripts.publicar).toBe("vite build && npx --yes wrangler@4 deploy");
    expect(ler(".github/workflows/deploy-cloudflare-pages.yml")).toContain("wrangler@4 deploy");
  });
});
