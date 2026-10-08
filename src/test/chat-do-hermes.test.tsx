import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Chat do Hermes ao lado do Gestor: sem ponte, a tela diz isso (nada
 * simulado); com ponte, o envio leva o contexto e o balão ao vivo mostra o
 * texto parcial do turno; sessão só de leitura oferece continuar; o diário da
 * coordenação escolhe o vínculo por busca (cliente, agente e título curto).
 */

const m = vi.hoisted(() => ({ chamar: vi.fn(), tabelas: {} as Record<string, unknown[]> }));

vi.mock("@/lib/mesa/api", async (orig) => ({ ...(await orig<typeof import("@/lib/mesa/api")>()), chamarFuncao: m.chamar }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u1" } }) }));
vi.mock("@/integrations/supabase/client", () => {
  // Cada tabela resolve com o que o teste deixou em m.tabelas (qualquer filtro passa).
  const cadeia = (tabela: string): any => {
    const c: any = new Proxy(function () {}, {
      get: (_t, k) => (k === "then" ? (ok: (v: unknown) => void) => ok({ data: m.tabelas[tabela] || [], count: 0, error: null }) : c),
      apply: () => c,
    });
    return c;
  };
  return { supabase: { from: (t: string) => cadeia(t), rpc: () => cadeia("rpc"), functions: { invoke: vi.fn() } } };
});

import ChatDoHermes from "@/components/execucao/central/ChatDoHermes";
import DiarioDaCoordenacao, { tituloCurto } from "@/components/execucao/central/DiarioDaCoordenacao";

beforeAll(() => {
  if (!(globalThis as any).ResizeObserver) {
    (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => {};
});

const contexto = { cliente: { id: "39ebda82", nome: "Acerbi" }, projeto: { id: "p1", nome: "Institucional" } };

function montar(no: JSX.Element) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter>{no}</MemoryRouter></QueryClientProvider>);
}

const sessao = (x: Partial<Record<string, unknown>> = {}) => ({
  id: "s1", titulo: "Acerbi outubro", origem: "desktop", iniciada_em: 1759900000, ultima_atividade: 1759910000,
  mensagens: 2, ferramentas: 1, pode_enviar: true, ocupada: false, ...x,
});

function ponteLigada(opcoes: { sessao?: ReturnType<typeof sessao>; turno?: Record<string, unknown> } = {}) {
  const s = opcoes.sessao || sessao();
  m.chamar.mockImplementation(async (_f: string, corpo: { acao: string }) => {
    switch (corpo.acao) {
      case "hermes_estado": return { configurada: true, ok: true };
      case "hermes_sessoes": return { sessoes: [sessao({ id: "s0", titulo: "Antiga", ultima_atividade: 1700000000 }), s] };
      case "hermes_sessao": return { sessao: s, mensagens: [
        { id: 1, papel: "user", texto: "Como está a Acerbi?", ferramenta: null, chamadas: [], quando: 1759909000 },
        { id: 2, papel: "tool", texto: "{\"resultado\":\"interno\"}", ferramenta: "delegate_task", chamadas: [], quando: 1759909001 },
        { id: 3, papel: "assistant", texto: "Pedi ao Atlas para conferir as publicações.", ferramenta: null, chamadas: ["delegate_task"], quando: 1759909002 },
      ] };
      case "hermes_enviar": return { aceito: true, desde: 1759910100 };
      case "hermes_estado_da_sessao": return opcoes.turno || { ocupada: true, desde: 1759910100, fim: null, erro: null, parcial: "Estou lendo o briefing da Acerbi", ferramentas: [{ nome: "delegate_task", estado: "rodando", resumo: "Atlas", desde: 1759910101 }], comentarios: ["Chamando o Atlas"], aguardando_aprovacao: true };
      case "hermes_continuar": return { sessao: sessao({ id: "s2", titulo: "Acerbi outubro (continuação)", origem: "api_server" }) };
      default: return {};
    }
  });
}

describe("Chat do Hermes", () => {
  beforeEach(() => {
    window.localStorage.clear();
    m.chamar.mockReset();
  });

  it("sem a ponte: avisa com o erro, oferece o diário e não mostra o campo de mensagem", async () => {
    m.chamar.mockImplementation(async (_f: string, corpo: { acao: string }) => (corpo.acao === "hermes_estado" ? { configurada: true, ok: false, erro: "hermes_fora" } : {}));
    const aoAbrirDiario = vi.fn();
    montar(<ChatDoHermes contexto={contexto} aoAbrirDiario={aoAbrirDiario} />);
    expect(await screen.findByText("A ponte com o Hermes não respondeu agora.")).toBeTruthy();
    expect(screen.getByText("hermes_fora")).toBeTruthy();
    expect(screen.queryByLabelText("Mensagem para o Hermes")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir o diário da coordenação" }));
    expect(aoAbrirDiario).toHaveBeenCalledTimes(1);
    expect(m.chamar.mock.calls.every((c) => c[1].acao === "hermes_estado")).toBe(true);
  });

  it("abre a conversa mais recente, envia com o contexto e mostra o texto parcial do turno ao vivo", async () => {
    ponteLigada();
    montar(<ChatDoHermes contexto={contexto} />);
    expect(await screen.findByText("Pedi ao Atlas para conferir as publicações.")).toBeTruthy();
    expect(m.chamar).toHaveBeenCalledWith("gestor-aceleriq", { acao: "hermes_sessao", sessao_id: "s1" });
    // Mensagem de ferramenta fica escondida; a chamada aparece como etiqueta.
    expect(screen.queryByText(/resultado/)).toBeNull();
    expect(screen.getByText("usou delegate_task")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Levar contexto: Acerbi · Institucional" }).getAttribute("aria-pressed")).toBe("true");

    const campo = screen.getByLabelText("Mensagem para o Hermes");
    fireEvent.change(campo, { target: { value: "Prepare o relatório da semana" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await waitFor(() => expect(m.chamar).toHaveBeenCalledWith("gestor-aceleriq", {
      acao: "hermes_enviar", sessao_id: "s1", texto: "Prepare o relatório da semana",
      contexto: { cliente: contexto.cliente, projeto: contexto.projeto },
    }));
    expect(await screen.findByText("Estou lendo o briefing da Acerbi")).toBeTruthy();
    expect(screen.getByText("Prepare o relatório da semana")).toBeTruthy();
    const ferramentas = screen.getByLabelText("Ferramentas do turno");
    expect(within(ferramentas).getByText("delegate_task")).toBeTruthy();
    expect(screen.getByText("Chamando o Atlas")).toBeTruthy();
    expect(screen.getByText(/aprove no app do Hermes/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Enviar ao Hermes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(window.localStorage.length).toBeGreaterThan(0);
  });

  it("sem levar o contexto: a mensagem vai sem cliente e projeto", async () => {
    ponteLigada();
    montar(<ChatDoHermes contexto={contexto} />);
    await screen.findByText("Pedi ao Atlas para conferir as publicações.");
    fireEvent.click(screen.getByRole("button", { name: "Levar contexto: Acerbi · Institucional" }));
    fireEvent.change(screen.getByLabelText("Mensagem para o Hermes"), { target: { value: "Oi" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao Hermes" }));
    await waitFor(() => expect(m.chamar).toHaveBeenCalledWith("gestor-aceleriq", { acao: "hermes_enviar", sessao_id: "s1", texto: "Oi" }));
  });

  it("arquivo de texto anexado vai junto da mensagem; tipo que o Hermes não lê é recusado", async () => {
    ponteLigada();
    montar(<ChatDoHermes contexto={{ cliente: null, projeto: null }} />);
    await screen.findByText("Pedi ao Atlas para conferir as publicações.");
    const entrada = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(entrada, { target: { files: [new File(["Ata: 2 vídeos para sexta."], "ata.md", { type: "" }), new File([new Uint8Array(10)], "planilha.xlsx", { type: "application/vnd.ms-excel" })] } });
    expect(await screen.findByText("ata.md")).toBeTruthy();
    expect(screen.queryByText("planilha.xlsx")).toBeNull();
    fireEvent.change(screen.getByLabelText("Mensagem para o Hermes"), { target: { value: "Resuma" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao Hermes" }));
    await waitFor(() => expect(m.chamar).toHaveBeenCalledWith("gestor-aceleriq", expect.objectContaining({ acao: "hermes_enviar", texto: "Resuma\n\n[Arquivo ata.md]\nAta: 2 vídeos para sexta." })));
  });

  it("sessão só de leitura: no lugar do campo, continuar cria a cópia e abre", async () => {
    ponteLigada({ sessao: sessao({ pode_enviar: false }) });
    window.localStorage.clear();
    montar(<ChatDoHermes contexto={contexto} />);
    const continuar = await screen.findByRole("button", { name: "Continuar esta conversa aqui" });
    expect(screen.queryByLabelText("Mensagem para o Hermes")).toBeNull();
    fireEvent.click(continuar);
    await waitFor(() => expect(m.chamar).toHaveBeenCalledWith("gestor-aceleriq", { acao: "hermes_continuar", sessao_id: "s1" }));
    await waitFor(() => expect(m.chamar).toHaveBeenCalledWith("gestor-aceleriq", { acao: "hermes_sessao", sessao_id: "s2" }));
  });

  it("fim do turno com erro: avisa e relê a conversa", async () => {
    ponteLigada({ sessao: sessao({ ocupada: true }), turno: { ocupada: false, desde: 1, fim: 2, erro: "limite de passos", parcial: "", ferramentas: [], comentarios: [], aguardando_aprovacao: false } });
    const { toast } = await import("sonner");
    const erro = vi.spyOn(toast, "error");
    montar(<ChatDoHermes contexto={contexto} />);
    await waitFor(() => expect(erro).toHaveBeenCalledWith("O turno do Hermes falhou: limite de passos"));
    erro.mockRestore();
  });
});

describe("Diário da coordenação", () => {
  beforeEach(() => {
    m.chamar.mockReset();
    m.tabelas = {
      internal_operators: [{ id: "op-aug", slug: "augusto", display_name: "Augusto", is_coordinator: true }],
      operator_task_links: [
        { id: "v1", status: "blocked", updated_at: "2026-10-08T10:00:00Z", operator_id: "op-aug", kanban_task_id: "t1" },
        { id: "v2", status: "in_progress", updated_at: "2026-10-08T09:00:00Z", operator_id: "op-aug", kanban_task_id: "t2" },
      ],
      tasks: [
        { id: "t1", title: "Conciliar as publicações confirmadas de setembro com o relatório mensal do cliente", status: "doing", project: { client: { company_name: "Acerbi", full_name: null } } },
        { id: "t2", title: "Roteiro do vídeo da palestra", status: "todo", project: { client: { company_name: null, full_name: "Verzelo Jardins" } } },
      ],
      operator_participations: [],
    };
  });

  it("o seletor lista cliente, agente e título curto, filtra pela busca e mostra o detalhe só do escolhido", async () => {
    montar(<DiarioDaCoordenacao contexto={contexto} />);
    const gatilho = await screen.findByRole("button", { name: "Conversa da coordenação" });
    // Fechado: o detalhe completo do escolhido (o primeiro) aparece no cartão.
    const detalhe = screen.getByLabelText("Detalhe da conversa escolhida");
    expect(within(detalhe).getByText("Conciliar as publicações confirmadas de setembro com o relatório mensal do cliente")).toBeTruthy();
    expect(within(detalhe).getByText("Bloqueado")).toBeTruthy();

    fireEvent.click(gatilho);
    const opcoes = await screen.findAllByRole("option");
    expect(opcoes).toHaveLength(2);
    expect(opcoes[0].textContent).toContain("Acerbi");
    expect(opcoes[0].textContent).toContain("Augusto");
    // Título curto (até 48 caracteres), sem o texto inteiro na linha.
    const curto = tituloCurto("Conciliar as publicações confirmadas de setembro com o relatório mensal do cliente");
    expect(curto.length).toBeLessThanOrEqual(48);
    expect(curto.endsWith("…")).toBe(true);
    expect(opcoes[0].textContent).toContain(curto);
    expect(opcoes[0].textContent).not.toContain("relatório mensal");
    expect(opcoes[1].textContent).toContain("Verzelo Jardins");

    fireEvent.change(screen.getByLabelText("Buscar conversa da coordenação"), { target: { value: "verzelo" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    fireEvent.click(screen.getByRole("option"));
    await waitFor(() => expect(within(screen.getByLabelText("Detalhe da conversa escolhida")).getByText("Roteiro do vídeo da palestra")).toBeTruthy());
    expect(within(screen.getByLabelText("Detalhe da conversa escolhida")).getByText("Em andamento")).toBeTruthy();
  });
});
