import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente ROT (30/09): a biblioteca "Roteiros validados" na tela da Mesa
 * Roteiros. Banco e função simulados (o mesmo molde de mesa-roteiros-ui).
 * Confere a escolha por objetivo e por modelo na etapa Modelos, o "Usar"
 * que abre o roteiro novo com o modelo, o pedido de geração com
 * objetivo_base e modelo_base_id, a linha "Base:" no editor e o modelo
 * próprio (Preencher com IA e salvar).
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  tabelas: {} as Record<string, unknown>,
}));

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
      rpc: mock.rpc,
      from: (tabela: string) => consulta(tabela),
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://x.test/a.png" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const TAREFA = "22222222-2222-4222-8222-222222222222";
const ROTEIRO = "44444444-4444-4444-8444-444444444444";
const PROPRIO = "77777777-7777-4777-8777-777777777777";

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

function hojeMais(dias: number) {
  const d = new Date(Date.now() + dias * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const CONTEUDO = {
  titulo: "Aposentadoria",
  tipo: "fala_camera",
  ganchos: [{ texto: "Ela perdeu tudo aos dezenove.", mecanismo: "contraste", promessa: "", motivo: "" }],
  gancho_escolhido: 0,
  blocos: [
    { id: "b1", funcao: "Gancho", fala: "Ela perdeu tudo aos dezenove.", segundos: 4, visual: "Sentada" },
    { id: "b2", funcao: "Erro", fala: "E recomeçou do zero.", segundos: 4, visual: "Detalhe" },
  ],
  direcao: { enquadramento: "Peito para cima" },
  base: { id: "rv-queda-e-reconstrucao", nome: "Da pia ao topo (queda e reconstrução)", objetivo: "autoridade", origem: "roteiros_magicos", como: "jev", confianca: 0.6, alternativas: [{ id: "rv-tudo-em-jogo", nome: "Tudo em jogo (a última tentativa)" }] },
};

function montar(endereco: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [endereco] }, h(TooltipProvider, null, h(MesaRoteiros)))));
}

const chamadasDe = (acao: string) => mock.invoke.mock.calls.filter((c) => c[1] && c[1].body && c[1].body.acao === acao);

beforeEach(() => {
  mock.invoke.mockReset();
  mock.rpc.mockReset();
  mock.rpc.mockResolvedValue({ data: {}, error: null });
  window.localStorage.clear();
  mock.tabelas = {
    ia_modelos: [{ id: "openai:gpt-6-sol", provedor: "openai", modelo_api: "gpt-6-sol", tipo: "texto", rotulo: "GPT 6 Sol", preco_entrada_1m: 1, preco_saida_1m: 4, ativo: true, padrao_para: ["estrategista"] }],
    tasks: [{ id: TAREFA, title: "Reels aposentadoria", description: null, due_date: hojeMais(2), delivery_type: "reel", status: "todo" }],
    calendario_propostas: [],
    roteiros: [],
    roteiro_modelos: [],
    roteiro_biblioteca: [
      { id: PROPRIO, escopo: "agencia", client_id: null, nome: "Advogado responde em 40s", objetivo: "autoridade", ficha: { quando_usar: "Dúvida jurídica rápida", blocos: [{ funcao: "Pergunta", faz: "a dúvida" }, { funcao: "Resposta", faz: "a regra" }] }, criado_em: "2026-09-30T10:00:00Z" },
    ],
    mesa_cliente_escolhas: [],
  };
  mock.invoke.mockImplementation((_fn: string, { body }: any) => {
    if (body.acao === "gerar") return Promise.resolve({ data: { roteiro: null, versao: { numero: 1, conteudo: CONTEUDO }, aviso_banco: "sem banco", custo_usd: 0.02 }, error: null });
    if (body.acao === "biblioteca_extrair") {
      return Promise.resolve({ data: { ficha: { id: "novo", nome: "Direto do escritório", origem: "proprio", referencia: "", objetivo: "autoridade", tambem: [], quando_usar: "Dúvida rápida", duracao_s: [30, 45], formato: "Fala", blocos: [{ funcao: "Pergunta", faz: "a dúvida real" }, { funcao: "Regra", faz: "a resposta curta" }], gatilhos: ["clareza"], exemplo: "", nichos: [], cuidados: ["Sem promessa"] }, custo_usd: 0.01 }, error: null });
    }
    if (body.acao === "biblioteca_salvar") return Promise.resolve({ data: { modelo: { id: "x" }, custo_usd: 0 }, error: null });
    if (body.acao === "agente_historico") return Promise.resolve({ data: { conversa_id: null, mensagens: [] }, error: null });
    return Promise.resolve({ data: {}, error: null });
  });
});

describe("biblioteca Roteiros validados na etapa Modelos", () => {
  it("filtra por objetivo, abre a ficha e Usar leva ao roteiro novo com o modelo escolhido", async () => {
    const tela = montar(`/mesa-roteiros?client=${CLIENTE}&etapa=modelos`);
    const bib = await waitFor(() => {
      const b = tela.container.querySelector("[data-biblioteca-validada]");
      if (!b) throw new Error("sem biblioteca");
      return b as HTMLElement;
    }, { timeout: 10000 });
    const lista = () => bib.querySelector("[data-lista-da-base]") as HTMLElement;
    // Próprio (do banco) + 27 da base.
    await waitFor(() => expect(lista().querySelectorAll("[data-modelo-da-base]").length).toBe(28));
    const objetivos = within(bib).getAllByRole("radiogroup", { name: "Objetivo do vídeo" })[0];
    fireEvent.click(within(objetivos).getByRole("radio", { name: /Produto/ }));
    const primeiros = Array.from(lista().querySelectorAll("[data-modelo-da-base]")).map((li) => li.getAttribute("data-modelo-da-base"));
    expect(primeiros).toContain("rv-observacao-que-virou-marca");
    expect(primeiros).not.toContain("rv-polemico-assumido");
    fireEvent.click(within(bib).getByRole("button", { name: "Ver a ficha de A observação que virou marca" }));
    expect(bib.querySelector("[data-ficha-do-modelo='rv-observacao-que-virou-marca']")!.textContent).toMatch(/Quando usar/);
    fireEvent.click(within(bib).getByRole("button", { name: "Usar A observação que virou marca num roteiro novo" }));
    const select = (await screen.findByLabelText("Modelo da base", {}, { timeout: 10000 })) as HTMLSelectElement;
    expect(select.value).toBe("rv-observacao-que-virou-marca");
  }, 30000);

  it("modelo próprio: Preencher com IA monta a ficha e Salvar manda para a biblioteca da agência", async () => {
    const tela = montar(`/mesa-roteiros?client=${CLIENTE}&etapa=modelos`);
    const novo = await waitFor(() => {
      const b = tela.container.querySelector("[data-novo-modelo]");
      if (!b) throw new Error("sem bloco");
      return b as HTMLElement;
    }, { timeout: 10000 });
    // Começa recolhido: abre pelo título.
    fireEvent.click(within(novo).getAllByRole("button")[0]);
    fireEvent.change(within(novo).getByLabelText("Roteiro de exemplo"), { target: { value: "Fui demitido, tenho direito? Em regra, sim. Veja os prazos e os documentos que você precisa juntar antes de procurar ajuda especializada." } });
    const preencher = await within(novo).findByRole("button", { name: /Preencher com IA/ });
    await waitFor(() => expect((preencher as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(preencher);
    await waitFor(() => expect(chamadasDe("biblioteca_extrair")).toHaveLength(1));
    await waitFor(() => expect((within(novo).getByPlaceholderText("Ex.: Advogado responde em 40s") as HTMLInputElement).value).toBe("Direto do escritório"));
    fireEvent.click(within(novo).getByRole("button", { name: /Salvar na biblioteca/ }));
    await waitFor(() => expect(chamadasDe("biblioteca_salvar")).toHaveLength(1));
    const corpo = chamadasDe("biblioteca_salvar")[0][1].body;
    expect(corpo).toMatchObject({ client_id: CLIENTE, escopo: "agencia" });
    expect(corpo.ficha.blocos).toEqual([{ funcao: "Pergunta", faz: "a dúvida real" }, { funcao: "Regra", faz: "a resposta curta" }]);
  }, 30000);
});

describe("geração com a base", () => {
  it("escolher Autoridade e um modelo manda objetivo_base e modelo_base_id; o roteiro mostra a base usada", async () => {
    montar(`/mesa-roteiros?client=${CLIENTE}&etapa=roteiro&tarefa=${TAREFA}`);
    const objetivos = await screen.findByRole("radiogroup", { name: "Objetivo do vídeo" }, { timeout: 10000 });
    fireEvent.click(within(objetivos).getByRole("radio", { name: "Autoridade" }));
    const select = screen.getByLabelText("Modelo da base") as HTMLSelectElement;
    await waitFor(() => expect(Array.from(select.options).map((o) => o.value)).toContain(PROPRIO));
    fireEvent.change(select, { target: { value: "rv-queda-e-reconstrucao" } });
    const gerar = await screen.findByRole("button", { name: /Gerar roteiro/ });
    fireEvent.click(gerar);
    await waitFor(() => expect(chamadasDe("gerar")).toHaveLength(1));
    expect(chamadasDe("gerar")[0][1].body).toMatchObject({ objetivo_base: "autoridade", modelo_base_id: "rv-queda-e-reconstrucao", objetivo: "Autoridade" });
  }, 30000);

  it("no automático não manda modelo (o agente escolhe pelo contexto da marca)", async () => {
    montar(`/mesa-roteiros?client=${CLIENTE}&etapa=roteiro&tarefa=${TAREFA}`);
    await screen.findByRole("radiogroup", { name: "Objetivo do vídeo" }, { timeout: 10000 });
    fireEvent.click(await screen.findByRole("button", { name: /Gerar roteiro/ }));
    await waitFor(() => expect(chamadasDe("gerar")).toHaveLength(1));
    const corpo = chamadasDe("gerar")[0][1].body;
    expect(corpo.objetivo_base).toBeNull();
    expect(corpo.modelo_base_id).toBeNull();
  }, 30000);

  it("editor: a linha Base diz o modelo, o objetivo e como foi escolhido", async () => {
    mock.tabelas.roteiros = [{ id: ROTEIRO, client_id: CLIENTE, task_id: TAREFA, titulo: "Aposentadoria", tipo: "fala_camera", status: "rascunho", versao_atual: 1, versao_aprovada: null, versoes: [{ numero: 1, origem: "ia", conteudo: CONTEUDO, criado_em: "2026-09-30T10:00:00Z" }], comentarios: [], custo_usd: 0.02, criado_em: "2026-09-30T10:00:00Z", atualizado_em: "2026-09-30T10:00:00Z" }];
    const tela = montar(`/mesa-roteiros?client=${CLIENTE}&etapa=roteiro&roteiro=${ROTEIRO}`);
    const linha = await waitFor(() => {
      const l = tela.container.querySelector("[data-base-do-roteiro='rv-queda-e-reconstrucao']");
      if (!l) throw new Error("sem base");
      return l as HTMLElement;
    }, { timeout: 10000 });
    expect(linha.textContent).toMatch(/Base: Da pia ao topo/);
    expect(linha.textContent).toMatch(/Autoridade/);
    expect(linha.textContent).toMatch(/Também serviam: Tudo em jogo/);
  }, 30000);
});
