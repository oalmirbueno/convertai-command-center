import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AdminExecucao from "@/pages/AdminExecucao";
import ExecucoesRecentes from "@/components/execucao/ExecucoesRecentes";
import TarefaDaExecucao from "@/components/execucao/TarefaDaExecucao";

/**
 * 26/10/2026 (dono: "a execução da equipe está muito pesada. Quando eu clico em Trabalho, ela pesa,
 * trava. Tarefas: quando eu clico em algumas coisas, está bem bugado"). Medido com banco simulado
 * (300 vínculos, 200 execuções, diário de 250 entradas):
 *  - os cartões eram componentes criados dentro da tela: cada releitura remontava todos (42 mil
 *    desmontagens em 30 s) e o "ver mais" aberto fechava sozinho;
 *  - a lista desenhava tudo (15,6 mil nós no Trabalho); a execução fechada já montava as provas;
 *  - o link da notificação voltava a valer a cada releitura (a tela pulava de volta);
 *  - a janela da tarefa abria com a linha enxuta do quadro (prioridade e área vazias, salvar
 *    regravava a área) e não fechava com Esc.
 */

const estado = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  vinculos: 1,
  runs: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin" }, profile: { id: "admin", role: "admin", full_name: "Dono" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({ useProjects: () => ({ data: [] }), useTeamMembers: () => ({ data: [] }), useClients: () => ({ data: [] }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: estado.from, rpc: estado.rpc } }));
vi.mock("@/lib/fileUrls", async (original) => ({ ...await original<typeof import("@/lib/fileUrls")>(), resolveFileUrl: vi.fn(async () => "https://exemplo.com/prova.png") }));
vi.mock("@tanstack/react-query", async (original) => {
  const real = await original<typeof import("@tanstack/react-query")>();
  return {
    ...real,
    useQuery: (opcoes: { queryKey: string[] }) => {
      const chave = opcoes.queryKey[0];
      // A tela da Execução lê do mock (cada desenho devolve objetos NOVOS, como uma releitura);
      // as peças de fora (prova, tarefa completa) usam o React Query de verdade.
      if (!chave.startsWith("operador") && !["flag-operators-layer", "operadores-internos", "execucao-pedidos"].includes(chave)) return real.useQuery(opcoes as never);
      const vinculos = Array.from({ length: estado.vinculos }, (_, i) => ({
        id: `link-${i}`, operator_id: "op", kanban_task_id: `task-${i}`, status: "in_progress",
        updated_at: "2026-10-26T12:00:00Z", last_action: `Fazendo a peça ${i}`, last_evidence: null, next_step: "Publicar depois da aprovação", approval_required: false,
      }));
      const linhas: Record<string, unknown> = {
        "flag-operators-layer": "on",
        "operadores-internos": [{ id: "op", slug: "sintetico", display_name: "Operador sintético", role: "Operação", status: "active", area: "Operações" }],
        "operador-vinculos": vinculos,
        "operador-runs": estado.runs.map((r) => ({ ...r })),
        "operador-tarefas": new Map(vinculos.map((v, i) => [v.kanban_task_id, { id: v.kanban_task_id, title: `Peça ${i}`, status: "doing", deleted_at: null }])),
        "operador-humanos": new Map(),
        "operador-tarefas-disponiveis": [],
        "execucao-pedidos": [],
      };
      return { data: linhas[chave] ?? [], isSuccess: true, isLoading: false, dataUpdatedAt: 1, error: null, refetch: vi.fn() };
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  estado.vinculos = 1;
  estado.runs = [];
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

function arvore(rota = "/execucao") {
  return <MemoryRouter initialEntries={[rota]}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AdminExecucao /></QueryClientProvider></MemoryRouter>;
}
const abaAberta = () => document.querySelector('nav[aria-label="Abas da Execução"] [aria-current="page"]')?.getAttribute("data-etapa");
const irParaTrabalho = () => fireEvent.click(document.querySelector('[data-etapa="trabalho"]') as HTMLElement);

describe("Trabalho: o cartão não remonta a cada releitura", () => {
  it("o 'ver mais' aberto continua aberto quando os dados chegam de novo", () => {
    const tela = render(arvore());
    irParaTrabalho();
    const lista = screen.getByRole("list", { name: "Tarefas dos agentes" });
    const detalhe = lista.querySelector("details") as HTMLDetailsElement;
    detalhe.open = true;
    // Releitura: a tela redesenha com objetos novos (o mock devolve listas novas a cada chamada).
    tela.rerender(arvore());
    tela.rerender(arvore());
    const depois = screen.getByRole("list", { name: "Tarefas dos agentes" }).querySelector("details") as HTMLDetailsElement;
    expect(depois).toBe(detalhe);
    expect(depois.open).toBe(true);
  });

  it("desenha um lote de cartões e o resto entra por 'Mostrar mais'", () => {
    estado.vinculos = 60;
    render(arvore());
    irParaTrabalho();
    const lista = () => document.querySelector('ul[aria-label="Tarefas dos agentes"]') as HTMLUListElement;
    expect(lista().querySelectorAll(":scope > li")).toHaveLength(48);
    // getByText e não getByRole: o cálculo de nome acessível do jsdom é lento com 60 cartões.
    fireEvent.click(screen.getByText("Mostrar mais 12 de 12"));
    expect(lista().querySelectorAll(":scope > li")).toHaveLength(60);
    expect(screen.queryByText(/Mostrar mais/)).not.toBeInTheDocument();
  });
});

describe("o link da notificação vale uma vez", () => {
  it("abrir pela execução (?run=) não puxa a tela de volta depois que a pessoa troca de aba", () => {
    estado.runs = [{ id: "run-1", operator_id: "op", run_key: "k", task_link_id: null, status: "done", started_at: "2026-10-26T12:00:00Z", heartbeat_at: "2026-10-26T12:00:00Z", detail: { title: "Rodada do link" } }];
    const tela = render(arvore("/execucao?run=run-1"));
    expect(abaAberta()).toBe("trabalho");
    fireEvent.click(document.querySelector('[data-etapa="decisoes"]') as HTMLElement);
    expect(abaAberta()).toBe("decisoes");
    tela.rerender(arvore("/execucao?run=run-1"));
    tela.rerender(arvore("/execucao?run=run-1"));
    expect(abaAberta()).toBe("decisoes");
  });
});

describe("Execuções: o detalhe só existe depois de aberto", () => {
  const run = (i: number) => ({ id: `r${i}`, operator_id: "o", run_key: `k${i}`, status: "review", heartbeat_at: "2026-10-26T12:00:00Z", detail: { title: `Rodada ${i}`, summary: "Página conferida", evidence: `aceleriq-file://00000000-0000-4000-8000-${String(i).padStart(12, "0")}` } });
  function montar(runs: Array<Record<string, unknown>>) {
    return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ExecucoesRecentes runs={runs} agentes={[{ id: "o", display_name: "Helena" }]} vinculos={[]} tarefas={new Map()} aoConversar={vi.fn()} /></QueryClientProvider>);
  }

  it("fechada não pede o arquivo da prova; aberta pede", async () => {
    const consulta = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { file_name: "prova.png", status: "ready", archived_at: null, storage_bucket: "files", storage_path: "x/prova.png" }, error: null }) };
    estado.from.mockImplementation(() => consulta);
    montar([run(1), run(2), run(3)]);
    expect(estado.from).not.toHaveBeenCalled();
    expect(screen.queryByText("Página conferida")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Rodada 2"));
    expect(screen.getByText("Página conferida")).toBeInTheDocument();
    await waitFor(() => expect(estado.from).toHaveBeenCalledWith("files"));
    expect(estado.from).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Rodada 2"));
    expect(screen.queryByText("Página conferida")).not.toBeInTheDocument();
  });

  it("cem execuções: desenha 40 e o resto por 'Mostrar mais'", () => {
    montar(Array.from({ length: 100 }, (_, i) => run(i)));
    expect(document.querySelectorAll("details")).toHaveLength(40);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar mais 40 de 60" }));
    expect(document.querySelectorAll("details")).toHaveLength(80);
  });
});

describe("a tarefa abre inteira e fecha com Esc", () => {
  it("lê a linha completa antes de abrir a janela e o Esc fecha", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "t1", title: "Título real", priority: "high", workstream: "trafego", status: "doing" }, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    estado.from.mockImplementation(() => ({ select }));
    const fechar = vi.fn();
    const desenhar = vi.fn((t: Record<string, any>) => <div role="dialog" aria-label={t.title}>{t.workstream}</div>);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TarefaDaExecucao tarefa={{ id: "t1", title: "linha enxuta do quadro" }} aoFechar={fechar} desenhar={desenhar} /></QueryClientProvider>);
    expect(screen.getByRole("status", { name: "Abrindo a tarefa" })).toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "Título real" })).toHaveTextContent("trafego");
    expect(estado.from).toHaveBeenCalledWith("tasks");
    expect(select).toHaveBeenCalledWith("*");
    expect(eq).toHaveBeenCalledWith("id", "t1");
    expect(desenhar).not.toHaveBeenCalledWith(expect.objectContaining({ title: "linha enxuta do quadro" }));
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(fechar).toHaveBeenCalledTimes(1);
  });

  it("a Execução abre a tarefa por aqui, e não direto com a linha do quadro", () => {
    const pagina = readFileSync(resolve(__dirname, "../..", "src/pages/AdminExecucao.tsx"), "utf8");
    expect(pagina).toContain("<TarefaDaExecucao");
    expect(pagina).toMatch(/desenhar=\{\(completa\) => \(\s*<TaskDetailDrawer\s*task=\{completa\}/);
  });
});

describe("leituras do quadro", () => {
  const pagina = readFileSync(resolve(__dirname, "../..", "src/pages/AdminExecucao.tsx"), "utf8");
  it("param enquanto a Central ou a Performance estão abertas e não relêem a cada 10 s", () => {
    expect(pagina).toContain('const quadroEmPausa = aba === "central" || aba === "performance";');
    expect(pagina).not.toContain("refetchInterval: 10_000");
    expect(pagina).toContain("refetchInterval: quadroEmPausa ? false : 15_000");
  });
  it("tarefas em lotes, com o mapa anterior na tela e o mesmo objeto para a tarefa que não mudou", () => {
    expect(pagina).toContain("i += LOTE_DE_IDS");
    expect(pagina).toContain("placeholderData: keepPreviousData");
    expect(pagina).toContain("structuralSharing: mesmoMapaDeTarefas");
  });
  it("o cartão é chamado como função (não vira um tipo novo a cada desenho)", () => {
    expect(pagina).not.toMatch(/<Cartao v=/);
    expect(pagina).not.toMatch(/<ListaDeCartoes (lista|pilha)/);
    expect(pagina).toContain("desenhar={(v) => Cartao({ v })}");
  });
});
