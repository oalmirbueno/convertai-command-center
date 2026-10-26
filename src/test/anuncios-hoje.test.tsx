import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { statusLabel } from "@/lib/adsLanguage";
import { normalizarAcao, precisaDeVoce } from "@/lib/anunciosHoje";

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
  ],
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => {
      const q: any = {};
      ["select", "order", "eq"].forEach((m) => (q[m] = () => q));
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

import AnunciosHoje from "@/pages/AnunciosHoje";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(AnunciosHoje))));
}

afterEach(() => cleanup());

describe("Anúncios hoje", () => {
  it("mostra o último boletim, o que mudou nas contas e o que precisa de você", async () => {
    montar();
    await waitFor(() => expect(screen.getByText("Conta da Casa gastou 120 e trouxe 9 conversas.")).toBeTruthy());
    // Alertas por nível (urgente primeiro) e a linha por cliente.
    const boletim = document.querySelector("[data-boletim]") as HTMLElement;
    expect(within(boletim).getByText("Urgente")).toBeTruthy();
    expect(within(boletim).getByText("Melhor criativo: vídeo 2")).toBeTruthy();
    // Mudança com antes → depois, motivo e prova.
    await waitFor(() => expect(document.querySelectorAll("[data-mudanca]").length).toBe(1));
    const mudanca = document.querySelector("[data-mudanca]") as HTMLElement;
    expect(mudanca.textContent).toContain("Conjunto Remarketing");
    expect(mudanca.textContent).toContain("R$ 30/dia");
    expect(mudanca.textContent).toContain("R$ 45/dia");
    expect(mudanca.textContent).toContain("CPA 40% abaixo da meta");
    expect(within(mudanca).getByLabelText("Abrir a prova").getAttribute("href")).toBe("https://exemplo.com/print.png");
    // Precisa de você: saldo baixo, alerta urgente, proposta pendente, terminada e vencendo.
    await waitFor(() => expect(document.querySelectorAll("[data-pedido]").length).toBe(5));
    const tipos = Array.from(document.querySelectorAll("[data-pedido]")).map((x) => x.getAttribute("data-pedido"));
    expect(tipos).toEqual(["saldo", "alerta", "decisao", "terminada", "vencendo"]);
    expect(screen.getByText(/"Black Friday" terminou em/)).toBeTruthy();
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
