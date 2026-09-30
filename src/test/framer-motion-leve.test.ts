import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O painel usa a versão leve do framer-motion (LazyMotion + m.*). A completa
 * (motion.*) trazia arrastar e layout para a home do cliente, que só faz um
 * fade de entrada: cerca de 14 KB comprimidos a mais (PERF-B08, 30/09/2026).
 * Um único `motion.` volta a carregar o pacote inteiro, e nada quebra: só fica
 * mais pesado. Por isso a guarda aqui.
 */

const raiz = resolve(__dirname, "..");

function arquivosDoPainel(pasta: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) {
      if (nome === "test" || nome === "node_modules") continue;
      saida.push(...arquivosDoPainel(caminho));
    } else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.(ts|tsx)$/.test(nome)) {
      saida.push(caminho);
    }
  }
  return saida;
}

const usamFramer = arquivosDoPainel(raiz)
  .map((caminho) => ({ caminho: relative(raiz, caminho), fonte: readFileSync(caminho, "utf8") }))
  .filter(({ fonte }) => /from\s+["']framer-motion["']/.test(fonte));

describe("framer-motion na versão leve", () => {
  it("há quem use o framer-motion (a guarda não está olhando para o vazio)", () => {
    expect(usamFramer.length).toBeGreaterThan(0);
  });

  it("ninguém importa o motion completo", () => {
    const comMotion = usamFramer
      .filter(({ fonte }) => {
        const importacoes = fonte.match(/import\s*\{[^}]*\}\s*from\s*["']framer-motion["']/g) || [];
        return importacoes.some((linha) => /[{,\s]motion[\s,}]/.test(linha));
      })
      .map(({ caminho }) => caminho);
    expect(comMotion).toEqual([]);
  });

  it("todo arquivo que usa m.* traz o LazyMotion", () => {
    const semLazy = usamFramer
      .filter(({ fonte }) => /<m\.[a-z]/.test(fonte) && !/<LazyMotion\b/.test(fonte))
      .map(({ caminho }) => caminho);
    expect(semLazy).toEqual([]);
  });
});
