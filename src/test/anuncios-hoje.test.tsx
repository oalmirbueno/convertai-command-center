import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { statusLabel } from "@/lib/adsLanguage";
import { clientesComAnuncioAtivo, diaLocal, montarCartoes, normalizarAcao, precisaDeVoce, tomDoCusto } from "@/lib/anunciosHoje";

/**
 * 26/10/2026: página /anuncios/hoje com o boletim do Hermes, o que mudou nas
 * contas (antes → depois, motivo, prova) e o que precisa do dono. Campanha
 * ACTIVE com fim no passado aparece como terminada.
 */

const AGORA = Date.now();
const ontem = new Date(AGORA - 86_400_000).toISOString();
const daquiADoisDias = new Date(AGORA + 2 * 86_400_000).toISOString();

const tabelas: Record<string, unknown[] | { erro: { message: string; code?: string } }> = {
  ads_boletins: [
    { id: "b1", periodo: "manha", resumo: "Conta da Casa gastou 120 e trouxe 9 conversas.", alertas: [{ client_id: "c1", nivel: "critico", texto: "Saldo acaba amanhã" }, { nivel: "info", texto: "CPM estável" }], por_cliente: [{ client_id: "c1", gasto: 120, resultado: 9, observacao: "Melhor criativo: vídeo 2" }], texto_completo: "Texto inteiro do boletim", criado_em: new Date(AGORA - 3_600_000).toISOString(), operator: "default" },
    { id: "b0", periodo: "tarde", resumo: "Ontem à tarde", alertas: [], por_cliente: [], texto_completo: "", criado_em: ontem, operator: "default" },
  ],
  ads_rotina_acoes: [
    // Formato do MCP 2.19 (sem colunas novas): alvo e prova em jsonb.
    { id: "a1", client_id: "c1", criado_em: new Date(AGORA - 1_800_000).toISOString(), origem: "agente", tipo: "orcamento", estado: "feita", resumo: "Subiu a verba do remarketing", porque: "CPA 40% abaixo da meta", alvo: { nivel: "conjunto", meta_id: "238", nome: "Conjunto Remarketing", conta_id: "act_1" }, prova: { antes: "R$ 30/dia", depois: "R$ 45/dia", prova_url: "https://exemplo.com/print.png", operator: "paperclip", acao: "verba", fonte: "composio" } },
    { id: "a2", client_id: "c1", criado_em: new Date(AGORA - 600_000).toISOString(), tipo: "pausar", resumo: "Pausar anúncio 3", porque: "Gasto sem resultado", alvo: { nome: "Anúncio 3" }, prova: {}, estado: "proposta", origem: "agente" },
  ],
  ads_campaigns: [
    { id: "k1", client_id: "c1", name: "Black Friday", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: 50, stop_time: ontem, external_account_id: "act_1" },
    { id: "k2", client_id: "c1", name: "Leads Outubro", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: 40, stop_time: daquiADoisDias, external_account_id: "act_1" },
    // Stop só tem campanha pausada: não está ativa na Mesa Ads, não aparece.
    { id: "k3", client_id: "c2", name: "Tráfego site", status: "PAUSED", effective_status: "PAUSED", daily_budget: 20, stop_time: null, external_account_id: "act_2" },
  ],
  ads_campaign_daily: [
    { client_id: "c1", campaign_id: "k2", objective: "OUTCOME_LEADS", day: diaLocal(AGORA), spend: 30, actions: [{ action_type: "onsite_conversion.lead_grouped", value: 3 }] },
    { client_id: "c1", campaign_id: "k2", objective: "OUTCOME_LEADS", day: diaLocal(AGORA - 8 * 86_400_000), spend: 30, actions: [{ action_type: "onsite_conversion.lead_grouped", value: 3 }] },
    { client_id: "c2", campaign_id: "k3", objective: "OUTCOME_TRAFFIC", day: diaLocal(AGORA), spend: 20, actions: [] },
  ],
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => {
      const q: any = {};
      ["select", "order", "eq", "gte", "in"].forEach((m) => (q[m] = () => q));
      q.limit = async () => {
        const t = tabelas[tabela];
        if (t && !Array.isArray(t)) return { data: null, error: t.erro };
        return { data: t ?? [], error: null };
      };
      return q;
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1" }, profile: { role: "admin" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({ useClients: () => ({ data: [{ id: "c1", company_name: "Casa dos Assados" }, { id: "c2", company_name: "Stop" }] }) }));
vi.mock("@/hooks/useAdsMetrics", () => ({
  useAdsConnection: () => ({ data: { agencia: null, contas: [{ id: "x", client_id: "c1", display_name: "Conta 01", external_id: "act_1", status: "active", token_proprio: false, ultima_coleta: null, saldo_disponivel: 80 }] }, refetch: vi.fn() }),
}));

vi.mock("@/components/admin/LogoDoCliente", async (orig) => ({ ...(await orig<any>()), useIdentidadesDosClientes: () => ({ data: new Map() }) }));

import AnunciosHoje from "@/pages/AnunciosHoje";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(AnunciosHoje))));
}

afterEach(() => cleanup());

describe("Anúncios hoje", () => {
  it("um cartão por cliente com anúncio ativo na Mesa Ads: gasto x teto, resultado, campanhas, saldo, última mudança e uma ação", async () => {
    montar();
    await waitFor(() => expect(document.querySelectorAll("[data-cartao-de-anuncio]").length).toBe(1));
    // Só a Casa (campanha no ar); a Stop tem só campanha pausada e fica fora.
    expect(document.querySelector('[data-cartao-de-anuncio="c1"]')).toBeTruthy();
    expect(document.querySelector('[data-cartao-de-anuncio="c2"]')).toBeNull();
    const cartao = document.querySelector('[data-cartao-de-anuncio="c1"]') as HTMLElement;
    expect(cartao.textContent).toContain("Casa dos Assados");
    // Gasto de hoje contra o teto (só a campanha no ar: R$ 40/dia).
    expect(cartao.textContent).toMatch(/HojeR\$\s30,00 \/ R\$\s40,00/);
    // Resultado principal (leads) e custo igual à semana anterior: bom.
    expect(cartao.querySelector("[data-resultado]")!.textContent).toContain("Leads em 7 dias");
    expect(cartao.querySelector("[data-tom]")!.getAttribute("data-tom")).toBe("bom");
    // Campanhas: terminada (ACTIVE com fim no passado) e terminando, com data.
    expect(Array.from(cartao.querySelectorAll("[data-campanha]")).map((x) => x.getAttribute("data-campanha"))).toEqual(["terminada", "terminando"]);
    expect(cartao.textContent).toMatch(/terminou \d{2}\/\d{2}/);
    // Saldo baixo (R$ 80 não cobre 3 dias de R$ 40).
    expect(cartao.querySelector("[data-saldo]")!.getAttribute("data-saldo")).toBe("baixo");
    // Última mudança do agente: antes → depois e prova.
    const mudanca = cartao.querySelector("[data-ultima-mudanca]") as HTMLElement;
    expect(mudanca.textContent).toContain("Conjunto Remarketing");
    expect(mudanca.textContent).toContain("R$ 30/dia");
    expect(mudanca.textContent).toContain("R$ 45/dia");
    expect(within(mudanca).getByLabelText("Abrir a prova").getAttribute("href")).toBe("https://exemplo.com/print.png");
    // Uma ação: a proposta pendente vira "Decidir a proposta" na Mesa Ads (etapa Conta).
    const acao = cartao.querySelector("[data-acao-do-cartao]") as HTMLAnchorElement;
    expect(acao.textContent).toContain("Decidir a proposta");
    expect(acao.getAttribute("href")).toBe("/mesa-ads?client=c1&etapa=conta");
    // Topo: os números da carteira; o boletim fica numa linha e abre o resumo curto.
    expect(document.querySelector("[data-numeros-da-carteira]")!.textContent).toContain("Gasto hoje");
    expect(screen.getByText("Boletim das 9h")).toBeTruthy();
    expect(document.querySelector("[data-resumo-do-boletim]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Boletim das 9h/ }));
    const resumo = document.querySelector("[data-resumo-do-boletim]") as HTMLElement;
    expect(within(resumo).getByText("Urgente")).toBeTruthy();
    expect(resumo.textContent).toContain("Conta da Casa gastou 120 e trouxe 9 conversas.");
  });

  it("filtro da Mesa Ads: só campanha no ar conta como cliente ativo", () => {
    const campanhas = tabelas.ads_campaigns as never[];
    expect(clientesComAnuncioAtivo(campanhas, AGORA)).toEqual(["c1"]);
    // Só com a campanha que já terminou (ACTIVE com fim passado), a Casa sai.
    expect(clientesComAnuncioAtivo([campanhas[0]], AGORA)).toEqual([]);
    const cartoes = montarCartoes({ campanhas, dias: tabelas.ads_campaign_daily as never, contas: [], acoes: [], boletim: null, agora: AGORA });
    expect(cartoes.map((c) => c.clientId)).toEqual(["c1"]);
    expect(cartoes[0]).toMatchObject({ gastoHoje: 30, tetoDia: 40, resultados: 3, nomeDoResultado: "leads" });
  });

  it("cor do custo: bom, atenção, ruim e gasto sem resultado", () => {
    expect(tomDoCusto(10, 10, 100, 10)).toBe("bom");
    expect(tomDoCusto(12.5, 10, 100, 8)).toBe("atencao");
    expect(tomDoCusto(20, 10, 100, 5)).toBe("ruim");
    expect(tomDoCusto(null, 10, 80, 0)).toBe("ruim");
    expect(tomDoCusto(10, null, 100, 10)).toBe("neutro");
  });

  it("tabela ainda não criada no banco: estado claro, sem erro", async () => {
    const guardado = tabelas.ads_boletins;
    tabelas.ads_boletins = { erro: { message: 'relation "public.ads_boletins" does not exist', code: "42P01" } };
    try {
      montar();
      await waitFor(() => expect(screen.getByText("O boletim ainda não chega a este painel.")).toBeTruthy());
      expect(screen.queryByText("Não foi possível ler o boletim.")).toBeNull();
    } finally {
      tabelas.ads_boletins = guardado;
    }
  });

  it("campanha ACTIVE com fim no passado é terminada, não ativa", () => {
    expect(statusLabel("ACTIVE", "ACTIVE", ontem)).toMatchObject({ label: "Terminada", noAr: false });
    expect(statusLabel("ACTIVE", "ACTIVE", daquiADoisDias)).toMatchObject({ label: "No ar", noAr: true });
    expect(statusLabel("ACTIVE", "ACTIVE", null)).toMatchObject({ noAr: true });
  });

  it("lê as ações nas duas formas (colunas novas e antigas)", () => {
    const antiga = normalizarAcao(tabelas.ads_rotina_acoes && (tabelas.ads_rotina_acoes as unknown[])[1]);
    expect(antiga).toMatchObject({ acao: "Pausou", alvoNome: "Anúncio 3", motivo: "Gasto sem resultado", estado: "proposta" });
    const pedidos = precisaDeVoce({ contas: [], campanhas: [], acoes: [antiga], boletim: null, nomeDe: () => "Casa", agora: AGORA });
    expect(pedidos[0].tipo).toBe("decisao");
  });
});
