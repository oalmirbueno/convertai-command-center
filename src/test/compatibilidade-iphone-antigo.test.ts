import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { primeiraFrase, separarFrases } from "@/lib/frases";

/**
 * iPhone 6, 7 e 8 desatualizados (Safari até 16.3) não entendem regex com
 * lookbehind `(?<=...)`. O build converte a sintaxe moderna, mas regex não
 * tem conversão: o compilador só a embrulha em `new RegExp(...)`, e ela
 * explode na hora em que a tela roda. Foi assim que o painel do cliente
 * ficou branco nesses aparelhos (2026-09-18). Este teste impede a volta.
 */

const raiz = resolve(__dirname, "../..");

function arquivosDeCodigo(dir: string, saida: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) { arquivosDeCodigo(caminho, saida); continue; }
    if (/\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome) && !caminho.includes(`${join("src", "test")}`)) saida.push(caminho);
  }
  return saida;
}

describe("nenhuma regex com lookbehind no código do painel", () => {
  it("src/ não contém (?<= nem (?<!", () => {
    const culpados = arquivosDeCodigo(resolve(raiz, "src"))
      .filter((f) => !f.endsWith(join("lib", "frases.ts")))
      .filter((f) => /\(\?<[=!]/.test(readFileSync(f, "utf8")));
    expect(culpados).toEqual([]);
  });

  it("o cortador de frases faz o mesmo trabalho sem lookbehind", () => {
    expect(separarFrases("Uma frase. Outra frase! Terceira? fim", { exigirMaiuscula: true }))
      .toEqual(["Uma frase.", "Outra frase!", "Terceira? fim"]);
    expect(separarFrases("A; B. C", { pontuacao: ".;!?" })).toEqual(["A;", "B.", "C"]);
    expect(primeiraFrase("Aprovar até quarta. Depois agendar.")).toBe("Aprovar até quarta.");
    expect(primeiraFrase("Sem ponto final")).toBe("Sem ponto final");
    expect(separarFrases("")).toEqual([]);
  });
});

describe("as lacunas de API do iPhone antigo estão preenchidas", () => {
  const polyfills = readFileSync(resolve(raiz, "src/polyfills.ts"), "utf8");
  const main = readFileSync(resolve(raiz, "src/main.tsx"), "utf8");

  it("polyfills é o primeiro import do painel", () => {
    expect(main.trimStart().replace(/^\/\/[^\n]*\n/, "").trimStart().startsWith('import "./polyfills";')).toBe(true);
  });

  it("cobre Promise.any, navigator.clipboard e ResizeObserver, além do que já cobria", () => {
    for (const nome of ['define(Promise, "any"', 'define(Promise, "allSettled"', 'define(Array.prototype, "at"', 'define(Object, "hasOwn"', "crypto.randomUUID", "navigator.clipboard", "g.ResizeObserver = ResizeObserverMinimo"]) {
      expect(polyfills).toContain(nome);
    }
  });

  it("o build continua mirando Safari 12", () => {
    expect(readFileSync(resolve(raiz, "vite.config.ts"), "utf8")).toContain('"safari12"');
  });
});
