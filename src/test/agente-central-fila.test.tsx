/**
 * 19/10 (dono: "ele trava pra responder quando está carregando"): a fila do
 * "Atualizar todos" não prende a tela. Trava:
 * - quem fica pronto já pode ser respondido e aplicado enquanto outro ainda lê;
 * - as consultas da Central são atualizadas uma vez, no fim, e não a cada cliente;
 * - o cliente que não deu certo mostra o motivo e tem "Tentar de novo" só para ele;
 * - as vagas somam leitura e aplicação, a aplicação passa na frente e o limite só desce.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ listar: vi.fn(), preparar: vi.fn(), aplicar: vi.fn(), publicar: vi.fn(), reescrever: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, profile: { role: "admin" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/central/agenteCentralApi", () => ({
  listarClientesDoAgente: mock.listar,
  prepararCliente: mock.preparar,
  aplicarRespostas: mock.aplicar,
  salvarEPublicarRitual: mock.publicar,
  reescreverRitual: mock.reescrever,
  criarTarefaDoRitual: vi.fn(),
}));

import AgenteDaCentral from "@/components/central/AgenteDaCentral";
import { criarVagas } from "@/components/central/filaDaCentral";
import { rodadaRetomada, type ItemDaRodada, type Rodada } from "@/components/central/rodadaDoAgente";

const cliente = (id: string, nome: string) => ({ id, nome, contato: "", dossie_versao: 3, dossie_em: null });
const preparo = (id: string, nome: string) => ({
  client_id: id, nome, contato: "", fase: "executar", motivo_da_fase: "",
  leitura: { onde_estamos: `Semana de ${nome}.`, fase: { nome: "Executar", motivo: "", proximo_degrau: "" }, o_que_andou: [], pendencias: [], proximos: [], lacunas: [] },
  perguntas: [{ pergunta: `A verba de ${nome} foi reposta?`, por_que: "" }],
  dossie_versao: 3, dossie_aviso: null,
});
const ritual = (body: string) => ({ tipo: "meio_semana", title: "Meio da semana", body, next_steps: "", alertas: [], tarefas_sugeridas: [], model: null, repeticao: null, fase: null });
const aplicado = (id: string, nome: string) => ({ client_id: id, nome, dossie_versao: 4, dossie_aviso: null, confirmacoes: [], aprovacao: { por: "u1", em: "", via: "" }, ritual: ritual(`Oi, ${nome}.`) });

/** Promessa que o teste resolve na hora que quiser (o servidor "demorando"). */
function adiada<T>() {
  let resolver!: (v: T) => void;
  let rejeitar!: (e: unknown) => void;
  const promessa = new Promise<T>((ok, erro) => { resolver = ok; rejeitar = erro; });
  return { promessa, resolver, rejeitar };
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidar = vi.spyOn(qc, "invalidateQueries");
  render(<MemoryRouter><QueryClientProvider client={qc}><AgenteDaCentral /></QueryClientProvider></MemoryRouter>);
  return { invalidar };
}

async function abrirELer() {
  fireEvent.click(screen.getByRole("button", { name: /Atualizar todos/ }));
  await screen.findByRole("dialog");
  fireEvent.click(await screen.findByRole("button", { name: "Ler e atualizar 2 dossiê(s)" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mock.listar.mockResolvedValue([cliente("a", "Verzelo"), cliente("b", "Stop")]);
});

describe("fila do Atualizar todos sem travar a tela", () => {
  it("responde e aplica um cliente pronto enquanto outro ainda está lendo; invalida as consultas só no fim", async () => {
    const leituraDoStop = adiada<ReturnType<typeof preparo>>();
    mock.preparar.mockImplementation((id: string) => (id === "a" ? Promise.resolve(preparo("a", "Verzelo")) : leituraDoStop.promessa));
    mock.aplicar.mockResolvedValue(aplicado("a", "Verzelo"));
    mock.publicar.mockResolvedValue({ reportId: "rep-a", publicado: true, avisos: [] });
    const { invalidar } = montar();
    await abrirELer();

    // O primeiro pronto já leva ao passo Responder, com o campo livre, enquanto o Stop segue lendo.
    const resposta = await screen.findByRole("textbox", { name: "A verba de Verzelo foi reposta?" });
    expect(screen.getByRole("button", { name: /Responder/, current: "page" })).toBeInTheDocument();
    expect(resposta).toBeEnabled();
    expect(screen.getByText(/Lendo 1 de 2, 4 por vez/)).toBeInTheDocument();
    fireEvent.change(resposta, { target: { value: "Sim, até 10/10." } });
    expect(screen.getByRole("textbox", { name: "Contexto que vale para todos" })).toBeEnabled();

    // Aplicar o Verzelo não espera o Stop.
    const salvar = screen.getByRole("button", { name: "Salvar, atualizar e publicar" });
    expect(salvar).toBeEnabled();
    fireEvent.click(salvar);
    await waitFor(() => expect(mock.publicar).toHaveBeenCalledTimes(1));
    expect(mock.aplicar).toHaveBeenCalledWith(expect.objectContaining({ clientId: "a", respostas: ["Sim, até 10/10."] }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "A verba de Verzelo foi reposta?" })).toBeDisabled());
    // Stop ainda a caminho: nenhuma consulta da Central recarregou no meio da fila.
    expect(invalidar).not.toHaveBeenCalled();

    // Stop chega: vira respondível e as consultas são atualizadas uma vez só (sem chave repetida).
    leituraDoStop.resolver(preparo("b", "Stop"));
    fireEvent.click(await screen.findByRole("button", { name: /Stop/ }));
    expect(await screen.findByRole("textbox", { name: "A verba de Stop foi reposta?" })).toBeEnabled();
    await waitFor(() => expect(invalidar).toHaveBeenCalled());
    const chaves = invalidar.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(new Set(chaves).size).toBe(chaves.length);
    expect(chaves).toContain(JSON.stringify(["reports"]));
    expect(chaves).toContain(JSON.stringify(["dossie-cliente"]));
  });

  it("cliente que não deu certo mostra o motivo do servidor e Tentar de novo refaz só ele", async () => {
    let tentativasDoStop = 0;
    mock.preparar.mockImplementation((id: string) => {
      if (id === "a") return Promise.resolve(preparo("a", "Verzelo"));
      tentativasDoStop += 1;
      return tentativasDoStop === 1
        ? Promise.reject(new Error("A IA não respondeu agora (nenhum modelo respondeu). Tente este cliente de novo."))
        : Promise.resolve(preparo("b", "Stop"));
    });
    montar();
    await abrirELer();
    await screen.findByRole("textbox", { name: "A verba de Verzelo foi reposta?" });
    await waitFor(() => expect(mock.preparar).toHaveBeenCalledTimes(2));

    fireEvent.click(within(screen.getByRole("navigation", { name: "Passos do Atualizar todos" })).getByRole("button", { name: /Ler/ }));
    const motivo = await screen.findByText(/nenhum modelo respondeu/);
    const linha = motivo.closest("li")!;
    expect(within(linha).getByText("Stop")).toBeInTheDocument();
    fireEvent.click(within(linha).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(mock.preparar).toHaveBeenCalledTimes(3));
    expect(mock.preparar.mock.calls.map((c) => c[0])).toEqual(["a", "b", "b"]);
    fireEvent.click(await screen.findByRole("button", { name: /Stop/ }));
    expect(await screen.findByRole("textbox", { name: "A verba de Stop foi reposta?" })).toBeEnabled();
  });

  it("rodada guardada no meio da fila não fica girando para sempre", () => {
    const base = { cliente: cliente("a", "Verzelo"), incluir: true, respostas: [""], contexto: "", aplicado: null, reportId: null, publicado: false, tarefasCriadas: [], erro: null };
    const r: Rodada = {
      ritual: "meio_semana", publicar: true, contextoGeral: "", iniciadaEm: "2026-10-19T10:00:00Z",
      itens: [
        { ...base, situacao: "lendo", preparo: null } as ItemDaRodada,
        { ...base, cliente: cliente("b", "Stop"), situacao: "aplicando", preparo: preparo("b", "Stop") } as ItemDaRodada,
      ],
    };
    const retomada = rodadaRetomada(r)!;
    expect(retomada.itens[0].situacao).toBe("fila");
    expect(retomada.itens[1].situacao).toBe("erro");
    expect(retomada.itens[1].erro).toMatch(/Tentar de novo/);
  });
});

describe("vagas da fila", () => {
  it("somam leitura e aplicação, a prioridade passa na frente e o limite só desce", async () => {
    const vagas = criarVagas(4);
    const iniciados: string[] = [];
    const soltar = new Map<string, () => void>();
    const tarefa = (nome: string) => () => new Promise<void>((ok) => { iniciados.push(nome); soltar.set(nome, ok); });
    const todas = ["l1", "l2", "l3", "l4", "l5", "l6"].map((n) => vagas.rodar(tarefa(n)));
    const aplicar = vagas.rodar(tarefa("aplicar"), true);
    await waitFor(() => expect(iniciados).toEqual(["l1", "l2", "l3", "l4"]));
    vagas.reduzir(2);
    vagas.reduzir(8);
    expect(vagas.limite).toBe(2);
    // Com o limite em 2, só entra alguém quando sobram menos de 2 a caminho; e entra a aplicação primeiro.
    soltar.get("l1")!(); soltar.get("l2")!();
    await Promise.resolve(); await Promise.resolve();
    expect(iniciados).toEqual(["l1", "l2", "l3", "l4"]);
    soltar.get("l3")!();
    await waitFor(() => expect(iniciados).toEqual(["l1", "l2", "l3", "l4", "aplicar"]));
    soltar.get("l4")!();
    await waitFor(() => expect(iniciados).toEqual(["l1", "l2", "l3", "l4", "aplicar", "l5"]));
    soltar.get("aplicar")!(); soltar.get("l5")!();
    await waitFor(() => expect(iniciados).toContain("l6"));
    soltar.get("l6")!();
    await Promise.all([...todas, aplicar]);
  });
});

describe("motivo legível do servidor", () => {
  it("junta o ia_erro à frase do servidor quando ela ainda não o cita", async () => {
    const api = await vi.importActual<typeof import("@/components/central/agenteCentralApi")>("@/components/central/agenteCentralApi");
    expect(api.mensagemComMotivo("A IA não conseguiu consolidar o contexto agora.", "nenhum modelo respondeu"))
      .toBe("A IA não conseguiu consolidar o contexto agora. Motivo: nenhum modelo respondeu");
    expect(api.mensagemComMotivo("A IA não respondeu agora (nenhum modelo respondeu).", "nenhum modelo respondeu"))
      .toBe("A IA não respondeu agora (nenhum modelo respondeu).");
    expect(api.mensagemComMotivo("Sem acesso.", null)).toBe("Sem acesso.");
  });
});
