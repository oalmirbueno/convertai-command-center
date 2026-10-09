import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blocoDasRegras, pedeCarteira } from "../../supabase/functions/gestor-aceleriq/modulos/carteira";

/**
 * Conversa real de 09/10: "me atualize todos os clientes" ficou presa na Casa dos Assados,
 * o Gestor pediu para "mudar o recorte" e as correções do dono se perdiam.
 */

const nucleo = readFileSync(resolve(__dirname, "../../supabase/functions/gestor-aceleriq/modulos/nucleo.ts"), "utf8");

describe("pedido da carteira toda", () => {
  it("reconhece os jeitos de pedir todos", () => {
    for (const p of ["quais as pendências atuais de todos os ativos?", "me dá uma visão geral", "e os demais clientes?", "resumo geral da operação", "como está a carteira", "e os outros clientes?"]) {
      expect(pedeCarteira(p), p).toBe(true);
    }
  });

  it("pergunta de um cliente só não vira carteira", () => {
    for (const p of ["e a Acerbi?", "qual depende de mim?", "pode aprovar essa", "abre o que você fez"]) {
      expect(pedeCarteira(p), p).toBe(false);
    }
  });

  it("sai do cliente anterior sem Jev de continuidade e lê o painel K", () => {
    expect(nucleo).toContain("const daCarteira = !escolhido && pedeCarteira(e.pergunta);");
    expect(nucleo).toContain("else if (daCarteira) cliente = null;");
    expect(nucleo).toContain("cliente ? Promise.resolve([] as Fonte[]) : lerCarteira(servico(), periodo)");
    expect(nucleo).toContain('if (a.choice === "mesmo") return p >= 0.7 ? anterior : null;');
  });

  it("não pede permissão para consultar nem manda escolher cliente", () => {
    expect(nucleo).not.toContain("na conversa geral sem cliente claro, pergunte qual");
    expect(nucleo).toContain("Nunca peça permissão para consultar");
  });
});

describe("o que o dono ensina vale para sempre", () => {
  it("as regras entram no pedido ao modelo, numeradas", () => {
    const b = blocoDasRegras([{ id: "1", texto: "Ajenda não é mais cliente.", criado_em: "" }, { id: "2", texto: "Não peça confirmação para leitura.", criado_em: "" }]);
    expect(b).toContain("REGRAS QUE O ALMIR JÁ TE ENSINOU");
    expect(b).toContain("1. Ajenda não é mais cliente.");
    expect(b).toContain("2. Não peça confirmação para leitura.");
    expect(blocoDasRegras([])).toBe("");
  });

  it("a resposta devolve a regra aprendida e ela é guardada", () => {
    expect(nucleo).toContain('"consultas", "regra_aprendida"]');
    expect(nucleo).toContain("guardarRegraDoDono(servico(), e.userId, red.bruto.regra_aprendida, e.pergunta)");
  });

  it("a conferência continua, mas não polui o chat", () => {
    expect(nucleo).not.toContain("na conferência com as fontes.`");
    expect(nucleo).not.toContain("com conferência fraca");
    expect(nucleo).toContain("aplicarConferencia(paraOJev");
  });
});
