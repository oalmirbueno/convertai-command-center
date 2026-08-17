/**
 * A tradução do Meta Ads para a língua de quem lê.
 *
 * A Meta devolve "OUTCOME_LEADS", "onsite_conversion.messaging_conversation_started_7d"
 * e "inline_link_clicks". Nada disso significa alguma coisa para o cliente — e,
 * sendo honesto, metade também não significa para quem só olha o painel de vez
 * em quando. Este arquivo é a camada que transforma isso em frase.
 *
 * Três leituras da MESMA campanha, porque três pessoas diferentes precisam de
 * coisas diferentes:
 *   cliente  -> o que ele ganhou com o dinheiro que colocou
 *   equipe   -> o que está caro, o que rendeu, o que precisa de ação
 *   gestor   -> a soma da carteira, para saber onde entrar
 *
 * A escolha de QUAL número é "o resultado" mora aqui, e não no banco, porque
 * depende do objetivo da campanha e é exatamente o tipo de regra que erra e
 * precisa de teste. O banco guarda a lista crua de resultados da Meta.
 */

export interface AdsAction {
  action_type: string;
  value: string | number;
}

export interface AdsDailyRow {
  campaign_id: string;
  campaign_name: string | null;
  objective: string | null;
  day: string;
  spend: number | string | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  link_clicks: number | null;
  ctr: number | string | null;
  cpc: number | string | null;
  cpm: number | string | null;
  frequency: number | string | null;
  actions: AdsAction[] | null;
  cost_per_action: AdsAction[] | null;
}

const num = (value: unknown): number => {
  const parsed = typeof value === "string" ? Number(value) : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/* ──────────────────────────── o que a campanha busca ─────────────────────── */

export type GoalKind = "contatos" | "vendas" | "conversas" | "visitas" | "alcance" | "video" | "outro";

interface Goal {
  kind: GoalKind;
  /** O objetivo em uma expressão que cabe numa frase. */
  label: string;
  /** Como chamar UM resultado desta campanha. */
  resultSingular: string;
  resultPlural: string;
  /** Os nomes que a Meta usa para esse resultado, do mais específico ao menos. */
  actionTypes: string[];
}

const METAS: Record<GoalKind, Goal> = {
  contatos: {
    kind: "contatos",
    label: "trazer contatos de quem tem interesse",
    resultSingular: "contato",
    resultPlural: "contatos",
    actionTypes: [
      "onsite_conversion.lead_grouped",
      "offsite_conversion.fb_pixel_lead",
      "lead",
      "leadgen.other",
    ],
  },
  vendas: {
    kind: "vendas",
    label: "gerar vendas",
    resultSingular: "venda",
    resultPlural: "vendas",
    actionTypes: [
      "offsite_conversion.fb_pixel_purchase",
      "purchase",
      "omni_purchase",
    ],
  },
  conversas: {
    kind: "conversas",
    label: "abrir conversas com clientes novos",
    resultSingular: "conversa iniciada",
    resultPlural: "conversas iniciadas",
    actionTypes: [
      "onsite_conversion.messaging_conversation_started_7d",
      "onsite_conversion.total_messaging_connection",
      "messaging_conversation_started_7d",
    ],
  },
  visitas: {
    kind: "visitas",
    label: "levar gente até o site",
    resultSingular: "visita",
    resultPlural: "visitas",
    actionTypes: ["landing_page_view", "link_click"],
  },
  alcance: {
    kind: "alcance",
    label: "colocar a marca na frente de mais gente",
    resultSingular: "pessoa alcançada",
    resultPlural: "pessoas alcançadas",
    actionTypes: [],
  },
  video: {
    kind: "video",
    label: "fazer mais gente assistir ao vídeo",
    resultSingular: "visualização do vídeo",
    resultPlural: "visualizações do vídeo",
    actionTypes: ["video_view"],
  },
  outro: {
    kind: "outro",
    label: "gerar movimento para o negócio",
    resultSingular: "resultado",
    resultPlural: "resultados",
    actionTypes: ["post_engagement", "page_engagement"],
  },
};

/** O objetivo da Meta, novo ou antigo, cai em uma das metas acima. */
export function goalForObjective(objective: string | null | undefined): Goal {
  const chave = String(objective || "").toUpperCase();
  if (/LEAD/.test(chave)) return METAS.contatos;
  if (/SALES|CONVERSION|CATALOG|PRODUCT/.test(chave)) return METAS.vendas;
  if (/MESSAG/.test(chave)) return METAS.conversas;
  if (/TRAFFIC|LINK_CLICKS/.test(chave)) return METAS.visitas;
  if (/VIDEO/.test(chave)) return METAS.video;
  if (/AWARENESS|REACH/.test(chave)) return METAS.alcance;
  return METAS.outro;
}

/**
 * Da meta mais valiosa para a menos, quando o objetivo não decide sozinho.
 * Uma venda vale mais que um contato, que vale mais que uma conversa.
 */
const ORDEM_DE_VALOR: Goal[] = [
  METAS.vendas,
  METAS.contatos,
  METAS.conversas,
  METAS.visitas,
  METAS.video,
  METAS.outro,
];

/**
 * A meta REAL da campanha, olhando também o que ela produziu.
 *
 * O objetivo sozinho não basta. Na taxonomia nova da Meta, "OUTCOME_ENGAGEMENT"
 * cobre desde conversa no WhatsApp até curtida em publicação, e "OUTCOME_LEADS"
 * cobre formulário E mensagem — quem separa é o destino escolhido, que não vem
 * nesse campo. Uma campanha de conversas ficava lida como "movimento para o
 * negócio" e o cliente via 0 resultado onde havia 11 conversas.
 *
 * Então: se o objetivo aponta um tipo que apareceu de fato, vale o objetivo.
 * Se não, vale o resultado mais valioso que a campanha realmente entregou.
 */
export function goalForCampaign(
  objective: string | null | undefined,
  actions: AdsAction[] | null | undefined,
): Goal {
  const lista = Array.isArray(actions) ? actions : [];
  const presentes = new Set(lista.map((item) => item?.action_type).filter(Boolean));
  const doObjetivo = goalForObjective(objective);
  if (doObjetivo.actionTypes.some((tipo) => presentes.has(tipo))) return doObjetivo;

  // Só adivinha quando o objetivo é ambíguo de verdade. Se o objetivo diz
  // "vendas" e não houve venda, a resposta honesta é nenhuma venda — trocar
  // por engajamento faria o cliente ler 50 curtidas como 50 compras.
  if (doObjetivo.kind !== "outro") return doObjetivo;

  for (const meta of ORDEM_DE_VALOR) {
    if (meta.actionTypes.some((tipo) => presentes.has(tipo))) return meta;
  }
  return doObjetivo;
}

/* ────────────────────────────── situação da campanha ─────────────────────── */

export type StatusTone = "ativa" | "pausada" | "encerrada" | "atencao";

/**
 * A situação REAL da campanha.
 *
 * `status` é o que a equipe configurou; `effective_status` é o que a Meta está
 * realmente fazendo. Os dois discordam com frequência — campanha marcada como
 * ativa mas parada por verba, conta ou reprovação — e quem lê precisa saber do
 * segundo, não do primeiro.
 */
export function statusLabel(
  status: string | null | undefined,
  effectiveStatus?: string | null,
): { label: string; tone: StatusTone; noAr: boolean } {
  const real = String(effectiveStatus || status || "").toUpperCase();
  if (real === "ACTIVE") return { label: "No ar", tone: "ativa", noAr: true };
  if (real === "PAUSED" || real === "ADSET_PAUSED" || real === "CAMPAIGN_PAUSED") {
    return { label: "Pausada", tone: "pausada", noAr: false };
  }
  if (real === "IN_PROCESS" || real === "PENDING_REVIEW") {
    return { label: "Em análise da Meta", tone: "atencao", noAr: false };
  }
  if (real === "WITH_ISSUES" || real === "DISAPPROVED") {
    return { label: "Precisa de ajuste", tone: "atencao", noAr: false };
  }
  if (real === "ARCHIVED" || real === "DELETED" || real === "COMPLETED") {
    return { label: "Encerrada", tone: "encerrada", noAr: false };
  }
  return { label: "Sem informação", tone: "pausada", noAr: false };
}

/* ─────────────────────────────── o resultado ─────────────────────────────── */

/**
 * Quantos resultados a campanha deu, escolhendo na lista da Meta o tipo que
 * corresponde ao objetivo. Sem objetivo casado, não inventa: devolve nulo, e a
 * tela mostra os números de alcance em vez de um resultado errado.
 */
export function resultFromActions(
  actions: AdsAction[] | null | undefined,
  objective: string | null | undefined,
  metaConhecida?: Goal,
): { count: number; actionType: string } | null {
  const meta = metaConhecida ?? goalForCampaign(objective, actions);
  const lista = Array.isArray(actions) ? actions : [];
  for (const tipo of meta.actionTypes) {
    const achado = lista.find((item) => item?.action_type === tipo);
    if (achado) return { count: num(achado.value), actionType: tipo };
  }
  return null;
}

/* ──────────────────────────── resumo de um período ───────────────────────── */

export interface CampaignSummary {
  campaignId: string;
  name: string;
  objective: string | null;
  goal: Goal;
  dias: number;
  investido: number;
  alcance: number;
  exibicoes: number;
  cliquesNoLink: number;
  frequencia: number;
  /** Percentual de quem viu e clicou. */
  ctr: number;
  resultados: number | null;
  custoPorResultado: number | null;
}

/**
 * Junta os dias em um período.
 *
 * Alcance NÃO é somável: a mesma pessoa alcançada em dois dias contaria duas
 * vezes. A Meta só sabe o alcance real do período inteiro, então aqui fica o
 * maior dia, que é o piso honesto — melhor um número conservador e verdadeiro
 * do que uma soma inflada que o cliente compararia com o Gerenciador e veria
 * diferente.
 */
export function summarizeCampaign(rows: AdsDailyRow[]): CampaignSummary | null {
  if (!rows || rows.length === 0) return null;
  const primeira = rows[0];
  const objective = rows.find((row) => row.objective)?.objective ?? null;
  // A meta é decidida UMA vez, com tudo que a campanha produziu no período.
  // Decidir dia a dia faria a mesma campanha mudar de meta conforme o dia
  // rendesse conversa ou só curtida, e a soma sairia misturada.
  const goal = goalForCampaign(
    objective,
    rows.flatMap((row) => (Array.isArray(row.actions) ? row.actions : [])),
  );

  let investido = 0;
  let exibicoes = 0;
  let cliquesNoLink = 0;
  let alcance = 0;
  let resultados = 0;
  let temResultado = false;

  for (const row of rows) {
    investido += num(row.spend);
    exibicoes += num(row.impressions);
    cliquesNoLink += num(row.link_clicks);
    alcance = Math.max(alcance, num(row.reach));
    const achado = resultFromActions(row.actions, objective, goal);
    if (achado) {
      resultados += achado.count;
      temResultado = true;
    }
  }

  return {
    campaignId: primeira.campaign_id,
    name: rows.find((row) => row.campaign_name)?.campaign_name || "Campanha",
    objective,
    goal,
    dias: new Set(rows.map((row) => row.day)).size,
    investido,
    alcance,
    exibicoes,
    cliquesNoLink,
    frequencia: alcance > 0 ? exibicoes / alcance : 0,
    ctr: exibicoes > 0 ? (cliquesNoLink / exibicoes) * 100 : 0,
    resultados: temResultado ? resultados : null,
    custoPorResultado: temResultado && resultados > 0 ? investido / resultados : null,
  };
}

/** Soma várias campanhas na visão de carteira que o gestor precisa. */
export function summarizeAccount(rows: AdsDailyRow[]): {
  investido: number;
  alcance: number;
  campanhas: number;
  resultados: number | null;
} {
  const porCampanha = new Map<string, AdsDailyRow[]>();
  for (const row of rows) {
    const lista = porCampanha.get(row.campaign_id) || [];
    lista.push(row);
    porCampanha.set(row.campaign_id, lista);
  }
  let investido = 0;
  let alcance = 0;
  let resultados = 0;
  let temResultado = false;
  for (const lista of porCampanha.values()) {
    const resumo = summarizeCampaign(lista);
    if (!resumo) continue;
    investido += resumo.investido;
    alcance += resumo.alcance;
    if (resumo.resultados != null) {
      resultados += resumo.resultados;
      temResultado = true;
    }
  }
  return {
    investido,
    alcance,
    campanhas: porCampanha.size,
    resultados: temResultado ? resultados : null,
  };
}

/* ──────────────────────────────── formatação ─────────────────────────────── */

export const dinheiro = (valor: number): string =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: valor < 100 ? 2 : 0,
  }).format(Number.isFinite(valor) ? valor : 0);

export const numero = (valor: number | null | undefined): string =>
  valor == null ? "—" : new Intl.NumberFormat("pt-BR").format(Math.round(valor));

/* ─────────────────────────────── as três leituras ────────────────────────── */

/**
 * O que o CLIENTE lê. Nada de sigla, nada de "CPC", nada de ausência: fala do
 * dinheiro que entrou e do que ele comprou, nessa ordem.
 */
export function clientCampaignLine(resumo: CampaignSummary): string {
  const partes = [`${dinheiro(resumo.investido)} investidos`];
  if (resumo.alcance > 0) partes.push(`${numero(resumo.alcance)} pessoas alcançadas`);
  if (resumo.resultados != null && resumo.resultados > 0) {
    const nome = resumo.resultados === 1 ? resumo.goal.resultSingular : resumo.goal.resultPlural;
    const custo = resumo.custoPorResultado;
    partes.push(
      custo && custo > 0
        ? `${numero(resumo.resultados)} ${nome} a ${dinheiro(custo)} cada`
        : `${numero(resumo.resultados)} ${nome}`,
    );
  } else if (resumo.cliquesNoLink > 0) {
    partes.push(`${numero(resumo.cliquesNoLink)} cliques no link`);
  }
  return partes.join(" · ");
}

/** Uma frase inteira, para quando a campanha aparece sozinha no relatório. */
export function clientCampaignSentence(resumo: CampaignSummary): string {
  const objetivo = `Esta campanha existe para ${resumo.goal.label}.`;
  return `${objetivo} Nos últimos ${resumo.dias} ${resumo.dias === 1 ? "dia" : "dias"}: ${clientCampaignLine(resumo)}.`;
}

/**
 * O que a EQUIPE lê: os mesmos fatos mais o que exige decisão. Aqui o jargão
 * é bem-vindo, porque quem lê opera a conta.
 */
export function teamCampaignLine(resumo: CampaignSummary): string {
  const partes = [
    `${dinheiro(resumo.investido)} em ${resumo.dias}d`,
    `${numero(resumo.exibicoes)} exib.`,
    `CTR ${resumo.ctr.toFixed(2)}%`,
    `freq. ${resumo.frequencia.toFixed(2)}`,
  ];
  if (resumo.custoPorResultado != null) {
    partes.push(`${dinheiro(resumo.custoPorResultado)}/${resumo.goal.resultSingular}`);
  }
  return partes.join(" · ");
}

/**
 * O aviso que faz alguém agir. Só aparece quando há motivo real — alerta que
 * aparece sempre vira ruído e para de ser lido.
 */
export function teamAlert(resumo: CampaignSummary): string | null {
  if (resumo.investido <= 0) return null;
  if (resumo.frequencia >= 4 && resumo.alcance > 0) {
    return `A mesma pessoa já viu ${resumo.frequencia.toFixed(1)} vezes. Vale trocar o criativo ou abrir o público.`;
  }
  if (resumo.resultados === 0 && resumo.investido >= 50) {
    return `${dinheiro(resumo.investido)} sem ${resumo.goal.resultSingular} ainda. Vale revisar público e criativo.`;
  }
  if (resumo.ctr > 0 && resumo.ctr < 0.5 && resumo.exibicoes > 1000) {
    return `Poucos cliques para quantas vezes apareceu (${resumo.ctr.toFixed(2)}%). O criativo não está parando o rolagem.`;
  }
  return null;
}

/* ────────────────────── o que cada número quer dizer ─────────────────────── */

/** Explicação curta, para o cliente que passa o olho e não sabe o termo. */
export const EXPLICACOES: Record<string, string> = {
  investido: "Quanto foi gasto em anúncio no período.",
  alcance: "Quantas pessoas diferentes viram o anúncio.",
  exibicoes: "Quantas vezes o anúncio apareceu na tela de alguém.",
  cliquesNoLink: "Quantas vezes alguém clicou para saber mais.",
  frequencia: "Quantas vezes, em média, a mesma pessoa viu o anúncio.",
  ctr: "De cada 100 vezes que apareceu, quantas viraram clique.",
  resultados: "O que a campanha se propôs a trazer e trouxe.",
  custoPorResultado: "Quanto custou, em média, cada resultado.",
};
