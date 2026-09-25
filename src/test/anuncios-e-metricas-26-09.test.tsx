import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Anúncios e métricas reorganizados (pedido do dono em 26/09):
 * - /anuncios: contas e situação no topo, compacto; desempenho por cliente
 *   com o resultado certo por objetivo; conectar e reconectar num lugar só.
 * - /metricas: perfil orgânico completo, anúncios somados, posts que mais
 *   performaram com miniatura e o conselho curto junto com a Mesa.
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
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "gte", "lt", "lte", "gt", "overlaps", "contains", "order", "limit", "range", "like"]) b[m] = () => b;
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
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/x.png" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import AdminAds from "@/pages/AdminAds";
import AdminMetricas from "@/pages/AdminMetricas";
import {
  haQuanto,
  ordenarPorSituacao,
  resultadosPorObjetivo,
  rotuloDoResultado,
  situacaoDaConta,
} from "@/lib/adsResumo";
import { conselhoDoCliente, rankearPosts, totaisDosPosts } from "@/lib/metricasResumo";
import type { AdsDailyRow } from "@/lib/adsLanguage";
import type { SocialPostMetric } from "@/hooks/useSocialMetrics";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");

const CLIENTE = "33333333-3333-3333-3333-333333333333";
const AGORA = new Date();
const diasAtras = (n: number) => new Date(AGORA.getTime() - n * 86400000);
const dia = (n: number) => {
  const d = diasAtras(n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const linha = (over: Partial<AdsDailyRow> & { client_id?: string }): AdsDailyRow & Record<string, unknown> => ({
  id: Math.random().toString(36).slice(2),
  client_id: CLIENTE,
  external_account_id: "ea-1",
  captured_at: AGORA.toISOString(),
  campaign_id: "c1",
  campaign_name: "Conversas",
  objective: "OUTCOME_ENGAGEMENT",
  day: dia(2),
  spend: "100",
  impressions: 5000,
  reach: 3000,
  clicks: 120,
  link_clicks: 90,
  ctr: "2.4",
  cpc: "0.8",
  cpm: "20",
  frequency: "1.6",
  actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "10" }],
  cost_per_action: null,
  ...over,
});

const DIAS_DE_ADS = [
  linha({}),
  linha({ campaign_id: "c2", campaign_name: "Cadastros", objective: "OUTCOME_LEADS", spend: "50", reach: 1000, actions: [{ action_type: "lead", value: "3" }] }),
];

const post = (id: string, over: Partial<SocialPostMetric> = {}): SocialPostMetric => ({
  id,
  client_id: CLIENTE,
  external_account_id: "ig-1",
  media_id: `m-${id}`,
  media_type: "CAROUSEL_ALBUM",
  caption: `Legenda do post ${id}`,
  permalink: `https://instagram.test/p/${id}`,
  media_url: `https://cdn.test/${id}.jpg`,
  thumbnail_url: null,
  posted_at: diasAtras(5).toISOString(),
  like_count: 10,
  comments_count: 2,
  reach: 500,
  saved: 4,
  shares: 1,
  total_interactions: null,
  captured_at: AGORA.toISOString(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = {
    user_roles: [{ user_id: CLIENTE }],
    profiles: [{ id: CLIENTE, company_name: "Padaria Sintética", full_name: "Padaria", services: ["trafego"] }],
  };
  mock.rpc.mockImplementation((nome: string) => {
    if (nome === "meta_ads_connection_status") {
      return Promise.resolve({
        data: {
          agencia: null,
          perfis: [],
          contas: [
            { id: "ea-1", client_id: CLIENTE, display_name: "Conta Padaria", external_id: "123456", status: "active", token_proprio: false, ultima_coleta: diasAtras(0.05).toISOString(), saldo_disponivel: 30, erro: null },
            { id: "ea-2", client_id: CLIENTE, display_name: "Conta Antiga", external_id: "654321", status: "active", token_proprio: false, ultima_coleta: diasAtras(3).toISOString(), saldo_disponivel: null, erro: "Error validating access token: Session has expired" },
          ],
        },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });
  mock.invoke.mockResolvedValue({ data: {}, error: null });
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

function montar(filho: any, rota: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(MemoryRouter, { initialEntries: [rota] }, h(QueryClientProvider, { client: qc }, filho)));
}

// ------------------------------------------------------------------ regras em código

describe("resultado certo por objetivo", () => {
  it("conversa não soma com contato: cada objetivo tem o seu número e o seu custo", () => {
    const r = resultadosPorObjetivo(DIAS_DE_ADS);
    expect(r.map((x) => x.kind)).toEqual(["conversas", "contatos"]);
    expect(rotuloDoResultado(r[0])).toBe("10 conversas iniciadas");
    expect(r[0].custoPorResultado).toBe(10);
    expect(rotuloDoResultado(r[1])).toBe("3 contatos");
  });
});

describe("situação da conta", () => {
  it("token vencido pede reconectar; saldo baixo e leitura atrasada viram atenção", () => {
    const base = { status: "active", ultima_coleta: AGORA.toISOString(), erro: null };
    expect(situacaoDaConta({ ...base, erro: "Error validating access token: Session has expired" })).toMatchObject({ tom: "erro", reconectar: true });
    expect(situacaoDaConta({ ...base, erro: "Unsupported get request" })).toMatchObject({ tom: "erro", reconectar: false });
    expect(situacaoDaConta({ ...base, account_status: 3 }).rotulo).toBe("Pagamento pendente");
    expect(situacaoDaConta({ ...base, account_status: 2 }).tom).toBe("erro");
    expect(situacaoDaConta({ ...base, saldo_disponivel: 20 }).rotulo).toBe("Saldo baixo");
    expect(situacaoDaConta({ ...base, ultima_coleta: diasAtras(3).toISOString() }).rotulo).toBe("Leitura atrasada");
    expect(situacaoDaConta({ ...base, ultima_coleta: null }).tom).toBe("aguardando");
    expect(situacaoDaConta({ ...base, status: "inactive" }).tom).toBe("desligada");
    expect(situacaoDaConta(base).rotulo).toBe("Lendo normalmente");
  });

  it("problemas primeiro na lista", () => {
    const contas = [
      { display_name: "B", status: "active", ultima_coleta: AGORA.toISOString() },
      { display_name: "A", status: "active", ultima_coleta: AGORA.toISOString(), erro: "token expirado" },
    ];
    expect(ordenarPorSituacao(contas).map((c) => c.display_name)).toEqual(["A", "B"]);
  });

  it("tempo relativo curto", () => {
    expect(haQuanto(new Date(AGORA.getTime() - 30 * 60000).toISOString(), AGORA)).toBe("há 30 min");
    expect(haQuanto(new Date(AGORA.getTime() - 5 * 3600000).toISOString(), AGORA)).toBe("há 5 h");
    expect(haQuanto(null)).toBe("");
  });
});

describe("posts e conselho", () => {
  it("ranking por interações (salvos e compartilhamentos contam) e totais de 30 dias sem zero falso", () => {
    const posts = [post("a", { like_count: 50, saved: 0, shares: 0 }), post("b", { like_count: 5, saved: 80, shares: 20 }), post("c", { posted_at: diasAtras(60).toISOString(), saved: null, shares: null })];
    expect(rankearPosts(posts).map((p) => p.id)).toEqual(["b", "a", "c"]);
    const t = totaisDosPosts(posts, 30, AGORA);
    expect(t.posts).toBe(2);
    expect(t.salvos).toBe(80);
    expect(t.compartilhamentos).toBe(20);
    expect(totaisDosPosts([post("x", { saved: null, shares: null })], 30, AGORA).salvos).toBeNull();
  });

  it("conselho junta semana, Mesa e anúncios, cada linha com o número", () => {
    const linhas = conselhoDoCliente({
      semanas: [],
      deltaAlcance: -12.5,
      deltaSeguidores: null,
      posts: [post("a")],
      evolucao: { aprendizados: [{ tipo: "repetir", texto: "Bastidor rende o dobro de salvamentos." }], proximos_testes: [{ titulo: "Reels de 15 segundos" }] },
      anuncios: { investido: 150, resultado: "10 conversas iniciadas", custo: "R$ 10,00 cada" },
      agora: AGORA,
    });
    expect(linhas[0]).toContain("Alcance caiu 12,5%");
    expect(linhas.join("\n")).toContain("Mesa: Bastidor rende o dobro de salvamentos.");
    expect(linhas.join("\n")).toContain("Próximo teste sugerido pela Mesa: Reels de 15 segundos");
    expect(linhas.join("\n")).toContain("trouxeram 10 conversas iniciadas (R$ 10,00 cada)");
    expect(linhas.length).toBeLessThanOrEqual(5);
  });

  it("dinheiro sem resultado vira alerta", () => {
    const linhas = conselhoDoCliente({ semanas: [], deltaAlcance: null, deltaSeguidores: null, posts: [], anuncios: { investido: 200, resultado: null, custo: null } });
    expect(linhas[0]).toContain("sem resultado medido");
  });
});

// ------------------------------------------------------------------ tela de anúncios

describe("/anuncios", () => {
  beforeEach(() => {
    mock.tabelas.ads_campaign_daily = DIAS_DE_ADS;
  });

  it("contas no topo (problema primeiro, reconectar no mesmo lugar) e depois o desempenho por cliente", async () => {
    const { container } = montar(h(AdminAds), "/anuncios");
    await waitFor(() => expect(screen.getByText("Desempenho por cliente")).toBeTruthy());
    await waitFor(() => expect(container.textContent).toContain("No ar agora"));
    const texto = container.textContent || "";
    expect(texto.indexOf("Contas de anúncio")).toBeLessThan(texto.indexOf("Desempenho por cliente"));
    expect(texto.indexOf("Desempenho por cliente")).toBeLessThan(texto.indexOf("No ar agora"));
    // Token vencido: o botão principal vira Reconectar, e a conta com erro vem primeiro.
    expect(screen.getByRole("button", { name: /Reconectar com a Meta/ })).toBeTruthy();
    expect(texto.indexOf("Conta Antiga")).toBeLessThan(texto.indexOf("Conta Padaria"));
    expect(texto).toContain("A Meta recusou a leitura:");
    expect(texto).toContain("Saldo baixo");
    // Resultado pelo objetivo, e o outro objetivo ao lado, sem somar.
    expect(texto).toContain("10 conversas iniciadas");
    expect(texto).toContain("+ 3 contatos");
    expect(texto).toContain("2 contas pedem atenção");
  });

  it("token e ligar pelo número ficam recolhidos em Mais opções", async () => {
    const { container } = montar(h(AdminAds), "/anuncios");
    await waitFor(() => expect(screen.getByText("Contas de anúncio")).toBeTruthy());
    expect(container.querySelector('input[type="password"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Mais opções/ }));
    expect(container.querySelector('input[type="password"]')).toBeTruthy();
    expect(container.textContent).toContain("Ligar conta pelo número");
    expect(container.textContent).toContain("Ou cole um token");
  });

  it("o cliente aberto mostra o resumo, as campanhas nas duas leituras e só as contas dele", async () => {
    const { container } = montar(h(AdminAds), `/anuncios?cliente=${CLIENTE}`);
    await waitFor(() => expect(container.textContent).toContain("Como o cliente lê"));
    const texto = container.textContent || "";
    expect(texto).toContain("Como o cliente lê");
    expect(texto).toContain("Para a equipe");
    expect(texto).toContain("Gerar relatório");
    expect(texto).toContain("Também: 3 contatos");
  });

  it("sem conta ligada, o próprio cartão das contas explica o primeiro passo", async () => {
    mock.rpc.mockImplementation(() => Promise.resolve({ data: { agencia: null, contas: [] }, error: null }));
    mock.tabelas.ads_campaign_daily = [];
    const { container } = montar(h(AdminAds), "/anuncios");
    await waitFor(() => expect(container.textContent).toContain("Nenhuma conta ligada ainda."));
    expect(container.textContent).toContain("Conecte com a Meta, escolha as contas e o cliente de cada uma.");
    expect(screen.getByRole("button", { name: /Conectar com a Meta/ })).toBeTruthy();
  });
});

// ------------------------------------------------------------------ tela de métricas

describe("/metricas", () => {
  beforeEach(() => {
    mock.tabelas.ads_campaign_daily = DIAS_DE_ADS;
    mock.tabelas.social_metrics_weekly = [
      { id: "w2", client_id: CLIENTE, external_account_id: "ig-1", platform: "instagram", week_start: dia(9), week_end: dia(3), captured_at: AGORA.toISOString(), followers: 1100, media_count: 80, reach: 900, profile_views: 70, accounts_engaged: 60, total_interactions: 300 },
      { id: "w1", client_id: CLIENTE, external_account_id: "ig-1", platform: "instagram", week_start: dia(16), week_end: dia(10), captured_at: AGORA.toISOString(), followers: 1000, media_count: 78, reach: 1000, profile_views: 50, accounts_engaged: 40, total_interactions: 200 },
    ];
    mock.tabelas.social_post_metrics = [
      post("a", { like_count: 50 }),
      post("b", { like_count: 5, saved: 80, shares: 20, media_type: "VIDEO" }),
      post("c", { media_type: "IMAGE" }),
    ];
    mock.tabelas.evolucao_leituras = [
      {
        leitura: { aprendizados: [{ canal: "organico", tipo: "repetir", texto: "Carrossel de bastidor rende o dobro de salvamentos." }], proximos_testes: [{ titulo: "Testar Reels de 15 segundos", canal: "organico" }] },
        explicacao: null,
        criado_em: "2026-09-20T10:00:00Z",
      },
    ];
    mock.invoke.mockImplementation((_f: string, opcoes: any) => {
      const acao = opcoes && opcoes.body ? opcoes.body.acao : "";
      if (acao === "desempenho_cliente") {
        return Promise.resolve({ data: { organico: {}, anuncios: {}, somado: { alcance_aprox: 4000, interacoes: 500, investimento: 150, explicacao: "Alcance somado é aproximado." } }, error: null });
      }
      return Promise.resolve({ data: { leitura: {}, explicacao: null }, error: null });
    });
  });

  it("a grade mostra o perfil e os anúncios somados de cada cliente", async () => {
    const { container } = montar(h(AdminMetricas), "/metricas");
    await waitFor(() => expect(container.textContent).toContain("Padaria Sintética"));
    await waitFor(() => expect(container.textContent).toMatch(/Anúncios 30 dias: R\$\s150/));
    expect(container.textContent).toContain("10 conversas iniciadas");
  });

  it("o dossiê traz conselho com a Mesa, perfil completo, anúncios e posts com miniatura", async () => {
    const { container } = montar(h(AdminMetricas), `/metricas?client=${CLIENTE}&account=ig-1`);
    await waitFor(() => expect(container.textContent).toContain("Mesa: Carrossel de bastidor rende o dobro de salvamentos."));
    const texto = container.textContent || "";
    expect(texto).toContain("Próximo teste sugerido pela Mesa: Testar Reels de 15 segundos");
    expect(texto).toContain("Alcance caiu 10%");
    for (const rotulo of ["Seguidores", "Alcance", "Interações", "Salvamentos", "Compartilhamentos", "Visitas ao perfil"]) {
      expect(texto).toContain(rotulo);
    }
    // Ordem dos blocos: conselho, perfil, anúncios, posts.
    const ordem = ["Conselho", "Perfil orgânico", "Anúncios do cliente", "Posts que mais performaram"].map((t) => texto.indexOf(t));
    expect(ordem.slice().sort((a, b) => a - b)).toEqual(ordem);
    expect(texto).toContain("Também: 3 contatos");
    await waitFor(() => expect(container.textContent).toContain("Somado pela Mesa"));
    // O post com mais salvos e compartilhamentos vem primeiro, com a miniatura sem referrer.
    const primeira = container.querySelector('img[src="https://cdn.test/b.jpg"]') as HTMLImageElement;
    expect(primeira).toBeTruthy();
    expect(primeira.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(texto.indexOf("Legenda do post b")).toBeLessThan(texto.indexOf("Legenda do post a"));
  });

  it("Pedir leitura da Mesa chama evolucao sem gravar memória e sem IA", async () => {
    montar(h(AdminMetricas), `/metricas?client=${CLIENTE}&account=ig-1`);
    const botao = await screen.findByRole("button", { name: /Pedir leitura da Mesa/ });
    fireEvent.click(botao);
    await waitFor(() => {
      const chamadas = mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-ads" && c[1].body.acao === "evolucao");
      expect(chamadas.length).toBe(1);
      expect(chamadas[0][1].body).toMatchObject({ client_id: CLIENTE, gravar: false, explicar: false });
    });
  });
});

// ------------------------------------------------------------------ regras de código

describe("compatibilidade e texto", () => {
  const arquivos = [
    "src/pages/AdminAds.tsx",
    "src/pages/AdminMetricas.tsx",
    "src/lib/adsResumo.ts",
    "src/lib/metricasResumo.ts",
    "src/hooks/useConselhoDaMesa.ts",
    "src/components/ads/CampanhasAtivas.tsx",
  ];

  it("sem lookbehind, \\p{}, grupo nomeado, .at(), Object.hasOwn, aspect-ratio, :has e min()/max()/clamp() em classe", () => {
    for (const arquivo of arquivos) {
      const f = ler(arquivo);
      expect(f, arquivo).not.toMatch(/\(\?<[=!]/);
      expect(f, arquivo).not.toMatch(/\\p\{/);
      expect(f, arquivo).not.toMatch(/\(\?<[a-zA-Z]/);
      expect(f, arquivo).not.toMatch(/\.at\(/);
      expect(f, arquivo).not.toMatch(/Object\.hasOwn\(/);
      expect(f, arquivo).not.toMatch(/aspect-/);
      expect(f, arquivo).not.toMatch(/:has\(/);
      expect(f, arquivo).not.toMatch(/\[(?:min|max|clamp)\(/);
    }
  });

  it("sem travessão", () => {
    for (const arquivo of arquivos) expect(ler(arquivo), arquivo).not.toMatch(/[—–]/);
  });

  it("caixas com rolagem própria têm altura máxima", () => {
    const tela = ler("src/pages/AdminAds.tsx");
    expect(tela).toContain("max-h-64 min-w-0 divide-y divide-border overflow-y-auto");
    expect(tela).toContain("max-h-[22rem] space-y-1.5 overflow-y-auto");
    expect(ler("src/pages/AdminMetricas.tsx")).toContain("max-h-[520px] min-w-0 divide-y divide-border overflow-y-auto");
  });

  it("nenhum token sai do cofre para a tela", () => {
    const tela = ler("src/pages/AdminAds.tsx");
    expect(tela).not.toMatch(/access_token/);
    expect(tela).toMatch(/type="password"[\s\S]{0,200}setToken/);
  });
});
