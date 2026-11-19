import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { semEfeitoColateral } from "../../config/sem-efeito-colateral";

/**
 * 19/11/2026 (painel lento): o primeiro arquivo do painel levava o @dnd-kit, o
 * Radix Select e a Central inteira, que nenhuma tela usa na abertura, porque o
 * Rollup não sabia que os nossos arquivos não fazem nada só por serem
 * importados. A regra está em config/sem-efeito-colateral.ts.
 */

const raiz = resolve(__dirname, "../..");

describe("arquivos do painel sem efeito colateral", () => {
  it("o código do painel e o compartilhado com as funções saem do build quando não usados", () => {
    expect(semEfeitoColateral(`${raiz}/src/components/sistema/QuadroKanban.tsx`.replace(/\\/g, "/"))).toBe(true);
    expect(semEfeitoColateral("C:\\AI\\x\\src\\lib\\mensagensDaSemana.ts")).toBe(true);
    expect(semEfeitoColateral("/x/supabase/functions/_shared/dados-da-agencia.ts")).toBe(true);
    expect(semEfeitoColateral("/x/node_modules/@dnd-kit/core/dist/core.esm.js")).toBe(true);
  });

  it("o que roda só por ser importado continua sempre no build", () => {
    for (const id of [
      "/x/src/main.tsx",
      "/x/src/polyfills.ts",
      "/x/src/index.css",
      "/x/src/lib/miniaturas.worker.ts",
      "/x/src/lib/miniaturas.worker.ts?worker",
      "/x/src/assets/logo.png?url",
      "/x/node_modules/react/index.js",
      "/x/node_modules/pacote/src/arquivo.ts",
      "\0commonjsHelpers.js",
    ]) {
      expect(semEfeitoColateral(id), id).toBe(false);
    }
  });

  it("nenhum arquivo do src é importado só pelo efeito (fora polyfills e CSS)", () => {
    const arquivos: string[] = [];
    const andar = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) {
          if (nome !== "test") andar(p);
        } else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.|\.d\.ts$/.test(nome)) arquivos.push(p);
      }
    };
    andar(join(raiz, "src"));
    const soPeloEfeito: string[] = [];
    for (const arq of arquivos) {
      for (const linha of readFileSync(arq, "utf8").split("\n")) {
        const m = /^\s*import\s+["']([^"']+)["']/.exec(linha);
        if (m && !/\.css$/.test(m[1]) && m[1] !== "./polyfills") soPeloEfeito.push(`${arq}: ${m[1]}`);
      }
    }
    // Se um dia precisar, ponha o arquivo em COM_EFEITO (config/sem-efeito-colateral.ts).
    expect(soPeloEfeito).toEqual([]);
  }, 30_000);

  it("o vite.config liga o plugin", () => {
    const fonte = readFileSync(join(raiz, "vite.config.ts"), "utf8");
    expect(fonte).toContain("pluginSemEfeitoColateral()");
  });
});
