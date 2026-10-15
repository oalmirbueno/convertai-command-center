import { describe, expect, it } from "vitest";
import { clienteDaPergunta, clientesDaPergunta, type ItemDaResposta } from "../../supabase/functions/gestor-aceleriq/modulos/ficha";
import { aplicarConferencia, perguntasDePerigo, semConectivoSolto } from "../../supabase/functions/gestor-aceleriq/modulos/conferencia";
import { somarConsumo } from "../../supabase/functions/gestor-aceleriq/modulos/consumo";
import { linhaDoGestor } from "../../supabase/functions/gestor-aceleriq/modulos/historico";

/**
 * 15/10/2026, queixa do dono: "como que esta a base da acerbi e da mirante
 * luz?" virou um balão só, começando com "Mas", e sem a Mirante. E o gasto por
 * conversa (valor e tokens) não aparecia.
 */

const CLIENTES = [
  { id: "c-acerbi", nome: "Acerbi" },
  { id: "c-acerbi", nome: "Acerbi", marca: "CME", apelidos: ["CME"], projetoId: "p-cme" },
  { id: "c-mirante", nome: "Mirante Luz Floripa" },
  { id: "c-verzelo-1", nome: "Verzelo Jardins" },
  { id: "c-verzelo-2", nome: "Verzelo Paisagismo" },
];

describe("vários clientes na mesma pergunta", () => {
  it("Acerbi e Mirante Luz viram os dois clientes (a Mirante citada só pelo começo do nome)", () => {
    expect(clientesDaPergunta("como que esta a base da acerbi e da mirante luz?", CLIENTES).map((c) => c.id)).toEqual(["c-acerbi", "c-mirante"]);
  });
  it("um nome só não é vários", () => {
    expect(clientesDaPergunta("como está a Acerbi?", CLIENTES)).toEqual([]);
  });
  it("marca do mesmo cliente conta como um só", () => {
    expect(clientesDaPergunta("e a Acerbi e o CME?", CLIENTES)).toEqual([]);
  });
  it("trecho que serve a dois clientes diferentes devolve [] (vale o 'Qual deles?')", () => {
    expect(clientesDaPergunta("e a Verzelo e a Acerbi?", CLIENTES)).toEqual([]);
  });
  it("o cliente único segue igual", () => {
    expect(clienteDaPergunta("como está a Acerbi?", CLIENTES)).toMatchObject({ tipo: "um", cliente: { id: "c-acerbi" } });
    expect(clienteDaPergunta("e a Verzelo?", CLIENTES).tipo).toBe("ambiguo");
  });
});

describe("costura: balão não começa com conectivo solto", () => {
  it("tira o 'Mas' que sobrou do corte", () => {
    expect(semConectivoSolto("Mas a base ainda precisa de saneamento.")).toBe("A base ainda precisa de saneamento.");
    expect(semConectivoSolto("Também falta o briefing.")).toBe("Falta o briefing.");
  });
  it("não mexe em palavra que só começa igual", () => {
    expect(semConectivoSolto("E-mail enviado ao cliente.")).toBe("E-mail enviado ao cliente.");
    expect(semConectivoSolto("Essa marca está em dia.")).toBe("Essa marca está em dia.");
    expect(semConectivoSolto("Então")).toBe("Então");
  });
});

describe("conferência: 'não diz' em leitura de texto vira 'a conferir'", () => {
  const item = (texto: string, fontes = ["L1"]): ItemDaResposta => ({ secao: "conversa", texto, fontes });
  const podeMarcar = (i: ItemDaResposta) => i.fontes.every((a) => a.startsWith("L"));

  it("frase de leitura, sem número e que não afirma conclusão: fica marcada", () => {
    const r = aplicarConferencia([item("O contexto mistura o público das duas marcas.")], { a0: { choice: "nao_diz" }, p0: { noul: 0.1 } }, { podeMarcar });
    expect(r.ficam).toEqual([{ ...item("O contexto mistura o público das duas marcas."), conferido: "a_conferir" }]);
    expect(r.marcados).toBe(1);
  });
  it("com número sai", () => {
    expect(aplicarConferencia([item("Faltam 3 campos no briefing.")], { a0: { choice: "nao_diz" }, p0: { noul: 0.1 } }, { podeMarcar }).sairam).toHaveLength(1);
  });
  it("afirmando conclusão (Noul alto) sai", () => {
    expect(aplicarConferencia([item("O briefing já foi respondido.")], { a0: { choice: "nao_diz" }, p0: { noul: 0.9 } }, { podeMarcar }).sairam).toHaveLength(1);
  });
  it("sem a resposta do Noul vale o corte de antes", () => {
    expect(aplicarConferencia([item("O contexto mistura as marcas.")], { a0: { choice: "nao_diz" } }, { podeMarcar }).sairam).toHaveLength(1);
  });
  it("fonte F (estado do OS) continua com corte duro", () => {
    expect(aplicarConferencia([item("A tarefa está atrasada.", ["F1"])], { a0: { choice: "nao_diz" }, p0: { noul: 0.1 } }, { podeMarcar }).sairam).toHaveLength(1);
  });
  it("'contradiz' sempre sai", () => {
    expect(aplicarConferencia([item("O briefing está completo.")], { a0: { choice: "contradiz" }, p0: { noul: 0.1 } }, { podeMarcar }).sairam).toHaveLength(1);
  });
  it("sem opções, igual a antes", () => {
    expect(aplicarConferencia([item("O contexto mistura as marcas.")], { a0: { choice: "nao_diz" }, p0: { noul: 0.1 } }).sairam).toHaveLength(1);
  });
  it("perguntas de perigo são Noul, uma por afirmação elegível", () => {
    const q = perguntasDePerigo([0, 2]);
    expect(Object.keys(q)).toEqual(["p0", "p2"]);
    expect(q.p0.type).toBe("noul");
  });
});

describe("gasto da conversa", () => {
  const usos = [
    { id: "u1", agente: "estrategista", modelo_id: "openrouter:openai/gpt-6.1-sol", tokens_entrada: 11483, tokens_saida: 269, tokens_cache: 0, custo_usd: "0.031396" },
    { id: "u2", agente: "estrategista", modelo_id: "openrouter:openai/gpt-6.1-sol", tokens_entrada: 11887, tokens_saida: 440, tokens_cache: 2556, custo_usd: 0.034372 },
    { id: "u3", agente: "jev", modelo_id: "typesafe:jev-latest", tokens_entrada: 2400, tokens_saida: 0, tokens_cache: 0, custo_usd: 0.0001 },
    { id: "u4", agente: "jev", modelo_id: "typesafe:jev-latest", tokens_entrada: 2364, tokens_saida: 0, tokens_cache: 0, custo_usd: 0.000093 },
  ];
  it("soma modelo e conferência, com tokens de entrada e saída do modelo", () => {
    const c = somarConsumo(usos, [{ uso_id: "u2", custo_usd: 0.065768 }], { "openrouter:openai/gpt-6.1-sol": "GPT-6.1 Sol" });
    expect(c.modelos).toEqual([{ id: "openrouter:openai/gpt-6.1-sol", rotulo: "GPT-6.1 Sol", chamadas: 2, entrada: 23370, saida: 709, cache: 2556, usd: 0.065768 }]);
    expect(c.tokens).toBe(24079);
    expect(c.conferencia).toEqual({ chamadas: 2, tokens: 4764, usd: 0.000193 });
    expect(c.antes_usd).toBe(0);
    expect(c.total_usd).toBe(0.065961);
  });
  it("resposta de antes da marca entra só pelo custo do modelo, sem contar duas vezes", () => {
    const c = somarConsumo(usos, [{ uso_id: "u2", custo_usd: 0.065768 }, { uso_id: "antigo", custo_usd: 0.35 }, { uso_id: null, custo_usd: "0.01" }]);
    expect(c.antes_usd).toBe(0.36);
    expect(c.total_usd).toBe(0.425961);
  });
  it("conversa sem uso nenhum dá zero, não erro", () => {
    expect(somarConsumo([], [])).toEqual({ total_usd: 0, tokens: 0, modelos: [], conferencia: { chamadas: 0, tokens: 0, usd: 0 }, antes_usd: 0 });
  });
});

describe("histórico com vários clientes", () => {
  it("o recorte de vários clientes vai para o histórico do modelo", () => {
    expect(linhaDoGestor({ conteudo: "Oi", dados: { clientes: [{ nome: "Acerbi" }, { nome: "Mirante Luz Floripa" }] } })).toContain("[Recorte: Acerbi e Mirante Luz Floripa]");
  });
});
