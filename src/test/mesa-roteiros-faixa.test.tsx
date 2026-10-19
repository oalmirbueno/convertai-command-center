import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Faixa de roteiros abertos da Mesa Roteiros (19/10/2026). O dono: "escolher
 * em cima os roteiros que eu quiser e fazer vários na mesma área, mesma
 * dinâmica de trabalho". Confere: abrir vários de uma vez (marcando na
 * Agenda), alternar entre as abas sem perder o estado de cada uma, "Gerar
 * todos" com o preço total antes e uma chamada ao gerador por roteiro, e
 * fechar da faixa sem apagar o roteiro nem o rascunho.
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
import { abrirNaFaixa, enderecoDaAba, FAIXA_VAZIA, fecharDaFaixa, tituloCurto, validarFaixa } from "@/components/mesa-roteiros/roteirosAbertos";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const TAREFA = "22222222-2222-4222-8222-222222222222";
const TAREFA_2 = "33333333-3333-4333-8333-333333333333";
const ROTEIRO = "44444444-4444-4444-8444-444444444444";

const CONTEUDO = {
  titulo: "Salário-maternidade",
  subtitulo: "Estou desempregada e agora?",
  tipo: "fala_camera",
  ganchos: [
    { texto: "Estou grávida e sem emprego. Tenho direito?", mecanismo: "pergunta concreta", promessa: "responder", motivo: "" },
    { texto: "Perdeu o emprego grávida?", mecanismo: "contraste", promessa: "", motivo: "" },
    { texto: "A data em que você saiu muda tudo.", mecanismo: "resultado primeiro", promessa: "", motivo: "" },
  ],
  gancho_escolhido: 0,
  blocos: [
    { id: "b1", funcao: "Abertura", fala: "Estou grávida e sem emprego. Tenho direito?", segundos: 5, visual: "Sentada" },
    { id: "b2", funcao: "Resposta", fala: "Não necessariamente.", segundos: 8, visual: "Aproximar" },
  ],
  direcao: { enquadramento: "Peito para cima", ambiente: "Sentada à mesa", orientacoes: ["Olhar na lente"] },
  cta: "Salve para consultar depois.",
  legenda: "Grávida e sem emprego?",
};

const linha = (id: string, taskId: string | null, titulo: string) => ({
  id,
  client_id: CLIENTE,
  task_id: taskId,
  titulo,
  tipo: "fala_camera",
  status: "rascunho",
  versao_atual: 1,
  versao_aprovada: null,
  versoes: [{ numero: 1, origem: "ia", conteudo: { ...CONTEUDO, titulo }, criado_em: "2026-10-19T10:00:00Z", custo_usd: 0.03 }],
  comentarios: [],
  custo_usd: 0.03,
  criado_em: "2026-10-19T10:00:00Z",
  atualizado_em: "2026-10-19T10:00:00Z",
});

function hojeMais(dias: number) {
  const d = new Date(Date.now() + dias * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function montar(endereco: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [endereco] }, h(TooltipProvider, null, h(MesaRoteiros)))));
}

const chamadasDe = (acao: string) => mock.invoke.mock.calls.filter((c) => c[1] && c[1].body && c[1].body.acao === acao);
const faixa = () => screen.findByRole("tablist", { name: "Roteiros abertos" }, { timeout: 10000 });
const nomesDasAbas = (lista: HTMLElement) => within(lista).queryAllByRole("tab").map((t) => t.textContent);
const preco = (b: HTMLElement) => {
  const m = (b.textContent || "").match(/US\$\s*([0-9.,]+)/);
  return m ? Number(m[1].replace(/\./g, "").replace(",", ".")) : NaN;
};

beforeEach(() => {
  mock.invoke.mockReset();
  window.localStorage.clear();
  mock.tabelas = {
    ia_modelos: [{ id: "openai:gpt-6-sol", provedor: "openai", modelo_api: "gpt-6-sol", tipo: "texto", rotulo: "GPT 6 Sol", preco_entrada_1m: 1, preco_saida_1m: 4, ativo: true, padrao_para: ["estrategista"] }],
    tasks: [
      { id: TAREFA, title: "Reels salário-maternidade", description: null, due_date: hojeMais(2), delivery_type: "reel", status: "todo" },
      { id: TAREFA_2, title: "Story BPC", description: null, due_date: hojeMais(4), delivery_type: "story", status: "todo" },
    ],
    calendario_propostas: [],
    roteiros: [],
    roteiro_modelos: [],
    mesa_cliente_escolhas: [],
  };
  let n = 0;
  mock.invoke.mockImplementation((_fn: string, { body }: any) => {
    if (body.acao === "gerar") {
      n += 1;
      const id = `5555555${n}-5555-4555-8555-555555555555`;
      return Promise.resolve({ data: { roteiro: linha(id, body.task_id || null, body.task_id === TAREFA ? "Reels salário-maternidade" : "Story BPC"), versao: { numero: 1 }, custo_usd: 0.03 }, error: null });
    }
    if (body.acao === "agente_historico" || body.acao === "ideias_historico") return Promise.resolve({ data: { conversa_id: null, mensagens: [] }, error: null });
    return Promise.resolve({ data: {}, error: null });
  });
});

describe("faixa: regras", () => {
  it("roteiro e peça não se repetem; avulso sempre abre aba nova; fechar escolhe a vizinha", () => {
    let r = abrirNaFaixa(FAIXA_VAZIA, { roteiro: ROTEIRO, titulo: "Salário-maternidade" }, "a1");
    expect(r.nova).toBe(true);
    const de1 = abrirNaFaixa(r.faixa, { roteiro: ROTEIRO, titulo: "Roteiro" }, "a2");
    expect(de1.nova).toBe(false);
    expect(de1.id).toBe("a1");
    // Título provisório não troca o real.
    expect(de1.faixa.abas[0].titulo).toBe("Salário-maternidade");
    r = abrirNaFaixa(de1.faixa, { tarefa: TAREFA, titulo: "Reels" }, "a3");
    r = abrirNaFaixa(r.faixa, { avulso: true, titulo: "Roteiro avulso" }, "a4");
    r = abrirNaFaixa(r.faixa, { avulso: true, titulo: "Roteiro avulso" }, "a5");
    expect(r.faixa.abas.map((a) => a.id)).toEqual(["a1", "a3", "a4", "a5"]);
    expect(validarFaixa(r.faixa)).toBe(true);
    const f = fecharDaFaixa({ ...r.faixa, ativa: "a3" }, "a3");
    expect(f.proxima && f.proxima.id).toBe("a4");
    expect(f.faixa.ativa).toBe("a4");
    expect(f.faixa.abas.map((a) => a.id)).toEqual(["a1", "a4", "a5"]);
    expect(enderecoDaAba(f.faixa.abas[1])).toMatchObject({ etapa: "roteiro", aba: "a4", avulso: "1", roteiro: null });
    expect(tituloCurto("Um título bem comprido demais para caber na aba")).toHaveLength(26);
    expect(validarFaixa({ abas: [{ id: "x" }], ativa: null })).toBe(false);
  });
});

describe("faixa na tela", () => {
  it("abre os selecionados da agenda e alterna entre as abas mantendo o estado de cada uma", async () => {
    const tela = montar(`/mesa-roteiros?client=${CLIENTE}&etapa=agenda`);
    const lista = await faixa();
    expect(nomesDasAbas(lista)).toEqual([]);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Marcar Reels salário-maternidade" }, { timeout: 10000 }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Marcar Story BPC" }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir os selecionados" }));
    await waitFor(() => expect(nomesDasAbas(lista)).toEqual(["Reels salário-maternidade", "Story BPC"]));
    // Abre a primeira, na etapa Roteiro, com o formulário da peça.
    await screen.findByRole("radiogroup", { name: "Tipo de roteiro" }, { timeout: 10000 });
    expect(within(lista).getByRole("tab", { name: "Reels salário-maternidade" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: /Tutorial/ }));
    fireEvent.change(screen.getByPlaceholderText(/a advogada grava sentada/), { target: { value: "Pedido do Reels" } });

    // Troca para a segunda: formulário limpo, dela.
    fireEvent.click(within(lista).getByRole("tab", { name: "Story BPC" }));
    await waitFor(() => expect(within(lista).getByRole("tab", { name: "Story BPC" }).getAttribute("aria-selected")).toBe("true"));
    await waitFor(() => expect((screen.getByPlaceholderText(/a advogada grava sentada/) as HTMLTextAreaElement).value).toBe(""));
    expect(screen.getByRole("radio", { name: /Tutorial/ }).getAttribute("aria-checked")).toBe("false");
    fireEvent.change(screen.getByPlaceholderText(/a advogada grava sentada/), { target: { value: "Pedido do Story" } });

    // Volta para a primeira: o que estava lá continua.
    fireEvent.click(within(lista).getByRole("tab", { name: "Reels salário-maternidade" }));
    await waitFor(() => expect((screen.getByPlaceholderText(/a advogada grava sentada/) as HTMLTextAreaElement).value).toBe("Pedido do Reels"));
    expect(screen.getByRole("radio", { name: /Tutorial/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(lista).getByRole("tab", { name: "Story BPC" }));
    await waitFor(() => expect((screen.getByPlaceholderText(/a advogada grava sentada/) as HTMLTextAreaElement).value).toBe("Pedido do Story"));
    // Nada foi gerado só por abrir e alternar.
    expect(chamadasDe("gerar")).toHaveLength(0);

    // A faixa fica guardada por cliente: montar de novo traz as duas abas.
    tela.unmount();
    montar(`/mesa-roteiros?client=${CLIENTE}&etapa=agenda`);
    const de_novo = await faixa();
    await waitFor(() => expect(nomesDasAbas(de_novo)).toEqual(["Reels salário-maternidade", "Story BPC"]));
  }, 40000);

  it("Gerar todos: preço total antes e uma chamada ao gerador por roteiro, com o andamento nas abas", async () => {
    montar(`/mesa-roteiros?client=${CLIENTE}&etapa=agenda`);
    const lista = await faixa();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Marcar Reels salário-maternidade" }, { timeout: 10000 }));
    const um = await screen.findByRole("button", { name: /Gerar todos \(1\)/ });
    await waitFor(() => expect(um.textContent).toMatch(/~US\$/));
    const precoDeUm = preco(um);
    fireEvent.click(screen.getByRole("checkbox", { name: "Marcar Story BPC" }));
    const dois = await screen.findByRole("button", { name: /Gerar todos \(2\)/ });
    await waitFor(() => expect(dois.textContent).toMatch(/~US\$/));
    // O total dos dois aparece antes de gastar.
    expect(precoDeUm).toBeGreaterThan(0);
    expect(preco(dois)).toBeCloseTo(precoDeUm * 2, 3);
    expect(chamadasDe("gerar")).toHaveLength(0);

    fireEvent.click(dois);
    await waitFor(() => expect(chamadasDe("gerar")).toHaveLength(2), { timeout: 10000 });
    const corpos = chamadasDe("gerar").map((c) => c[1].body);
    expect(corpos.map((c) => c.task_id)).toEqual([TAREFA, TAREFA_2]);
    for (const c of corpos) expect(c).toMatchObject({ client_id: CLIENTE, tipo: "fala_camera", modelo_id: "openai:gpt-6-sol" });
    await waitFor(() => expect(nomesDasAbas(lista)).toEqual(["Reels salário-maternidade", "Story BPC"]));
    await waitFor(() => expect(lista.querySelectorAll('[data-estado-no-lote="pronto"]')).toHaveLength(2), { timeout: 10000 });
  }, 40000);

  it("fechar da faixa não apaga o roteiro nem o rascunho", async () => {
    mock.tabelas.roteiros = [linha(ROTEIRO, TAREFA, "Salário-maternidade")];
    montar(`/mesa-roteiros?client=${CLIENTE}&etapa=roteiro&roteiro=${ROTEIRO}`);
    const lista = await faixa();
    await waitFor(() => expect(nomesDasAbas(lista)).toEqual(["Salário-maternidade"]), { timeout: 10000 });
    const fala = (await screen.findByLabelText("Fala do bloco 2", {}, { timeout: 10000 })) as HTMLTextAreaElement;
    fireEvent.change(fala, { target: { value: "Rascunho que não pode sumir." } });
    // O rascunho do editor grava com respiro de 400 ms.
    await new Promise((ok) => setTimeout(ok, 500));
    fireEvent.click(within(lista).getByRole("button", { name: "Fechar Salário-maternidade da faixa" }));
    await waitFor(() => expect(nomesDasAbas(lista)).toEqual([]));
    // Sem aba, volta para a Agenda; o roteiro continua lá.
    const pecas = await waitFor(() => {
      const l = document.querySelector("[data-pecas-de-video]");
      if (!l) throw new Error("sem lista");
      return l as HTMLElement;
    }, { timeout: 10000 });
    await waitFor(() => expect(within(pecas).getByText("Rascunho")).toBeTruthy());
    expect(mock.invoke.mock.calls.filter((c) => /apagar|arquivar|excluir/.test(String(c[1] && c[1].body && c[1].body.acao)))).toHaveLength(0);
    // Abrir de novo traz a edição que estava lá.
    fireEvent.click(within(pecas).getByRole("button", { name: "Abrir" }));
    await waitFor(() => expect((screen.getByLabelText("Fala do bloco 2") as HTMLTextAreaElement).value).toBe("Rascunho que não pode sumir."), { timeout: 10000 });
    expect(nomesDasAbas(lista)).toEqual(["Salário-maternidade"]);
  }, 40000);

  it("ideias marcadas: Abrir os selecionados abre uma aba por ideia, com o formulário já preenchido", async () => {
    const ideia = (n: number, tema: string) => ({
      apelido: `i${n}`,
      tema,
      pergunta_do_cliente: `Pergunta ${n}?`,
      gancho: `Gancho ${n}`,
      angulo: "autoridade",
      objetivo: "autoridade",
      modelo_base_id: null,
      modelo_base_nome: null,
      tipo: "fala_camera",
      por_que_agora: "",
      fonte: null,
      promessa: "",
      esqueleto: [],
      ligacao_com_roteiros: null,
      notas: { responde: 0.9, gancho: 0.8, especifico: 0.7, total: 0.83, como: "jev" },
    });
    const padrao = mock.invoke.getMockImplementation();
    mock.invoke.mockImplementation((fn: string, arg: any) =>
      arg.body.acao === "ideias_conversar"
        ? Promise.resolve({ data: { conversa_id: null, mensagem_id: "m1", resposta: "Duas ideias.", ideias: [ideia(1, "Inventário em cartório em 30 dias"), ideia(2, "Pensão por morte")], preencher: null, fontes: [], ranking: "jev", custo_usd: 0.01 }, error: null })
        : padrao!(fn, arg),
    );
    montar(`/mesa-roteiros?client=${CLIENTE}&etapa=roteiro&avulso=1`);
    const lista = await faixa();
    await waitFor(() => expect(nomesDasAbas(lista)).toEqual(["Roteiro avulso"]));
    fireEvent.click(await screen.findByRole("button", { name: "Me dá ideias" }, { timeout: 10000 }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Marcar a ideia 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Marcar a ideia 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir os selecionados" }));
    await waitFor(() => expect(nomesDasAbas(lista)).toEqual(["Roteiro avulso", "Inventário em cartório em…", "Pensão por morte"]));
    expect(within(lista).getByRole("tab", { name: /Inventário em cartório/ }).getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect((screen.getByPlaceholderText(/período de graça/) as HTMLInputElement).value).toBe("Inventário em cartório em 30 dias"));
    fireEvent.click(within(lista).getByRole("tab", { name: "Pensão por morte" }));
    await waitFor(() => expect((screen.getByPlaceholderText(/período de graça/) as HTMLInputElement).value).toBe("Pensão por morte"));
    // A primeira aba avulsa continua com o formulário vazio dela.
    fireEvent.click(within(lista).getByRole("tab", { name: "Roteiro avulso" }));
    await waitFor(() => expect((screen.getByPlaceholderText(/período de graça/) as HTMLInputElement).value).toBe(""));
    expect(chamadasDe("gerar")).toHaveLength(0);
  }, 40000);

  it("o + abre a janela no centro; Roteiro novo abre uma aba avulsa com as ideias", async () => {
    montar(`/mesa-roteiros?client=${CLIENTE}&etapa=agenda`);
    const lista = await faixa();
    fireEvent.click(screen.getByRole("button", { name: "Abrir outro roteiro" }));
    const janela = await screen.findByRole("dialog");
    expect(janela.hasAttribute("data-janela-central")).toBe(true);
    fireEvent.click(within(janela).getByRole("button", { name: /Roteiro novo/ }));
    await waitFor(() => expect(nomesDasAbas(lista)).toEqual(["Roteiro avulso"]));
    await screen.findByText("Ideias com o agente", {}, { timeout: 10000 });
  }, 30000);
});
