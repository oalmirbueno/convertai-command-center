import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Checklist solto do cliente (ficha do ciclo).
 *
 * 1. Dois cliques seguidos: os dois toques partiam da mesma lista antiga e o segundo update gravava a lista sem
 *    o primeiro item marcado (o primeiro clique se perdia). Agora os toques da mesma lista entram numa fila.
 * 2. Divisão local do pedido: "aceleriq.com.br", e-mails e "Dr. Paulo" eram quebrados no ponto.
 */

type Gravacao = { id: string; metadata: { items: Array<{ id: string; done: boolean }>; completed: boolean } };

const estado = vi.hoisted(() => ({
  gravacoes: [] as Gravacao[],
  esperas: [] as Array<() => void>,
  erroNa: -1,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (valor: { metadata: Gravacao["metadata"] }) => ({
        eq: (_coluna: string, id: string) => {
          const ordem = estado.gravacoes.length;
          estado.gravacoes.push({ id, metadata: valor.metadata });
          // Cada update só responde quando o teste solta: simula a rede lenta entre dois cliques.
          return new Promise<{ error: unknown }>((ok) => {
            estado.esperas.push(() => ok({ error: ordem === estado.erroNa ? { message: "falhou" } : null }));
          });
        },
      }),
    }),
  },
}));

import { splitRequestIntoItems, toggleChecklistItem, type Checklist } from "@/lib/clientChecklist";

const LISTA: Checklist = {
  id: "lista-1",
  title: "Depoimento na loja",
  created_at: "2026-10-30T12:00:00Z",
  items: [
    { id: "i0", text: "Combinar horário", done: false },
    { id: "i1", text: "Levar tripé", done: false },
    { id: "i2", text: "Gravar 3 perguntas", done: false },
  ],
};

const marcados = (g: Gravacao) => g.metadata.items.filter((i) => i.done).map((i) => i.id);

async function soltarTudo() {
  // Solta os updates um a um, deixando o próximo toque da fila começar.
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    const proxima = estado.esperas.shift();
    if (proxima) proxima();
  }
}

beforeEach(() => {
  estado.gravacoes = [];
  estado.esperas = [];
  estado.erroNa = -1;
});

describe("dois cliques seguidos no checklist", () => {
  it("o segundo toque não desmarca o primeiro (os dois partem da mesma lista da tela)", async () => {
    const primeiro = toggleChecklistItem(LISTA, "i0");
    const segundo = toggleChecklistItem(LISTA, "i1");
    await soltarTudo();
    const [r1, r2] = await Promise.all([primeiro, segundo]);
    expect(estado.gravacoes).toHaveLength(2);
    expect(marcados(estado.gravacoes[1])).toEqual(["i0", "i1"]);
    expect(r1 && r1.items.filter((i) => i.done).map((i) => i.id)).toEqual(["i0"]);
    expect(r2 && r2.items.filter((i) => i.done).map((i) => i.id)).toEqual(["i0", "i1"]);
  });

  it("toque que falhou não entra na base do próximo", async () => {
    estado.erroNa = 0;
    const primeiro = toggleChecklistItem(LISTA, "i0");
    const segundo = toggleChecklistItem(LISTA, "i1");
    await soltarTudo();
    expect(await primeiro).toBeNull();
    expect(marcados(estado.gravacoes[1])).toEqual(["i1"]);
    expect(await segundo).not.toBeNull();
  });

  it("fila vazia: vale a lista que a tela mandou", async () => {
    const r = toggleChecklistItem({ ...LISTA, items: LISTA.items.map((i) => ({ ...i, done: i.id === "i2" })) }, "i0");
    await soltarTudo();
    await r;
    expect(marcados(estado.gravacoes[0])).toEqual(["i0", "i2"]);
  });
});

describe("divisão local do pedido não quebra domínio, e-mail nem abreviação", () => {
  it("domínio e e-mail ficam inteiros", () => {
    expect(splitRequestIntoItems("Atualizar o link para aceleriq.com.br no perfil")).toEqual([
      "Atualizar o link para aceleriq.com.br no perfil",
    ]);
    expect(splitRequestIntoItems("Mandar o relatório para ana@loja.com.br hoje")).toEqual([
      "Mandar o relatório para ana@loja.com.br hoje",
    ]);
  });

  it("Dr., Dra., Sr. e Sra. não viram item separado", () => {
    expect(splitRequestIntoItems("Gravar o depoimento com o Dr. Paulo na clínica")).toEqual([
      "Gravar o depoimento com o Dr. Paulo na clínica",
    ]);
    expect(splitRequestIntoItems("Ligar para a Dra. Ana\nPedir a foto da Sra. Lúcia")).toEqual([
      "Ligar para a Dra. Ana",
      "Pedir a foto da Sra. Lúcia",
    ]);
  });

  it("ponto seguido de espaço e vírgula continuam separando", () => {
    expect(splitRequestIntoItems("Gravar o depoimento. Refazer a arte, pedir as fotos")).toEqual([
      "Gravar o depoimento",
      "Refazer a arte",
      "Pedir as fotos",
    ]);
  });
});
