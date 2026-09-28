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
    const { linhas, truncado, erro } = await buscarTodas(montar, { pagina: 100 });
    expect(linhas.length).toBe(100);
    // Meia lista sem aviso é exatamente o defeito que isto evita. Frente CE
    // (28/09): falha não é corte; o aviso "não coube" com 81 marcos no banco
    // vinha de uma página que falhou.
    expect(erro).toBe(true);
    expect(truncado).toBe(false);
  });

  it("com lancarErro, a falha vira exceção (o React Query tenta de novo e guarda o dado anterior)", async () => {
    const montar = () => Promise.resolve({ data: null, error: new Error("caiu") });
    await expect(buscarTodas(montar, { lancarErro: true })).rejects.toThrow("Não foi possível ler");
  });

  it("sem teto, lê até o fim, uma página de cada vez", async () => {
    const t = tabelaCom(12_345);
    const { linhas, truncado, erro } = await buscarTodas(t.montar);
    expect(linhas.length).toBe(12_345);
    expect(truncado).toBe(false);
    expect(erro).toBe(false);
    expect(t.chamadas()).toBe(13);
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

  it("as dez consultas passaram a paginar", () => {
    // Sete da Central original + tarefas concluidas da semana + versoes do dossie
    // + a lista de entregas sem janela, lida só para o Marco 90 (frente R).
    const paginadas = central.match(/buscarTodas<any>/g) || [];
    expect(paginadas.length).toBe(10);
  });

  it("falha de leitura aparece como falha (e o painel tenta de novo), nunca como corte", () => {
    // Frente CE (28/09): "Parte dos dados não coube nesta leitura (marcos)"
    // com 81 marcos no banco. Agora toda leitura paginada lança o erro e o
    // aviso lê o estado de erro de cada consulta.
    expect(central).toContain("const LER_TUDO = { lancarErro: true } as const;");
    expect(central).not.toContain("não coube nesta leitura");
    expect(central).toContain("Não foi possível ler agora:");
    expect(central).toContain("cortes.current");
    expect((central.match(/LER_TUDO,/g) || []).length).toBe(10);
  });
});
