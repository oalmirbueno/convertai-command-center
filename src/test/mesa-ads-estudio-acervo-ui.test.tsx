import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Estúdio Ads mais limpo e o acervo (frente AD4, pedido do dono em 28/09):
 * "Todos entregues" vira selo (sem o filtro gigante), um primário no topo, o
 * resto no "...", Resultado e prévias recolhidos sem caixa, a vista Acervo por
 * ângulo e formato, e o "Enviar para a conta" em dois cliques (status pronto).
 * A função e as tabelas são simuladas.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  tabelas: {} as Record<string, unknown>,
  updates: [] as { tabela: string; valor: Record<string, unknown>; eq: unknown[] }[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    let atual: { tabela: string; valor: Record<string, unknown>; eq: unknown[] } | null = null;
    for (const m of ["select", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "insert"]) b[m] = () => b;
    b.eq = (...args: unknown[]) => {
      if (atual) atual.eq.push(args);
      return b;
    };
    b.update = (valor: Record<string, unknown>) => {
      atual = { tabela, valor, eq: [] };
      mock.updates.push(atual);
      return b;
    };
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null, count: Array.isArray(dados) ? dados.length : 0 }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: mock.rpc,
      from: (tabela: string) => consulta(tabela),
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
// A arte no motor do Estúdio é de outra frente e tem testes próprios: aqui só o lugar dela.
vi.mock("@/components/mesa-ads/ArteDoCriativo", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return { ...real, default: () => h("div", { "data-arte-falsa": "" }, "arte") };
});

vi.mock("@/components/mesa-ads/VideoDoCriativo", () => ({ default: () => h("div", null, "Bancada de vídeo") }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import AbaEstudioAds, { TODOS_NA_SITUACAO } from "@/components/mesa-ads/AbaEstudioAds";
import { CartaoDasAcoes } from "@/components/mesa-ads/AcoesDoAgente";
import { itemTemDesfazer, normalizarAcoesDaConta } from "@/components/mesa-ads/acoesDoAgenteApi";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const PLANO = "22222222-2222-2222-2222-222222222222";

const valor = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Verzelo Sintética",
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

const trabalho = (id: string) => ({
  id,
  client_id: CLIENTE,
  tipo: "ads",
  status: "entregue",
  direcao: { cards: [{ ordem: 1, texto_exato: "Árvore perto do telhado?" }] },
  cards: [{ ordem: 1, versao: 1, storage_path: `${CLIENTE}/arte-${id}.png` }],
});

const criativo = (id: string, formato: string, extra: Record<string, unknown> = {}) => ({
  id,
  client_id: CLIENTE,
  plano_id: PLANO,
  angulo_id: "a1",
  trabalho_id: `t-${id}`,
  nome: `Árvore perto do telhado | V1 | ${formato}`,
  formato,
  copy: { texto_principal: "Mande uma foto no Direct.", titulo: "Árvore perto do telhado?" },
  status: "rascunho",
  ad_id: null,
  evidencia: "E0",
  criado_em: "2026-09-25T12:00:00Z",
  atualizado_em: "2026-09-25T12:00:00Z",
  ...extra,
});

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valor(), children: h(AbaEstudioAds, { criativoId: null, onCriativo: vi.fn(), planoId: null }) }))),
  );
}

beforeAll(() => {
  if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mock.updates = [];
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.tabelas = {
    ads_criativos: [criativo("c-1", "quadrado_1x1"), criativo("c-2", "stories_9x16")],
    ads_planos: [
      {
        id: PLANO,
        client_id: CLIENTE,
        nome: "Teste de conceitos",
        status: "em_teste",
        angulos: [{ id: "a1", nome: "Árvore perto do telhado", formatos: ["quadrado_1x1", "stories_9x16"], hipotese: "Foto no Direct", corte: { metrica: "Conversas", texto: "R$ 30 por conversa", limite_brl: 30, impressoes_minimas: 1000, gasto_sem_resultado_brl: 60 } }],
        estrutura: {},
        criado_em: "2026-09-25T12:00:00Z",
        atualizado_em: "2026-09-25T12:00:00Z",
      },
    ],
    estudio_trabalhos: [trabalho("t-c-1"), trabalho("t-c-2")],
    ads_creatives: [],
  };
  mock.rpc.mockResolvedValue({ data: null, error: null });
  mock.invoke.mockImplementation(async () => ({ data: { ok: true, custo_usd: 0 }, error: null }));
});

describe("Estúdio Ads mais limpo (AD4)", () => {
  it("no vídeo separa estados reais e filtros das artes entregues", async () => {
    mock.tabelas.video_pedidos = [{ id: "p1", client_id: CLIENTE, estado: "pronto", parametros: { ads_criativo_id: "c-1" }, criado_em: "2026-10-06" }];
    mock.tabelas.video_arquivos = [{ id: "v1", client_id: CLIENTE, pedido_id: "p1", estado: "ativo", mime: "video/mp4", storage_path: "video.mp4", criado_em: "2026-10-06" }];
    montar();
    await screen.findByText(TODOS_NA_SITUACAO.entregue);
    fireEvent.click(screen.getByRole("button", { name: "Vídeo", exact: true }));
    await screen.findByText("Bancada de vídeo");
    const coluna = screen.getByRole("complementary", { name: "Criativos de vídeo" });
    expect(within(coluna).queryByText("Entregue")).toBeNull();
    expect(within(coluna).getByText(/Para revisar.*1 versão/)).toBeInTheDocument();
    expect(within(coluna).getByText(/Para criar.*sem vídeo/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Situação dos vídeos: Todos (2)" }));
    fireEvent.click(screen.getByRole("option", { name: "Para criar (1)" }));
    expect(within(coluna).queryByText(/Para revisar.*1 versão/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Arte", exact: true }));
    expect(await screen.findByText(TODOS_NA_SITUACAO.entregue)).toBeInTheDocument();
  });
  it("todos entregues: selo compacto na linha de estado, sem o filtro; um primário (Enviar para a conta) e o resto no ...", async () => {
    montar();
    const linha = await screen.findByText(TODOS_NA_SITUACAO.entregue);
    expect(linha.getAttribute("data-selo-da-situacao")).toBe("entregue");
    expect(screen.queryByRole("button", { name: /Filtrar por situação/ })).toBeNull();
    expect(screen.queryByText(/^Todos \(2\)$/)).toBeNull();
    // Gerar todos não aparece sem lâmina pendente; o secundário mora no "...".
    expect(screen.queryByRole("button", { name: /Gerar todos/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Importar pacote no Estúdio Ads/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mais ações do Estúdio Ads" }));
    expect(screen.getByRole("button", { name: /Importar pacote no Estúdio Ads/ })).toBeTruthy();

    // Resultado e prévias recolhidos, sem caixa, com o resumo numa linha.
    const resultado = screen.getByRole("region", { name: "Resultado do criativo" });
    expect(within(resultado).getByText("Sem anúncio ligado · corte: R$ 30 por conversa")).toBeTruthy();
    expect(resultado.className).not.toMatch(/rounded|border|bg-card/);
    const previas = document.querySelector("[data-posicionamentos]") as HTMLElement;
    expect(previas.className).not.toMatch(/bg-card|rounded/);
    expect(within(previas).getByText("Feed, Stories e Reels em tamanho de celular")).toBeTruthy();
  });

  it("Enviar para a conta pede o segundo clique e grava o status pronto (na conta) de cada criativo entregue", async () => {
    montar();
    const botao = await screen.findByRole("button", { name: /Enviar para a conta \(2\)/ });
    fireEvent.click(botao);
    expect(mock.updates).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Confirmar: 2 para a conta/ }));
    await waitFor(() => expect(mock.updates.filter((u) => u.tabela === "ads_criativos")).toHaveLength(2));
    expect(mock.updates.map((u) => [u.valor, u.eq[0]])).toEqual([
      [{ status: "pronto" }, ["id", "c-1"]],
      [{ status: "pronto" }, ["id", "c-2"]],
    ]);
  });

  it("vista Acervo: ângulo com os formatos, a copy, o kit de recepção e o enviar do ângulo", async () => {
    montar();
    await screen.findByText(TODOS_NA_SITUACAO.entregue);
    fireEvent.click(screen.getByRole("tab", { name: "Acervo" }));
    const acervo = await screen.findByRole("region", { name: "Ângulo Árvore perto do telhado" });
    expect(within(acervo).getByText(/Teste de conceitos · 2 formatos · 2 com copy/)).toBeTruthy();
    expect(within(acervo).getAllByText("Mande uma foto no Direct.")).toHaveLength(2);
    expect(within(acervo).getByRole("region", { name: "Kit de recepção: Árvore perto do telhado" })).toBeTruthy();
    expect(within(acervo).getByRole("button", { name: /Enviar para a conta/ })).toBeTruthy();
  });
});

describe("cartão da troca do Otimizar (AD4)", () => {
  const anexo = {
    tipo: "acoes_conta",
    resumo: "1 troca pronta para você confirmar.",
    itens: [
      {
        id: "i1",
        tipo: "trocar_anuncio",
        na_meta: true,
        alvo: { ref: "n1", nivel: "anuncio", meta_id: "140000000000001", nome: "Árvore | Quadrado" },
        criativo: { ref: "a1", id: "c-2", nome: "Poda segura" },
        motivo: "CTR de link 0,3% em 6.000 impressões, abaixo do mínimo de 0,5%. Jev: saúde 0,6 de 4.",
        de: { status: "ACTIVE", efetivo: "ACTIVE", orcamento_diario_brl: null, nome: "Árvore | Quadrado" },
        para: { status: "PAUSED" },
        limitado: false,
        indisponivel: null,
        troca: {
          numeros: { periodo: { inicio: "2026-09-21", fim: "2026-09-27", dias: 7 }, gasto: 40, impressoes: 6000, resultados: 0, resultado_rotulo: "Conversas", custo_por_resultado: null, ctr_link_pct: 0.3, cpc: 2, frequencia: 1.5 },
          regua: { ctr_minimo_pct: 0.5, ctr_mediana_pct: 1.2, custo_alvo_brl: 12, fonte_do_alvo: "custo tolerável do briefing" },
          problemas: ["ctr_baixo"],
          jev: { saude: 0.6, prob_candidato: 0.71, nota_copy_atual: 1.2 },
          candidato: { id: "c-2", nome: "Poda segura", angulo: "Poda segura", formato: "feed_4x5" },
          copy: "candidato",
        },
      },
    ],
    ignorados: [],
    gestao: { disponivel: true, motivo: null },
    modo: "real",
  };

  it("mostra a prova (números antes, régua, Jev, o que entra) e só age no Confirmar; o feito tem Desfazer", async () => {
    const acoes = normalizarAcoesDaConta(anexo)!;
    expect(acoes.itens[0].troca).toMatchObject({ saude: 0.6, candidato: { nome: "Poda segura" }, copy: "candidato" });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valor(), children: h(CartaoDasAcoes, { mensagemId: "m1", acoes }) }))));
    const troca = document.querySelector("[data-troca]") as HTMLElement;
    expect(troca.textContent).toMatch(/Antes \(21\/09 a 27\/09\): R\$ 40,00 gastos · 0 conversas · CTR 0,3% \(mínimo 0,5%\) · CPC R\$ 2,00 · frequência 1,5 · Jev: saúde 0,6 de 4/);
    expect(troca.textContent).toMatch(/Entra: Poda segura · ângulo Poda segura · com a copy do acervo/);
    expect(mock.invoke).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Confirmar 1/ })).toBeTruthy();
    const feito = { ...acoes.itens[0], resultado: { ok: true, motivo: "", criado: { anuncio_id: "160000000000001" }, desfeito: false, motivo_desfazer: "", depois: null, depois_novo: null, ativada_em: null, feito_em: null, relido_em: null, resposta: null } };
    expect(itemTemDesfazer(feito)).toBe(true);
  });
});
