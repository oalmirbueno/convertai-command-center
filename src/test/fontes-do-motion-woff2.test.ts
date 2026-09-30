import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PERF-B17 (30/09/2026): o player do motion baixava 4 fontes em TTF (1,15 MB)
 * ao abrir. Agora baixa as mesmas letras em WOFF2 (368 KB). Os .ttf continuam
 * ao lado: o HyperFrames (supabase/functions/_shared/cena-hf.ts) e os pedidos
 * de render já gravados usam esses nomes, e o worker copia a pasta inteira.
 */

const raiz = resolve(__dirname, "../..");
const pecas = readFileSync(resolve(raiz, "src/components/mesa-edicao/editor/motion/Pecas.tsx"), "utf8");
const bloco = pecas.slice(pecas.indexOf("export const FONTES_DO_MOTION"), pecas.indexOf("];", pecas.indexOf("export const FONTES_DO_MOTION")));
const arquivos = Array.from(bloco.matchAll(/arquivo: "([^"]+)"/g), (m) => m[1]);

describe("fontes do motion em WOFF2", () => {
  it("o player pede as 4 fontes em WOFF2", () => {
    expect(arquivos).toHaveLength(4);
    for (const arquivo of arquivos) expect(arquivo).toMatch(/^editor\/fontes\/[A-Za-z-]+\.woff2$/);
    expect(pecas).toContain("format('woff2')");
  });

  it("cada WOFF2 existe no public, é WOFF2 de verdade e tem o TTF ao lado", () => {
    for (const arquivo of arquivos) {
      const woff2 = resolve(raiz, "public", arquivo);
      expect(existsSync(woff2), arquivo).toBe(true);
      expect(readFileSync(woff2).subarray(0, 4).toString("latin1"), arquivo).toBe("wOF2");
      const ttf = woff2.replace(/\.woff2$/, ".ttf");
      expect(existsSync(ttf), ttf).toBe(true);
      expect(readFileSync(woff2).length, arquivo).toBeLessThan(readFileSync(ttf).length);
    }
  });
});
