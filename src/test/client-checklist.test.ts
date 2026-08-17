import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checklistProgress, type Checklist } from "@/lib/clientChecklist";

/**
 * O checklist rápido cobre o combinado do momento, aquilo que aparece numa
 * conversa e some se ninguém anotar. Ele nasce dentro da história do cliente,
 * então o que foi cumprido vira contexto para as mensagens seguintes.
 */

const lista = (itens: Array<{ text: string; done: boolean }>): Checklist => ({
  id: "c1",
  title: "Depoimento na loja",
  created_at: "2026-08-17T12:00:00.000Z",
  items: itens.map((item, index) => ({ id: `i${index}`, ...item })),
});

describe("progresso do checklist", () => {
  it("conta o que já foi feito", () => {
    const progresso = checklistProgress(
      lista([
        { text: "Combinar horário com o cliente", done: true },
        { text: "Levar tripé e microfone", done: true },
        { text: "Gravar 3 perguntas", done: false },
      ]),
    );
    expect(progresso).toEqual({ done: 2, total: 3 });
  });

  it("reconhece a lista inteira concluída", () => {
    const cheia = lista([
      { text: "a", done: true },
      { text: "b", done: true },
    ]);
    const { done, total } = checklistProgress(cheia);
    expect(done).toBe(total);
  });

  it("lista nova começa zerada", () => {
    expect(checklistProgress(lista([{ text: "a", done: false }]))).toEqual({
      done: 0,
      total: 1,
    });
  });
});

describe("motor que monta a lista", () => {
  const motor = readFileSync(
    resolve(process.cwd(), "supabase/functions/client-checklist/index.ts"),
    "utf8",
  );

  it("limita o tamanho: lista longa não é lista, é relatório", () => {
    expect(motor).toContain("Entre 3 e 6 itens");
    expect(motor).toContain(".slice(0, 6)");
  });

  it("exige ação concreta, não intenção vaga", () => {
    expect(motor).toMatch(/Comece com o verbo no infinitivo/i);
    expect(motor).toMatch(/Não crie item genérico/i);
  });

  it("usa o contexto do cliente para não sair genérico", () => {
    expect(motor).toContain("CONTEXTO DELE AGORA");
    // Mas sem inventar: a regra de ouro do painel vale aqui também.
    expect(motor).toMatch(/nunca invente fato que não foi dado/i);
  });

  it("tem reserva sem IA, para o pedido nunca se perder", () => {
    expect(motor).toContain("function fallbackItems");
    expect(motor).toContain('source: "fallback"');
  });
});

describe("checklist na história do cliente", () => {
  const lib = readFileSync(resolve(process.cwd(), "src/lib/clientChecklist.ts"), "utf8");

  it("mora na memória do cliente, não numa tabela solta", () => {
    expect(lib).toContain('.from("project_memory")');
    expect(lib).toContain('kind: "checklist"');
  });

  it("reescreve o corpo ao marcar, para o histórico não mentir", () => {
    // Sem isso, a IA leria "nada foi feito" mesmo com tudo concluído.
    expect(lib).toContain("content: corpoDe(items");
    expect(lib).toContain("Progresso:");
  });

  it("é interno: checklist não aparece no portal do cliente", () => {
    expect(lib).toContain("client_visible: false");
  });
});
