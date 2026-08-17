import { describe, expect, it } from "vitest";
import {
  clientCampaignLine,
  clientCampaignSentence,
  goalForCampaign,
  goalForObjective,
  resultFromActions,
  statusLabel,
  summarizeAccount,
  summarizeCampaign,
  teamAlert,
  teamCampaignLine,
  type AdsDailyRow,
} from "@/lib/adsLanguage";

/**
 * A Meta fala "OUTCOME_LEADS" e
 * "onsite_conversion.messaging_conversation_started_7d". O cliente precisa ler
 * quanto investiu e o que ganhou. Estes testes guardam essa tradução.
 */

const dia = (over: Partial<AdsDailyRow> = {}): AdsDailyRow => ({
  campaign_id: "1",
  campaign_name: "Conversas | Mirante",
  objective: "OUTCOME_ENGAGEMENT",
  day: "2026-08-16",
  spend: "10.00",
  impressions: 1000,
  reach: 800,
  clicks: 40,
  link_clicks: 30,
  ctr: "3.0",
  cpc: "0.33",
  cpm: "10.0",
  frequency: "1.25",
  actions: null,
  cost_per_action: null,
  ...over,
});

describe("objetivo da Meta vira meta em português", () => {
  it("reconhece os objetivos novos", () => {
    expect(goalForObjective("OUTCOME_LEADS").kind).toBe("contatos");
    expect(goalForObjective("OUTCOME_SALES").kind).toBe("vendas");
    expect(goalForObjective("OUTCOME_TRAFFIC").kind).toBe("visitas");
    expect(goalForObjective("OUTCOME_AWARENESS").kind).toBe("alcance");
  });

  it("reconhece os objetivos antigos, que ainda aparecem em conta com histórico", () => {
    expect(goalForObjective("LEAD_GENERATION").kind).toBe("contatos");
    expect(goalForObjective("MESSAGES").kind).toBe("conversas");
    expect(goalForObjective("LINK_CLICKS").kind).toBe("visitas");
    expect(goalForObjective("VIDEO_VIEWS").kind).toBe("video");
  });

  it("objetivo desconhecido não quebra nem inventa", () => {
    expect(goalForObjective(null).kind).toBe("outro");
    expect(goalForObjective("COISA_NOVA_DA_META").label).toBeTruthy();
  });
});

describe("objetivo ambíguo: quem decide é o que a campanha produziu", () => {
  const conversa = [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "11" }];

  it("engajamento com conversa é campanha de conversa", () => {
    // "OUTCOME_ENGAGEMENT" cobre desde WhatsApp até curtida; o objetivo sozinho
    // não separa. Sem esta regra o cliente via 0 resultado onde havia 11 conversas.
    expect(goalForCampaign("OUTCOME_ENGAGEMENT", conversa).kind).toBe("conversas");
  });

  it("engajamento sem conversa continua sendo engajamento", () => {
    expect(goalForCampaign("OUTCOME_ENGAGEMENT", [{ action_type: "post_engagement", value: "80" }]).kind)
      .toBe("outro");
  });

  it("objetivo claro não é substituído pelo que sobrou", () => {
    // Campanha de venda sem venda tem zero venda. Trocar por engajamento faria
    // o cliente ler curtida como compra.
    expect(goalForCampaign("OUTCOME_SALES", [{ action_type: "post_engagement", value: "50" }]).kind)
      .toBe("vendas");
  });

  it("sem dado nenhum, fica com o que o objetivo diz", () => {
    expect(goalForCampaign("OUTCOME_LEADS", []).kind).toBe("contatos");
  });
});

describe("qual número é o resultado", () => {
  it("campanha de mensagem conta conversa iniciada", () => {
    const achado = resultFromActions(
      [
        { action_type: "link_click", value: "98" },
        { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "11" },
      ],
      "OUTCOME_ENGAGEMENT",
    );
    // Sem isso, a tela mostraria 98 "resultados" que não são resultado nenhum.
    expect(achado).toEqual({ count: 11, actionType: "onsite_conversion.messaging_conversation_started_7d" });
  });

  it("campanha de contato prefere o cadastro ao clique", () => {
    const achado = resultFromActions(
      [
        { action_type: "link_click", value: "300" },
        { action_type: "offsite_conversion.fb_pixel_lead", value: "7" },
      ],
      "OUTCOME_LEADS",
    );
    expect(achado?.count).toBe(7);
  });

  it("sem o tipo que casa com o objetivo, não inventa resultado", () => {
    expect(resultFromActions([{ action_type: "post_engagement", value: "50" }], "OUTCOME_SALES")).toBeNull();
    expect(resultFromActions(null, "OUTCOME_LEADS")).toBeNull();
  });
});

describe("situação da campanha", () => {
  it("o que a Meta faz ganha do que está configurado", () => {
    // Campanha marcada ativa mas parada pela Meta: quem lê precisa saber disso.
    expect(statusLabel("ACTIVE", "WITH_ISSUES")).toMatchObject({ noAr: false, tone: "atencao" });
    expect(statusLabel("ACTIVE", "ACTIVE")).toMatchObject({ label: "No ar", noAr: true });
  });

  it("traduz pausada e encerrada", () => {
    expect(statusLabel("PAUSED").label).toBe("Pausada");
    expect(statusLabel("ARCHIVED").label).toBe("Encerrada");
  });
});

describe("resumo do período", () => {
  it("soma o gasto e NÃO soma o alcance", () => {
    // A mesma pessoa alcançada em dois dias não são duas pessoas. Somar
    // inflaria o número e o cliente veria diferente no Gerenciador.
    const resumo = summarizeCampaign([
      dia({ day: "2026-08-15", spend: "10.00", reach: 800, impressions: 1000 }),
      dia({ day: "2026-08-16", spend: "15.00", reach: 900, impressions: 1200 }),
    ])!;
    expect(resumo.investido).toBe(25);
    expect(resumo.alcance).toBe(900);
    expect(resumo.exibicoes).toBe(2200);
    expect(resumo.dias).toBe(2);
  });

  it("calcula custo por resultado a partir dos dias", () => {
    const resumo = summarizeCampaign([
      dia({ day: "2026-08-15", spend: "30.00", actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "6" }] }),
      dia({ day: "2026-08-16", spend: "30.00", actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "6" }] }),
    ])!;
    expect(resumo.resultados).toBe(12);
    expect(resumo.custoPorResultado).toBe(5);
  });

  it("sem dia nenhum devolve nulo em vez de zeros", () => {
    expect(summarizeCampaign([])).toBeNull();
  });

  it("a carteira soma as campanhas do gestor", () => {
    const carteira = summarizeAccount([
      dia({ campaign_id: "1", spend: "10.00", reach: 500 }),
      dia({ campaign_id: "2", spend: "20.00", reach: 700 }),
    ]);
    expect(carteira.campanhas).toBe(2);
    expect(carteira.investido).toBe(30);
  });
});

describe("a leitura do cliente", () => {
  const resumo = summarizeCampaign([
    dia({
      spend: "37.42",
      reach: 3910,
      actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "11" }],
    }),
  ])!;

  it("fala de dinheiro e de ganho, com o resultado pelo nome", () => {
    const linha = clientCampaignLine(resumo);
    expect(linha).toContain("3.910 pessoas alcançadas");
    expect(linha).toContain("11 conversas iniciadas");
  });

  it("não deixa vazar jargão da Meta para o cliente", () => {
    const texto = `${clientCampaignLine(resumo)} ${clientCampaignSentence(resumo)}`;
    expect(texto).not.toMatch(/CTR|CPC|CPM|impress|OUTCOME|onsite_conversion|action_type/i);
  });

  it("explica para que a campanha existe", () => {
    expect(clientCampaignSentence(resumo)).toContain("abrir conversas");
  });

  it("sem resultado casado, mostra clique em vez de sumir com tudo", () => {
    const semResultado = summarizeCampaign([dia({ actions: [], link_clicks: 30 })])!;
    expect(clientCampaignLine(semResultado)).toContain("30 cliques no link");
  });
});

describe("a leitura da equipe", () => {
  it("traz o que serve para operar", () => {
    const resumo = summarizeCampaign([dia()])!;
    const linha = teamCampaignLine(resumo);
    expect(linha).toContain("CTR");
    expect(linha).toContain("freq.");
  });

  it("avisa quando a mesma pessoa já viu demais", () => {
    const cansada = summarizeCampaign([dia({ impressions: 5000, reach: 1000, spend: "80.00" })])!;
    expect(teamAlert(cansada)).toMatch(/trocar o criativo/i);
  });

  it("avisa quando o dinheiro saiu e o resultado não veio", () => {
    const semRetorno = summarizeCampaign([
      dia({ spend: "120.00", impressions: 900, reach: 700, actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "0" }] }),
    ])!;
    expect(teamAlert(semRetorno)).toMatch(/sem conversa iniciada ainda/i);
  });

  it("campanha saudável não gera alerta, para o aviso não virar ruído", () => {
    const boa = summarizeCampaign([
      dia({ spend: "40.00", impressions: 2000, reach: 1600, link_clicks: 60, actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "8" }] }),
    ])!;
    expect(teamAlert(boa)).toBeNull();
  });
});
