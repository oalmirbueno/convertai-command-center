import { describe, expect, it } from "vitest";
import {
  buildRadarIdeas,
  radarIdeaForClient,
  RADAR_LENSES,
  type RadarClientContext,
} from "./radarIdeas";

const base: RadarClientContext = {
  clientId: "c1",
  clientName: "Padaria do Bairro",
  services: ["social_media"],
  pulseScore: null,
  pulseAgeDays: null,
  releasedLast30: 4,
  publishedLast30: 6,
  publishedTotal: 40,
  hasPublishedReport: true,
  monthsTogether: 5,
  isOneOff: false,
  idleDays: null,
  month: 7,
};

describe("Radar: ideia de diferenciação, não cobrança", () => {
  it("nunca sugere migrar de plano nem reajuste", () => {
    const ideas = buildRadarIdeas(base, 10);
    const texto = JSON.stringify(ideas).toLowerCase();
    expect(texto).not.toContain("reajuste");
    expect(texto).not.toContain("migrar de plano");
    expect(texto).not.toContain("tabela vigente");
    expect(texto).not.toContain("aumentar a mensalidade");
  });

  it("entrega ideias ordenadas pela mais forte primeiro", () => {
    const ideas = buildRadarIdeas(base, 3);
    expect(ideas.length).toBeGreaterThan(0);
    expect(ideas.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < ideas.length; i += 1) {
      expect(ideas[i - 1].score).toBeGreaterThanOrEqual(ideas[i].score);
    }
  });

  it("todas as lentes existentes são do Fator X", () => {
    const ideas = buildRadarIdeas(base, 10);
    for (const idea of ideas) {
      expect(RADAR_LENSES[idea.lens]).toBeTruthy();
    }
  });
});

describe("Radar: a ideia nasce do contexto real", () => {
  it("avulso parado recebe a retomada como prioridade", () => {
    const ideas = buildRadarIdeas(
      { ...base, isOneOff: true, idleDays: 45, services: [] },
      3,
    );
    expect(ideas[0].id).toContain("retomada-avulso");
    expect(ideas[0].whyNow).toContain("45 dias");
  });

  it("Pulso alto e recente abre a jogada de prova e indicação", () => {
    const ideas = buildRadarIdeas({ ...base, pulseScore: 5, pulseAgeDays: 10 }, 3);
    const indicacao = ideas.find((idea) => idea.id.includes("indicacao-momento-alto"));
    expect(indicacao).toBeTruthy();
    expect(indicacao!.whyNow).toContain("nota 5 de 5");
    expect(indicacao!.whyNow).toContain("10 dias");
  });

  it("não oferece impulsionamento para quem já tem tráfego pago", () => {
    const comTrafego = buildRadarIdeas({ ...base, services: ["social_media", "traffic"] }, 10);
    expect(comTrafego.some((idea) => idea.id.includes("alcance-pago-no-validado"))).toBe(false);

    const semTrafego = buildRadarIdeas(base, 10);
    expect(semTrafego.some((idea) => idea.id.includes("alcance-pago-no-validado"))).toBe(true);
  });

  it("não oferece site para quem já tem site, nem automação para quem já tem", () => {
    const comSite = buildRadarIdeas({ ...base, services: ["social_media", "site"] }, 10);
    expect(comSite.some((idea) => idea.id.includes("vitrine-que-vende"))).toBe(false);

    const comAutomacao = buildRadarIdeas({ ...base, services: ["social_media", "automation"] }, 10);
    expect(comAutomacao.some((idea) => idea.id.includes("atendimento-sem-fila"))).toBe(false);
  });

  it("sem relatório publicado não promete caso de resultado", () => {
    const ideas = buildRadarIdeas({ ...base, hasPublishedReport: false }, 10);
    expect(ideas.some((idea) => idea.id.includes("prova-numero-real"))).toBe(false);
  });

  it("cliente novo em casa não recebe caso de resultado ainda", () => {
    const ideas = buildRadarIdeas({ ...base, monthsTogether: 1 }, 10);
    expect(ideas.some((idea) => idea.id.includes("prova-numero-real"))).toBe(false);
  });
});

describe("Radar: contexto real em toda ideia", () => {
  it("cada ideia carrega o momento do cliente com os dados dele", () => {
    const ideas = buildRadarIdeas(
      {
        ...base,
        serviceLabels: ["Social Media"],
        recentMaterials: ["carrossel-outubro-01.png", "story_promo.png"],
        contactsTrendPct: 23,
      },
      3,
    );
    for (const idea of ideas) {
      expect(idea.moment).toContain("Padaria do Bairro");
      expect(idea.moment).toContain("5 meses de trabalho juntos");
      expect(idea.moment).toContain("Social Media");
      expect(idea.moment).toContain("contatos crescendo 23%");
      expect(idea.moment).toContain("carrossel outubro 01");
    }
  });

  it("o texto do cliente abre com o momento antes do motivo", () => {
    const [idea] = buildRadarIdeas({ ...base, serviceLabels: ["Social Media"] }, 1);
    const forClient = radarIdeaForClient(idea);
    expect(forClient.whyNow.startsWith(idea.moment)).toBe(true);
    expect(forClient.whyNow).toContain(idea.whyNow);
  });

  it("crescimento medido entra no caso de resultado", () => {
    const ideas = buildRadarIdeas({ ...base, contactsTrendPct: 40 }, 10);
    const prova = ideas.find((idea) => idea.id.includes("prova-numero-real"));
    expect(prova?.whyNow).toContain("40%");
  });

  it("sem medição, o momento não inventa número de crescimento", () => {
    const ideas = buildRadarIdeas({ ...base, contactsTrendPct: null }, 1);
    expect(ideas[0].moment).not.toContain("crescendo");
    expect(ideas[0].moment).not.toContain("%");
  });
});

describe("Radar: a venda nunca vaza para o cliente", () => {
  it("o texto do cliente não carrega oferta nem valor", () => {
    const ideas = buildRadarIdeas(base, 10);
    for (const idea of ideas) {
      const forClient = radarIdeaForClient(idea);
      const texto = JSON.stringify(forClient).toLowerCase();
      expect(texto).not.toContain(idea.internal.offer.toLowerCase());
      expect(texto).not.toContain("r$");
      expect(texto).not.toContain("valor");
      expect(texto).not.toContain("investimento de");
    }
  });

  it("cada ideia tem leitura interna de oferta e faixa para a equipe", () => {
    const ideas = buildRadarIdeas(base, 10);
    for (const idea of ideas) {
      expect(idea.internal.offer.length).toBeGreaterThan(0);
      expect(idea.internal.range[0]).toBeLessThanOrEqual(idea.internal.range[1]);
      expect(["baixo", "medio", "alto"]).toContain(idea.internal.effort);
    }
  });

  it("sem travessão em nada que o cliente lê", () => {
    const ideas = buildRadarIdeas(base, 10);
    for (const idea of ideas) {
      const texto = [idea.title, idea.pitch, idea.whyNow, idea.signal, ...idea.moves].join(" ");
      expect(texto).not.toMatch(/[—–]/);
    }
  });
});
