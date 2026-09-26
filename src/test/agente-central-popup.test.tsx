/**
 * Frente C2 (26/09): o "Atualizar todos" da Central virou um botão pequeno no
 * cabeçalho, com selo do estado da rodada, que abre o agente num pop-up em
 * quatro passos. Trava: o botão abre o pop-up, o selo aparece com rodada
 * pendente, fechar não perde a rodada, e a Central guarda o estado da tela.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ listar: vi.fn(), preparar: vi.fn(), aplicar: vi.fn(), publicar: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, profile: { role: "admin" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/central/agenteCentralApi", () => ({
  listarClientesDoAgente: mock.listar,
  prepararCliente: mock.preparar,
  aplicarRespostas: mock.aplicar,
  salvarEPublicarRitual: mock.publicar,
  criarTarefaDoRitual: vi.fn(),
}));

import AgenteDaCentral from "@/components/central/AgenteDaCentral";
import { CHAVE_LOCAL, etapaSugerida, seloDaRodada, type ItemDaRodada, type Rodada } from "@/components/central/rodadaDoAgente";
import { useEstadoDaTela } from "@/components/central/useEstadoDaTela";

const cliente = (id: string, nome: string) => ({ id, nome, contato: "", dossie_versao: 3, dossie_em: null });
const preparo = (id: string, nome: string) => ({
  client_id: id, nome, contato: "", fase: "executar", motivo_da_fase: "",
  leitura: { onde_estamos: `Semana de ${nome}.`, fase: { nome: "Executar", motivo: "", proximo_degrau: "" }, o_que_andou: [], pendencias: [], proximos: [], lacunas: [] },
  perguntas: [{ pergunta: `A verba de ${nome} foi reposta?`, por_que: "" }, { pergunta: `O vídeo de ${nome} saiu?`, por_que: "" }],
  dossie_versao: 3, dossie_aviso: null,
});
const item = (id: string, nome: string, mudar: Partial<ItemDaRodada> = {}): ItemDaRodada => ({
  cliente: cliente(id, nome), incluir: true, situacao: "perguntas", preparo: preparo(id, nome), respostas: ["", ""], contexto: "",
  aplicado: null, reportId: null, publicado: false, tarefasCriadas: [], erro: null, ...mudar,
});
const rodada = (itens: ItemDaRodada[]): Rodada => ({ ritual: "meio_semana", publicar: true, contextoGeral: "", itens, iniciadaEm: "2026-09-26T10:00:00Z" });

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AgenteDaCentral /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mock.listar.mockResolvedValue([cliente("a", "Verzelo"), cliente("b", "Stop")]);
});

describe("selo e etapa da rodada", () => {
  it("sem rodada não há selo; perguntas sem resposta viram o selo", () => {
    expect(seloDaRodada(null, null)).toBeNull();
    const r = rodada([item("a", "Verzelo", { respostas: ["Sim", ""] }), item("b", "Stop")]);
    expect(seloDaRodada(r, null)).toMatchObject({ texto: "3 perguntas esperando", curto: "3 perguntas", tom: "atencao" });
    expect(etapaSugerida(r, null)).toBe("responder");
  });

  it("rodando mostra o progresso; tudo pronto mostra os rituais", () => {
    const r = rodada([item("a", "Verzelo", { situacao: "fila", preparo: null }), item("b", "Stop")]);
    expect(seloDaRodada(r, "lendo")).toMatchObject({ texto: "Lendo 1 de 2", tom: "andamento" });
    const ritual = { tipo: "meio_semana", title: null, body: "Oi", next_steps: "", alertas: [], tarefas_sugeridas: [], model: null, repeticao: null, fase: null };
    const aplicado = { client_id: "a", nome: "Verzelo", dossie_versao: 4, dossie_aviso: null, confirmacoes: [], aprovacao: { por: "u1", em: "", via: "" }, ritual };
    const pronto = rodada([item("a", "Verzelo", { situacao: "pronto", aplicado })]);
    expect(seloDaRodada(pronto, null)).toMatchObject({ texto: "1 ritual pronto", tom: "ok" });
    expect(etapaSugerida(pronto, null)).toBe("copiar");
    expect(etapaSugerida(null, null)).toBe("ler");
  });
});

describe("botão Atualizar todos", () => {
  it("é um botão pequeno e abre o agente no pop-up, lendo a carteira", async () => {
    montar();
    const botao = screen.getByRole("button", { name: /Atualizar todos/ });
    expect(botao).toHaveAttribute("data-agente-central-botao");
    expect(document.querySelector("[data-selo-da-rodada]")).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(botao);
    const janela = await screen.findByRole("dialog");
    expect(janela).toHaveTextContent("Atualizar todos");
    await waitFor(() => expect(mock.listar).toHaveBeenCalledTimes(1));
    // Os quatro passos, com o botão da etapa no rodapé.
    const passos = await screen.findByRole("navigation", { name: "Passos do Atualizar todos" });
    for (const p of ["Ler", "Responder", "Aplicar e publicar", "Copiar rituais"]) expect(passos).toHaveTextContent(p);
    expect(await screen.findByRole("button", { name: "Ler e atualizar 2 dossiê(s)" })).toBeInTheDocument();
    expect(screen.getByText("Verzelo")).toBeInTheDocument();
  });

  it("com rodada guardada, o selo mostra as perguntas esperando e o pop-up abre no passo Responder", async () => {
    window.localStorage.setItem(CHAVE_LOCAL, JSON.stringify(rodada([item("a", "Verzelo"), item("b", "Stop", { respostas: ["Sim", ""] })])));
    montar();
    const selo = document.querySelector("[data-selo-da-rodada]");
    expect(selo).toHaveTextContent("3 perguntas esperando");
    fireEvent.click(screen.getByRole("button", { name: /Atualizar todos/ }));
    await screen.findByRole("dialog");
    expect(mock.listar).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Responder/, current: "page" })).toBeInTheDocument();
    // Um cliente aberto por vez: o primeiro com pergunta sem resposta.
    const resposta = screen.getByRole("textbox", { name: "A verba de Verzelo foi reposta?" });
    fireEvent.change(resposta, { target: { value: "Sim, até 10/10." } });
    expect(screen.queryByRole("textbox", { name: "A verba de Stop foi reposta?" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
    expect(screen.getByRole("textbox", { name: "O vídeo de Stop saiu?" })).toBeInTheDocument();
    // Rodapé com o próximo passo sempre à vista.
    fireEvent.click(screen.getByRole("button", { name: "Continuar para aplicar" }));
    expect(screen.getByRole("button", { name: "Aplicar respostas e publicar" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Publicar no portal ao aplicar" })).toBeChecked();
  });

  it("fechar o pop-up não perde a rodada: a resposta continua guardada e o selo atualiza", async () => {
    window.localStorage.setItem(CHAVE_LOCAL, JSON.stringify(rodada([item("a", "Verzelo")])));
    montar();
    fireEvent.click(screen.getByRole("button", { name: /Atualizar todos/ }));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByRole("textbox", { name: "A verba de Verzelo foi reposta?" }), { target: { value: "Sim." } });
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.querySelector("[data-selo-da-rodada]")).toHaveTextContent("1 pergunta esperando");
    const guardada = JSON.parse(window.localStorage.getItem(CHAVE_LOCAL) || "null") as Rodada;
    expect(guardada.itens[0].respostas[0]).toBe("Sim.");
  });
});

describe("estado da tela guardado por usuário", () => {
  it("grava, devolve ao voltar e descarta valor que não vale mais", async () => {
    vi.useFakeTimers();
    try {
      const valida = (v: unknown) => typeof v === "string" && ["carteira", "fila"].includes(v);
      const primeira = renderHook(() => useEstadoDaTela<string>("central:u1:aba", "carteira", valida));
      act(() => primeira.result.current[1]("fila"));
      act(() => { vi.advanceTimersByTime(300); });
      primeira.unmount();
      const volta = renderHook(() => useEstadoDaTela<string>("central:u1:aba", "carteira", valida));
      expect(volta.result.current[0]).toBe("fila");
      window.localStorage.setItem("tela:v1:central:u1:aba", JSON.stringify("aba-que-sumiu"));
      const invalida = renderHook(() => useEstadoDaTela<string>("central:u1:aba", "carteira", valida));
      expect(invalida.result.current[0]).toBe("carteira");
      // Sem usuário (chave nula) não grava nada.
      const semChave = renderHook(() => useEstadoDaTela<string>(null, "carteira"));
      act(() => semChave.result.current[1]("fila"));
      act(() => { vi.advanceTimersByTime(300); });
      expect(Object.keys(window.localStorage).filter((k) => k.indexOf("tela:v1:null") === 0)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sair no meio da digitação não perde a última mudança", () => {
    const h = renderHook(() => useEstadoDaTela<Record<string, string>>("central:u1:rascunhos", {}));
    act(() => h.result.current[1]({ r1: "texto novo" }));
    h.unmount();
    expect(JSON.parse(window.localStorage.getItem("tela:v1:central:u1:rascunhos") || "{}")).toEqual({ r1: "texto novo" });
  });
});

describe("Central enxuta (contrato do código)", () => {
  const central = readFileSync(resolve(__dirname, "../..", "src/pages/AdminExperience.tsx"), "utf8");

  it("o agente fica no cabeçalho, ao lado do gerador, e não como bloco grande", () => {
    const cabecalho = central.slice(central.indexOf("Cabeçalho enxuto"), central.indexOf("Hoje, numa faixa só"));
    expect(cabecalho).toContain("{!cycleReview && <AgenteDaCentral />}");
    expect(cabecalho).toContain('data-tour="central-gerador"');
  });

  it("descrições fixas viraram \"?\" ao lado do título", () => {
    expect(central).not.toContain('<p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">');
    expect(central).not.toContain("O que esta aba faz, em uma linha");
    // E3 (26/09): parte do "?" agora vem pela prop `ajuda` do CabecalhoDePagina e da Secao.
    expect((central.match(/<AjudaRecolhida\b|\bajuda=/g) || []).length).toBeGreaterThanOrEqual(8);
  });

  it("aba, cliente aberto, filtros, rascunhos, texto da IA e rolagem ficam guardados por usuário", () => {
    expect(central).toContain("const telaChave = !cycleReview && user?.id ? `central:${user.id}` : null;");
    for (const nome of ["aba", "carteira-aberto", "perfil-cliente", "historico-cliente", "fila-aberto", "rascunhos", "momentos-ia", "ideias-ia", "radar-cliente"]) {
      expect(central).toContain(`guardar("${nome}")`);
    }
    expect(central).toContain('useRolagemDaTela(guardar("rolagem"), raizDaCentral)');
  });
});
