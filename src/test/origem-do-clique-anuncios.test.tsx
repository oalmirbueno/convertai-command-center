import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Origem do clique (19/10/2026, ideia 8 do estudo do ClickMax): o lead nasce
 * no formulário do site com os utm_* e o id do anúncio; /anuncios conta os
 * leads do CRM por campanha e por peça, com a temperatura; o lead mostra
 * "veio do anúncio X"; e um relógio discreto diz de quando são os dados da
 * Meta, âmbar depois de 24 h.
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
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: mock.rpc,
      from: (tabela: string) => consulta(tabela),
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "u-1" } } }) },
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/x.png" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import AdminAds from "@/pages/AdminAds";
import FrescorDaMeta from "@/components/ads/FrescorDaMeta";
import OrigemDoLead from "@/components/ads/OrigemDoLead";
import {
  frescorDaMeta,
  fraseDaOrigem,
  ligacaoDoLead,
  ligarLeadsAosAnuncios,
  LIMITE_DO_FRESCOR_HORAS,
  ultimaLeituraDasContas,
  type LeadComOrigem,
} from "@/components/ads/leadsDosAnuncios";
import { lerOrigemDoClique, origemDaBusca, PARAMETROS_DE_URL_DA_META } from "../../supabase/functions/_shared/origem-clique";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");

const CLIENTE = "44444444-4444-4444-4444-444444444444";
const OUTRO = "55555555-5555-5555-5555-555555555555";
const CAMPANHA = "120210000000001";
const ANUNCIO = "120210000000099";
const AGORA = new Date();
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3600000).toISOString();
const dia = (n: number) => {
  const d = new Date(AGORA.getTime() - n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const lead = (over: Partial<LeadComOrigem>): LeadComOrigem => ({
  id: Math.random().toString(36).slice(2),
  name: "Lead",
  company: null,
  email: null,
  whatsapp: null,
  origin: "site",
  campaign_id: null,
  quiz_submission_id: null,
  stage: "novo",
  monthly_value: 0,
  one_off_value: 0,
  owner_id: null,
  next_action: null,
  next_action_at: null,
  notes: null,
  lost_reason: null,
  won_client_id: null,
  closed_at: null,
  created_at: horasAtras(2),
  expected_close_date: null,
  organization_id: null,
  contact_id: null,
  classe: null,
  qualificacao: { client_id: CLIENTE },
  origem_clique: null,
  ...over,
});

// ------------------------------------------------------------------ captura

describe("captura: o formulário guarda os UTMs e o id do anúncio", () => {
  it("guarda utm_* e ad_id/adset_id/campaign_id/fbclid que vieram no link", () => {
    const o = lerOrigemDoClique({
      chave: "x",
      nome: "Ana",
      utm_source: "meta",
      utm_medium: "paid_social",
      utm_campaign: "Black Friday",
      utm_content: "criativo-v1",
      utm_term: "publico-a",
      ad_id: ANUNCIO,
      adset_id: "120210000000050",
      campaign_id: CAMPANHA,
      fbclid: "IwAR0abc_DEF-123",
    });
    expect(o).toEqual({
      utm_source: "meta",
      utm_medium: "paid_social",
      utm_campaign: "Black Friday",
      utm_content: "criativo-v1",
      utm_term: "publico-a",
      ad_id: ANUNCIO,
      adset_id: "120210000000050",
      campaign_id: CAMPANHA,
      fbclid: "IwAR0abc_DEF-123",
    });
  });

  it("padrão da Meta: utm_content={{ad.id}} vira ad_id; macro não trocada e id inválido ficam de fora", () => {
    expect(lerOrigemDoClique({ utm_content: ANUNCIO, utm_campaign: CAMPANHA })).toEqual({ utm_content: ANUNCIO, utm_campaign: CAMPANHA, ad_id: ANUNCIO, campaign_id: CAMPANHA });
    expect(lerOrigemDoClique({ utm_content: "{{ad.id}}", ad_id: "abc", campaign_id: "12" })).toBeNull();
    expect(lerOrigemDoClique({ utm_source: "<script>" })).toBeNull();
    // Sem link, sem origem: nada é inventado.
    expect(lerOrigemDoClique({ nome: "Ana", email: "a@b.com" })).toBeNull();
    expect(lerOrigemDoClique(null)).toBeNull();
    expect(origemDaBusca(`?utm_source=meta&utm_content=${ANUNCIO}&outro=1`)).toEqual({ utm_source: "meta", utm_content: ANUNCIO, ad_id: ANUNCIO });
    expect(origemDaBusca("")).toBeNull();
  });

  it("a função pública manda _origem para a RPC só quando há origem, e repete sem ela se o banco for antigo", () => {
    const f = ler("supabase/functions/site-formulario/index.ts");
    expect(f).toMatch(/lerOrigemDoClique\(corpo\)/);
    expect(f).toMatch(/argumentos\._origem = origemDoClique/);
    expect(f).toMatch(/error\.code === "PGRST202"/);
    expect(f).not.toMatch(/from\("commercial_leads"\)/);
  });

  it("o site repassa os parâmetros do link em campos ocultos (e a casca sobe de versão)", () => {
    const int = ler("workers/motor-codigo/modelo-site/src/lib/integracoes.tsx");
    for (const c of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ad_id", "adset_id", "campaign_id", "fbclid"]) expect(int).toContain(`"${c}"`);
    expect(int).toMatch(/type="hidden" name=\{c\}/);
    expect(int).toMatch(/sessionStorage\.setItem\(CHAVE_DA_ORIGEM/);
    const casca = JSON.parse(ler("workers/motor-codigo/modelo-site/.aceleriq/casca.json")) as { versao: number };
    expect(casca.versao).toBeGreaterThanOrEqual(6);
  });

  it("migration: coluna origem_clique, índices por anúncio e campanha, RPC com _origem só para a service_role", () => {
    const sql = ler("supabase/migrations/20261020040000_origem_do_clique.sql");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS origem_clique jsonb/);
    expect(sql).toMatch(/\(\(origem_clique ->> 'ad_id'\)\)/);
    expect(sql).toMatch(/\(\(origem_clique ->> 'campaign_id'\)\)/);
    expect(sql).toMatch(/_origem jsonb DEFAULT NULL/);
    expect(sql).toMatch(/app_private\.rpc_trusted_backend\(\)/);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.site_registrar_lead\(text, text, text, text, text, text, text, text, text\);/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.site_registrar_lead\(text, text, text, text, text, text, text, text, text, jsonb\) TO service_role/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.site_registrar_lead\(text, text, text, text, text, text, text, text, text, jsonb\) FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/DELETE FROM|DROP TABLE|DROP COLUMN/i);
  });
});

// ------------------------------------------------------------------ leitura

describe("leitura: leads no CRM por anúncio e por campanha", () => {
  const pecas = [
    { ad_id: ANUNCIO, ad_name: "Criativo V1", campaign_id: CAMPANHA },
    { ad_id: "120210000000777", ad_name: "Outra peça", campaign_id: "120210000000002" },
  ];
  const campanhas = [
    { campaign_id: CAMPANHA, name: "Cadastros" },
    { campaign_id: "120210000000002", name: "Conversas" },
  ];

  it("conta pelo ad_id e acha a campanha pela peça; o mais novo primeiro", () => {
    const a = lead({ id: "a", created_at: horasAtras(5), origem_clique: { ad_id: ANUNCIO } });
    const b = lead({ id: "b", created_at: horasAtras(1), origem_clique: { utm_content: ANUNCIO } });
    const c = lead({ id: "c", origem_clique: { campaign_id: "120210000000002" } });
    const semOrigem = lead({ id: "d" });
    const r = ligarLeadsAosAnuncios([a, b, c, semOrigem], pecas, campanhas, CLIENTE);
    expect((r.porAnuncio.get(ANUNCIO) || []).map((l) => l.id)).toEqual(["b", "a"]);
    expect((r.porCampanha.get(CAMPANHA) || []).map((l) => l.id)).toEqual(["b", "a"]);
    expect((r.porCampanha.get("120210000000002") || []).map((l) => l.id)).toEqual(["c"]);
    expect(r.porAnuncio.get("120210000000777")).toBeUndefined();
  });

  it("pelo nome só quando o lead é do mesmo cliente (nome igual em outro cliente não puxa lead alheio)", () => {
    const meu = lead({ id: "m", origem_clique: { utm_content: "Criativo V1", utm_campaign: "cadastros" } });
    const alheio = lead({ id: "x", qualificacao: { client_id: OUTRO }, origem_clique: { utm_content: "Criativo V1" } });
    expect(ligacaoDoLead(meu, pecas, campanhas, CLIENTE)).toEqual({ adId: ANUNCIO, campaignId: CAMPANHA, pelo: "nome" });
    expect(ligacaoDoLead(alheio, pecas, campanhas, CLIENTE)).toEqual({ adId: null, campaignId: null, pelo: null });
  });

  it("o lead do CRM diz de qual anúncio veio (nome lido ou o id do link)", () => {
    expect(fraseDaOrigem({ ad_id: ANUNCIO }, { anuncio: "Criativo V1", campanha: "Cadastros" })).toBe("Veio do anúncio Criativo V1 · campanha Cadastros");
    expect(fraseDaOrigem({ ad_id: ANUNCIO }, null)).toBe(`Veio do anúncio ${ANUNCIO}`);
    expect(fraseDaOrigem({ fbclid: "IwAR0abc_DEF-123" })).toBe("Veio de um anúncio da Meta (clique sem o id do anúncio)");
    expect(fraseDaOrigem({ utm_source: "instagram", utm_medium: "bio" })).toBe("Veio pelo link instagram · bio");
    const { container } = render(h(QueryClientProvider, { client: new QueryClient() }, h(OrigemDoLead, { lead: { id: "z", origem_clique: null } })));
    expect(container.textContent).toBe("");
  });
});

// ------------------------------------------------------------------ frescor

describe("frescor dos dados da Meta", () => {
  it("diz há quanto tempo e avisa depois de 24 h", () => {
    expect(LIMITE_DO_FRESCOR_HORAS).toBe(24);
    expect(frescorDaMeta(horasAtras(0.5), AGORA)).toMatchObject({ curto: "há 30 min", velho: false });
    expect(frescorDaMeta(horasAtras(3), AGORA)).toMatchObject({ curto: "há 3 h", velho: false, frase: "Dados da Meta de há 3 h." });
    expect(frescorDaMeta(horasAtras(24), AGORA).velho).toBe(false);
    const velho = frescorDaMeta(horasAtras(30), AGORA);
    expect(velho).toMatchObject({ curto: "há 30 h", velho: true });
    expect(velho.frase).toContain("passou de 24 h");
    expect(frescorDaMeta(horasAtras(72), AGORA).curto).toBe("há 3 dias");
    expect(frescorDaMeta(null, AGORA)).toMatchObject({ curto: "", velho: false });
    expect(ultimaLeituraDasContas([
      { status: "active", ultima_coleta: horasAtras(5) },
      { status: "active", ultima_coleta: horasAtras(2) },
      { status: "inactive", ultima_coleta: horasAtras(0.1) },
    ])).toBe(horasAtras(2));
  });

  it("o indicador é discreto (só ícone no celular) e vira aviso âmbar com texto à vista depois de 24 h", () => {
    const ok = render(h(FrescorDaMeta, { ultima: horasAtras(2), agora: AGORA }));
    const s1 = ok.container.querySelector("[data-frescor]")!;
    expect(s1.getAttribute("data-frescor")).toBe("ok");
    expect(s1.getAttribute("title")).toBe("Dados da Meta de há 2 h.");
    expect(s1.querySelector("span")!.className).toContain("hidden sm:inline");
    ok.unmount();
    const velho = render(h(FrescorDaMeta, { ultima: horasAtras(30), agora: AGORA }));
    const s2 = velho.container.querySelector("[data-frescor]")!;
    expect(s2.getAttribute("data-frescor")).toBe("velho");
    expect(s2.className).toContain("text-warning");
    expect(s2.querySelector("span")!.className).not.toContain("hidden");
    velho.unmount();
    expect(render(h(FrescorDaMeta, { ultima: null })).container.textContent).toBe("");
  });
});

// ------------------------------------------------------------------ tela

describe("/anuncios com leads do CRM e frescor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.tabelas = {
      user_roles: [{ user_id: CLIENTE }],
      profiles: [{ id: CLIENTE, company_name: "Clínica Sintética", full_name: "Clínica", services: ["trafego"] }],
      ads_campaign_daily: [
        {
          id: "d1", client_id: CLIENTE, external_account_id: "ea-1", captured_at: horasAtras(30), campaign_id: CAMPANHA, campaign_name: "Cadastros",
          objective: "OUTCOME_LEADS", day: dia(2), spend: "80", impressions: 4000, reach: 2000, clicks: 90, link_clicks: 70, ctr: "2", cpc: "1", cpm: "20",
          frequency: "1.5", actions: [{ action_type: "lead", value: "4" }], cost_per_action: null,
        },
      ],
      ads_campaigns: [{ id: "k1", client_id: CLIENTE, external_account_id: "ea-1", campaign_id: CAMPANHA, name: "Cadastros", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_LEADS", daily_budget: null, lifetime_budget: null, start_time: null, stop_time: null, updated_at: horasAtras(30) }],
      ads_creatives: [{ ad_id: ANUNCIO, ad_name: "Criativo V1", campaign_id: CAMPANHA, thumbnail_url: null, image_url: null, video_id: null, titulo: null, corpo: null, status: "ACTIVE", effective_status: "ACTIVE" }],
      ads_creative_daily: [{ ad_id: ANUNCIO, day: dia(2), spend: 80, impressions: 4000, reach: 2000, clicks: 90, link_clicks: 70 }],
      commercial_leads: [
        { ...lead({ id: "l1", name: "Ana Quente", stage: "proposta", origem_clique: { utm_source: "meta", utm_content: ANUNCIO } }), archived_at: null },
        { ...lead({ id: "l2", name: "Bruno Novo", origem_clique: { ad_id: ANUNCIO, campaign_id: CAMPANHA } }), archived_at: null },
      ],
      commercial_activities: [],
      commercial_lead_events: [],
    };
    mock.rpc.mockImplementation((nome: string) => {
      if (nome === "meta_ads_connection_status") {
        return Promise.resolve({
          data: { agencia: null, perfis: [], contas: [{ id: "ea-1", client_id: CLIENTE, display_name: "Conta Clínica", external_id: "123", status: "active", token_proprio: false, ultima_coleta: horasAtras(30), saldo_disponivel: null, erro: null }] },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    try {
      window.localStorage.clear();
    } catch {
      /* sem armazenamento */
    }
  });

  const montar = (rota: string) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(h(MemoryRouter, { initialEntries: [rota] }, h(QueryClientProvider, { client: qc }, h(AdminAds))));
  };

  it("a campanha mostra quantos leads trouxe e, aberta, a lista curta com a temperatura", async () => {
    const { container } = montar(`/anuncios?cliente=${CLIENTE}`);
    const contagem = await waitFor(() => {
      const el = container.querySelector('[data-leads-no-crm="2"]');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(contagem.getAttribute("aria-label")).toBe("2 leads no CRM");
    fireEvent.click(screen.getByRole("button", { name: /Cadastros/ }));
    const lista = await screen.findByRole("list", { name: "Leads no CRM" });
    expect(lista.textContent).toContain("Ana Quente");
    expect(lista.textContent).toContain("Bruno Novo");
    expect(lista.querySelectorAll('[aria-label^="Temperatura:"]').length).toBe(2);
    // Frescor do cliente aberto: leitura de 30 h atrás vira aviso.
    const frescor = container.querySelector("[data-frescor]")!;
    expect(frescor.getAttribute("data-frescor")).toBe("velho");
    expect(frescor.textContent).toContain("há 30 h");
  });

  it("a peça na aba Criativos também mostra os leads do anúncio", async () => {
    const { container } = montar(`/anuncios?cliente=${CLIENTE}`);
    await waitFor(() => expect(container.querySelector('[data-leads-no-crm="2"]')).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Criativos/ }));
    await waitFor(() => expect(container.textContent).toContain("Criativo V1"));
    const cartao = screen.getAllByText("Criativo V1").map((el) => el.closest("button")).find(Boolean)!;
    expect(cartao.querySelector('[data-leads-no-crm="2"]')).toBeTruthy();
    fireEvent.click(cartao);
    const lista = await screen.findByRole("list", { name: "Leads no CRM" });
    expect(lista.textContent).toContain("Ana Quente");
  });

  it("a lista tem o relógio da Meta e o \"?\" ensina o link com utm_content={{ad.id}}", async () => {
    const { container } = montar("/anuncios");
    await waitFor(() => expect(container.querySelector("[data-frescor]")).toBeTruthy());
    expect(container.querySelector("[data-frescor]")!.getAttribute("data-frescor")).toBe("velho");
    expect(PARAMETROS_DE_URL_DA_META).toContain("utm_content={{ad.id}}");
    expect(ler("src/pages/AdminAds.tsx")).toMatch(/DICA_DO_LINK_DO_ANUNCIO\}/);
  });
});

describe("regras de código do painel", () => {
  it("sem lookbehind, \\p{} nem grupo nomeado nos arquivos novos", () => {
    for (const arq of [
      "src/components/ads/leadsDosAnuncios.ts",
      "src/components/ads/useLeadsDosAnuncios.ts",
      "src/components/ads/FrescorDaMeta.tsx",
      "src/components/ads/LeadsDoAnuncio.tsx",
      "src/components/ads/OrigemDoLead.tsx",
      "supabase/functions/_shared/origem-clique.ts",
    ]) {
      const t = ler(arq);
      expect(t, arq).not.toMatch(/\(\?<[=!]/);
      expect(t, arq).not.toMatch(/\\p\{/);
      expect(t, arq).not.toMatch(/\(\?<[a-zA-Z]/);
    }
  });
});
