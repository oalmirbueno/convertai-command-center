import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Concluir/reabrir a entrega de um avulso grava a bandeira no cadastro e um
 * marco na história. O marco era gravado (ou apagado) sem conferir o erro: a
 * tela dizia "Projeto concluído" e a Central nunca via o marco. E a leitura
 * das etapas devolvia vazio em erro, que o useQuery guardava como "nenhuma
 * etapa feita".
 */

type Resposta = { data: unknown; error: { message: string } | null };
const respostas: Record<string, Resposta> = {};

function consulta(tabela: string) {
  let operacao = "select";
  const alvo: Record<string, unknown> = {};
  const encadeia: Record<string, unknown> = new Proxy(alvo, {
    get(_, metodo: string) {
      if (metodo === "then") {
        const resposta = respostas[`${tabela}:${operacao}`] || { data: [], error: null };
        return (resolver: (valor: Resposta) => unknown) => resolver(resposta);
      }
      return () => {
        if (["insert", "update", "delete"].includes(metodo)) operacao = metodo;
        return encadeia;
      };
    },
  });
  return encadeia;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => consulta(tabela),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }) },
  },
}));

import { concluirEntrega, listEtapasFeitas } from "@/lib/entregaAvulsa";

afterEach(() => {
  for (const chave of Object.keys(respostas)) delete respostas[chave];
});

const falha = { data: null, error: { message: "permission denied" } };

describe("concluir a entrega avulsa confere cada gravação", () => {
  it("o marco 'Projeto concluído' não gravou: devolve false", async () => {
    respostas["project_memory:insert"] = falha;
    const ok = await concluirEntrega({
      clientId: "client-1",
      servicesConfig: {},
      resumo: "Entrega de site concluída.",
      concluir: true,
    });
    expect(ok).toBe(false);
  });

  it("reabrir não apagou o marco: devolve false", async () => {
    respostas["project_memory:delete"] = falha;
    const ok = await concluirEntrega({
      clientId: "client-1",
      servicesConfig: { one_off_done: true },
      resumo: "",
      concluir: false,
    });
    expect(ok).toBe(false);
  });

  it("tudo gravado: devolve true nos dois sentidos", async () => {
    for (const concluir of [true, false]) {
      const ok = await concluirEntrega({
        clientId: "client-1",
        servicesConfig: {},
        resumo: "Entrega de site concluída.",
        concluir,
      });
      expect(ok).toBe(true);
    }
  });
});

describe("ler as etapas feitas", () => {
  it("erro de leitura sobe para o useQuery em vez de virar 'nenhuma etapa'", async () => {
    respostas["project_memory:select"] = falha;
    await expect(listEtapasFeitas("client-1", "site")).rejects.toMatchObject({
      message: "permission denied",
    });
  });

  it("leitura boa devolve só as etapas feitas", async () => {
    respostas["project_memory:select"] = {
      data: [
        { metadata: { step: 1, done: true } },
        { metadata: { step: 2, done: false } },
        { metadata: null },
      ],
      error: null,
    };
    const feitas = await listEtapasFeitas("client-1", "site");
    expect([...feitas]).toEqual([1]);
  });
});
