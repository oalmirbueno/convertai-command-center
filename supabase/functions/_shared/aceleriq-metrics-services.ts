/**
 * MÉTRICAS REAIS para o MCP — Instagram e Meta Ads.
 *
 * Até aqui o MCP conhecia o TRABALHO (projetos, tarefas, ciclo, arquivos) e não
 * conhecia o RESULTADO dele. Um agente externo conseguia dizer o que a equipe
 * fez na semana e não conseguia dizer se funcionou — o que torna qualquer
 * análise ou proposta um chute bem escrito.
 *
 * As quatro leituras aqui fecham esse buraco: perfil e publicações do
 * Instagram, campanhas e desempenho diário do Meta Ads. Todas com histórico,
 * porque a pergunta que importa quase nunca é "quanto foi ontem" e sim "está
 * melhorando ou piorando".
 *
 * Cada leitura já devolve o cálculo que o agente faria por fora e erraria:
 * variação entre semanas (a lista vem da mais recente para a mais antiga, e
 * inverter é o erro clássico) e agregação de campanha (alcance não é somável).
 */

import { db, isUuid, READ_LIMITS } from './aceleriq-read-services.ts';

const numero = (valor: unknown): number => {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Semanas fechadas do Instagram: seguidores, alcance, interações. */
export async function listSocialMetrics(opts: { client_id?: string; weeks?: number }) {
  const semanas = Math.min(Math.max(opts.weeks ?? 12, 1), 52);
  let qb = db()
    .from('social_metrics_weekly')
    .select(
      'client_id, platform, week_start, week_end, captured_at, followers, media_count, reach, profile_views, accounts_engaged, total_interactions',
    )
    .order('week_start', { ascending: false })
    .limit(opts.client_id ? semanas : READ_LIMITS.maxPageSize);

  if (opts.client_id) {
    if (!isUuid(opts.client_id)) throw new Error('client_id must be a UUID');
    qb = qb.eq('client_id', opts.client_id);
  }

  const { data, error } = await qb;
  if (error) throw new Error(error.message);
  const linhas = (data || []) as Array<Record<string, unknown>>;

  // A variação vai junto: calculada por fora, o agente costuma inverter a
  // ordem (a lista vem da mais recente para a mais antiga) e reportar queda
  // onde houve crescimento.
  const variacao = (campo: 'followers' | 'reach' | 'total_interactions') => {
    const comValor = linhas.filter((linha) => linha[campo] != null);
    if (comValor.length < 2) return null;
    const anterior = numero(comValor[1][campo]);
    if (!anterior) return null;
    return Number((((numero(comValor[0][campo]) - anterior) / anterior) * 100).toFixed(1));
  };

  return {
    weeks: linhas,
    latest: linhas[0] ?? null,
    change_pct: {
      followers: variacao('followers'),
      reach: variacao('reach'),
      total_interactions: variacao('total_interactions'),
    },
  };
}

/** Histórico de publicações com o desempenho real de cada uma. */
export async function listSocialPosts(opts: { client_id?: string; limit?: number }) {
  const limite = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  let qb = db()
    .from('social_post_metrics')
    .select(
      'client_id, media_id, media_type, caption, permalink, posted_at, like_count, comments_count, reach, saved, shares, total_interactions, captured_at',
    )
    .order('posted_at', { ascending: false })
    .limit(limite);

  if (opts.client_id) {
    if (!isUuid(opts.client_id)) throw new Error('client_id must be a UUID');
    qb = qb.eq('client_id', opts.client_id);
  }

  const { data, error } = await qb;
  if (error) throw new Error(error.message);
  const linhas = (data || []) as Array<Record<string, unknown>>;

  // O ranking do que funcionou é sempre a pergunta seguinte à lista.
  const porInteracao = [...linhas].sort(
    (a, b) => numero(b.total_interactions) - numero(a.total_interactions),
  );

  return { posts: linhas, top_posts: porInteracao.slice(0, 5) };
}

/** Campanhas do Meta Ads: situação atual, objetivo e verba configurada. */
export async function listAdsCampaigns(opts: { client_id?: string; only_active?: boolean }) {
  let qb = db()
    .from('ads_campaigns')
    .select(
      'client_id, campaign_id, name, status, effective_status, objective, daily_budget, lifetime_budget, start_time, stop_time, updated_at',
    )
    .order('updated_at', { ascending: false })
    .limit(READ_LIMITS.maxPageSize);

  if (opts.client_id) {
    if (!isUuid(opts.client_id)) throw new Error('client_id must be a UUID');
    qb = qb.eq('client_id', opts.client_id);
  }
  // A situação que vale é a efetiva: campanha marcada como ativa pode estar
  // parada pela Meta por verba, conta ou reprovação.
  if (opts.only_active) qb = qb.eq('effective_status', 'ACTIVE');

  const { data, error } = await qb;
  if (error) throw new Error(error.message);
  return { campaigns: data || [] };
}

/**
 * Desempenho diário das campanhas, com o total do período junto.
 *
 * Devolve o dia E o agregado de propósito: o dia mostra tendência, o total
 * responde "quanto rendeu". Deixar o agente somar sozinho convida ao erro no
 * alcance, que NÃO é somável — a mesma pessoa alcançada em dois dias não são
 * duas pessoas. Aqui o alcance do período é o maior dia, que é o piso honesto.
 */
export async function listAdsPerformance(opts: { client_id?: string; days?: number }) {
  const dias = Math.min(Math.max(opts.days ?? 30, 1), 30);
  const desde = new Date();
  desde.setUTCDate(desde.getUTCDate() - (dias - 1));

  let qb = db()
    .from('ads_campaign_daily')
    .select(
      'client_id, campaign_id, campaign_name, objective, day, spend, impressions, reach, clicks, link_clicks, ctr, cpc, cpm, frequency, actions, cost_per_action',
    )
    .gte('day', desde.toISOString().slice(0, 10))
    .order('day', { ascending: false })
    .limit(READ_LIMITS.maxPageSize);

  if (opts.client_id) {
    if (!isUuid(opts.client_id)) throw new Error('client_id must be a UUID');
    qb = qb.eq('client_id', opts.client_id);
  }

  const { data, error } = await qb;
  if (error) throw new Error(error.message);
  const linhas = (data || []) as Array<Record<string, unknown>>;

  const porCampanha = new Map<string, Array<Record<string, unknown>>>();
  for (const linha of linhas) {
    const chave = String(linha.campaign_id);
    const lista = porCampanha.get(chave) || [];
    lista.push(linha);
    porCampanha.set(chave, lista);
  }

  const resumo = [...porCampanha.entries()]
    .map(([campaignId, lista]) => {
      let investido = 0;
      let exibicoes = 0;
      let cliquesNoLink = 0;
      let alcance = 0;
      const resultados = new Map<string, number>();

      for (const linha of lista) {
        investido += numero(linha.spend);
        exibicoes += numero(linha.impressions);
        cliquesNoLink += numero(linha.link_clicks);
        alcance = Math.max(alcance, numero(linha.reach));
        const acoes = Array.isArray(linha.actions)
          ? (linha.actions as Array<Record<string, unknown>>)
          : [];
        for (const acao of acoes) {
          const tipo = String(acao?.action_type ?? '');
          if (!tipo) continue;
          resultados.set(tipo, (resultados.get(tipo) ?? 0) + numero(acao?.value));
        }
      }

      return {
        campaign_id: campaignId,
        campaign_name: lista.find((l) => l.campaign_name)?.campaign_name ?? null,
        objective: lista.find((l) => l.objective)?.objective ?? null,
        days: lista.length,
        spend: Number(investido.toFixed(2)),
        impressions: exibicoes,
        reach: alcance,
        link_clicks: cliquesNoLink,
        // Cru de propósito: qual destes tipos É o resultado depende do
        // objetivo, e essa decisão é do leitor, não desta camada.
        results_by_type: Object.fromEntries(resultados),
      };
    })
    .sort((a, b) => b.spend - a.spend);

  return {
    period_days: dias,
    since: desde.toISOString().slice(0, 10),
    daily: linhas,
    by_campaign: resumo,
    totals: {
      spend: Number(resumo.reduce((soma, campanha) => soma + campanha.spend, 0).toFixed(2)),
      campaigns: resumo.length,
    },
  };
}
