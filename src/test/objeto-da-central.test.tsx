import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Objeto aberto na Central (08/10/2026): o painel nativo lê com a sessão de
 * quem está logado, não oferece "Concluída" na troca de status da tarefa,
 * aprova só depois do segundo clique e pelo mecanismo oficial, e resolve o
 * link do arquivo só pelo resolveFileUrl.
 */

const m = vi.hoisted(() => ({
  linhas: {} as Record<string, unknown>,
  updates: [] as Array<{ tabela: string; patch: unknown }>,
  rpc: vi.fn(),
  resolver: vi.fn(),
  sync: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  // Cadeia do PostgREST: a resposta vem da tabela (m.linhas[tabela]).
  // maybeSingle devolve a primeira linha; o await direto devolve a lista.
  function cadeia(tabela: string) {
    const valor = () => m.linhas[tabela];
    const lista = () => { const v = valor(); return Array.isArray(v) ? v : v ? [v] : []; };
    const c: any = {
      maybeSingle: async () => ({ data: (Array.isArray(valor()) ? lista()[0] : valor()) ?? null, error: null }),
      single: async () => ({ data: lista()[0] ?? null, error: null }),
      update: (patch: unknown) => { m.updates.push({ tabela, patch }); return c; },
      then: (ok: (v: unknown) => void) => ok({ data: lista(), error: null }),
    };
    for (const k of ["select", "eq", "neq", "is", "in", "not", "order", "limit", "range"]) c[k] = () => c;
    return c;
  }
  return { supabase: { from: (t: string) => cadeia(t), rpc: (...args: unknown[]) => m.rpc(...args) } };
});
vi.mock("@/lib/fileUrls", async (orig) => ({ ...(await orig<typeof import("@/lib/fileUrls")>()), resolveFileUrl: m.resolver }));
vi.mock("@/lib/requestTaskWorkflow", () => ({ syncClientRequestStatusForTask: m.sync }));

import ObjetoDaCentral, { type ObjetoAberto } from "@/components/execucao/central/ObjetoDaCentral";

function montar(objeto: ObjetoAberto, extra: Partial<Parameters<typeof ObjetoDaCentral>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const aoFechar = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <ObjetoDaCentral objeto={objeto} aoFechar={aoFechar} {...extra} />
    </QueryClientProvider>,
  );
  return { qc, aoFechar };
}

const aprovacaoBase = {
  id: "ap1", o_que: "Enviar o resumo da semana", por_que: "Fechamento do ciclo", status: "pendente",
  action_kind: "enviar_mensagem", payload_version: 3, payload_hash: "hash-3", client_id: "c1",
  valid_until: null, created_at: "2026-10-08T12:00:00Z", decided_at: null, decision_note: null,
  executed_at: null, task_link_id: null, client: { company_name: "Acerbi" },
};

beforeEach(() => {
  m.linhas = {};
  m.updates = [];
  m.rpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  m.resolver.mockReset();
  m.sync.mockReset().mockResolvedValue({ synced: false });
});

describe("ObjetoDaCentral: tarefa", () => {
  it("mostra título e status e a troca de status não oferece Concluída", async () => {
    m.linhas.tasks = {
      id: "t1", title: "Roteiro do reel de outubro", status: "doing", priority: "high", due_date: "2026-10-10",
      description: "Detalhes do roteiro", deleted_at: null, project_id: "p1", source: null,
      project: { id: "p1", name: "Conteúdo mensal", client_id: "c1", client: { company_name: "Acerbi" } },
    };
    m.linhas.operator_task_links = [];
    const aoAbrirFerramenta = vi.fn();
    montar({ tipo: "tarefa", id: "t1" }, { aoAbrirFerramenta });

    expect(await screen.findByText("Roteiro do reel de outubro", { selector: "p.text-\\[15px\\]" })).toBeInTheDocument();
    expect(screen.getAllByText("Em andamento").length).toBeGreaterThan(0);
    expect(screen.getByText("10/10/2026")).toBeInTheDocument();
    expect(screen.getByText("Conteúdo mensal · Acerbi")).toBeInTheDocument();

    const select = screen.getByLabelText("Status da tarefa") as HTMLSelectElement;
    const valores = Array.from(select.options).map((o) => o.value);
    expect(valores).toEqual(["backlog", "todo", "doing", "review"]);
    expect(valores).not.toContain("done");
    expect(within(select).queryByText("Concluída")).toBeNull();

    fireEvent.change(select, { target: { value: "review" } });
    await waitFor(() => expect(m.updates).toContainEqual({ tabela: "tasks", patch: { status: "review", kanban_status: "review" } }));

    fireEvent.click(screen.getByRole("button", { name: /Abrir no Kanban/ }));
    expect(aoAbrirFerramenta).toHaveBeenCalledWith("/kanban?task=t1", "Kanban");
  });

  it("tarefa concluída ou na lixeira não oferece troca de status", async () => {
    m.linhas.tasks = { id: "t2", title: "Entregue", status: "done", priority: "low", due_date: null, description: null, deleted_at: "2026-10-01T00:00:00Z", project_id: "p1", source: null, project: null };
    montar({ tipo: "tarefa", id: "t2" });
    expect(await screen.findByText("Na lixeira")).toBeInTheDocument();
    expect(screen.queryByLabelText("Status da tarefa")).toBeNull();
  });

  it("item ausente (apagado ou sem acesso) mostra o aviso curto", async () => {
    m.linhas.tasks = null;
    montar({ tipo: "tarefa", id: "sumiu" });
    expect(await screen.findByText("Não encontrei este item (pode ter sido apagado ou você não tem acesso).")).toBeInTheDocument();
  });
});

describe("ObjetoDaCentral: aprovação", () => {
  it("aprovação da Central só chama central_review_decide depois de Confirmar aprovação", async () => {
    m.linhas.operator_approvals = {
      ...aprovacaoBase, origin: "central", report_id: "r1",
      payload: { report: { id: "r1", client_id: "c1", title: "Resumo semanal", summary: "Semana fechada com 3 entregas.", next_steps: "Aprovar a pauta de novembro.", created_at: "2026-10-08T12:00:00Z" }, destination: { channel: "portal", recipient: "Acerbi" } },
    };
    montar({ tipo: "aprovacao", id: "ap1" });

    expect(await screen.findByText("Semana fechada com 3 entregas.")).toBeInTheDocument();
    expect(screen.getByText("Aprovar a pauta de novembro.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Aprovar" }));
    expect(m.rpc).not.toHaveBeenCalled();
    expect(screen.getByText("Aprovar registra a decisão nesta versão. Enviar ou publicar é uma etapa à parte.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Confirmar aprovação/ }));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1));
    const [nome, args] = m.rpc.mock.calls[0];
    expect(nome).toBe("central_review_decide");
    expect(args).toMatchObject({
      _approval_id: "ap1", _expected_client_id: "c1", _expected_version: 3, _expected_payload_hash: "hash-3",
      _decision: "aprovado", _comment: null,
    });
    expect(typeof args._idempotency_key).toBe("string");
  });

  it("aprovação de agente usa operator_approval_decidir e rejeitar exige comentário", async () => {
    m.linhas.operator_approvals = { ...aprovacaoBase, origin: "agente", report_id: null, payload: { como_medir: "cliques" } };
    montar({ tipo: "aprovacao", id: "ap1" });
    await screen.findByText("Enviar o resumo da semana", { selector: "p.text-\\[15px\\]" });

    fireEvent.click(screen.getByRole("button", { name: "Rejeitar" }));
    expect(m.rpc).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Aprovar" }));
    expect(m.rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Confirmar aprovação/ }));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith("operator_approval_decidir", { _approval_id: "ap1", _decisao: "aprovado", _nota: null }));
  });

  it("aprovação já decidida não mostra os botões de decisão", async () => {
    m.linhas.operator_approvals = { ...aprovacaoBase, origin: "agente", status: "aprovado", payload: {} };
    montar({ tipo: "aprovacao", id: "ap1" });
    expect(await screen.findByText("Aprovada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aprovar" })).toBeNull();
  });
});

describe("ObjetoDaCentral: arquivo", () => {
  it("resolve o link pelo resolveFileUrl e mostra a imagem assinada", async () => {
    m.linhas.files = {
      id: "f1", file_name: "capa.png", mime_type: "image/png", file_type: "image", extension: "png", size_bytes: 2048,
      file_url: "workspace://client/c1/x.png", storage_bucket: "workspace", storage_path: "client/c1/x.png",
      client_id: "c1", created_at: "2026-10-08T12:00:00Z", archived_at: null,
    };
    m.resolver.mockResolvedValue("https://assinado.example/capa.png?token=1");
    const aoAbrirFerramenta = vi.fn();
    montar({ tipo: "arquivo", id: "f1" }, { aoAbrirFerramenta });

    const img = await screen.findByRole("img", { name: "capa.png" });
    expect(img).toHaveAttribute("src", "https://assinado.example/capa.png?token=1");
    expect(m.resolver).toHaveBeenCalledWith({ fileUrl: "workspace://client/c1/x.png", storageBucket: "workspace", storagePath: "client/c1/x.png" });
    expect(screen.getByText("2 KB")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Abrir no Workspace/ }));
    expect(aoAbrirFerramenta).toHaveBeenCalledWith("/workspace?client=c1", "Workspace");
  });
});

describe("ObjetoDaCentral: cabeçalho e projeto", () => {
  it("fechar chama aoFechar e a tarefa aberta pelo projeto volta com Voltar", async () => {
    m.linhas.projects = { id: "p1", name: "Conteúdo mensal", status: "active", client_id: "c1", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", deleted_at: null, client: { company_name: "Acerbi" } };
    m.linhas.tasks = [
      { id: "t1", title: "Roteiro", status: "doing", due_date: null, updated_at: "2026-10-08T00:00:00Z", priority: "medium", description: null, deleted_at: null, project_id: "p1", source: null, project: null },
      { id: "t2", title: "Arte", status: "todo", due_date: null, updated_at: "2026-10-07T00:00:00Z" },
    ];
    m.linhas.operator_task_links = [];
    const aoAbrirFerramenta = vi.fn();
    const { aoFechar } = montar({ tipo: "projeto", id: "p1" }, { aoAbrirFerramenta });

    expect(await screen.findByRole("button", { name: /Arte/ })).toBeInTheDocument();
    expect(screen.getByText("Conteúdo mensal", { selector: "p" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Roteiro/ }));
    expect(await screen.findByLabelText("Status da tarefa")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Voltar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Kanban do projeto/ }));
    expect(aoAbrirFerramenta).toHaveBeenCalledWith("/kanban?client=c1&project=p1", "Kanban");

    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(aoFechar).toHaveBeenCalled();
  });
});
