/**
 * Recomendações de anúncio que saem de um número, e mostram o número.
 *
 * A queixa era "faltam recomendações reais". Reais quer dizer duas coisas
 * ao mesmo tempo: nascer de dado que já está no painel, e trazer junto a
 * conta que as gerou. Conselho sem número é horóscopo — quem lê não tem
 * como discordar, e por isso também não tem como agir.
 *
 * Toda regra aqui declara um MÍNIMO de volume antes de opinar. Dizer que
 * um anúncio com 40 impressões "tem CTR ruim" é ler ruído como sinal, e
 * duas semanas depois ninguém confia mais em nenhum aviso da tela.
 */

export interface DiaDaCampanha {
  campaign_id: string;
  day: string;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  link_clicks: number | null;
  ctr: number | null;
  cpc: number | null;
  frequency: number | null;
}

export interface CampanhaAtiva {
  campaign_id: string;
  name: string | null;
  effective_status: string | null;
  objective: string | null;
  daily_budget: number | null;
  lifetime_budget: number | null;
}

export type Gravidade = "alta" | "media" | "baixa";

export interface Recomendacao {
  campaign_id: string;
  campanha: string;
  gravidade: Gravidade;
  titulo: string;
  /** A conta que gerou o aviso, em texto. Sem isto vira palpite. */
  porque: string;
  acao: string;
}

/** Volume abaixo do qual nenhuma regra opina. */
export const MINIMO_DE_IMPRESSOES = 500;
export const MINIMO_DE_GASTO = 20;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const dinheiro = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const pct = (v: number) => `${v.toFixed(2).replace(".", ",")}%`;

export interface ResumoDaCampanha {
  campaign_id: string;
  gasto: number;
  impressoes: number;
  cliques: number;
  cliquesNoLink: number;
  ctr: number;
  cpc: number;
  frequencia: number;
  dias: number;
}

/**
 * Soma os dias de uma campanha dentro de uma janela.
 *
 * CTR e CPC são recalculados do total, e não pela média das médias: um dia
 * de 10 impressões pesaria igual a um de 10 mil, e o número resultante não
 * descreveria campanha nenhuma.
 */
export function resumirCampanha(
  dias: readonly DiaDaCampanha[],
  campaignId: string,
  janelaEmDias?: number,
  hoje?: string,
): ResumoDaCampanha {
  const limite = janelaEmDias && hoje
    ? new Date(new Date(`${hoje}T12:00:00`).getTime() - janelaEmDias * 86_400_000)
      .toISOString().slice(0, 10)
    : null;

  const linhas = dias.filter(
    (d) => d.campaign_id === campaignId && (!limite || d.day > limite),
  );

  const gasto = linhas.reduce((s, d) => s + num(d.spend), 0);
  const impressoes = linhas.reduce((s, d) => s + num(d.impressions), 0);
  const cliques = linhas.reduce((s, d) => s + num(d.clicks), 0);
  const cliquesNoLink = linhas.reduce((s, d) => s + num(d.link_clicks), 0);
  const freqs = linhas.map((d) => num(d.frequency)).filter((f) => f > 0);

  return {
    campaign_id: campaignId,
    gasto,
    impressoes,
    cliques,
    cliquesNoLink,
    ctr: impressoes > 0 ? (cliques / impressoes) * 100 : 0,
    cpc: cliques > 0 ? gasto / cliques : 0,
    frequencia: freqs.length > 0 ? freqs.reduce((a, b) => a + b, 0) / freqs.length : 0,
    dias: linhas.length,
  };
}

/**
 * As recomendações de uma conta.
 *
 * A média da conta é a régua, e não um número de mercado: 1% de CTR é bom
 * num nicho e ruim em outro, e comparar com o próprio histórico é a única
 * comparação que se sustenta sem chutar contexto.
 */
export function recomendar(
  campanhas: readonly CampanhaAtiva[],
  dias: readonly DiaDaCampanha[],
  hoje: string,
): Recomendacao[] {
  const ativas = campanhas.filter((c) => (c.effective_status || "").toUpperCase() === "ACTIVE");
  if (ativas.length === 0) return [];

  const resumos = new Map(ativas.map((c) => [
    c.campaign_id, resumirCampanha(dias, c.campaign_id, 14, hoje),
  ]));

  // A régua da casa: só entram campanhas com volume, senão a média herda
  // o ruído que estamos tentando evitar.
  const comVolume = [...resumos.values()].filter((r) => r.impressoes >= MINIMO_DE_IMPRESSOES);
  const impressoesTotais = comVolume.reduce((s, r) => s + r.impressoes, 0);
  const cliquesTotais = comVolume.reduce((s, r) => s + r.cliques, 0);
  const ctrDaConta = impressoesTotais > 0 ? (cliquesTotais / impressoesTotais) * 100 : 0;

  const saida: Recomendacao[] = [];

  for (const c of ativas) {
    const r = resumos.get(c.campaign_id)!;
    const nome = c.name || c.campaign_id;

    // 1) Gastou e ninguém clicou no link. É o mais grave: dinheiro saindo
    //    sem nada do outro lado.
    if (r.gasto >= MINIMO_DE_GASTO && r.cliquesNoLink === 0) {
      saida.push({
        campaign_id: c.campaign_id, campanha: nome, gravidade: "alta",
        titulo: "Gasto sem clique no link",
        porque: `${dinheiro(r.gasto)} gastos em ${r.dias} dia(s) e nenhum clique no link, com ${r.impressoes.toLocaleString("pt-BR")} impressões.`,
        acao: "Confira o destino e a chamada do anúncio antes de deixar rodar mais um dia.",
      });
    }

    // 2) Fadiga: as mesmas pessoas vendo de novo. Acima de 3,5 a curva de
    //    resposta costuma já ter virado.
    if (r.impressoes >= MINIMO_DE_IMPRESSOES && r.frequencia >= 3.5) {
      saida.push({
        campaign_id: c.campaign_id, campanha: nome, gravidade: "media",
        titulo: "O mesmo público está vendo demais",
        porque: `Frequência média de ${r.frequencia.toFixed(1)} nos últimos ${r.dias} dia(s): cada pessoa viu o anúncio mais de três vezes.`,
        acao: "Amplie o público ou troque o criativo — mais entrega no mesmo público rende menos a cada dia.",
      });
    }

    // 3) CTR bem abaixo da própria casa. Só compara quando HÁ régua.
    if (
      ctrDaConta > 0 && r.impressoes >= MINIMO_DE_IMPRESSOES
      && r.ctr > 0 && r.ctr < ctrDaConta * 0.6
    ) {
      saida.push({
        campaign_id: c.campaign_id, campanha: nome, gravidade: "media",
        titulo: "CTR bem abaixo da média da conta",
        porque: `${pct(r.ctr)} contra ${pct(ctrDaConta)} da conta nos últimos 14 dias.`,
        acao: "O criativo não está parando o scroll. Vale testar outra abertura antes de subir orçamento.",
      });
    }

    // 4) Orçamento diário sendo consumido quase inteiro: pode estar
    //    limitando entrega justamente no que funciona.
    const ontem = resumirCampanha(dias, c.campaign_id, 1, hoje);
    const orcamento = num(c.daily_budget);
    if (orcamento > 0 && ontem.gasto >= orcamento * 0.95) {
      saida.push({
        campaign_id: c.campaign_id, campanha: nome, gravidade: "baixa",
        titulo: "Orçamento diário no teto",
        porque: `Gastou ${dinheiro(ontem.gasto)} de ${dinheiro(orcamento)} no último dia.`,
        acao: "Se o resultado está bom, o teto está segurando a entrega. Se não está, o teto é o que evita gastar mais.",
      });
    }

    // 5) Campanha ativa e parada: ativa sem entrega há dias costuma ser
    //    conta bloqueada, público esgotado ou anúncio em revisão.
    if (r.impressoes === 0 && r.dias === 0) {
      saida.push({
        campaign_id: c.campaign_id, campanha: nome, gravidade: "alta",
        titulo: "Ativa, mas sem entrega nenhuma",
        porque: "Nenhum dia com impressão nos últimos 14 dias, apesar do status ativo na Meta.",
        acao: "Verifique aprovação do anúncio, saldo da conta e se o público não ficou pequeno demais.",
      });
    }
  }

  const ordem: Record<Gravidade, number> = { alta: 0, media: 1, baixa: 2 };
  return saida.sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade]
    || a.campanha.localeCompare(b.campanha));
}
