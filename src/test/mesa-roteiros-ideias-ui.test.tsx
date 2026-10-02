import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ideias com o agente (02/10) na tela: o roteiro avulso abre com a conversa
 * de ideias, a rodada mostra as ideias com pergunta, gancho e fonte, "Usar
 * este tema" preenche o formulário (Desfazer volta), o cartão do agente pede
 * Confirmar e o Gerar roteiro leva o tema, o objetivo, o modelo e o pedido.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), tabelas: {} as Record<string, unknown> }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "overlaps", "gte", "lt", "lte", "gt", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: () => Promise.resolve({ data: {}, error: null }),
      from: (tabela: string) => consulta(tabela),
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://x.test/a.png" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({
    data: [{ id: "11111111-1111-1111-1111-111111111111", company_name: "Thainá Lima Rosa Advogada", plan_status: "active" }],
    isLoading: false,
    isSuccess: true,
    isFetching: false,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
  }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import MesaRoteiros from "@/pages/MesaRoteiros";
import { linhasDoPreenchimento, normalizarHistoricoDasIdeias } from "@/components/mesa-roteiros/IdeiasDeTema";

const CLIENTE = "11111111-1111-1111-1111-111111111111";

const IDEIA = (n: number, x: Record<string, unknown> = {}) => ({
  apelido: `i${n}`,
  tema: n === 2 ? "Inventário em cartório em 30 dias" : `Tema ${n}`,
  pergunta_do_cliente: n === 2 ? "Quanto tempo demora um inventário em cartório?" : `Pergunta ${n}?`,
  gancho: n === 2 ? "Inventário em 30 dias? Só se você fizer isso." : `Gancho ${n}`,
  angulo: "autoridade",
  objetivo: "autoridade",
  modelo_base_id: "casa-advogado-duvida-juridica",
  modelo_base_nome: "Advogado: dúvida jurídica em linguagem simples",
  tipo: "fala_camera",
  por_que_agora: "Mudou a regra do CNJ.",
  fonte: n === 2 ? { url: "https://cnj.jus.br/noticia", titulo: "CNJ", tipo: "web" } : null,
  promessa: "Saber se cabe no cartório.",
  esqueleto: ["Gancho", "Quando pode", "CTA"],
  ligacao_com_roteiros: null,
  notas: { responde: 0.9, gancho: 0.8, especifico: 0.7, total: 0.83, como: "jev" },
  ...x,
});

function montar(endereco: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [endereco] }, h(TooltipProvider, null, h(MesaRoteiros)))));
}

const chamadasDe = (acao: string) => mock.invoke.mock.calls.filter((c) => c[1] && c[1].body && c[1].body.acao === acao);

beforeEach(() => {
  mock.invoke.mockReset();
  window.localStorage.clear();
  mock.tabelas = {
    ia_modelos: [{ id: "openai:gpt-6-sol", provedor: "openai", modelo_api: "gpt-6-sol", tipo: "texto", rotulo: "GPT 6 Sol", preco_entrada_1m: 1, preco_saida_1m: 4, ativo: true, padrao_para: ["estrategista"] }],
    tasks: [],
    roteiros: [],
    roteiro_modelos: [],
    roteiro_biblioteca: [],
    mesa_cliente_escolhas: [],
  };
  mock.invoke.mockImplementation((_fn: string, { body }: any) => {
    if (body.acao === "agente_historico" || body.acao === "ideias_historico") return Promise.resolve({ data: { conversa_id: null, mensagens: [] }, error: null });
    if (body.acao === "ideias_conversar") {
      const escolhe = /usa a 2/i.test(String(body.mensagem || ""));
      return Promise.resolve({
        data: {
          conversa_id: "55555555-5555-4555-8555-555555555555",
          mensagem_id: escolhe ? "77777777-7777-4777-8777-777777777777" : "66666666-6666-4666-8666-666666666666",
          resposta: escolhe ? "Boa escolha. Confirme para eu preencher." : "Puxei pela dúvida mais comum dos herdeiros. Recomendo a 2.",
          ideias: escolhe ? [] : [IDEIA(2), IDEIA(1, { angulo: "conversao", objetivo: "venda", modelo_base_id: null, modelo_base_nome: null })],
          preencher: escolhe ? IDEIA(2) : null,
          fontes: [
            { fonte: "web", ok: true, texto: "Web: 3 fontes da busca de agora" },
            { fonte: "instagram", ok: false, texto: "Instagram: conecte o Instagram da agência." },
          ],
          ranking: "jev",
          custo_usd: 0.03,
        },
        error: null,
      });
    }
    if (body.acao === "gerar") return Promise.resolve({ data: { roteiro: null, versao: { numero: 1, conteudo: {} }, custo_usd: 0.02, aviso_banco: "sem banco" }, error: null });
    return Promise.resolve({ data: {}, error: null });
  });
});

describe("ideias com o agente no roteiro avulso", () => {
  it("pede ideias com a web e as hashtags, mostra pergunta, gancho e fonte, e as fontes que ficaram de fora", async () => {
    const tela = montar(`/mesa-roteiros?client=${CLIENTE}&etapa=roteiro&avulso=1`);
    const bloco = await waitFor(() => {
      const b = tela.container.querySelector("[data-ideias-de-tema]");
      if (!b) throw new Error("sem ideias");
      return b as HTMLElement;
    }, { timeout: 10000 });
    await waitFor(() => expect(chamadasDe("ideias_historico")).toHaveLength(1));
    fireEvent.change(within(bloco).getByRole("textbox", { name: "Hashtags para olhar no Instagram" }), { target: { value: "#inventario, partilha" } });
    fireEvent.click(within(bloco).getByRole("button", { name: "Me dá ideias" }));
    await waitFor(() => expect(chamadasDe("ideias_conversar")).toHaveLength(1));
    expect(chamadasDe("ideias_conversar")[0][1].body).toMatchObject({ client_id: CLIENTE, web: true, hashtags: ["inventario", "partilha"] });
    const lista = await within(bloco).findByRole("list", { name: "Ideias de tema" });
    expect(within(lista).getByText("Inventário em cartório em 30 dias")).toBeTruthy();
    expect(within(lista).getByText(/"Quanto tempo demora um inventário em cartório\?"/)).toBeTruthy();
    expect(within(lista).getByText("Mais forte")).toBeTruthy();
    expect((within(lista).getByRole("link", { name: /CNJ/ }) as HTMLAnchorElement).href).toBe("https://cnj.jus.br/noticia");
    const fontes = tela.container.querySelector("[data-fontes-das-ideias]") as HTMLElement;
    expect(fontes.querySelector('[data-fonte="web"]')!.getAttribute("data-ok")).toBe("sim");
    expect(fontes.querySelector('[data-fonte="instagram"]')!.getAttribute("data-ok")).toBe("nao");
  }, 20000);

  it("Usar este tema preenche o formulário e o Gerar roteiro leva tema, objetivo, modelo e pedido", async () => {
    const tela = montar(`/mesa-roteiros?client=${CLIENTE}&etapa=roteiro&avulso=1`);
    const bloco = await waitFor(() => {
      const b = tela.container.querySelector("[data-ideias-de-tema]");
      if (!b) throw new Error("sem ideias");
      return b as HTMLElement;
    }, { timeout: 10000 });
    const tema = (await screen.findByPlaceholderText(/período de graça/)) as HTMLInputElement;
    fireEvent.change(tema, { target: { value: "Tema que eu tinha" } });
    fireEvent.click(within(bloco).getByRole("button", { name: "Pedir ideias ao agente" }));
    await within(bloco).findByRole("list", { name: "Ideias de tema" });
    fireEvent.click(within(bloco).getByRole("button", { name: "Usar o tema 2" }));
    await waitFor(() => expect(tema.value).toBe("Inventário em cartório em 30 dias"));
    const pedido = screen.getByPlaceholderText(/advogada grava sentada/) as HTMLTextAreaElement;
    expect(pedido.value).toContain("Pergunta do cliente que o vídeo responde: Quanto tempo demora um inventário em cartório?");
    expect(pedido.value).toContain("Gancho combinado");
    expect((screen.getByRole("combobox", { name: "Modelo da base" }) as HTMLSelectElement).value).toBe("casa-advogado-duvida-juridica");
    expect(screen.getByRole("radio", { name: "Autoridade" }).getAttribute("aria-checked")).toBe("true");
    expect(within(bloco).getByRole("button", { name: "Usar o tema 2" }).textContent).toContain("No formulário");

    fireEvent.click(await screen.findByRole("button", { name: /Gerar roteiro/ }));
    await waitFor(() => expect(chamadasDe("gerar")).toHaveLength(1));
    expect(chamadasDe("gerar")[0][1].body).toMatchObject({ tema: "Inventário em cartório em 30 dias", objetivo_base: "autoridade", modelo_base_id: "casa-advogado-duvida-juridica", tipo: "fala_camera" });
    expect(String(chamadasDe("gerar")[0][1].body.pedido)).toContain("Gancho combinado");
  }, 20000);

  it("o agente propõe preencher (usa a 2): nada muda antes do Confirmar, e o Desfazer do cartão volta", async () => {
    const tela = montar(`/mesa-roteiros?client=${CLIENTE}&etapa=roteiro&avulso=1`);
    const bloco = await waitFor(() => {
      const b = tela.container.querySelector("[data-ideias-de-tema]");
      if (!b) throw new Error("sem ideias");
      return b as HTMLElement;
    }, { timeout: 10000 });
    const tema = (await screen.findByPlaceholderText(/período de graça/)) as HTMLInputElement;
    fireEvent.change(tema, { target: { value: "Antes" } });
    fireEvent.click(within(bloco).getByRole("button", { name: "Me dá ideias" }));
    await within(bloco).findByRole("list", { name: "Ideias de tema" });
    fireEvent.change(within(bloco).getByRole("textbox", { name: "Mensagem ao agente de ideias" }), { target: { value: "Usa a 2" } });
    fireEvent.click(within(bloco).getByRole("button", { name: "Pedir ideias ao agente" }));
    const cartao = await waitFor(() => {
      const c = tela.container.querySelector('[data-cartao-preencher="i2"]');
      if (!c) throw new Error("sem cartão");
      return c as HTMLElement;
    });
    expect(tema.value).toBe("Antes");
    expect(within(cartao).getByText(/Tema: Inventário em cartório em 30 dias/)).toBeTruthy();
    fireEvent.click(within(cartao).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(tema.value).toBe("Inventário em cartório em 30 dias"));
    fireEvent.click(within(cartao).getByRole("button", { name: /Desfazer/ }));
    await waitFor(() => expect(tema.value).toBe("Antes"));
  }, 20000);

  it("a agenda tem o atalho Ideias de tema, que abre o roteiro avulso com as ideias", async () => {
    const tela = montar(`/mesa-roteiros?client=${CLIENTE}&etapa=agenda`);
    fireEvent.click(await screen.findByRole("button", { name: "Ideias de tema com o agente" }, { timeout: 10000 }));
    await waitFor(() => expect(tela.container.querySelector("[data-ideias-de-tema]")).toBeTruthy());
  }, 20000);
});

describe("histórico e cartão", () => {
  it("o histórico traz as ideias, as fontes e a ideia proposta do anexo", () => {
    const h1 = normalizarHistoricoDasIdeias({
      conversa_id: "c",
      mensagens: [
        { id: "a", papel: "usuario", conteudo: "ideias", anexos: [] },
        { id: "b", papel: "agente", conteudo: "aqui", anexos: [{ tipo: "ideias_de_tema", ideias: [IDEIA(1)], fontes: [{ fonte: "web", ok: false, texto: "Web: desligada" }], preencher: "i1", ranking: "regra" }] },
      ],
    });
    expect(h1.conversaId).toBe("c");
    expect(h1.mensagens[1].ideias).toHaveLength(1);
    expect(h1.mensagens[1].preencher).toBe("i1");
    expect(h1.mensagens[1].ranking).toBe("regra");
    expect(h1.mensagens[1].fontes[0].texto).toBe("Web: desligada");
  });

  it("o cartão diz o que muda no formulário", () => {
    const l = linhasDoPreenchimento({ tema: "T", objetivo: "auto", modeloBase: "auto", tipo: "tutorial", duracao_s: 45, pedido: "p" }, null);
    expect(l).toEqual(["Tema: T", "Objetivo: Automático", "Modelo da base: Automático", "Tipo: Tutorial, 45s", "Pedido da equipe: pergunta, gancho, esqueleto e porquê"]);
  });
});
