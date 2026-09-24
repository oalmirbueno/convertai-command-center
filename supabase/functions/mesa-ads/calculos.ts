/**
 * Cálculos da Mesa Ads, puros e sem IA (docs/mesa-ads/SPEC.md).
 *
 * Tudo aqui é conta e regra fixa: soma das métricas diárias da Meta
 * (ads_creative_daily), resultados por tipo de ação, diagnóstico pela tabela
 * DIAGNOSTICO do dossiê com limiares simples e documentados, e a escala de
 * evidência (E1, E3, E4). Sem dependência de Deno nem de banco: a função
 * mesa-ads usa e o teste do painel importa direto.
 *
 * Sem travessão nos textos (regra do dono).
 */

export type Evidencia = "E0" | "E1" | "E2" | "E3" | "E4";

/** Linha de ads_creative_daily como a função lê. */
export type Diaria = {
  ad_id: string;
  day: string;
  spend: number | string | null;
  impressions: number | string | null;
  reach?: number | string | null;
  clicks: number | string | null;
  link_clicks: number | string | null;
  frequency: number | string | null;
  actions: unknown;
};

/**
 * Resultados que contam, por grupo. Dentro de cada grupo vale o PRIMEIRO tipo
 * presente no dia: "lead" da Meta já soma o lead do pixel e o do formulário,
 * então somar os dois contaria em dobro.
 */
export const GRUPOS_DE_RESULTADO: { chave: "mensagens" | "leads" | "compras"; tipos: string[] }[] = [
  { chave: "mensagens", tipos: ["onsite_conversion.messaging_conversation_started_7d"] },
  { chave: "leads", tipos: ["lead", "offsite_conversion.fb_pixel_lead", "onsite_web_lead"] },
  { chave: "compras", tipos: ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"] },
];

const TIPOS_VISITA = ["landing_page_view", "omni_landing_page_view"];
const TIPOS_ENGAJAMENTO = ["post_engagement"];
const TIPOS_CLIQUE_SAIDA = ["link_click"];

export type Metricas = {
  gasto: number;
  impressoes: number;
  cliques: number;
  cliques_saida: number;
  visitas: number | null;
  engajamentos: number | null;
  /** CTR de saída em %: cliques de saída / impressões x 100. */
  ctr_saida_pct: number | null;
  /** Custo por clique de saída. */
  cpc: number | null;
  cpm: number | null;
  /** Média das frequências diárias ponderada pelas impressões (alcance não soma entre dias). */
  frequencia_media: number | null;
  /** Visitas à página / cliques de saída (só quando a Meta mediu visita). */
  taxa_visita: number | null;
  resultados: number;
  resultados_por_tipo: Record<string, number>;
  custo_por_resultado: number | null;
  dias: number;
  inicio: string | null;
  fim: string | null;
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const arred = (v: number, casas = 2) => Math.round(v * 10 ** casas) / 10 ** casas;

/** Valor do primeiro tipo de ação presente na lista (array da Meta [{action_type, value}]). */
export function valorDaAcao(actions: unknown, tipos: string[]): number | null {
  if (!Array.isArray(actions)) return null;
  for (const tipo of tipos) {
    const a = actions.find((x) => (x as { action_type?: string } | null)?.action_type === tipo) as { value?: unknown } | undefined;
    if (a) return num(a.value);
  }
  return null;
}

/** Soma das métricas diárias de um ou mais anúncios. */
export function somarMetricas(linhas: Diaria[]): Metricas {
  let gasto = 0, impressoes = 0, cliques = 0, cliquesSaida = 0, freqPeso = 0, impComFreq = 0;
  let visitas: number | null = null;
  let engajamentos: number | null = null;
  const porTipo: Record<string, number> = {};
  const dias = new Set<string>();
  for (const l of linhas) {
    const imp = num(l.impressions);
    gasto += num(l.spend);
    impressoes += imp;
    cliques += num(l.clicks);
    const saida = l.link_clicks != null ? num(l.link_clicks) : valorDaAcao(l.actions, TIPOS_CLIQUE_SAIDA) ?? 0;
    cliquesSaida += saida;
    const f = num(l.frequency);
    if (f > 0 && imp > 0) {
      freqPeso += f * imp;
      impComFreq += imp;
    }
    const v = valorDaAcao(l.actions, TIPOS_VISITA);
    if (v != null) visitas = (visitas ?? 0) + v;
    const e = valorDaAcao(l.actions, TIPOS_ENGAJAMENTO);
    if (e != null) engajamentos = (engajamentos ?? 0) + e;
    for (const g of GRUPOS_DE_RESULTADO) {
      const r = valorDaAcao(l.actions, g.tipos);
      if (r != null) porTipo[g.chave] = (porTipo[g.chave] ?? 0) + r;
    }
    if (l.day) dias.add(String(l.day).slice(0, 10));
  }
  const resultados = Object.values(porTipo).reduce((s, v) => s + v, 0);
  const ordenados = [...dias].sort();
  return {
    gasto: arred(gasto),
    impressoes,
    cliques,
    cliques_saida: cliquesSaida,
    visitas,
    engajamentos,
    ctr_saida_pct: impressoes > 0 ? arred((cliquesSaida / impressoes) * 100) : null,
    cpc: cliquesSaida > 0 ? arred(gasto / cliquesSaida) : null,
    cpm: impressoes > 0 ? arred((gasto / impressoes) * 1000) : null,
    frequencia_media: impComFreq > 0 ? arred(freqPeso / impComFreq) : null,
    taxa_visita: visitas != null && cliquesSaida > 0 ? arred(visitas / cliquesSaida, 3) : null,
    resultados,
    resultados_por_tipo: porTipo,
    custo_por_resultado: resultados > 0 ? arred(gasto / resultados) : null,
    dias: dias.size,
    inicio: ordenados[0] ?? null,
    fim: ordenados[ordenados.length - 1] ?? null,
  };
}

/**
 * Evidência de um anúncio próprio importado: E3 só com gasto E resultado
 * documentados na Meta; senão E1 (foi veiculado, resultado desconhecido).
 * E4 já conquistado por aprendizado nunca desce.
 */
export function evidenciaDaImportacao(m: Pick<Metricas, "gasto" | "resultados">, atual?: string | null): Evidencia {
  if (atual === "E4") return "E4";
  return m.gasto > 0 && m.resultados > 0 ? "E3" : "E1";
}

const ORDEM: Evidencia[] = ["E0", "E1", "E2", "E3", "E4"];
export function maiorEvidencia(a: string | null | undefined, b: Evidencia): Evidencia {
  const ia = ORDEM.indexOf((a ?? "E0") as Evidencia);
  return ia > ORDEM.indexOf(b) ? ORDEM[ia] : b;
}

// ------------------------------------------------------------- diagnóstico

/**
 * Limiares do diagnóstico, simples e à vista. São pontos de atenção, não
 * regra universal (o dossiê proíbe "matar em 24 h"): servem para apontar qual
 * linha da tabela DIAGNOSTICO investigar primeiro.
 */
export const LIMIARES_DIAGNOSTICO = {
  /** Abaixo disso o período é inconclusivo: pouca entrega para concluir qualquer coisa. */
  impressoes_minimas: 1000,
  /** CTR de saída abaixo de 0,8%: pouca atenção inicial. */
  ctr_saida_baixo_pct: 0.8,
  /** Engajamento por impressão a partir de 2% com CTR baixo: interesse sem motivo de ação. */
  engajamento_alto_pct: 2,
  /** Cliques de saída mínimos para julgar o que acontece depois do clique. */
  cliques_minimos: 30,
  /** Menos da metade dos cliques de saída virou visita: problema técnico ou clique acidental. */
  taxa_visita_baixa: 0.5,
  /** Frequência média a partir de 3: risco de fadiga criativa. */
  frequencia_alta: 3,
  /** Custo (por resultado, ou CPM sem resultado) 20% maior na segunda metade do período: custo subindo. */
  alta_de_custo: 1.2,
} as const;

export type Sinal = { codigo: string; sinal: string; hipotese: string; verificar: string };
export type Diagnostico = {
  situacao: "inconclusivo" | "com_sinais" | "sem_alerta";
  sinais: Sinal[];
  observacoes: string[];
  limiares: typeof LIMIARES_DIAGNOSTICO;
};

const pct = (v: number) => `${String(Math.round(v * 100) / 100).replace(".", ",")}%`;

/** Custo da segunda metade dividido pelo da primeira (por resultado; sem resultado, CPM). */
export function tendenciaDeCusto(linhas: Diaria[]): number | null {
  const dias = [...new Set(linhas.map((l) => String(l.day).slice(0, 10)))].sort();
  if (dias.length < 4) return null;
  const corte = dias[Math.floor(dias.length / 2)];
  const a = somarMetricas(linhas.filter((l) => String(l.day).slice(0, 10) < corte));
  const b = somarMetricas(linhas.filter((l) => String(l.day).slice(0, 10) >= corte));
  if (a.custo_por_resultado && b.custo_por_resultado) return Math.round((b.custo_por_resultado / a.custo_por_resultado) * 100) / 100;
  if (a.cpm && b.cpm) return Math.round((b.cpm / a.cpm) * 100) / 100;
  return null;
}

/**
 * Diagnóstico pela tabela DIAGNOSTICO do dossiê, em código e sem IA.
 * Hipóteses a investigar, nunca causa garantida.
 */
export function diagnosticar(m: Metricas, linhas: Diaria[], custoToleravel?: number | null): Diagnostico {
  const L = LIMIARES_DIAGNOSTICO;
  const observacoes = [
    "Qualidade dos contatos e vendas não vêm da Meta: \"muitos contatos ruins\" e \"bons contatos e poucas vendas\" só se leem com o acompanhamento comercial.",
    "Sem retenção de vídeo nestes dados: \"atenção e abandono rápido\" não é avaliado aqui.",
  ];
  if (m.impressoes < L.impressoes_minimas) {
    return {
      situacao: "inconclusivo",
      sinais: [{
        codigo: "volume_insuficiente",
        sinal: `Só ${m.impressoes} impressões no período.`,
        hipotese: "Volume insuficiente para concluir. Registrar como inconclusivo.",
        verificar: "Entrega, verba, público e período antes de julgar a peça.",
      }],
      observacoes,
      limiares: L,
    };
  }
  const sinais: Sinal[] = [];
  const ctr = m.ctr_saida_pct ?? 0;
  const engPct = m.engajamentos != null && m.impressoes > 0 ? (m.engajamentos / m.impressoes) * 100 : null;
  if (ctr < L.ctr_saida_baixo_pct) {
    if (engPct != null && engPct >= L.engajamento_alto_pct) {
      sinais.push({
        codigo: "engajamento_sem_clique",
        sinal: `Engajamento de ${pct(engPct)} das impressões, mas CTR de saída de ${pct(ctr)}.`,
        hipotese: "Interesse sem motivo de ação.",
        verificar: "Oferta, prova, CTA e objetivo da campanha.",
      });
    } else {
      sinais.push({
        codigo: "pouca_atencao",
        sinal: `CTR de saída de ${pct(ctr)} (abaixo de ${pct(L.ctr_saida_baixo_pct)}).`,
        hipotese: "Abertura pouco clara ou pouco relevante.",
        verificar: "Visual, primeira frase, público e distribuição.",
      });
    }
  }
  if (m.cliques_saida >= L.cliques_minimos && m.taxa_visita != null && m.taxa_visita < L.taxa_visita_baixa) {
    sinais.push({
      codigo: "cliques_sem_visita",
      sinal: `${m.cliques_saida} cliques de saída e ${m.visitas ?? 0} visitas (${pct(m.taxa_visita * 100)}).`,
      hipotese: "Problema técnico ou clique acidental.",
      verificar: "Carregamento, destino e rastreamento.",
    });
  }
  if (m.cliques_saida >= L.cliques_minimos && m.resultados === 0) {
    sinais.push({
      codigo: "visitas_sem_contato",
      sinal: `${m.cliques_saida} cliques de saída e nenhum resultado registrado.`,
      hipotese: "Descontinuidade entre anúncio e destino (ou resultado não rastreado).",
      verificar: "Oferta, formulário ou primeira mensagem, confiança, usabilidade e rastreamento.",
    });
  }
  const tendencia = tendenciaDeCusto(linhas);
  if ((m.frequencia_media ?? 0) >= L.frequencia_alta && (tendencia == null || tendencia >= L.alta_de_custo)) {
    sinais.push({
      codigo: "fadiga",
      sinal: `Frequência média de ${String(m.frequencia_media).replace(".", ",")}${tendencia != null ? ` e custo ${Math.round((tendencia - 1) * 100)}% maior na segunda metade` : ""}.`,
      hipotese: "Fadiga criativa.",
      verificar: "Novo ângulo ou nova execução do ângulo vencedor.",
    });
  }
  if (custoToleravel && custoToleravel > 0 && m.custo_por_resultado != null && m.custo_por_resultado > custoToleravel) {
    sinais.push({
      codigo: "custo_acima_do_toleravel",
      sinal: `Custo por resultado de ${m.custo_por_resultado} acima do tolerável do briefing (${custoToleravel}).`,
      hipotese: "A peça traz resultado, mas caro para a oferta.",
      verificar: "Qualidade dos contatos, oferta, público e comparação com outro ângulo.",
    });
  }
  return { situacao: sinais.length ? "com_sinais" : "sem_alerta", sinais, observacoes, limiares: L };
}

// ------------------------------------------------------------- aprendizado

export type DirecaoResultado = "positivo" | "negativo" | "inconclusivo";

/** Direção do resultado de uma janela: base para a E4 (mesmo ângulo, mesma direção, nova janela). */
export function direcaoDoResultado(m: Metricas, custoToleravel?: number | null): DirecaoResultado {
  if (m.impressoes < LIMIARES_DIAGNOSTICO.impressoes_minimas || m.gasto <= 0) return "inconclusivo";
  if (m.resultados <= 0) return "negativo";
  if (custoToleravel && custoToleravel > 0 && m.custo_por_resultado != null) {
    return m.custo_por_resultado <= custoToleravel ? "positivo" : "negativo";
  }
  return "positivo";
}

/**
 * E4 quando já existe aprendizado E3 ou E4 do mesmo ângulo, com a mesma
 * direção de resultado, numa janela anterior que não se sobrepõe a esta.
 */
export function evidenciaDoAprendizado(
  anteriores: { evidencia: string; periodo_fim: string | null; direcao: string | null }[],
  direcao: DirecaoResultado,
  periodoInicio: string,
): "E3" | "E4" {
  if (direcao === "inconclusivo") return "E3";
  const confirma = anteriores.some((a) =>
    (a.evidencia === "E3" || a.evidencia === "E4") && a.direcao === direcao && !!a.periodo_fim && a.periodo_fim < periodoInicio
  );
  return confirma ? "E4" : "E3";
}

// ------------------------------------------------------------- textos

/** Corta no limite sem partir palavra (título até 40, por exemplo). */
export function cortarNaPalavra(texto: string, max: number): string {
  const t = texto.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const corte = t.slice(0, max + 1);
  const i = corte.lastIndexOf(" ");
  return (i > max * 0.6 ? corte.slice(0, i) : t.slice(0, max)).replace(/[\s,;:.]+$/, "");
}

/** Travessão e meia-risca viram vírgula (regra do dono), sem mexer em hífen de palavra. */
export function semTravessao(texto: string): string {
  return texto.replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/,\s*,/g, ",");
}
