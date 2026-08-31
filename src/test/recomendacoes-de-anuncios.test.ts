import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MINIMO_DE_IMPRESSOES, recomendar, resumirCampanha,
  type CampanhaAtiva, type DiaDaCampanha,
} from "@/lib/recomendacoesDeAnuncios";

/**
 * "Faltam recomendações reais."
 *
 * Real quer dizer duas coisas ao mesmo tempo: nascer de dado que já está
 * no painel, e trazer junto a conta que gerou o aviso. Conselho sem número
 * é horóscopo — quem lê não tem como discordar, e por isso também não tem
 * como agir.
 */

const HOJE = "2026-09-01";

const campanha = (id: string, extra: Partial<CampanhaAtiva> = {}): CampanhaAtiva => ({
  campaign_id: id, name: `Campanha ${id}`, effective_status: "ACTIVE",
  objective: "TRAFFIC", daily_budget: null, lifetime_budget: null, ...extra,
});

const dia = (id: string, d: string, v: Partial<DiaDaCampanha> = {}): DiaDaCampanha => ({
  campaign_id: id, day: d, spend: 0, impressions: 0, clicks: 0,
  link_clicks: 0, ctr: null, cpc: null, frequency: null, ...v,
});

describe("o resumo recalcula do total, não pela média das médias", () => {
  it("um dia pequeno não pesa igual a um dia grande", () => {
    // Média de médias faria 10 impressões pesarem como 10 mil, e o CTR
    // resultante não descreveria campanha nenhuma.
    const dias = [
      dia("a", "2026-08-31", { impressions: 10, clicks: 5 }),
      dia("a", "2026-08-30", { impressions: 9990, clicks: 95 }),
    ];
    const r = resumirCampanha(dias, "a");
    expect(r.impressoes).toBe(10_000);
    expect(r.ctr).toBeCloseTo(1.0, 5);
  });

  it("a janela corta pelo dia", () => {
    const dias = [
      dia("a", "2026-08-31", { impressions: 100 }),
      dia("a", "2026-01-01", { impressions: 900 }),
    ];
    expect(resumirCampanha(dias, "a", 14, HOJE).impressoes).toBe(100);
  });

  it("sem clique não inventa CPC", () => {
    const r = resumirCampanha([dia("a", "2026-08-31", { spend: 50 })], "a");
    expect(r.cpc).toBe(0);
  });
});

describe("nenhuma regra opina sem volume", () => {
  it("CTR baixo com poucas impressões não vira aviso", () => {
    // Dizer que um anúncio com 40 impressões tem "CTR ruim" é ler ruído
    // como sinal, e some com a confiança em todos os avisos da tela.
    const campanhas = [campanha("a"), campanha("b")];
    const dias = [
      dia("a", "2026-08-31", { impressions: 40, clicks: 0, spend: 1 }),
      dia("b", "2026-08-31", { impressions: 50_000, clicks: 1000, spend: 200 }),
    ];
    const avisos = recomendar(campanhas, dias, HOJE);
    expect(avisos.filter((r) => r.campaign_id === "a" && r.titulo.includes("CTR"))).toHaveLength(0);
  });

  it("gasto minúsculo sem clique também não alarma", () => {
    const dias = [dia("a", "2026-08-31", { spend: 3, impressions: 900, link_clicks: 0 })];
    const avisos = recomendar([campanha("a")], dias, HOJE);
    expect(avisos.filter((r) => r.titulo.includes("Gasto sem clique"))).toHaveLength(0);
  });
});

describe("as regras que devem disparar", () => {
  it("gasto real sem nenhum clique no link é o mais grave", () => {
    const dias = [dia("a", "2026-08-31", { spend: 120, impressions: 20_000, link_clicks: 0, clicks: 10 })];
    const [aviso] = recomendar([campanha("a")], dias, HOJE);
    expect(aviso.titulo).toBe("Gasto sem clique no link");
    expect(aviso.gravidade).toBe("alta");
    // O NÚMERO tem que estar no texto: sem ele o aviso vira palpite.
    expect(aviso.porque).toContain("R$");
    expect(aviso.porque).toContain("20.000");
  });

  it("frequência alta vira aviso de fadiga", () => {
    const dias = [dia("a", "2026-08-31", {
      spend: 100, impressions: 5000, clicks: 100, link_clicks: 50, frequency: 4.2,
    })];
    const avisos = recomendar([campanha("a")], dias, HOJE);
    const fadiga = avisos.find((r) => r.titulo.includes("vendo demais"));
    expect(fadiga).toBeDefined();
    expect(fadiga!.porque).toContain("4.2");
  });

  it("CTR compara com a média da PRÓPRIA conta, não com um número de mercado", () => {
    // 1% é bom num nicho e ruim em outro; a única régua que se sustenta
    // sem chutar contexto é o histórico da casa.
    const campanhas = [campanha("boa"), campanha("ruim")];
    const dias = [
      dia("boa", "2026-08-31", { impressions: 10_000, clicks: 300, link_clicks: 200, spend: 100 }),
      dia("ruim", "2026-08-31", { impressions: 10_000, clicks: 50, link_clicks: 30, spend: 100 }),
    ];
    const avisos = recomendar(campanhas, dias, HOJE);
    const ctr = avisos.filter((r) => r.titulo.includes("CTR"));
    expect(ctr).toHaveLength(1);
    expect(ctr[0].campaign_id).toBe("ruim");
    expect(ctr[0].porque).toContain("da conta");
  });

  it("campanha ativa sem entrega nenhuma alarma", () => {
    const avisos = recomendar([campanha("a")], [], HOJE);
    expect(avisos.some((r) => r.titulo.includes("sem entrega"))).toBe(true);
  });

  it("orçamento no teto avisa sem afirmar que é bom ou ruim", () => {
    // Teto batendo pode ser bom ou péssimo; o painel não tem como saber e
    // não finge que sabe.
    const dias = [dia("a", "2026-09-01", { spend: 49, impressions: 3000, clicks: 60, link_clicks: 40 })];
    const avisos = recomendar([campanha("a", { daily_budget: 50 })], dias, HOJE);
    const teto = avisos.find((r) => r.titulo.includes("teto"));
    expect(teto).toBeDefined();
    expect(teto!.acao).toContain("Se o resultado está bom");
  });
});

describe("a ordem e o escopo", () => {
  it("o mais grave vem primeiro", () => {
    const campanhas = [campanha("a", { daily_budget: 50 }), campanha("b")];
    const dias = [
      dia("a", "2026-09-01", { spend: 49, impressions: 3000, clicks: 60, link_clicks: 40 }),
      dia("b", "2026-08-31", { spend: 120, impressions: 20_000, link_clicks: 0, clicks: 10 }),
    ];
    expect(recomendar(campanhas, dias, HOJE)[0].gravidade).toBe("alta");
  });

  it("campanha pausada não gera recomendação", () => {
    const avisos = recomendar([campanha("a", { effective_status: "PAUSED" })], [], HOJE);
    expect(avisos).toHaveLength(0);
  });

  it("o mínimo de impressões está declarado, e não escondido num número solto", () => {
    expect(MINIMO_DE_IMPRESSOES).toBeGreaterThan(0);
  });
});

describe("a tela das campanhas ativas", () => {
  const comp = readFileSync(
    resolve(__dirname, "../..", "src/components/ads/CampanhasAtivas.tsx"), "utf8");

  it("atualiza sozinha", () => {
    expect(comp).toContain("refetchInterval: 60_000");
  });

  it("falha de leitura não vira 'nenhuma campanha ativa'", () => {
    expect(comp).toContain("Nenhuma campanha está sendo dada como parada");
  });

  it("zero de hoje não é chamado de parado", () => {
    // A Meta consolida o dia com atraso; chamar isso de parado às 9h da
    // manhã seria alarme falso.
    expect(comp).toContain("consolida o dia com algumas horas de atraso");
  });

  it("está montada nos dois caminhos da página de anúncios", () => {
    // Passou a ter DOIS pontos de montagem, de propósito: dentro do
    // cliente (só as campanhas dele) e na lista geral (com o nome do
    // cliente em cada uma). Um só não atendia os dois casos.
    const pagina = readFileSync(
      resolve(__dirname, "../..", "src/pages/AdminAds.tsx"), "utf8");
    expect(pagina).toContain("<CampanhasAtivas clientId={clienteAberto} />");
    expect(pagina).toContain("nomesDeClientes={nomes}");
    expect((pagina.match(/<CampanhasAtivas/g) ?? [])).toHaveLength(2);
  });
});
