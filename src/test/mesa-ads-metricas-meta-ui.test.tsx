import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente ADM (01/10/2026): o bloco Números da Meta na Conta da Mesa Ads, com a resposta montada
 * pelas regras do servidor a partir das respostas REAIS da Meta da Stop Informática (fixtures).
 * A função é simulada: nada sai para a Meta nem para o banco.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mock.invoke }, rpc: vi.fn(), from: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import { TooltipProvider } from "@/components/ui/tooltip";
import MetricasDaMeta, { GraficoNoTempo } from "@/components/mesa-ads/MetricasDaMeta";
import { resolverPeriodo } from "@/components/mesa-ads/periodoDaConta";
import {
  classificacaoDosConjuntos,
  classificar,
  COLUNAS_DE_TODOS,
  faixasDoTempo,
  itemDaLinha,
  melhorHorario,
  METRICAS,
  OBJETIVOS,
  somarNumeros,
  totaisPorObjetivo,
} from "../../supabase/functions/mesa-ads/modulos/metricas-meta";

const pasta = resolve(__dirname, "fixtures/meta-insights");
const ler = (nome: string): Record<string, any>[] => JSON.parse(readFileSync(resolve(pasta, `${nome}.json`), "utf8")).data;
const CLIENTE = "6a847578-ba39-44cd-be61-08e34e18e4c9";

/** O que o servidor responde (as mesmas funções de lerMetricasDaConta), a partir das linhas reais. */
function respostaDasMetricas(nivel: string, objetivo: string | null) {
  const anuncios = ler("stop-anuncio-7d");
  const classes = classificacaoDosConjuntos(anuncios);
  const conjuntos = anuncios.map((l) => itemDaLinha("conjunto", l, classes)!);
  const base = conjuntos.filter((i) => !objetivo || i.objetivo === objetivo);
  const conta = ler("stop-conta-7d")[0];
  const total = somarNumeros(base.map((i) => ({ numeros: i.numeros, resultado: i.resultado })), Number(conta.reach));
  const linhas = nivel === "anuncio" ? anuncios : ler("stop-campanha-7d");
  return {
    fonte: "meta_ao_vivo",
    janela: "7 dias após o clique",
    periodo: { inicio: "2026-09-25", fim: "2026-10-01" },
    total: { numeros: total.numeros, resultado: total.resultado, resultado_rotulo: "Conversas iniciadas", misto: total.misto, por_resultado: [] },
    objetivos: totaisPorObjetivo(conjuntos),
    itens: nivel === "conta" ? [] : linhas.map((l) => itemDaLinha(nivel as any, l, classes)!).filter((i) => !objetivo || i.objetivo === objetivo),
    catalogo: METRICAS,
    definicoes_de_objetivo: OBJETIVOS,
    colunas_de_todos: COLUNAS_DE_TODOS,
    avisos: ["O período inclui hoje: a Meta ainda conta as conversas e os resultados de hoje, que podem subir nas próximas horas."],
    lido_em: new Date().toISOString(),
  };
}

function respostaDoTempo() {
  const classe = (l: Record<string, unknown>) => classificar(String(l.objective), String(l.optimization_goal));
  const h = faixasDoTempo(ler("stop-hora-30d"), "hora", classe);
  const d = faixasDoTempo(ler("stop-dia-30d"), "dia_da_semana", classe);
  return {
    fonte: "meta_ao_vivo",
    medida: { chave: "resultados", rotulo: "Conversas iniciadas" },
    hora: { faixas: h.faixas, melhor: melhorHorario(h.faixas, "resultados", "hora") },
    dia_da_semana: { faixas: d.faixas, melhor: melhorHorario(d.faixas, "resultados", "dia_da_semana") },
    avisos: [],
  };
}

const chamadas = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MetricasDaMeta, { clientId: CLIENTE, periodo: resolverPeriodo({ preset: "7" }, "2026-10-01"), rotuloDoPeriodo: "nos últimos 7 dias" }))));
}

beforeAll(() => {
  if (typeof (globalThis as any).ResizeObserver === "undefined") (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

beforeEach(() => {
  mock.invoke.mockReset();
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.invoke.mockImplementation(async (_f: string, { body }: any) => {
    if (body.acao === "metricas_meta") return { data: respostaDasMetricas(body.nivel, body.objetivo || null), error: null };
    if (body.acao === "metricas_por_hora") return { data: respostaDoTempo(), error: null };
    return { data: { ok: true }, error: null };
  });
});

describe("Números da Meta na Conta (Stop, 7 dias)", () => {
  it("mostra 2 Conversas iniciadas como resultado e nenhum 'Engajamentos' no lugar de mensagem", async () => {
    montar();
    const numeros = await screen.findByLabelText("Números do período");
    const conversas = numeros.querySelector('[data-metrica="conversas"]') as HTMLElement;
    expect(conversas).toBeTruthy();
    expect(within(conversas).getByText("Conversas iniciadas")).toBeTruthy();
    expect(within(conversas).getByText("2")).toBeTruthy();
    expect(screen.queryByText(/^Engajamentos?$/)).toBeNull();
    // Resultados por objetivo (Todos): só Mensagens, com o nome certo.
    const porObjetivo = screen.getByLabelText("Resultados por objetivo");
    expect(within(porObjetivo).getByText("Mensagens")).toBeTruthy();
    expect(porObjetivo.textContent).toMatch(/2 conversas iniciadas/);
    // A tabela de campanhas: cada linha com o resultado "Conversas iniciadas".
    const tabela = screen.getByRole("region", { name: "Tabela de números" });
    expect(within(tabela.querySelector("tbody") as HTMLElement).getAllByText("Conversas iniciadas").length).toBe(2);
    // O aviso de que hoje ainda está fechando.
    expect(screen.getByText(/O período inclui hoje/)).toBeTruthy();
    expect(chamadas("metricas_meta")[0]).toMatchObject({ client_id: CLIENTE, nivel: "campanha", dias: 7 });
  });

  it("escolher o objetivo pede à Meta só aquele objetivo e usa as colunas prontas dele", async () => {
    montar();
    await screen.findByLabelText("Resultados por objetivo");
    fireEvent.click(within(screen.getByLabelText("Resultados por objetivo")).getByText("Mensagens"));
    await waitFor(() => expect(chamadas("metricas_meta").some((c) => c.objetivo === "mensagens")).toBe(true));
    const numeros = await screen.findByLabelText("Números do período");
    await waitFor(() => expect(numeros.querySelector('[data-metrica="primeira_resposta"]')).toBeTruthy());
    expect(numeros.querySelector('[data-metrica="conexoes_mensagem"]')).toBeTruthy();
  });

  it("O que ver: desmarcar uma métrica tira o número e a escolha fica guardada para o cliente", async () => {
    const { unmount } = montar();
    const numeros = await screen.findByLabelText("Números do período");
    expect(numeros.querySelector('[data-metrica="gasto"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /O que ver/ }));
    const janela = await screen.findByRole("dialog");
    fireEvent.click(within(janela).getByRole("checkbox", { name: "Valor investido" }));
    await waitFor(() => expect(screen.getByLabelText("Números do período").querySelector('[data-metrica="gasto"]')).toBeNull());
    unmount();
    montar();
    const de_novo = await screen.findByLabelText("Números do período");
    expect(de_novo.querySelector('[data-metrica="gasto"]')).toBeNull();
    expect(de_novo.querySelector('[data-metrica="conversas"]')).toBeTruthy();
  });

  it("nível Anúncios: o anúncio sem conversa mostra 0 conversa, não engajamento", async () => {
    montar();
    await screen.findByLabelText("Números do período");
    fireEvent.click(screen.getByRole("button", { name: /Nível/ }));
    fireEvent.click(await screen.findByRole("option", { name: /Anúncios/ }).catch(() => screen.getByText("Anúncios")));
    await waitFor(() => expect(chamadas("metricas_meta").some((c) => c.nivel === "anuncio")).toBe(true));
    const tabela = await screen.findByRole("region", { name: "Tabela de números" });
    await waitFor(() => expect(within(tabela.querySelector("tbody") as HTMLElement).getAllByText("Conversas iniciadas").length).toBe(3));
    const linhas = Array.prototype.slice.call(tabela.querySelectorAll("tbody tr")) as HTMLElement[];
    expect(linhas.some((tr) => /Limpeza preventiva/.test(tr.textContent || "") && /Conversas iniciadas/.test(tr.textContent || ""))).toBe(true);
  });

  it("por horário: 24 barras, o melhor horário e a tabela", async () => {
    montar();
    const grafico = await screen.findByRole("img", { name: /Conversas iniciadas por hora do dia/ });
    expect(grafico.querySelectorAll("[data-faixa]").length).toBe(24);
    // A Stop teve poucas conversas no mês: o painel não inventa um "melhor horário".
    expect(document.querySelector('[data-pouco-volume="sim"]')).toBeTruthy();
    expect(screen.queryByText(/Melhor hora:/)).toBeNull();
    expect(chamadas("metricas_por_hora")[0]).toMatchObject({ client_id: CLIENTE, dias: 7 });
  });

  it("com volume, aponta a melhor hora e as 3 horas mais fortes, em destaque no gráfico", () => {
    const faixas = Array.from({ length: 24 }, (_, i) => ({ indice: i, rotulo: `${String(i).padStart(2, "0")}h`, gasto: 10, impressoes: 100, cliques_link: 1, conversas: i >= 18 && i <= 20 ? 6 - (i - 18) : i === 9 ? 1 : 0, leads: 0, compras: 0, resultados: null, custo_por_resultado: null }));
    const melhor = melhorHorario(faixas as any, "conversas", "hora");
    render(h(GraficoNoTempo, { faixas: faixas as any, melhor, chave: "conversas", rotuloDaMedida: "Conversas iniciadas", modo: "hora" }));
    expect(screen.getByText("Melhor hora: 18h")).toBeTruthy();
    expect(screen.getByText("das 18h às 21h")).toBeTruthy();
    const barras = Array.prototype.slice.call(document.querySelectorAll("[data-faixa]")) as HTMLElement[];
    const fortes = barras.filter((b) => (b.firstElementChild as HTMLElement).className.indexOf("bg-primary/35") < 0).map((b) => b.getAttribute("data-faixa"));
    expect(fortes).toEqual(["18", "19", "20"]);
  });
});
