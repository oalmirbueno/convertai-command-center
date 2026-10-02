import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 02/10: o script de estatística da Cloudflare (beacon.min.js), bloqueado por bloqueador ou rede,
// abria "Não foi possível baixar o painel" e recarregava a tela. E qualquer "Failed to fetch" na
// abertura (login, banco) contava como arquivo do painel faltando.

const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const refresh = readFileSync(resolve(process.cwd(), "src/lib/appRefresh.ts"), "utf8");
const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

function vigia(): { isOurFile: (u: string) => boolean; isMissingFile: (m: string) => boolean } {
  const ini = html.indexOf("function isMissingFile(message)");
  const fim = html.indexOf("function failedToStart(message)");
  const codigo = html.slice(ini, fim);
  // eslint-disable-next-line no-new-func
  return new Function(`${codigo}; return { isOurFile, isMissingFile };`)();
}

describe("abertura do painel sem tela falsa", () => {
  it("script de outro site não conta como arquivo do painel", () => {
    const v = vigia();
    expect(v.isOurFile("https://static.cloudflareinsights.com/beacon.min.js/v31")).toBe(false);
    expect(v.isOurFile(`${window.location.origin}/assets/index-abc.js`)).toBe(true);
    expect(v.isOurFile("/assets/index-abc.js")).toBe(true);
    expect(v.isOurFile("")).toBe(false);
    expect(html).toMatch(/if \(!isOurFile\(\(target && target\.src\) \|\| \(target && target\.href\) \|\| ""\)\) return;/);
  });

  it("só erro de módulo conta como arquivo faltando; rede comum não recarrega", () => {
    const v = vigia();
    expect(v.isMissingFile("Failed to fetch dynamically imported module: /assets/x.js")).toBe(true);
    expect(v.isMissingFile("Importing a module script failed.")).toBe(true);
    expect(v.isMissingFile("TypeError: Failed to fetch")).toBe(false);
    expect(v.isMissingFile("Load failed")).toBe(false);
  });

  it("versão nova não recarrega no meio do trabalho: só na abertura ou na próxima troca de tela", () => {
    expect(refresh).toMatch(/if \(reloadNow && Date\.now\(\) - abertoEm < 8_000\) updateReload\(\);/);
    expect(refresh).not.toMatch(/if \(updatePending\) updateReload\(\);\s*else void check\(true\);/);
    expect(refresh).toMatch(/export function atualizarNaTrocaDeTela\(\): boolean/);
    expect(app).toMatch(/atualizarNaTrocaDeTela\(\);/);
  });
});
