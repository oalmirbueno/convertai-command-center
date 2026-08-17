import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ClientLiveCampaigns from "@/components/reports/ClientLiveCampaigns";

/**
 * O bloco que o CLIENTE vê. Aqui o teste monta a tela de verdade, com dados no
 * formato que a Meta devolve, e lê o que apareceu — porque a promessa é sobre
 * o texto na tela, e só olhando o texto renderizado dá para garantir.
 */

const DIAS = [
  {
    id: "1",
    client_id: "cliente",
    external_account_id: "conta",
    captured_at: "2026-08-17T12:00:00Z",
    campaign_id: "120210",
    campaign_name: "Conversas | Mirante",
    objective: "OUTCOME_ENGAGEMENT",
    day: "2026-08-16",
    spend: "37.42",
    impressions: 4821,
    reach: 3910,
    clicks: 142,
    link_clicks: 98,
    ctr: "2.945",
    cpc: "0.263",
    cpm: "7.76",
    frequency: "1.233",
    actions: [
      { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "11" },
    ],
    cost_per_action: [],
  },
];

const CAMPANHAS = [
  {
    id: "c1",
    client_id: "cliente",
    external_account_id: "conta",
    campaign_id: "120210",
    name: "Conversas | Mirante",
    status: "ACTIVE",
    effective_status: "ACTIVE",
    objective: "OUTCOME_ENGAGEMENT",
    daily_budget: 30,
    lifetime_budget: null,
    start_time: "2026-08-01T13:00:00Z",
    stop_time: null,
    updated_at: "2026-08-17T12:00:00Z",
  },
];

const dados = vi.hoisted(() => ({ dias: [] as any[], campanhas: [] as any[] }));

vi.mock("@/hooks/useAdsMetrics", () => ({
  useAdsDaily: () => ({ data: dados.dias }),
  useAdsCampaigns: () => ({ data: dados.campanhas }),
}));

describe("campanhas ao vivo na tela do cliente", () => {
  it("mostra o dinheiro, o alcance e o resultado pelo nome", () => {
    dados.dias = DIAS;
    dados.campanhas = CAMPANHAS;
    render(<ClientLiveCampaigns clientId="cliente" />);

    expect(screen.getByText("Conversas | Mirante")).toBeTruthy();
    // O alcance aparece duas vezes de propósito: no total da conta e na linha
    // da campanha. Com uma campanha só, os dois números coincidem.
    expect(screen.getAllByText(/3\.910/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/11 conversas iniciadas/)).toBeTruthy();
    expect(screen.getByText(/No ar/)).toBeTruthy();
    expect(screen.getAllByText(/R\$\s?37,42/).length).toBeGreaterThanOrEqual(1);
  });

  it("nenhuma sigla da Meta chega ao cliente", () => {
    dados.dias = DIAS;
    dados.campanhas = CAMPANHAS;
    const { container } = render(<ClientLiveCampaigns clientId="cliente" />);
    const texto = container.textContent || "";

    // Foi o que motivou esta camada: o cliente não sabe (nem precisa saber) o
    // que é CTR, CPM ou impressão.
    expect(texto).not.toMatch(/\bCTR\b|\bCPC\b|\bCPM\b/);
    expect(texto).not.toMatch(/impress/i);
    expect(texto).not.toMatch(/OUTCOME_|onsite_conversion|action_type/);
  });

  it("explica para que serve cada número", () => {
    dados.dias = DIAS;
    dados.campanhas = CAMPANHAS;
    const { container } = render(<ClientLiveCampaigns clientId="cliente" />);
    expect(container.textContent).toContain("Quantas pessoas diferentes viram o anúncio");
  });

  it("sem campanha rodando, não aparece nada em vez de anunciar vazio", () => {
    dados.dias = [];
    dados.campanhas = [];
    const { container } = render(<ClientLiveCampaigns clientId="cliente" />);
    expect(container.textContent).toBe("");
  });

  it("campanha sem gasto não polui a tela", () => {
    dados.dias = [{ ...DIAS[0], spend: "0" }];
    dados.campanhas = CAMPANHAS;
    const { container } = render(<ClientLiveCampaigns clientId="cliente" />);
    expect(container.textContent).toBe("");
  });
});
