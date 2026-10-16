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

  it("abas em ícone na linha do título; clientes primeiro com os quatro números; Ver contas abre e fecha o detalhe", async () => {
    const { container } = montar(h(AdminAds), "/anuncios");
    const abas = await screen.findByRole("navigation", { name: "Partes dos anúncios" });
    // 16/10: Clientes | No ar agora | Contas e conexão, uma por vez, na mesma linha do título.
    const valores = Array.prototype.slice.call(abas.querySelectorAll("button[data-etapa]")).map((b: Element) => b.getAttribute("data-etapa"));
    expect(valores).toEqual(["clientes", "agora", "contas"]);
    expect(abas.querySelector('[aria-current="page"]')!.getAttribute("data-etapa")).toBe("clientes");
    expect(screen.getByRole("heading", { name: "Anúncios" }).parentElement!.contains(abas)).toBe(true);
    // Só a aba aberta na tela: a configuração das contas não aparece.
    expect(screen.queryByRole("button", { name: /Mais opções/ })).toBeNull();
    // Ações só em ícone, sem texto, com o nome no title; um "Atualizar" só.
    const atualizar = screen.getByRole("button", { name: "Atualizar agora" });
    expect(atualizar.getAttribute("title")).toBe("Atualizar agora");
    expect(atualizar.textContent).toBe("");
    expect(screen.getAllByRole("button", { name: /Atualizar/ })).toHaveLength(1);
    // Os quatro números com ícone, por cliente.
    const linha = await screen.findByRole("list", { name: "Clientes com anúncios" });
    const texto = container.textContent || "";
    expect(linha.querySelectorAll("[data-metrica]")).toHaveLength(4);
    expect(linha.textContent).toContain("investido");
    expect(linha.textContent).toContain("conversas iniciadas");
    expect(linha.textContent).toContain("por conversa iniciada");
    expect(linha.textContent).toContain("saldo");
    // Resultado pelo objetivo; o outro objetivo vai na dica, sem somar.
    expect(linha.querySelector('[title="Também: 3 contatos"]')).toBeTruthy();
    // Conta pedindo atenção: só o ícone "Ver contas" na linha do título, com a contagem no title.
    const ver = await screen.findByRole("button", { name: "Ver contas" });
    expect(ver.getAttribute("title")).toContain("2 contas pedem atenção");
    expect(ver.getAttribute("aria-expanded")).toBe("false");
    expect(texto).not.toContain("A Meta recusou a leitura:");
    expect(screen.queryByRole("button", { name: /Reconectar com a Meta/ })).toBeNull();
    // Tocar abre o detalhe (problema primeiro, com o Reconectar); tocar de novo fecha.
    fireEvent.click(ver);
    await waitFor(() => expect(container.textContent).toContain("A Meta recusou a leitura:"));
    const aberto = container.textContent || "";
    expect(aberto.indexOf("Conta Antiga")).toBeLessThan(aberto.indexOf("Conta Padaria"));
    expect(aberto).toContain("Saldo baixo");
    expect(screen.getByRole("button", { name: /Reconectar com a Meta/ })).toBeTruthy();
    expect(ver.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(ver);
    expect(container.textContent).not.toContain("A Meta recusou a leitura:");
    expect(screen.queryByRole("region", { name: "Contas que pedem atenção" })).toBeNull();
  });

  it("No ar agora e Contas e conexão abrem pela aba, uma por vez", async () => {
    const { container } = montar(h(AdminAds), "/anuncios");
    await screen.findByRole("list", { name: "Clientes com anúncios" });
    fireEvent.click(screen.getByRole("button", { name: /No ar agora/ }));
    await waitFor(() => expect(container.textContent).toContain("Nada pede ação agora."));
    expect(screen.queryByRole("list", { name: "Clientes com anúncios" })).toBeNull();
  });

  it("token e ligar pelo número ficam recolhidos em Mais opções, na aba Contas e conexão", async () => {
    const { container } = montar(h(AdminAds), "/anuncios");
    await waitFor(() => expect(screen.getByRole("button", { name: /Contas e conexão/ })).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Mais opções/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Contas e conexão/ }));
    expect(container.querySelector('button[data-etapa="contas"]')!.getAttribute("aria-current")).toBe("page");
    // Conectar com a Meta também é só ícone, com o nome no title.
    expect(screen.getByRole("button", { name: "Reconectar com a Meta" }).getAttribute("title")).toBe("Reconectar com a Meta");
    expect(container.querySelector('input[type="password"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Mais opções/ }));
    expect(container.querySelector('input[type="password"]')).toBeTruthy();
    expect(container.textContent).toContain("Ligar conta pelo número");
    expect(container.textContent).toContain("Ou cole um token");
  });

  it("o cliente aberto mostra os números grandes, as partes em abas de ícone e as ações só em ícone", async () => {
    const { container } = montar(h(AdminAds), `/anuncios?cliente=${CLIENTE}`);
    await waitFor(() => expect(screen.getByRole("button", { name: /Conversas/ })).toBeTruthy());
    expect(screen.getByRole("group", { name: "Resumo dos últimos 30 dias" }).querySelectorAll("[data-metrica]")).toHaveLength(4);
    expect(container.textContent).toContain("Também: 3 contatos");
    // Ações: só ícone, nome no title, sem "Copiar resumo" e sem dois "Atualizar".
    for (const nome of ["Gerar relatório", "Atualizar agora", "Abrir na Mesa Ads", "Ver contas"]) {
      const acao = screen.getByRole(nome === "Abrir na Mesa Ads" ? "link" : "button", { name: nome });
      expect(acao.getAttribute("title"), nome).toContain(nome);
    }
    expect(screen.getByRole("button", { name: "Gerar relatório" }).textContent).toBe("");
    expect(screen.getAllByRole("button", { name: /Atualizar/ })).toHaveLength(1);
    expect(container.textContent).not.toContain("Copiar resumo");
    // As partes: uma aba por vez, Campanhas aberta de início.
    const abas = screen.getByRole("navigation", { name: "Partes de Padaria Sintética" });
    const valores = Array.prototype.slice.call(abas.querySelectorAll("button[data-etapa]")).map((b: Element) => b.getAttribute("data-etapa"));
    expect(valores).toEqual(["campanhas", "agora", "criativos", "contas"]);
    expect(abas.querySelector('[aria-current="page"]')!.getAttribute("data-etapa")).toBe("campanhas");
    expect(screen.queryByRole("button", { name: /Mais opções/ })).toBeNull();
    // A campanha abre nas duas leituras.
    expect(container.textContent).not.toContain("Como o cliente lê");
    fireEvent.click(screen.getByRole("button", { name: /Conversas/ }));
    expect(container.textContent).toContain("Como o cliente lê");
    expect(container.textContent).toContain("Para a equipe");
    // Criativos e contas pela aba, e a campanha sai da tela.
    fireEvent.click(screen.getByRole("button", { name: /Criativos/ }));
    await waitFor(() => expect(container.textContent).toContain("Nenhum criativo lido ainda."));
    expect(container.textContent).not.toContain("Como o cliente lê");
    fireEvent.click(screen.getByRole("button", { name: /Contas deste cliente/ }));
    expect(screen.getByRole("button", { name: /Mais opções/ })).toBeTruthy();
    // Os números continuam à vista em qualquer aba.
    expect(screen.getByRole("group", { name: "Resumo dos últimos 30 dias" })).toBeTruthy();
  });

  it("sem conta ligada, o primeiro passo aparece no lugar dos números", async () => {
    mock.rpc.mockImplementation(() => Promise.resolve({ data: { agencia: null, contas: [] }, error: null }));
    mock.tabelas.ads_campaign_daily = [];
    const { container } = montar(h(AdminAds), "/anuncios");
    await waitFor(() => expect(container.textContent).toContain("Nenhuma conta ligada ainda."));
    expect(container.textContent).toContain("Conecte com a Meta, escolha as contas e o cliente de cada uma.");
    expect(screen.getByRole("button", { name: /Conectar com a Meta/ })).toBeTruthy();
  });

  it("a seta compara os últimos 15 dias com os 15 anteriores", async () => {
    mock.tabelas.ads_campaign_daily = [
      linha({ day: dia(20), spend: "100", actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "4" }] }),
      linha({ day: dia(3), spend: "100", actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "10" }] }),
    ];
    const { container } = montar(h(AdminAds), "/anuncios");
    await waitFor(() => expect(container.querySelector('[data-tendencia="subiu"]')).toBeTruthy());
    // Mais conversas (verde) e custo por conversa menor (seta para baixo, verde).
    expect(container.querySelector('[data-tendencia="subiu"]')!.className).toContain("text-success");
    expect(container.querySelector('[data-tendencia="caiu"]')!.className).toContain("text-success");
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

  it("contas e saúde das contas em abas de ícone na linha do título, um Atualizar só e em ícone", async () => {
    // 16/10/2026 (dono): "Métricas, Saúde da conta, tá tudo um abaixo do outro; colocar do ladinho, com abas".
    const { container } = montar(h(AdminMetricas), "/metricas");
    await waitFor(() => expect(container.textContent).toContain("Padaria Sintética"));
    const abas = screen.getByRole("navigation", { name: "Partes das métricas" });
    const valores = Array.prototype.slice.call(abas.querySelectorAll("button[data-etapa]")).map((b: Element) => b.getAttribute("data-etapa"));
    expect(valores).toEqual(["contas", "saude"]);
    expect(abas.querySelector('[aria-current="page"]')!.getAttribute("data-etapa")).toBe("contas");
    expect(screen.getByRole("heading", { name: "Métricas" }).parentElement!.contains(abas)).toBe(true);
    const atualizar = screen.getByRole("button", { name: "Atualizar agora" });
    expect(atualizar.getAttribute("title")).toBe("Atualizar agora");
    expect(atualizar.textContent).toBe("");
    expect(screen.getAllByRole("button", { name: /Atualizar/ })).toHaveLength(1);
    // Saúde das contas pela aba: a lista de contas sai da tela.
    fireEvent.click(abas.querySelector('button[data-etapa="saude"]') as HTMLElement);
    await waitFor(() => expect(container.textContent).toContain("Nenhuma conta de Instagram cadastrada."));
    expect(container.textContent).not.toContain("Padaria Sintética");
  });

  it("o dossiê traz as partes em abas de ícone: conselho com a Mesa, perfil completo, anúncios e posts com miniatura", async () => {
    // 16/10/2026 (dono): as seções empilhadas viraram abas de ícone, uma por vez; ações só em ícone.
    const { container } = montar(h(AdminMetricas), `/metricas?client=${CLIENTE}&account=ig-1`);
    await waitFor(() => expect(container.textContent).toContain("Mesa: Carrossel de bastidor rende o dobro de salvamentos."));
    const abas = screen.getByRole("navigation", { name: "Partes de Padaria Sintética" });
    const valores = Array.prototype.slice.call(abas.querySelectorAll("button[data-etapa]")).map((b: Element) => b.getAttribute("data-etapa"));
    expect(valores).toEqual(["conselho", "organico", "anuncios", "posts", "identidade"]);
    expect(abas.querySelector('[aria-current="page"]')!.getAttribute("data-etapa")).toBe("conselho");
    const aba = (v: string) => abas.querySelector(`button[data-etapa="${v}"]`) as HTMLElement;
    let texto = container.textContent || "";
    expect(texto).toContain("Próximo teste sugerido pela Mesa: Testar Reels de 15 segundos");
    expect(texto).toContain("Alcance caiu 10%");
    // Ações só em ícone, nome no title; sem "Copiar resumo"; um "Atualizar" só; ícones sem repetir.
    for (const nome of ["Atualizar agora", "Pedir leitura da Mesa", "Abrir a Mesa"]) {
      const acao = screen.getByRole(nome === "Abrir a Mesa" ? "link" : "button", { name: nome });
      expect(acao.getAttribute("title"), nome).toBe(nome);
      expect(acao.textContent, nome).toBe("");
    }
    expect(screen.getAllByRole("button", { name: /Atualizar/ })).toHaveLength(1);
    expect(texto).not.toContain("Copiar resumo");
    const iconeDe = (el: Element) => (el.querySelector("svg") as SVGElement).getAttribute("class");
    expect(iconeDe(screen.getByRole("button", { name: "Atualizar agora" }))).not.toBe(iconeDe(screen.getByRole("button", { name: "Pedir leitura da Mesa" })));
    // Perfil orgânico: só ele na tela.
    fireEvent.click(aba("organico"));
    texto = container.textContent || "";
    for (const rotulo of ["Seguidores", "Interações", "Salvamentos", "Compartilhamentos", "Visitas ao perfil"]) {
      expect(texto).toContain(rotulo);
    }
    expect(texto).not.toContain("Alcance caiu 10%");
    // Anúncios.
    fireEvent.click(aba("anuncios"));
    expect(container.textContent).toContain("Também: 3 contatos");
    await waitFor(() => expect(container.textContent).toContain("Somado pela Mesa"));
    expect(screen.getByRole("link", { name: "Abrir em Anúncios" }).getAttribute("title")).toBe("Abrir em Anúncios");
    // Posts: o com mais salvos e compartilhamentos vem primeiro, com a miniatura sem referrer.
    fireEvent.click(aba("posts"));
    const primeira = container.querySelector('img[src="https://cdn.test/b.jpg"]') as HTMLImageElement;
    expect(primeira).toBeTruthy();
    expect(primeira.getAttribute("referrerpolicy")).toBe("no-referrer");
    texto = container.textContent || "";
    expect(texto.indexOf("Legenda do post b")).toBeLessThan(texto.indexOf("Legenda do post a"));
    expect(texto).not.toContain("Somado pela Mesa");
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
    // Sistema de design (26/09): lista longa não empurra o resto da tela, mas
    // só rola por dentro de 1024 px para cima (lg:); no celular a página rola
    // normal, sem caixa prendendo o dedo. Toda rolagem própria tem teto.
    const tela = ler("src/pages/AdminAds.tsx");
    expect(tela).toContain("divide-y divide-border lg:max-h-64 lg:overflow-y-auto");
    expect(tela).toContain("lg:max-h-[22rem] lg:overflow-y-auto");
    expect(ler("src/pages/AdminMetricas.tsx")).toContain("divide-y divide-border lg:max-h-[520px] lg:overflow-y-auto");
    for (const arquivo of ["src/pages/AdminAds.tsx", "src/pages/AdminMetricas.tsx", "src/components/ads/CampanhasAtivas.tsx", "src/components/ads/GaleriaDeCriativos.tsx"]) {
      const f = ler(arquivo);
      for (const classes of f.match(/className="[^"]*overflow-y-auto[^"]*"/g) || []) {
        // O modal da galeria (janela de altura fixa) é a exceção que o sistema permite.
        if (classes.includes("max-h-full")) continue;
        expect(classes, arquivo).toMatch(/lg:overflow-y-auto/);
        expect(classes, arquivo).not.toMatch(/(^|[\s"])overflow-y-auto/);
        expect(classes, arquivo).toMatch(/lg:max-h-/);
      }
    }
  });

  it("nenhum token sai do cofre para a tela", () => {
    const tela = ler("src/pages/AdminAds.tsx");
    expect(tela).not.toMatch(/access_token/);
    expect(tela).toMatch(/type="password"[\s\S]{0,200}setToken/);
  });
});
