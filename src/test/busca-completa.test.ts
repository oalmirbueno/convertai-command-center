import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buscarTodas } from "@/lib/buscaCompleta";

const central = readFileSync(
  resolve(__dirname, "../..", "src/pages/AdminExperience.tsx"),
  "utf8",
);

/**
 * As consultas da Central pegavam as N linhas mais recentes de TODOS os
 * clientes e filtravam depois. Dois tetos, os dois silenciosos: o escrito no
 * código (.limit(400)) e o que ninguém escreveu — consulta sem limite é
 * cortada pelo max-rows do PostgREST, e `files` já tem 909 linhas.
 */

/** Uma tabela falsa com `total` linhas, que responde por intervalo. */
const tabelaCom = (total: number) => {
  let chamadas = 0;
  const montar = (de: number, ate: number) => {
    chamadas += 1;
    const linhas = [];
    for (let i = de; i <= ate && i < total; i += 1) linhas.push({ i });
    return Promise.resolve({ data: linhas, error: null });
  };
  return { montar, chamadas: () => chamadas };
};

describe("buscar até acabar", () => {
  it("traz tudo quando passa de uma página", async () => {
    const t = tabelaCom(2500);
    const { linhas, truncado } = await buscarTodas(t.montar, { pagina: 1000 });
    expect(linhas.length).toBe(2500);
    expect(truncado).toBe(false);
  });

  it("para na primeira página quando a tabela é pequena", async () => {
    const t = tabelaCom(169); // o tamanho real de project_memory hoje
    const { linhas, truncado } = await buscarTodas(t.montar, { pagina: 1000 });
    expect(linhas.length).toBe(169);
    expect(truncado).toBe(false);
    expect(t.chamadas()).toBe(1);
  });

  it("página exatamente cheia não engana: busca a seguinte", async () => {
    // O caso que quebra implementações ingênuas — 1000 linhas exatas parecem
    // "acabou" e não são.
    const t = tabelaCom(1000);
    const { linhas, truncado } = await buscarTodas(t.montar, { pagina: 1000 });
    expect(linhas.length).toBe(1000);
    expect(truncado).toBe(false);
    expect(t.chamadas()).toBe(2);
  });

  it("tabela em fuga para no teto e AVISA", async () => {
    const t = tabelaCom(999999);
    const { linhas, truncado } = await buscarTodas(t.montar, { pagina: 500, teto: 1500 });
    expect(linhas.length).toBe(1500);
    // O aviso é o ponto: sem ele, a tela mostraria 1500 linhas como se
    // fossem tudo.
    expect(truncado).toBe(true);
  });

  it("erro no meio devolve o que veio, marcado como incompleto", async () => {
    let n = 0;
    const montar = (de: number, ate: number) => {
      n += 1;
      if (n > 1) return Promise.resolve({ data: null, error: new Error("caiu") });
      const linhas = [];
      for (let i = de; i <= ate; i += 1) linhas.push({ i });
      return Promise.resolve({ data: linhas, error: null });
    };
    const { linhas, truncado } = await buscarTodas(montar, { pagina: 100 });
    expect(linhas.length).toBe(100);
    // Meia lista sem aviso é exatamente o defeito que isto evita.
    expect(truncado).toBe(true);
  });

  it("tabela vazia não é considerada corte", async () => {
    const { linhas, truncado } = await buscarTodas(tabelaCom(0).montar, { pagina: 100 });
    expect(linhas).toEqual([]);
    expect(truncado).toBe(false);
  });
});

describe("a Central não tem mais teto escondido", () => {
  it("nenhuma consulta usa mais limite fixo", () => {
    // Eram .limit(400) na memória, .limit(300) nas pautas, .limit(150) nos
    // relatórios.
    expect(central).not.toContain(".limit(400)");
    expect(central).not.toContain(".limit(300)");
    expect(central).not.toContain(".limit(150)");
  });

  it("as sete consultas passaram a paginar", () => {
    const paginadas = central.match(/buscarTodas<any>/g) || [];
    expect(paginadas.length).toBe(7);
  });

  it("o corte, se houver, aparece na tela", () => {
    expect(central).toContain("cortes.current");
    expect(central).toContain("não coube nesta leitura");
  });
});
