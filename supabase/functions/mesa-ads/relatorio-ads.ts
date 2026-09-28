/**
 * Relatório de anúncios do período (frente AD3, 28/09). Pedido do dono:
 * "gerar um relatório ali, puxar tudo bem, e ele já atualiza lá em
 * Relatórios". A Mesa Ads grava um rascunho na tabela reports (a mesma área
 * de Relatórios do painel), com os números da conta no período e a análise.
 *
 * Tudo aqui é regra em código sobre os números da coleta (nada de modelo):
 * o resumo, os destaques, os próximos passos, as métricas nos nomes que a
 * tela de relatório já entende (ad_spend, reach, results...), a série diária
 * para o gráfico e a quebra por campanha (metrics.__breakdown, no formato do
 * painel de fonte "meta_ads").
 *
 * Sem Deno e sem banco: testado no Vitest. Texto sem travessão.
 */

export type MetricasParaRelatorio = {
  gasto: number;
  impressoes: number;
  alcance: number | null;
  cliques_link: number | null;
  resultados: number;
  resultado_rotulo: string;
  resultado_tipo: string | null;
  custo_por_resultado: number | null;
  cpm: number | null;
  frequencia: number | null;
  valor_conversao: number | null;
  roas: number | null;
  acoes: Record<string, number>;
};

export type CampanhaParaRelatorio = { nome: string; status: string | null; metricas: MetricasParaRelatorio };

export type AnuncioParaRelatorio = {
  nome: string;
  status: string | null;
  sinal: string;
  metricas: MetricasParaRelatorio;
  frequencia: number | null;
  ctr_var_pct: number | null;
};

export type ComparacaoParaRelatorio = {
  gasto_pct: number | null;
  resultados_pct: number | null;
  custo_por_resultado_pct: number | null;
  ctr_link_pct: number | null;
  cpm_pct: number | null;
} | null;

export type EntradaDoRelatorio = {
  cliente: string;
  periodo: { inicio: string; fim: string; dias: number };
  totais: MetricasParaRelatorio;
  comparacao: ComparacaoParaRelatorio;
  serie: { dia: string; gasto: number; resultados: number }[];
  campanhas: CampanhaParaRelatorio[];
  anuncios: AnuncioParaRelatorio[];
  contas: { nome: string; saldo_a_pagar: number | null }[];
  gerado_em: string;
};

export type RelatorioMontado = {
  title: string;
  summary: string;
  highlights: string;
  next_steps: string;
  metrics: Record<string, unknown>;
  chart_type: "area";
  chart_data: Record<string, string | number>[];
};

const arred = (v: number, casas = 2) => Math.round(v * 10 ** casas) / 10 ** casas;
const semTravessao = (t: string) => t.replace(/\s*[–—]\s*/g, ", ");

/** "R$ 1.234,56" sem depender do Intl do ambiente. */
export function reais(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "sem dado";
  const negativo = v < 0;
  const [int, dec] = Math.abs(v).toFixed(2).split(".");
  const milhar = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}R$ ${milhar},${dec}`;
}

/** "12.300" */
export function inteiroBr(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "sem dado";
  return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

const pct = (v: number | null | undefined, casas = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "sem dado" : `${v.toFixed(casas).replace(".", ",")}%`);
const dataBr = (iso: string, comAno = false) => {
  const p = iso.slice(0, 10).split("-");
  return p.length === 3 ? (comAno ? `${p[2]}/${p[1]}/${p[0]}` : `${p[2]}/${p[1]}`) : iso;
};
const variacao = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : `${v > 0 ? "+" : ""}${Math.round(v)}%`);
const ctrLink = (m: MetricasParaRelatorio) => (m.cliques_link !== null && m.impressoes > 0 ? (m.cliques_link / m.impressoes) * 100 : null);
const minusculo = (t: string) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);

/** Volume mínimo para comparar custo por resultado entre campanhas ou anúncios (menos que isso é sorte). */
export const MINIMO_DE_RESULTADOS = 3;

export function montarRelatorioDeAnuncios(e: EntradaDoRelatorio): RelatorioMontado {
  const t = e.totais;
  const p = e.periodo;
  const trechoDoPeriodo = p.inicio === p.fim ? `Em ${dataBr(p.inicio, true)}` : `De ${dataBr(p.inicio)} a ${dataBr(p.fim, true)} (${p.dias} dias)`;
  const rotulo = t.resultado_rotulo || "Resultados";
  const comGasto = e.campanhas.filter((c) => c.metricas.gasto > 0).sort((a, b) => b.metricas.gasto - a.metricas.gasto);
  const rodaram = e.anuncios.filter((a) => a.metricas.gasto > 0 || a.metricas.impressoes > 0);

  // ---- resumo
  const resumo: string[] = [];
  if (t.gasto <= 0) {
    resumo.push(`${trechoDoPeriodo}, não houve investimento em anúncios nas contas ligadas.`);
  } else {
    const custo = t.resultados > 0 && t.custo_por_resultado !== null ? `, a ${reais(t.custo_por_resultado)} cada` : "";
    const extras: string[] = [];
    if (t.alcance) extras.push(`alcance aproximado de ${inteiroBr(t.alcance)} pessoas`);
    if (ctrLink(t) !== null) extras.push(`CTR no link de ${pct(ctrLink(t), 2)}`);
    if (t.cpm !== null) extras.push(`CPM de ${reais(t.cpm)}`);
    if (t.frequencia !== null) extras.push(`frequência média de ${t.frequencia.toFixed(1).replace(".", ",")}`);
    resumo.push(
      `${trechoDoPeriodo}, ${reais(t.gasto)} investidos em ${comGasto.length} ${comGasto.length === 1 ? "campanha" : "campanhas"} trouxeram ${inteiroBr(t.resultados)} ${minusculo(rotulo)}${custo}.` +
        (extras.length ? ` ${extras.join(", ").replace(/^./, (x) => x.toUpperCase())}.` : ""),
    );
    if (t.roas !== null && t.valor_conversao) resumo.push(`As compras medidas somam ${reais(t.valor_conversao)} (retorno de ${t.roas.toFixed(2).replace(".", ",")} vezes o investido).`);
  }
  const c = e.comparacao;
  if (c && t.gasto > 0) {
    const partes = [
      variacao(c.gasto_pct) ? `investimento ${variacao(c.gasto_pct)}` : "",
      variacao(c.resultados_pct) ? `resultados ${variacao(c.resultados_pct)}` : "",
      variacao(c.custo_por_resultado_pct) ? `custo por resultado ${variacao(c.custo_por_resultado_pct)}` : "",
      variacao(c.ctr_link_pct) ? `CTR ${variacao(c.ctr_link_pct)}` : "",
    ].filter(Boolean);
    if (partes.length) resumo.push(`Frente aos ${p.dias} ${p.dias === 1 ? "dia anterior" : "dias anteriores"}: ${partes.join(", ")}.`);
  }
  if (comGasto.length) {
    resumo.push(
      "Por campanha:\n" +
        comGasto.slice(0, 8).map((x) => {
          const m = x.metricas;
          const cada = m.resultados > 0 && m.custo_por_resultado !== null ? ` (${reais(m.custo_por_resultado)} cada)` : "";
          const ctr = ctrLink(m);
          return `· ${x.nome}: ${reais(m.gasto)}, ${inteiroBr(m.resultados)} ${minusculo(m.resultado_rotulo || "resultados")}${cada}${ctr !== null ? `, CTR ${pct(ctr, 2)}` : ""}.`;
        }).join("\n"),
    );
  }
  const porSinal = (s: string) => rodaram.filter((a) => a.sinal === s);
  if (rodaram.length) {
    const escalar = porSinal("escalar").length;
    const renovar = porSinal("renovar").length;
    const pausar = porSinal("pausar").length;
    const sinais = [escalar ? `${escalar} com sinal de escalar` : "", renovar ? `${renovar} pedindo criativo novo` : "", pausar ? `${pausar} para pausar` : ""].filter(Boolean);
    resumo.push(`Criativos: ${rodaram.length} ${rodaram.length === 1 ? "anúncio rodou" : "anúncios rodaram"} no período${sinais.length ? `; ${sinais.join(", ")}` : ""}.`);
  }

  // ---- destaques
  const destaques: string[] = [];
  const tipoPrincipal = t.resultado_tipo;
  const comparaveis = comGasto.filter((x) => x.metricas.resultados >= MINIMO_DE_RESULTADOS && x.metricas.custo_por_resultado !== null && (!tipoPrincipal || x.metricas.resultado_tipo === tipoPrincipal));
  if (comparaveis.length >= 2) {
    const melhor = comparaveis.slice().sort((a, b) => (a.metricas.custo_por_resultado as number) - (b.metricas.custo_por_resultado as number))[0];
    destaques.push(`Campanha mais eficiente: ${melhor.nome}, ${inteiroBr(melhor.metricas.resultados)} ${minusculo(melhor.metricas.resultado_rotulo)} a ${reais(melhor.metricas.custo_por_resultado)} cada.`);
  } else if (comGasto[0] && comGasto[0].metricas.resultados > 0) {
    destaques.push(`Campanha principal: ${comGasto[0].nome}, com ${inteiroBr(comGasto[0].metricas.resultados)} ${minusculo(comGasto[0].metricas.resultado_rotulo)}.`);
  }
  const vencedor = porSinal("escalar").sort((a, b) => b.metricas.resultados - a.metricas.resultados)[0];
  if (vencedor) destaques.push(`Melhor criativo: ${vencedor.nome}, ${inteiroBr(vencedor.metricas.resultados)} ${minusculo(vencedor.metricas.resultado_rotulo)} a ${reais(vencedor.metricas.custo_por_resultado)} cada.`);
  if (c && c.custo_por_resultado_pct !== null && c.custo_por_resultado_pct <= -10 && t.resultados > 0) destaques.push(`O custo por resultado caiu ${Math.abs(Math.round(c.custo_por_resultado_pct))}% frente ao período anterior.`);
  if (c && c.resultados_pct !== null && c.resultados_pct >= 10 && t.resultados > 0) destaques.push(`Os resultados cresceram ${Math.round(c.resultados_pct)}% frente ao período anterior.`);

  // ---- próximos passos
  const passos: string[] = [];
  const nomes = (l: AnuncioParaRelatorio[]) => l.slice(0, 3).map((a) => a.nome).join(", ") + (l.length > 3 ? ` e mais ${l.length - 3}` : "");
  if (porSinal("escalar").length) passos.push(`Reforçar a verba de ${nomes(porSinal("escalar"))}, subindo até 30% por vez para não reiniciar o aprendizado.`);
  const cansados = porSinal("renovar");
  if (cansados.length) {
    const f = cansados.filter((a) => a.frequencia !== null).sort((a, b) => (b.frequencia as number) - (a.frequencia as number))[0];
    passos.push(`Criar variações de ${nomes(cansados)}: o público já viu muito${f && f.frequencia !== null ? ` (frequência ${f.frequencia.toFixed(1).replace(".", ",")})` : ""} e o clique está caindo.`);
  }
  if (porSinal("pausar").length) passos.push(`Pausar ${nomes(porSinal("pausar"))}: gastaram sem trazer resultado na medida.`);
  for (const conta of e.contas) {
    if (conta.saldo_a_pagar !== null && conta.saldo_a_pagar > 0) passos.push(`Quitar ${reais(conta.saldo_a_pagar)} em aberto na conta ${conta.nome} para a entrega não travar.`);
  }
  if (!passos.length) passos.push(t.gasto > 0 ? "Manter as campanhas como estão e reavaliar no próximo período, testando um criativo novo por vez." : "Definir a campanha do próximo período com o objetivo e a verba.");

  // ---- métricas nos nomes que a tela de relatório entende
  const acoes = t.acoes || {};
  const metrics: Record<string, unknown> = {
    ad_spend: arred(t.gasto),
    impressions: Math.round(t.impressoes),
    results: Math.round(t.resultados),
  };
  if (t.alcance) metrics.reach = Math.round(t.alcance);
  if (t.cliques_link !== null) metrics.link_clicks = Math.round(t.cliques_link);
  if (t.custo_por_resultado !== null) metrics.cost_per_result = arred(t.custo_por_resultado);
  if (ctrLink(t) !== null) metrics.ctr = arred(ctrLink(t) as number);
  if (t.cpm !== null) metrics.cpm = arred(t.cpm);
  if (t.frequencia !== null) metrics.frequency = arred(t.frequencia);
  if ((acoes.mensagens || 0) > 0) metrics.messages = Math.round(acoes.mensagens);
  if ((acoes.leads || 0) > 0) metrics.leads = Math.round(acoes.leads);
  if ((acoes.compras || 0) > 0) metrics.purchases = Math.round(acoes.compras);
  if ((acoes.video || 0) > 0) metrics.video_views = Math.round(acoes.video);
  if ((acoes.engajamento || 0) > 0) metrics.engagement = Math.round(acoes.engajamento);
  if (t.valor_conversao) metrics.revenue = arred(t.valor_conversao);
  if (t.roas !== null && t.valor_conversao) metrics.roas = arred(t.roas);
  metrics.custom = [
    { label: "Campanhas com gasto", value: comGasto.length },
    { label: "Anúncios que rodaram", value: rodaram.length },
  ].filter((x) => x.value > 0);
  // Origem: a Mesa Ads regrava o mesmo rascunho do período (não empilha cópias).
  metrics.source = "mesa_ads";
  metrics.written_by = "mesa_ads";
  metrics.resultado_principal = rotulo;
  metrics.gerado_em = e.gerado_em;
  if (comGasto.length) {
    metrics.__source = "meta_ads";
    metrics.__source_label = "Meta Ads (Mesa Ads)";
    metrics.__dimension = "Campanha";
    metrics.__breakdown = comGasto.slice(0, 200).map((x) => ({
      Campanha: x.nome,
      "Valor usado": arred(x.metricas.gasto),
      Impressões: Math.round(x.metricas.impressoes),
      Alcance: x.metricas.alcance ? Math.round(x.metricas.alcance) : 0,
      "Cliques no link": x.metricas.cliques_link !== null ? Math.round(x.metricas.cliques_link) : 0,
      Resultados: Math.round(x.metricas.resultados),
      "Custo por resultado": x.metricas.custo_por_resultado !== null ? arred(x.metricas.custo_por_resultado) : 0,
    }));
  }

  const chartData = e.serie
    .slice()
    .sort((a, b) => a.dia.localeCompare(b.dia))
    .map((d) => ({ label: dataBr(d.dia), Investido: arred(d.gasto), [rotulo]: Math.round(d.resultados) }));

  return {
    title: semTravessao(`Anúncios · ${e.cliente} · ${p.inicio === p.fim ? dataBr(p.inicio, true) : `${dataBr(p.inicio)} a ${dataBr(p.fim, true)}`}`).slice(0, 200),
    summary: semTravessao(resumo.join("\n\n")).slice(0, 8000),
    highlights: semTravessao(destaques.join("\n")).slice(0, 4000),
    next_steps: semTravessao(passos.map((x) => `· ${x}`).join("\n")).slice(0, 4000),
    metrics,
    chart_type: "area",
    chart_data: chartData.length > 1 ? chartData : [],
  };
}
