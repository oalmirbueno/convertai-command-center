/**
 * Cálculos da Mesa Ads, puros e sem IA (docs/mesa-ads/SPEC.md e
 * docs/mesa-ads/v2/CONTRATO-V2.md).
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
  /** Campanha do anúncio no dia (a conta ao vivo agrupa por ela). */
  campaign_id?: string | null;
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
  // Conversa iniciada; sem ela no dia, a conexão de mensagem (o Direct e o WhatsApp de alguns
  // anúncios só registram esta: Verzelo, 23/09).
  { chave: "mensagens", tipos: ["onsite_conversion.messaging_conversation_started_7d", "onsite_conversion.total_messaging_connection"] },
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

// =============================================================== Mesa Ads v2
// Regras em c\u00f3digo da v2 (docs/mesa-ads/v2/CONTRATO-V2.md): notas do Jev em
// 0 a 10, aprova\u00e7\u00e3o do \u00e2ngulo, conta ao vivo (tend\u00eancia e sinal), leitura do
// an\u00fancio da Meta, links das refer\u00eancias e o pacote do gestor. Nada aqui
// chama IA nem banco.

// ------------------------------------------------------------- notas do Jev

/**
 * Nota do Score do Jev (0 a niveis-1) em 0 a 10 com uma casa. Todos os
 * n\u00edveis v\u00e3o do pior ao melhor, inclusive NIVEIS_RISCO_POLITICA (0 = viola a
 * pol\u00edtica, \u00faltimo = sem risco aparente): em risco_politica, 10 = SEM risco.
 */
export const notaDe0a10 = (n: number | null, niveis: number): number | null =>
  n == null ? null : Math.round((n / (niveis - 1)) * 100) / 10;

/** N\u00edvel bruto 0 ("viola") ou 1 ("risco alto") de 0 a 4: a pe\u00e7a vai com alerta de pol\u00edtica. */
export const alertaDePolitica = (bruta: number | null): boolean => bruta != null && bruta < 2;

// ------------------------------------------------------------- aprova\u00e7\u00e3o do \u00e2ngulo

/**
 * Regra de aprova\u00e7\u00e3o do plano de teste (contrato v2 com a corre\u00e7\u00e3o do
 * coordenador): risco_politica \u00e9 nota de 0 a 10 onde 10 = sem risco, ent\u00e3o
 * aprovar exige 7 ou mais (n\u00edvel "risco baixo" ou melhor) e nenhum alerta.
 */
export const LIMIARES_APROVACAO = {
  clareza_min: 7,
  relevancia_min: 7,
  parada_min: 6,
  diferenciacao_min: 6,
  /** Nota de risco de pol\u00edtica (10 = sem risco): m\u00ednimo para aprovar. */
  risco_politica_min: 7,
  /** v3: só quando o Jev mediu o tom pedido (agressivo, por exemplo). */
  tom_min: 6,
} as const;

export type NotasAngulo = {
  clareza: number | null;
  relevancia: number | null;
  prova: number | null;
  risco_politica: number | null;
  parada?: number | null;
  diferenciacao?: number | null;
  /** v3: quanto o ângulo cumpre o tom pedido (0 a 10); ausente quando não foi medido. */
  tom?: number | null;
  alerta_politica: boolean;
};

const virgula = (v: number) => String(v).replace(".", ",");

/** Motivos de reprova\u00e7\u00e3o do \u00e2ngulo (lista vazia = aprovado). Nota ausente reprova: sem nota n\u00e3o h\u00e1 aprova\u00e7\u00e3o. */
export function motivosDoAngulo(j: NotasAngulo | null | undefined): string[] {
  if (!j) return ["Sem nota do Jev."];
  const L = LIMIARES_APROVACAO;
  const motivos: string[] = [];
  if (j.alerta_politica) motivos.push("Alerta de pol\u00edtica da Meta.");
  if (j.risco_politica == null) motivos.push("Sem nota de risco de pol\u00edtica.");
  else if (j.risco_politica < L.risco_politica_min) motivos.push(`Risco de pol\u00edtica: nota ${virgula(j.risco_politica)} (o m\u00ednimo \u00e9 ${L.risco_politica_min}; 10 = sem risco).`);
  const minimos: [number | null | undefined, number, string][] = [
    [j.clareza, L.clareza_min, "Clareza"],
    [j.relevancia, L.relevancia_min, "Relev\u00e2ncia"],
    [j.parada, L.parada_min, "Poder de parar a rolagem"],
    [j.diferenciacao, L.diferenciacao_min, "Diferencia\u00e7\u00e3o"],
  ];
  for (const [nota, minimo, nome] of minimos) {
    if (nota == null) motivos.push(`Sem nota de ${nome.toLowerCase()}.`);
    else if (nota < minimo) motivos.push(`${nome} ${virgula(nota)} (o m\u00ednimo \u00e9 ${minimo}).`);
  }
  if (typeof j.tom === "number" && j.tom < L.tom_min) motivos.push(`Abaixo do tom pedido: nota ${virgula(j.tom)} (o mínimo é ${L.tom_min}).`);
  return motivos;
}

/**
 * Ângulo genérico pela nota do Jev (regra em código): diferenciação ou
 * relevância abaixo de 5 (o nível "serviria para qualquer marca da categoria").
 */
export function anguloGenerico(j: NotasAngulo | null | undefined): boolean {
  if (!j) return false;
  return (typeof j.diferenciacao === "number" && j.diferenciacao < 5) || (typeof j.relevancia === "number" && j.relevancia < 5);
}

export const anguloAprovado = (j: NotasAngulo | null | undefined): boolean => motivosDoAngulo(j).length === 0;

/** Pesos da pontua\u00e7\u00e3o do \u00e2ngulo (somam 1). risco_politica entra como qualidade (10 = sem risco). */
export const PESOS_PONTUACAO = { clareza: 0.22, relevancia: 0.2, parada: 0.2, diferenciacao: 0.15, prova: 0.1, risco_politica: 0.13 } as const;
/** v3: peso do tom pedido quando o Jev mediu (entra na média ponderada junto dos outros). */
export const PESO_DO_TOM = 0.15;

/**
 * Pontua\u00e7\u00e3o de 0 a 10 para ordenar os \u00e2ngulos: m\u00e9dia ponderada das notas
 * presentes; alerta de pol\u00edtica corta pela metade.
 */
export function pontuacaoDoAngulo(j: NotasAngulo | null | undefined): number | null {
  if (!j) return null;
  const P = PESOS_PONTUACAO;
  const partes: [number | null | undefined, number][] = [
    [j.clareza, P.clareza],
    [j.relevancia, P.relevancia],
    [j.parada, P.parada],
    [j.diferenciacao, P.diferenciacao],
    [j.prova, P.prova],
    [j.risco_politica, P.risco_politica],
    [j.tom, PESO_DO_TOM],
  ];
  let soma = 0;
  let pesos = 0;
  for (const [v, p] of partes) {
    if (typeof v === "number" && Number.isFinite(v)) {
      soma += v * p;
      pesos += p;
    }
  }
  if (!pesos) return null;
  const nota = (soma / pesos) * (j.alerta_politica ? 0.5 : 1);
  return Math.round(nota * 10) / 10;
}

/**
 * Lista final do plano: aprovados por pontua\u00e7\u00e3o; se sobrarem menos de
 * `minimo`, os melhores reprovados completam a lista marcados `reprovado`;
 * o resto vai para os descartados com os motivos.
 */
export function separarAngulos<T extends { aprovado: boolean; pontuacao: number | null; motivos?: string[] }>(
  angulos: T[],
  minimo = 3,
  maximo = Infinity,
): { principais: (T & { reprovado?: boolean })[]; descartados: T[] } {
  const ordem = (a: T, b: T) => (b.pontuacao ?? -1) - (a.pontuacao ?? -1);
  const todosAprovados = angulos.filter((a) => a.aprovado).sort(ordem);
  // Gera a mais e entrega os melhores: aprovado além do pedido fica de reserva.
  const aprovados = todosAprovados.slice(0, maximo);
  const reservas = todosAprovados.slice(maximo).map((a) => ({ ...a, motivos: ["Aprovado, ficou de reserva: outros tiveram nota maior."] }));
  const reprovados = angulos.filter((a) => !a.aprovado).sort(ordem);
  const faltam = Math.max(0, Math.min(minimo, maximo) - aprovados.length);
  const resgatados = reprovados.slice(0, faltam).map((a) => ({ ...a, reprovado: true }));
  return { principais: [...aprovados, ...resgatados], descartados: [...reservas, ...reprovados.slice(faltam)] };
}

// ------------------------------------------------------------- conta ao vivo

export type Tendencia = { ctr_var_pct: number | null; custo_resultado_var_pct: number | null; frequencia: number | null };

/** Impress\u00f5es m\u00ednimas em cada metade do per\u00edodo para comparar CTR e custo. */
export const IMPRESSOES_POR_METADE = 500;

/**
 * Tend\u00eancia do an\u00fancio no per\u00edodo: segunda metade dos dias contra a primeira.
 * Varia\u00e7\u00e3o em % (positivo = subiu). Frequ\u00eancia: a da metade mais recente.
 */
export function tendenciaDoAnuncio(linhas: Diaria[]): Tendencia {
  const total = somarMetricas(linhas);
  const dias = [...new Set(linhas.map((l) => String(l.day).slice(0, 10)))].sort();
  if (dias.length < 4) return { ctr_var_pct: null, custo_resultado_var_pct: null, frequencia: total.frequencia_media };
  const corte = dias[Math.floor(dias.length / 2)];
  const a = somarMetricas(linhas.filter((l) => String(l.day).slice(0, 10) < corte));
  const b = somarMetricas(linhas.filter((l) => String(l.day).slice(0, 10) >= corte));
  const comparaveis = a.impressoes >= IMPRESSOES_POR_METADE && b.impressoes >= IMPRESSOES_POR_METADE;
  const variacao = (x: number | null, y: number | null) =>
    comparaveis && x != null && y != null && x > 0 ? Math.round((y / x - 1) * 1000) / 10 : null;
  return {
    ctr_var_pct: variacao(a.ctr_saida_pct, b.ctr_saida_pct),
    custo_resultado_var_pct: variacao(a.custo_por_resultado, b.custo_por_resultado),
    frequencia: b.frequencia_media ?? total.frequencia_media,
  };
}

/**
 * Limiares do sinal da conta ao vivo. S\u00e3o pontos de decis\u00e3o da equipe, n\u00e3o
 * verdade universal: o custo de refer\u00eancia \u00e9 o toler\u00e1vel do briefing ou, sem
 * ele, o custo por resultado m\u00e9dio da pr\u00f3pria conta no per\u00edodo.
 */
export const LIMIARES_SINAL = {
  /** Resultados m\u00ednimos no per\u00edodo para falar em escalar. */
  resultados_para_escalar: 3,
  /** Escalar: custo por resultado at\u00e9 80% da refer\u00eancia. */
  folga_para_escalar: 0.8,
  /** Escalar s\u00f3 com frequ\u00eancia abaixo disso (ainda h\u00e1 p\u00fablico novo). */
  frequencia_max_para_escalar: 2.5,
  /** Fadiga: CTR caiu 20% ou mais da primeira para a segunda metade... */
  queda_de_ctr_fadiga_pct: -20,
  /** ...ou o custo por resultado subiu 20% ou mais, com frequ\u00eancia alta. */
  alta_de_custo_fadiga_pct: 20,
  /** Pausar: custo por resultado acima de 2 vezes a refer\u00eancia. */
  custo_para_pausar: 2,
  /** Pausar: gasto sem nenhum resultado maior que 2 vezes a refer\u00eancia. */
  gasto_sem_resultado_para_pausar: 2,
  /** Sem refer\u00eancia de custo: impress\u00f5es sem nenhum resultado para pausar. */
  impressoes_sem_resultado_para_pausar: 5000,
} as const;

export type SinalConta = "escalar" | "manter" | "observar" | "renovar" | "pausar" | "sem_dados";

/** Sinal do an\u00fancio na conta ao vivo, regra em c\u00f3digo (nunca IA). */
export function sinalDoAnuncio(m: Metricas, t: Tendencia, custoReferencia?: number | null): SinalConta {
  const L = LIMIARES_SINAL;
  const D = LIMIARES_DIAGNOSTICO;
  if (m.impressoes < D.impressoes_minimas || !(m.gasto > 0)) return "sem_dados";
  const ref = custoReferencia && custoReferencia > 0 ? custoReferencia : null;
  if (m.resultados <= 0) {
    const gastouDemais = ref ? m.gasto >= ref * L.gasto_sem_resultado_para_pausar : m.impressoes >= L.impressoes_sem_resultado_para_pausar;
    return gastouDemais ? "pausar" : "observar";
  }
  const cpr = m.custo_por_resultado;
  if (ref && cpr != null && cpr > ref * L.custo_para_pausar) return "pausar";
  const freq = t.frequencia ?? m.frequencia_media ?? 0;
  const ctrCaiu = t.ctr_var_pct != null && t.ctr_var_pct <= L.queda_de_ctr_fadiga_pct;
  const custoSubiu = t.custo_resultado_var_pct != null && t.custo_resultado_var_pct >= L.alta_de_custo_fadiga_pct;
  if (freq >= D.frequencia_alta && (ctrCaiu || custoSubiu)) return "renovar";
  if (ref && m.resultados >= L.resultados_para_escalar && cpr != null && cpr <= ref * L.folga_para_escalar && freq < L.frequencia_max_para_escalar && !custoSubiu) {
    return "escalar";
  }
  if (custoSubiu || (m.ctr_saida_pct ?? 0) < D.ctr_saida_baixo_pct || (ref && cpr != null && cpr > ref)) return "observar";
  return "manter";
}

export type PontoDaSerie = { dia: string; gasto: number; impressoes: number; cliques: number; ctr: number | null; resultados: number };

/** S\u00e9rie di\u00e1ria do an\u00fancio (cliques = cliques de sa\u00edda; ctr = CTR de sa\u00edda em %). */
export function serieDiaria(linhas: Diaria[]): PontoDaSerie[] {
  const porDia = new Map<string, Diaria[]>();
  for (const l of linhas) {
    const d = String(l.day).slice(0, 10);
    const lista = porDia.get(d) ?? [];
    lista.push(l);
    porDia.set(d, lista);
  }
  return [...porDia.keys()].sort().map((dia) => {
    const m = somarMetricas(porDia.get(dia)!);
    return { dia, gasto: m.gasto, impressoes: m.impressoes, cliques: m.cliques_saida, ctr: m.ctr_saida_pct, resultados: m.resultados };
  });
}

// ------------------------------------------------------------- anúncio da Meta

/** Botões da Meta (call_to_action.type) no nome que a equipe vê. */
export const CTA_DA_META: Record<string, string | null> = {
  LEARN_MORE: "Saiba mais",
  MESSAGE_PAGE: "Enviar mensagem",
  SEND_MESSAGE: "Enviar mensagem",
  INSTAGRAM_MESSAGE: "Enviar mensagem",
  WHATSAPP_MESSAGE: "Enviar mensagem pelo WhatsApp",
  SHOP_NOW: "Comprar agora",
  BUY_NOW: "Comprar agora",
  ORDER_NOW: "Peça agora",
  SIGN_UP: "Cadastre-se",
  SUBSCRIBE: "Assinar",
  BOOK_TRAVEL: "Reservar",
  BOOK_NOW: "Reservar",
  CONTACT_US: "Fale conosco",
  GET_QUOTE: "Solicitar orçamento",
  CALL_NOW: "Ligar agora",
  DOWNLOAD: "Baixar",
  GET_OFFER: "Obter oferta",
  SEE_MENU: "Ver menu",
  APPLY_NOW: "Candidate-se",
  GET_DIRECTIONS: "Como chegar",
  WATCH_MORE: "Assistir mais",
  NO_BUTTON: null,
};

export type CopyDoAnuncio = {
  titulo: string | null;
  corpo: string | null;
  descricao: string | null;
  cta: string | null;
  cta_tipo: string | null;
  destino: string | null;
  imagem_url: string | null;
  miniatura_url: string | null;
  video_id: string | null;
};

const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const primeiroTexto = (v: unknown): string | null => {
  if (!Array.isArray(v)) return null;
  for (const x of v) {
    const t = str(objeto(x).text) ?? str(x);
    if (t) return t;
  }
  return null;
};

/**
 * Copy, CTA, destino e imagem do anúncio a partir do `raw` guardado em
 * ads_creatives (anúncio da Meta com creative.object_story_spec). Só o que a
 * Meta devolveu: campo que não veio fica null.
 */
export function extrairCopyDoRaw(
  raw: unknown,
  colunas: { titulo?: string | null; corpo?: string | null; destino?: string | null; image_url?: string | null; thumbnail_url?: string | null; video_id?: string | null } = {},
): CopyDoAnuncio {
  const r = objeto(raw);
  const criativo = objeto(r.creative);
  const spec = objeto(criativo.object_story_spec);
  const link = objeto(spec.link_data);
  const video = objeto(spec.video_data);
  const modelo = objeto(spec.template_data);
  const feed = objeto(criativo.asset_feed_spec);
  const ctaObj = objeto(link.call_to_action ?? video.call_to_action ?? modelo.call_to_action);
  const ctaTipo = str(ctaObj.type) ?? (Array.isArray(feed.call_to_action_types) ? str(feed.call_to_action_types[0]) : null);
  const ctaValor = objeto(ctaObj.value);
  const linkFeed = Array.isArray(feed.link_urls) ? objeto(feed.link_urls[0]) : {};
  let destino = str(ctaValor.link) ?? str(link.link) ?? str(modelo.link) ?? str(linkFeed.website_url) ?? str(colunas.destino);
  if (!destino && ctaTipo) {
    const app = String(ctaValor.app_destination ?? "").toUpperCase();
    if (ctaTipo === "WHATSAPP_MESSAGE" || app === "WHATSAPP") destino = "WhatsApp";
    else if (ctaTipo === "INSTAGRAM_MESSAGE" || app === "INSTAGRAM_DIRECT") destino = "Direct do Instagram";
    else if (ctaTipo === "MESSAGE_PAGE" || ctaTipo === "SEND_MESSAGE" || app === "MESSENGER") destino = "Messenger";
    else if (ctaTipo === "CALL_NOW") destino = "Ligação";
  }
  let cta: string | null = null;
  if (ctaTipo) {
    cta = ctaTipo in CTA_DA_META
      ? CTA_DA_META[ctaTipo]
      : ctaTipo.toLowerCase().split("_").map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join(" ");
  }
  return {
    titulo: str(link.name) ?? str(video.title) ?? str(modelo.name) ?? primeiroTexto(feed.titles) ?? str(criativo.title) ?? str(colunas.titulo),
    corpo: str(link.message) ?? str(video.message) ?? str(modelo.message) ?? primeiroTexto(feed.bodies) ?? str(criativo.body) ?? str(colunas.corpo),
    descricao: str(link.description) ?? str(video.link_description) ?? str(modelo.description) ?? primeiroTexto(feed.descriptions),
    cta,
    cta_tipo: ctaTipo,
    destino,
    imagem_url: str(criativo.image_url) ?? str(link.picture) ?? str(video.image_url) ?? str(colunas.image_url),
    miniatura_url: str(criativo.thumbnail_url) ?? str(colunas.thumbnail_url),
    video_id: str(criativo.video_id) ?? str(video.video_id) ?? str(colunas.video_id),
  };
}

// ------------------------------------------------------------- links das referências

/** IPv4 de rede interna, reservada ou de metadados (bloqueado para busca no servidor). */
export function ipv4Interno(ip: string): boolean {
  const p = ip.split(".").map((x) => Number(x));
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19));
}

/** IPv6 interno (loopback, local, único local, IPv4 mapeado). */
export function ipv6Interno(ip: string): boolean {
  const h = ip.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::" || h === "::1") return true;
  if (/^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return true;
  const mapeado = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapeado) return ipv4Interno(mapeado[1]);
  return h.startsWith("::ffff:") || h.startsWith("64:ff9b:");
}

/**
 * Só https público na porta padrão, sem usuário e senha, sem host interno.
 * Devolve a URL normalizada ou null.
 */
export function urlPublicaSegura(bruto: unknown): URL | null {
  if (typeof bruto !== "string" || !bruto.trim() || bruto.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(bruto.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  if (u.port && u.port !== "443") return null;
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!h) return null;
  if (h.startsWith("[")) return ipv6Interno(h) ? null : u;
  if (/^[\d.]+$/.test(h)) return ipv4Interno(h) ? null : u;
  if (!h.includes(".") || h === "localhost" || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(h)) return null;
  return u;
}

export type TipoDeLink = "youtube" | "github" | "behance" | "instagram" | "pinterest" | "spotify" | "tiktok" | "imagem" | "pagina";

const EXT_IMAGEM = /\.(png|jpe?g|webp)$/i;

export function tipoDoLink(u: URL): TipoDeLink {
  const h = u.hostname.toLowerCase().replace(/^www\./, "");
  if (h === "youtu.be" || h === "youtube.com" || h.endsWith(".youtube.com")) return "youtube";
  if (h === "github.com") return "github";
  if (h === "behance.net" || h.endsWith(".behance.net")) return h.startsWith("mir-s3-cdn") ? "imagem" : "behance";
  if (h === "instagram.com" || h.endsWith(".instagram.com")) return "instagram";
  if (/(^|\.)pinterest\.[a-z.]{2,8}$/.test(h) || h === "pin.it") return "pinterest";
  if (h === "open.spotify.com" || h === "spotify.com") return "spotify";
  if (h === "tiktok.com" || h.endsWith(".tiktok.com")) return "tiktok";
  if (EXT_IMAGEM.test(u.pathname)) return "imagem";
  return "pagina";
}

/** Origem gravada em ads_referencias para um link importado. */
export function origemDoLink(u: URL): "pinterest" | "instagram" | "tiktok" | "url" {
  const t = tipoDoLink(u);
  return t === "pinterest" || t === "instagram" || t === "tiktok" ? t : "url";
}

/** Id do vídeo do YouTube (watch, youtu.be, shorts, embed, live) ou null. */
export function idDoYoutube(u: URL): string | null {
  const h = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  const valido = (x: string | null | undefined) => (x && /^[A-Za-z0-9_-]{11}$/.test(x) ? x : null);
  if (h === "youtu.be") return valido(u.pathname.split("/")[1]);
  if (h === "youtube.com" || h === "music.youtube.com") {
    const v = valido(u.searchParams.get("v"));
    if (v) return v;
    const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/);
    return m ? valido(m[2]) : null;
  }
  return null;
}

const GITHUB_RESERVADOS = new Set(["orgs", "topics", "search", "marketplace", "features", "explore", "settings", "login", "about", "pricing", "collections", "sponsors", "trending", "enterprise", "apps"]);

/** Dono e repositório de um link do GitHub ou null. */
export function repoDoGithub(u: URL): { dono: string; repo: string } | null {
  if (u.hostname.toLowerCase().replace(/^www\./, "") !== "github.com") return null;
  const [dono, repoBruto] = u.pathname.split("/").filter(Boolean);
  if (!dono || !repoBruto || GITHUB_RESERVADOS.has(dono.toLowerCase())) return null;
  const repo = repoBruto.replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]+$/.test(dono) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return { dono, repo };
}

/** Entidades HTML mais comuns. */
export function decodificarHtml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export type MetaTags = { titulo: string | null; descricao: string | null; imagem: string | null; site: string | null; tipo: string | null; imagens: string[] };

/** og:tags, twitter:tags e <title> de uma página (atributos em qualquer ordem). */
export function lerMetaTags(html: string, base?: string): MetaTags {
  const campos = new Map<string, string[]>();
  const trecho = html.slice(0, 600_000);
  const tags = trecho.match(/<meta\s[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const attrs: Record<string, string> = {};
    const re = /([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tag))) attrs[m[1].toLowerCase()] = decodificarHtml(m[3] ?? m[4] ?? "").trim();
    const chave = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (!chave || !attrs.content) continue;
    const lista = campos.get(chave) ?? [];
    lista.push(attrs.content);
    campos.set(chave, lista);
  }
  const um = (...chaves: string[]) => {
    for (const c of chaves) {
      const v = campos.get(c)?.[0];
      if (v) return v;
    }
    return null;
  };
  const absoluta = (x: string) => {
    try {
      return new URL(x, base).toString();
    } catch {
      return null;
    }
  };
  const tituloTag = trecho.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
  const titulo = um("og:title", "twitter:title") ?? (tituloTag ? decodificarHtml(tituloTag[1]).trim() : null);
  const imagens = [...new Set(
    [...(campos.get("og:image") ?? []), ...(campos.get("og:image:secure_url") ?? []), ...(campos.get("twitter:image") ?? []), ...(campos.get("twitter:image:src") ?? [])]
      .map(absoluta)
      .filter((x): x is string => !!x),
  )];
  return {
    titulo: titulo || null,
    descricao: um("og:description", "twitter:description", "description"),
    imagem: imagens[0] ?? null,
    site: um("og:site_name", "application-name"),
    tipo: um("og:type"),
    imagens,
  };
}

/** Ordem de preferência dos tamanhos de módulo do Behance (maior primeiro). */
const TAMANHOS_BEHANCE = ["source", "max_3840", "max_3840_webp", "fs", "fs_webp", "max_1200", "max_1200_webp", "1400", "1400_webp", "1400_opt_1", "hd", "disp", "disp_webp", "808", "max_808", "404", "max_632", "230"];

/** Imagens dos módulos de um projeto do Behance (o maior tamanho de cada uma, sem repetir). */
export function imagensDoBehance(html: string, max = 12): string[] {
  const texto = html.replace(/\\\//g, "/");
  const achados = texto.match(/https:\/\/mir-s3-cdn-cf\.behance\.net\/project_modules\/[^"'\s)\\<>]+/g) ?? [];
  const melhor = new Map<string, { url: string; rank: number }>();
  const ordem: string[] = [];
  for (const url of achados) {
    const partes = url.split("/");
    const tamanho = partes[4] ?? "";
    const arquivo = partes[partes.length - 1].split("?")[0];
    if (!arquivo || !EXT_IMAGEM.test(arquivo)) continue;
    const i = TAMANHOS_BEHANCE.indexOf(tamanho);
    const rank = i < 0 ? TAMANHOS_BEHANCE.length : i;
    const atual = melhor.get(arquivo);
    if (!atual) ordem.push(arquivo);
    if (!atual || rank < atual.rank) melhor.set(arquivo, { url, rank });
  }
  return ordem.slice(0, max).map((a) => melhor.get(a)!.url);
}

/** Imagens do README (markdown e <img>); caminho relativo vira raw.githubusercontent. Sem selo nem SVG. */
export function imagensDoReadme(md: string, dono: string, repo: string, max = 8): string[] {
  const achados: string[] = [];
  const reMd = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
  const reImg = /<img\s[^>]*src\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = reMd.exec(md))) achados.push(m[1]);
  while ((m = reImg.exec(md))) achados.push(m[1]);
  const saida: string[] = [];
  for (const bruto of achados) {
    let url: string;
    if (/^https?:\/\//i.test(bruto)) url = bruto.replace(/^http:/i, "https:");
    else url = `https://raw.githubusercontent.com/${dono}/${repo}/HEAD/${bruto.replace(/^\.?\//, "")}`;
    url = url.replace(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\//, "https://raw.githubusercontent.com/$1/$2/");
    if (/shields\.io|badgen|badge|\.svg(\?|$)/i.test(url)) continue;
    if (!saida.includes(url)) saida.push(url);
    if (saida.length >= max) break;
  }
  return saida;
}

// ------------------------------------------------------------- pacote de copy

export const ESTILOS_DE_TEXTO_PRINCIPAL = ["curto", "medio", "longo", "pas", "historia", "prova_objecao"] as const;

/** Limites do pacote (Meta e contrato v2). */
export const LIMITES_PACOTE = {
  textos_principais_min: 6,
  titulos_min: 8,
  titulo_max: 40,
  descricoes_min: 5,
  descricao_max: 30,
  ganchos_min: 5,
  texto_principal_max: 2200,
} as const;

export type PacoteCopy = {
  textos_principais: { estilo: string; texto: string }[];
  titulos: string[];
  descricoes: string[];
  ctas: { cta: string; porque: string }[];
  ganchos: string[];
  gestor: {
    objetivo_meta: string | null;
    evento_otimizacao: string | null;
    publico_sugerido: string;
    conjuntos: string[];
    utm: string;
    regras_de_corte: string[];
    regras_de_escala: string[];
    verba: string | null;
  };
};

const limpo = (v: unknown, max: number) => (typeof v === "string" ? semTravessao(v.trim().replace(/[ \t]+/g, " ")).slice(0, max) : "");
const unicos = (lista: string[]) => {
  const vistos = new Set<string>();
  return lista.filter((x) => {
    const k = x.toLowerCase();
    if (!x || vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
};

/**
 * Normaliza o pacote de copy em código: limites da Meta (título até 40,
 * descrição até 30, cortando na palavra), CTA só da lista, sem repetição e
 * sem travessão. O que ficar abaixo do mínimo vira aviso (nunca é inventado).
 */
export function normalizarPacoteCopy(bruto: unknown, ctasValidos: readonly string[]): { pacote: PacoteCopy; avisos: string[] } {
  const b = objeto(bruto);
  const L = LIMITES_PACOTE;
  const avisos: string[] = [];
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const vistosTexto = new Set<string>();
  const textos = arr(b.textos_principais)
    .map((x) => {
      const estilo = String(objeto(x).estilo ?? "");
      return { estilo: (ESTILOS_DE_TEXTO_PRINCIPAL as readonly string[]).includes(estilo) ? estilo : "medio", texto: limpo(objeto(x).texto, L.texto_principal_max) };
    })
    .filter((x) => {
      const k = x.texto.toLowerCase();
      if (!x.texto || vistosTexto.has(k)) return false;
      vistosTexto.add(k);
      return true;
    });
  let cortados = 0;
  const noLimite = (t: unknown, max: number) => {
    const s = limpo(t, 300);
    const c = cortarNaPalavra(s, max);
    if (c.length < s.length) cortados++;
    return c;
  };
  const titulos = unicos(arr(b.titulos).map((t) => noLimite(t, L.titulo_max)));
  const descricoes = unicos(arr(b.descricoes).map((t) => noLimite(t, L.descricao_max)));
  const ctas = arr(b.ctas)
    .map((x) => ({ cta: String(objeto(x).cta ?? ""), porque: limpo(objeto(x).porque, 300) }))
    .filter((x, i, todos) => ctasValidos.includes(x.cta) && todos.findIndex((y) => y.cta === x.cta) === i);
  const ganchos = unicos(arr(b.ganchos).map((g) => limpo(g, 200)));
  const g = objeto(b.gestor);
  const listaTexto = (v: unknown, n: number) => arr(v).map((x) => limpo(x, 400)).filter(Boolean).slice(0, n);
  if (cortados) avisos.push(`${cortados} título(s) ou descrição(ões) cortado(s) no limite da Meta.`);
  if (textos.length < L.textos_principais_min) avisos.push(`Vieram ${textos.length} textos principais (o pedido era ${L.textos_principais_min}).`);
  if (titulos.length < L.titulos_min) avisos.push(`Vieram ${titulos.length} títulos (o pedido era ${L.titulos_min}).`);
  if (descricoes.length < L.descricoes_min) avisos.push(`Vieram ${descricoes.length} descrições (o pedido era ${L.descricoes_min}).`);
  if (ganchos.length < L.ganchos_min) avisos.push(`Vieram ${ganchos.length} ganchos (o pedido era ${L.ganchos_min}).`);
  return {
    pacote: {
      textos_principais: textos.slice(0, 12),
      titulos: titulos.slice(0, 16),
      descricoes: descricoes.slice(0, 10),
      ctas: ctas.slice(0, 5),
      ganchos: ganchos.slice(0, 10),
      gestor: {
        objetivo_meta: limpo(g.objetivo_meta, 120) || null,
        evento_otimizacao: limpo(g.evento_otimizacao, 120) || null,
        publico_sugerido: limpo(g.publico_sugerido, 1200),
        conjuntos: listaTexto(g.conjuntos, 8),
        utm: limpo(g.utm, 400),
        regras_de_corte: listaTexto(g.regras_de_corte, 8),
        regras_de_escala: listaTexto(g.regras_de_escala, 8),
        verba: limpo(g.verba, 400) || null,
      },
    },
    avisos,
  };
}

export type CampoDoPacote = "texto_principal" | "titulo" | "descricao" | "gancho";

/** Todos os textos do pacote numa lista plana (para a conferência de política). */
export function textosDoPacote(p: PacoteCopy): { campo: CampoDoPacote; indice: number; texto: string }[] {
  return [
    ...p.textos_principais.map((t, i) => ({ campo: "texto_principal" as const, indice: i, texto: t.texto })),
    ...p.titulos.map((t, i) => ({ campo: "titulo" as const, indice: i, texto: t })),
    ...p.descricoes.map((t, i) => ({ campo: "descricao" as const, indice: i, texto: t })),
    ...p.ganchos.map((t, i) => ({ campo: "gancho" as const, indice: i, texto: t })),
  ];
}

/**
 * Aplica a conferência no pacote: troca os textos reescritos e tira os que
 * continuam com alerta. `trocas` e `remover` usam a chave "campo:indice".
 */
export function aplicarConferenciaNoPacote(p: PacoteCopy, trocas: Map<string, string>, remover: Set<string>): PacoteCopy {
  const chave = (campo: CampoDoPacote, i: number) => `${campo}:${i}`;
  const L = LIMITES_PACOTE;
  const trata = (campo: CampoDoPacote, lista: string[], max?: number) =>
    lista.flatMap((t, i) => {
      const k = chave(campo, i);
      if (remover.has(k)) return [];
      const novo = trocas.get(k);
      return [novo != null ? (max ? cortarNaPalavra(semTravessao(novo), max) : semTravessao(novo)) : t];
    });
  return {
    ...p,
    textos_principais: p.textos_principais.flatMap((t, i) => {
      const k = chave("texto_principal", i);
      if (remover.has(k)) return [];
      const novo = trocas.get(k);
      return [novo != null ? { ...t, texto: semTravessao(novo).slice(0, L.texto_principal_max) } : t];
    }),
    titulos: trata("titulo", p.titulos, L.titulo_max),
    descricoes: trata("descricao", p.descricoes, L.descricao_max),
    ganchos: trata("gancho", p.ganchos),
  };
}

export type CriativoDoPacote = {
  nome: string;
  formato: string;
  angulo: string | null;
  hipotese: string | null;
  arte: string;
  copy: { texto_principal?: string | null; titulo?: string | null; descricao?: string | null; cta_meta?: string | null };
  pacote: PacoteCopy | null;
};

export type DadosDoPacote = {
  cliente: string;
  plano: string | null;
  gerado_em: string;
  objetivo: { nome: string; objetivo_meta: string; evento_otimizacao: string; metrica_que_decide: string } | null;
  oferta: { nome: string; promessa?: string | null } | null;
  destino: string | null;
  verba_diaria_brl: number | null;
  criativos: CriativoDoPacote[];
};

/** Pacote do gestor de tráfego em Markdown (montado em código, sem IA e sem travessão). */
export function markdownDoPacote(d: DadosDoPacote): string {
  const l: string[] = [];
  const item = (rotulo: string, valor: unknown) => {
    if (valor != null && String(valor).trim()) l.push(`- **${rotulo}:** ${String(valor).trim()}`);
  };
  l.push(`# Pacote do gestor de tráfego: ${d.cliente}`);
  l.push("");
  item("Plano", d.plano);
  item("Gerado em", `${d.gerado_em.slice(0, 16).replace("T", " ")} (UTC)`);
  item("Objetivo", d.objetivo ? `${d.objetivo.nome} (objetivo na Meta: ${d.objetivo.objetivo_meta}; otimizar para: ${d.objetivo.evento_otimizacao})` : "não definido");
  if (d.objetivo) item("Métrica que decide", d.objetivo.metrica_que_decide);
  if (d.oferta) item("Oferta", [d.oferta.nome, d.oferta.promessa].filter(Boolean).join(": "));
  item("Destino", d.destino ?? "não informado no briefing");
  item("Verba diária do briefing", d.verba_diaria_brl != null ? `R$ ${d.verba_diaria_brl.toFixed(2).replace(".", ",")}` : "não informada (definir com o dono)");
  l.push("");
  l.push("> Número de resultado só com dado real da conta. Nada de prova, depoimento, preço ou urgência que não esteja no briefing.");
  d.criativos.forEach((c, i) => {
    l.push("");
    l.push(`## ${i + 1}. ${c.nome}`);
    item("Formato", c.formato);
    item("Ângulo", c.angulo);
    item("Hipótese", c.hipotese);
    item("Arte", c.arte);
    const p = c.pacote;
    if (!p) {
      l.push("");
      l.push("**Copy principal** (pacote completo ainda não gerado)");
      item("Texto principal", c.copy.texto_principal);
      item("Título", c.copy.titulo);
      item("Descrição", c.copy.descricao);
      item("Botão", c.copy.cta_meta);
      return;
    }
    const bloco = (titulo: string, linhas: string[]) => {
      if (!linhas.length) return;
      l.push("");
      l.push(`**${titulo}**`);
      for (const x of linhas) l.push(`- ${x}`);
    };
    bloco("Textos principais", p.textos_principais.map((t) => `(${t.estilo}) ${t.texto.replace(/\n+/g, " / ")}`));
    bloco("Títulos (até 40 caracteres)", p.titulos);
    bloco("Descrições (até 30 caracteres)", p.descricoes);
    bloco("Botões (CTA)", p.ctas.map((t) => `${t.cta}: ${t.porque}`));
    bloco("Ganchos (primeira linha)", p.ganchos);
    const g = p.gestor;
    l.push("");
    l.push("**Configuração sugerida**");
    item("Objetivo na Meta", g.objetivo_meta);
    item("Evento de otimização", g.evento_otimizacao);
    item("Público sugerido", g.publico_sugerido);
    if (g.conjuntos.length) item("Conjuntos", g.conjuntos.join("; "));
    item("UTM", g.utm ? `\`${g.utm}\`` : null);
    if (g.regras_de_corte.length) item("Regras de corte", g.regras_de_corte.join("; "));
    if (g.regras_de_escala.length) item("Regras de escala", g.regras_de_escala.join("; "));
    item("Verba", g.verba ?? "não informada no briefing");
  });
  l.push("");
  return semTravessao(l.join("\n"));
}

// =============================================================== Mesa Ads v3
// Pedido do dono (25/09/2026): criativo menos genérico e foco em resultado.
// Tudo aqui é regra fixa: sinais de texto genérico, ordem de teste e a regra
// de corte com os números do briefing e da conta (nunca da IA).

/** Clichês que denunciam copy genérica (a conta confere; o Jev julga o resto). */
export const CLICHES_DE_ANUNCIO = [
  "qualidade",
  "excelência",
  "soluções",
  "solução completa",
  "confira",
  "venha conhecer",
  "venha nos visitar",
  "o melhor para você",
  "atendimento diferenciado",
  "compromisso com",
  "tradição",
  "sua melhor escolha",
  "não perca",
  "entre em contato",
  "faça já o seu",
] as const;

const semAcento = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Clichês encontrados no texto (sem acento e sem caixa). */
export function clichesNoTexto(texto: string | null | undefined): string[] {
  const t = ` ${semAcento(String(texto ?? ""))} `;
  return CLICHES_DE_ANUNCIO.filter((c) => t.indexOf(semAcento(c)) >= 0);
}

export const contarPalavras = (t: string | null | undefined) => String(t ?? "").trim().split(/\s+/).filter(Boolean).length;

/** Tem algum número (preço, prazo, quantidade)? */
export const temNumero = (t: string | null | undefined) => /\d/.test(String(t ?? ""));

/**
 * Avisos de tom em código para a peça: headline longa demais para o tom,
 * clichês e, no agressivo, falta de número quando a oferta tem número real.
 */
export function avisosDeTom(
  peca: { headline: string; texto_principal: string },
  tom: { id: string; nome: string; headline_max_palavras: number },
  numerosDaOferta: string[] = [],
): string[] {
  const avisos: string[] = [];
  const palavras = contarPalavras(peca.headline);
  if (palavras > tom.headline_max_palavras) avisos.push(`Headline com ${palavras} palavras: o tom ${tom.nome.toLowerCase()} pede no máximo ${tom.headline_max_palavras}.`);
  const cliches = [...new Set([...clichesNoTexto(peca.headline), ...clichesNoTexto(peca.texto_principal)])];
  if (cliches.length) avisos.push(`Genérico: usa ${cliches.map((c) => `"${c}"`).join(", ")}.`);
  if (tom.id === "agressivo" && numerosDaOferta.length && !temNumero(peca.headline) && !temNumero(peca.texto_principal)) {
    avisos.push(`Sem número: a oferta tem ${numerosDaOferta.slice(0, 3).join(", ")} e o tom agressivo pede a promessa concreta com número real.`);
  }
  return avisos;
}

/** Trechos com número nos textos reais da oferta (preço, prazo, garantia, vagas). */
export function numerosReais(textos: (string | null | undefined)[]): string[] {
  const achados: string[] = [];
  for (const t of textos) {
    const m = String(t ?? "").match(/(R\$\s?)?\d[\d.,]*(\s?(%|dias?|horas?|min|vagas?|anos?|meses|mês|vezes|unidades?|kg|m²))?/gi) || [];
    for (const x of m) {
      const limpo = x.trim().replace(/[.,]+$/, "");
      if (limpo && achados.indexOf(limpo) < 0) achados.push(limpo);
    }
  }
  return achados.slice(0, 8);
}

export type CorteDoAngulo = {
  metrica: string;
  /** Custo por resultado acima disso, com volume, pausa. */
  limite_brl: number | null;
  /** Gasto sem nenhum resultado que já manda pausar (2,5 vezes o tolerável). */
  gasto_sem_resultado_brl: number | null;
  impressoes_minimas: number;
  dias_minimos: number;
  fonte: "briefing" | "media_da_conta" | null;
  texto: string;
};

const reais = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

/**
 * Regra de corte do ângulo com os números reais: o custo tolerável do
 * briefing ou, sem ele, a média da conta no período. Sem número, a regra
 * diz o que falta (nunca inventa).
 */
export function regraDeCorte(opcoes: {
  metrica?: string | null;
  custoToleravel?: number | null;
  custoMedioConta?: number | null;
  janelaDias?: number | null;
}): CorteDoAngulo {
  const metrica = (opcoes.metrica && opcoes.metrica.trim()) || "custo por resultado";
  const tolera = typeof opcoes.custoToleravel === "number" && opcoes.custoToleravel > 0 ? opcoes.custoToleravel : null;
  const media = typeof opcoes.custoMedioConta === "number" && opcoes.custoMedioConta > 0 ? opcoes.custoMedioConta : null;
  const base = tolera ?? media;
  const fonte = tolera ? "briefing" : media ? "media_da_conta" : null;
  const dias = Math.min(7, Math.max(3, Math.round(Number(opcoes.janelaDias) || 3)));
  const impressoes = 1000;
  if (!base) {
    return {
      metrica,
      limite_brl: null,
      gasto_sem_resultado_brl: null,
      impressoes_minimas: impressoes,
      dias_minimos: dias,
      fonte: null,
      texto: `Julgar por ${metrica} depois de 1.000 impressões e ${dias} dias. Sem custo tolerável no briefing nem histórico na conta: defina o custo tolerável para ter o corte em reais.`,
    };
  }
  const limite = Math.round(base * 100) / 100;
  const semResultado = Math.round(base * 2.5 * 100) / 100;
  const origem = fonte === "briefing" ? "custo tolerável do briefing" : "média da conta no período";
  return {
    metrica,
    limite_brl: limite,
    gasto_sem_resultado_brl: semResultado,
    impressoes_minimas: impressoes,
    dias_minimos: dias,
    fonte,
    texto: `Pausar se gastar ${reais(semResultado)} sem nenhum resultado, ou se o custo por resultado passar de ${reais(limite)} (${origem}) depois de 1.000 impressões e ${dias} dias. Abaixo de ${reais(limite)} com volume: manter e produzir variações.`,
  };
}

/**
 * Ordem de teste: aprovados primeiro, depois pela pontuação do Jev e, no
 * empate, pela prova (prova real sustenta o custo). Devolve 1, 2, 3... por id.
 */
export function ordemDeTeste<T extends { id: string; aprovado?: boolean; reprovado?: boolean; pontuacao: number | null; jev?: { prova?: number | null } | null }>(angulos: T[]): Map<string, number> {
  const valido = (a: T) => Number(!a.reprovado && a.aprovado !== false);
  const prova = (a: T) => (a.jev && typeof a.jev.prova === "number" ? a.jev.prova : -1);
  const lista = angulos.slice().sort((a, b) => valido(b) - valido(a) || (b.pontuacao ?? -1) - (a.pontuacao ?? -1) || prova(b) - prova(a));
  return new Map(lista.map((a, i) => [a.id, i + 1]));
}

// ------------------------------------------------------------- oferta do contexto

export type EntradaDaOfertaDoContexto = {
  cliente: string;
  briefing: {
    oferta?: { produto?: string | null; promessa?: string | null; condicao?: string | null; preco_confirmado?: string | null; garantia?: string | null } | null;
    publico?: { quem?: string | null } | null;
    destino?: { tipo?: string | null } | null;
    provas?: { texto?: string; autorizado?: boolean }[] | null;
  } | null;
  consolidado: { negocio?: string; publico?: string; oferta?: string; diferenciais?: string[] } | null;
  brief: Record<string, unknown> | null;
  campanhas: { nome: string; objetivo: string | null; conceito: string | null; periodo_fim: string | null }[];
  melhorAnuncio: { nome: string | null; titulo: string | null; custo_por_resultado: number | null; resultados: number } | null;
};

export type CamposDaOferta = {
  nome: string;
  para_quem: string;
  promessa: string;
  mecanismo: string;
  entregaveis: string[];
  bonus: string[];
  garantia: string | null;
  urgencia_real: string | null;
  ancoragem: string | null;
  cta: string;
  provas_necessarias: string[];
  riscos: string[];
};

const limpoCtx = (v: unknown, max = 600): string => (typeof v === "string" ? semTravessao(v.replace(/\s+/g, " ").trim()).slice(0, max) : "");

/** Primeira frase (até max caracteres), sem o ponto final. */
function primeiraFrase(t: string, max = 240): string {
  const m = t.match(/^[^.!?\n]{8,}[.!?]/);
  return cortarNaPalavra((m ? m[0] : t).replace(/[.!?]+$/, ""), max);
}

/** Nome curto (até 6 palavras). */
const nomeCurto = (t: string) => t.split(/\s+/).filter(Boolean).slice(0, 6).join(" ").replace(/[,;:.]+$/, "");

/** Resposta do brief cuja pergunta casa com o padrão. */
function doBrief(brief: Record<string, unknown> | null, padrao: RegExp): { chave: string; texto: string } | null {
  if (!brief) return null;
  for (const k of Object.keys(brief)) {
    if (!padrao.test(k)) continue;
    const t = limpoCtx(brief[k], 800);
    if (t) return { chave: k, texto: t };
  }
  return null;
}

export const CTA_DO_DESTINO: Record<string, string> = {
  whatsapp: "Chame no WhatsApp",
  direct: "Mande uma mensagem no Direct",
  formulario: "Preencha o formulário",
  pagina: "Veja as condições no site",
  ligacao: "Ligue agora",
};

const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Oferta montada EM CÓDIGO a partir do contexto do cliente (sem IA, grátis):
 * cada campo vem de uma fonte real e diz qual; o que não existe fica vazio e
 * vira lacuna. O agente de oferta lapida depois, com o custo à vista.
 */
export function ofertaDoContextoEmCodigo(e: EntradaDaOfertaDoContexto): { campos: CamposDaOferta; fontes: Record<string, string>; lacunas: string[] } {
  const fontes: Record<string, string> = {};
  const lacunas: string[] = [];
  const b = e.briefing ?? {};
  const bo = b.oferta ?? {};
  const c = e.consolidado ?? {};
  const escolher = (campo: string, opcoes: [string, string][]): string => {
    for (const [valor, fonte] of opcoes) {
      if (valor) {
        fontes[campo] = fonte;
        return valor;
      }
    }
    return "";
  };

  const produtoBrief = doBrief(e.brief, /produt|servi[cç]/i);
  const precoBrief = doBrief(e.brief, /pre[cç]o|valor|investimento|ticket/i);
  const diferencialBrief = doBrief(e.brief, /diferenc|por que (escolher|comprar)|vantag/i);
  const publicoBrief = doBrief(e.brief, /p[uú]blico|cliente ideal|quem (compra|[eé] o cliente)|persona/i);
  const garantiaBrief = doBrief(e.brief, /garant/i);
  const campanhaComData = e.campanhas.find((x) => !!x.periodo_fim) ?? null;
  const campanha = e.campanhas[0] ?? null;

  const produto = escolher("produto", [
    [limpoCtx(bo.produto, 300), "briefing de performance (produto)"],
    [c.oferta ? primeiraFrase(limpoCtx(c.oferta, 600), 160) : "", "contexto consolidado da Mesa (oferta)"],
    [produtoBrief ? primeiraFrase(produtoBrief.texto, 160) : "", `brief do cliente (${produtoBrief ? produtoBrief.chave : ""})`],
  ]);
  const nomeBase = campanha && campanha.nome ? campanha.nome : produto;
  const nome = nomeCurto(limpoCtx(nomeBase, 120)) || `Oferta ${e.cliente}`.slice(0, 60);
  fontes.nome = campanha && campanha.nome ? "campanha do mês na Mesa" : fontes.produto ?? "nome do cliente";

  const para_quem = escolher("para_quem", [
    [limpoCtx(b.publico?.quem, 600), "briefing de performance (público)"],
    [limpoCtx(c.publico, 600), "contexto consolidado da Mesa (público)"],
    [publicoBrief ? publicoBrief.texto.slice(0, 600) : "", `brief do cliente (${publicoBrief ? publicoBrief.chave : ""})`],
  ]);
  if (!para_quem) lacunas.push("Para quem: o contexto não diz quem compra. Conte ao agente a situação de quem compra.");

  const promessa = escolher("promessa", [
    [limpoCtx(bo.promessa, 800), "briefing de performance (promessa)"],
    [campanha && campanha.conceito ? primeiraFrase(limpoCtx(campanha.conceito, 600), 240) : "", "campanha do mês na Mesa (conceito)"],
    [c.oferta ? limpoCtx(c.oferta, 800) : "", "contexto consolidado da Mesa (oferta)"],
  ]);
  if (!promessa) lacunas.push("Promessa: sem promessa no contexto. Peça ao agente uma promessa forte e específica.");

  const diferenciais = Array.isArray(c.diferenciais) ? c.diferenciais.map((d) => limpoCtx(d, 200)).filter(Boolean).slice(0, 3) : [];
  const mecanismo = escolher("mecanismo", [
    [diferenciais.join("; "), "contexto consolidado da Mesa (diferenciais)"],
    [diferencialBrief ? diferencialBrief.texto.slice(0, 600) : "", `brief do cliente (${diferencialBrief ? diferencialBrief.chave : ""})`],
  ]);
  if (!mecanismo) lacunas.push("Mecanismo: nenhum diferencial registrado. Diga ao agente por que o cliente entrega melhor que o comum.");

  const entregaveis: string[] = [];
  if (produto) entregaveis.push(produto);
  if (limpoCtx(bo.condicao)) {
    entregaveis.push(limpoCtx(bo.condicao, 300));
    fontes.entregaveis = "briefing de performance (produto e condição)";
  }
  if (produtoBrief) {
    for (const item of produtoBrief.texto.split(/[;\n]/).map((x) => limpoCtx(x, 200)).filter((x) => x.length > 2)) {
      if (entregaveis.length >= 8) break;
      if (entregaveis.indexOf(item) < 0) entregaveis.push(item);
    }
    if (!fontes.entregaveis) fontes.entregaveis = `brief do cliente (${produtoBrief.chave})`;
  }
  if (entregaveis.length && !fontes.entregaveis) fontes.entregaveis = fontes.produto ?? "contexto";
  if (!entregaveis.length) lacunas.push("O que entra: o contexto não lista produtos ou serviços.");

  const garantia = escolher("garantia", [
    [limpoCtx(bo.garantia, 400), "briefing de performance (garantia)"],
    [garantiaBrief ? garantiaBrief.texto.slice(0, 400) : "", `brief do cliente (${garantiaBrief ? garantiaBrief.chave : ""})`],
  ]) || null;
  if (!garantia) lacunas.push("Garantia: nenhuma registrada. O agente pode sugerir uma reversão de risco para o cliente confirmar.");

  const precoConfirmado = limpoCtx(bo.preco_confirmado, 200);
  const ancoragem = escolher("ancoragem", [
    [precoConfirmado ? `Preço confirmado: ${precoConfirmado}` : "", "briefing de performance (preço confirmado)"],
    [precoBrief ? precoBrief.texto.slice(0, 300) : "", `brief do cliente (${precoBrief ? precoBrief.chave : ""})`],
  ]) || null;
  if (!ancoragem) lacunas.push("Preço: sem preço confirmado. Oferta agressiva pede número real; confirme com o cliente.");

  let urgencia_real: string | null = null;
  if (campanhaComData && campanhaComData.periodo_fim) {
    urgencia_real = `${campanhaComData.nome} vai até ${dataCurta(campanhaComData.periodo_fim)}`;
    fontes.urgencia_real = "campanha do mês na Mesa (período)";
  } else lacunas.push("Urgência real: nenhuma campanha com data neste mês. Sem data real, sem urgência.");

  const destino = String((b.destino && b.destino.tipo) || "");
  const cta = CTA_DO_DESTINO[destino] || "Fale com a gente";
  fontes.cta = CTA_DO_DESTINO[destino] ? "briefing de performance (destino)" : "padrão (sem destino no briefing)";

  lacunas.push("Bônus: o contexto não tem bônus. Peça ao agente bônus que resolvam o próximo problema do comprador.");

  const provas_necessarias: string[] = [];
  const provas = (b.provas ?? []).filter((p) => p && p.texto);
  if (!provas.length) provas_necessarias.push("Uma prova real (depoimento autorizado, número ou caso) para sustentar a promessa.");
  if (provas.some((p) => !p.autorizado)) provas_necessarias.push("Autorização para usar as provas do briefing que ainda não estão autorizadas.");
  if (!ancoragem) provas_necessarias.push("Preço ou condição confirmados pelo cliente.");

  const riscos: string[] = [];
  if (e.melhorAnuncio && e.melhorAnuncio.resultados > 0) {
    const custo = e.melhorAnuncio.custo_por_resultado != null ? `, custo por resultado R$ ${e.melhorAnuncio.custo_por_resultado.toFixed(2).replace(".", ",")}` : "";
    riscos.push(`Base da conta: o anúncio "${limpoCtx(e.melhorAnuncio.titulo || e.melhorAnuncio.nome || "sem nome", 80)}" trouxe ${e.melhorAnuncio.resultados} resultado(s) nos últimos 90 dias${custo}. A oferta nova precisa bater isso.`);
    fontes.riscos = "conta de anúncios (últimos 90 dias)";
  }

  return {
    campos: { nome, para_quem, promessa, mecanismo, entregaveis, bonus: [], garantia, urgencia_real, ancoragem, cta, provas_necessarias, riscos },
    fontes,
    lacunas,
  };
}

// ------------------------------------------------------------- peça do anúncio (v5)

/**
 * Chave da PEÇA de um anúncio: a mesma arte rodando em vários anúncios
 * (conjuntos diferentes, anúncio duplicado) vira uma peça só. Ordem: hash da
 * imagem da Meta, vídeo, id do criativo da Meta e, por último, o endereço da
 * imagem sem a assinatura (a Meta troca a assinatura, não o caminho).
 */
export function chaveDaPeca(
  raw: unknown,
  colunas: { image_url?: string | null; thumbnail_url?: string | null; video_id?: string | null; ad_id?: string | null } = {},
): string | null {
  const r = objeto(raw);
  const criativo = objeto(r.creative);
  const spec = objeto(criativo.object_story_spec);
  const link = objeto(spec.link_data);
  const video = objeto(spec.video_data);
  const feed = objeto(criativo.asset_feed_spec);
  const imagensDoFeed = Array.isArray(feed.images) ? feed.images.map((i) => str(objeto(i).hash)).filter(Boolean) : [];
  const hash = str(link.image_hash) ?? str(video.image_hash) ?? (imagensDoFeed[0] as string | undefined) ?? null;
  if (hash) return `hash:${hash}`;
  const videoId = str(video.video_id) ?? str(criativo.video_id) ?? str(colunas.video_id);
  if (videoId) return `video:${videoId}`;
  const criativoId = str(criativo.id);
  if (criativoId) return `criativo:${criativoId}`;
  const url = str(criativo.image_url) ?? str(colunas.image_url) ?? str(colunas.thumbnail_url);
  if (url) return `url:${url.split("?")[0]}`;
  return colunas.ad_id ? `ad:${colunas.ad_id}` : null;
}
