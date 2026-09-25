import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mês da Mesa só com peças (pedido do dono em 26/09): "dentro da Mesa, só
 * puxe o que é arte ou vídeo (carrossel, estático, Reels, o que vai gravar),
 * não planejamento; o resto fica na agenda". O formato vem de
 * tasks.delivery_type; um contador discreto leva o resto para a Agenda.
 */

const mock = vi.hoisted(() => ({ tabelas: {} as Record<string, unknown> }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "gte", "lt", "lte", "gt", "overlaps", "contains", "order", "limit", "range"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: vi.fn().mockResolvedValue({ data: {}, error: null }) },
      rpc: vi.fn(),
      from: (tabela: string) => consulta(tabela),
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/x.png" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import AgendaDoMes from "@/components/mesa/AgendaDoMes";
import { ehPeca, FORMATOS_DE_PECA, separarPecas } from "@/components/mesa/useAgendaDoMes";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const CLIENTE = "44444444-4444-4444-4444-444444444444";

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Cliente sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 50,
  catalogo: [],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(MemoryRouter, { initialEntries: ["/mesa?client=c&mes=2026-09-01"] },
      h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa() }, h(AgendaDoMes, {}))))),
  );
}

const tarefa = (id: string, title: string, delivery_type: string, due_date = "2026-09-15") => ({
  id, title, description: null, due_date, delivery_type, status: "todo", project_id: "proj",
});

beforeEach(() => {
  mock.tabelas = {};
  try {
    window.sessionStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("quais tarefas são peça", () => {
  it("arte e vídeo entram; planejamento, reunião, relatório, copy e sem formato ficam na Agenda", () => {
    for (const t of ["carousel", "static", "design", "reel", "story", "video", "short", "google_post"]) expect(ehPeca(t), t).toBe(true);
    for (const t of ["planning", "report", "copywriting", "document", "traffic", "website", "other", "unspecified", "", null]) expect(ehPeca(t), String(t)).toBe(false);
    expect(ehPeca("REEL")).toBe(true);
    expect(FORMATOS_DE_PECA.indexOf("planning")).toBe(-1);
    const { pecas, outros } = separarPecas([
      { delivery_type: "carousel" },
      { delivery_type: "planning" },
      { delivery_type: "reel" },
      { delivery_type: "report" },
    ]);
    expect(pecas.map((p) => p.delivery_type)).toEqual(["carousel", "reel"]);
    expect(outros).toBe(2);
  });
});

describe("a agenda do mês na Mesa", () => {
  it("mostra só as peças e diz quantas tarefas ficaram na Agenda, com o link", async () => {
    mock.tabelas.tasks = [
      tarefa("t1", "Carrossel das perguntas", "carousel"),
      tarefa("t2", "Reels do bastidor", "reel", "2026-09-16"),
      tarefa("t3", "Planejamento de outubro", "planning", "2026-09-16"),
      tarefa("t4", "Relatório mensal", "report", "2026-09-20"),
    ];
    const { container } = montar();
    await waitFor(() => expect(container.querySelector('[data-dia="2026-09-15"] [data-cartao="item"]')).toBeTruthy());
    const texto = container.textContent || "";
    expect(texto).toContain("Carrossel das perguntas");
    expect(texto).toContain("Reels do bastidor");
    expect(texto).not.toContain("Planejamento de outubro");
    expect(texto).not.toContain("Relatório mensal");
    const aviso = container.querySelector("[data-outros-tipos]") as HTMLElement;
    expect(aviso.getAttribute("data-outros-tipos")).toBe("2");
    expect(aviso.textContent).toContain("2 tarefas de outros tipos ficam na Agenda");
    expect((aviso.querySelector("a") as HTMLAnchorElement).getAttribute("href")).toBe(`/calendario?client=${CLIENTE}`);
    expect(texto).toContain("2 peças");
  });

  it("sem tarefa de outro tipo, nenhum aviso", async () => {
    mock.tabelas.tasks = [tarefa("t1", "Carrossel das perguntas", "carousel")];
    const { container } = montar();
    await waitFor(() => expect(container.querySelector('[data-dia="2026-09-15"] [data-cartao="item"]')).toBeTruthy());
    expect(container.querySelector("[data-outros-tipos]")).toBeNull();
  });

  it("o filtro é na tela: a leitura da Agenda e o filtro da marca continuam os mesmos", () => {
    const hook = ler("src/components/mesa/useAgendaDoMes.ts");
    expect(hook).toContain("...(filtro ? { select: daMarca } : {}),");
    const tela = ler("src/components/mesa/AgendaDoMes.tsx");
    expect(tela).toContain("separarPecas(dados ? dados.itens : [])");
    expect(tela).not.toMatch(/dados\.itens\.(map|length)/);
  });

  it("o diagnóstico do mês usa o componente recolhido, e não o textão", () => {
    const aba = ler("src/components/mesa/AbaMes.tsx");
    expect(aba).toContain("<DiagnosticoDoMes proposta={proposta} />");
    expect(aba).not.toContain("{proposta.diagnostico}</p>");
  });
});
