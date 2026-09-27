/**
 * "Sempre trazer os melhores" (frente CR, 27/09/2026): em código e sem IA.
 *
 * 1. Ordem dos estilos visuais pelo que dá resultado de verdade:
 *    - dado do cliente (anúncios dele com o estilo conhecido: criativo da Mesa
 *      ligado ao anúncio ou anúncio próprio lido com o estilo), comparado com a
 *      média da conta;
 *    - sem dado do cliente, dado da carteira (outros clientes do mesmo nicho,
 *      só números somados, sem nome de cliente);
 *    - sem dado real, o padrão do nicho (NICHOS.estilos_que_funcionam) e o
 *      formato que combina com o objetivo (FORMATOS_QUE_CONVERTEM).
 *    Estilo que exige prova que o briefing não tem (depoimento autorizado,
 *    número real, transformação visível, itens da oferta) desce na ordem.
 *    Cada estilo sai com o "porquê" em uma linha, com o número real ou dizendo
 *    que é padrão do nicho. Nunca um número que não veio dos dados.
 * 2. Escolha da melhor copy entre as escritas a mais (sem laço de correção):
 *    nota composta da conferência do Jev (clareza, poder de parar, específica
 *    contra genérica e tom), com a política como trava (alerta ou nota baixa
 *    vai para o fim). O "porquê" da copy também sai em uma linha.
 *
 * Puro: sem Deno, sem banco. A função mesa-ads e os testes usam o mesmo.
 * Sem travessão nos textos (regra do dono).
 */

import { ESTILOS_VISUAIS, type Nicho, OBJETIVOS_DE_CAMPANHA } from "../_shared/conhecimento-ads.ts";
import { formatoDoEstilo, nomeDoFramework, REQUISITOS_DO_ESTILO, ROTULO_DO_REQUISITO, type RequisitoDoEstilo } from "../_shared/conhecimento-criativo.ts";
import { type Diaria, numerosReais, somarMetricas } from "./calculos.ts";

// ------------------------------------------------------------------ desempenho por estilo

/** Volume mínimo para um estilo contar como dado real (mesma régua do diagnóstico: 1.000 impressões). */
export const VOLUME_MINIMO_DO_ESTILO = { impressoes: 1000, resultados: 3 };

/** Um anúncio com o estilo visual conhecido e os números somados. */
export type AnuncioComEstilo = {
  ad_id: string;
  estilo: string;
  gasto: number;
  impressoes: number;
  resultados: number;
  inicio?: string | null;
  fim?: string | null;
};

export type OrigemDoDado = "cliente" | "carteira";

export type DesempenhoDoEstilo = {
  estilo: string;
  origem: OrigemDoDado;
  anuncios: number;
  gasto: number;
  impressoes: number;
  resultados: number;
  custo_por_resultado: number | null;
  inicio: string | null;
  fim: string | null;
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const arred2 = (v: number) => Math.round(v * 100) / 100;

const IDS_DE_ESTILO = new Set(ESTILOS_VISUAIS.map((e) => e.id));
export const estiloConhecido = (v: unknown): string | null => (typeof v === "string" && IDS_DE_ESTILO.has(v) ? v : null);

/** Anúncio a partir das linhas diárias (ads_creative_daily) já filtradas por ele. */
export function anuncioDasDiarias(adId: string, estilo: string, linhas: Diaria[]): AnuncioComEstilo {
  const m = somarMetricas(linhas);
  return { ad_id: adId, estilo, gasto: m.gasto, impressoes: m.impressoes, resultados: m.resultados, inicio: m.inicio, fim: m.fim };
}

/** Anúncio a partir das métricas guardadas na referência própria (ads_referencias.metricas). */
export function anuncioDaReferencia(adId: string, estilo: string, metricas: Record<string, unknown> | null | undefined): AnuncioComEstilo | null {
  const m = metricas ?? {};
  const gasto = num(m.gasto);
  const impressoes = num(m.impressoes);
  if (gasto <= 0 && impressoes <= 0) return null;
  return {
    ad_id: adId,
    estilo,
    gasto,
    impressoes,
    resultados: num(m.resultados),
    inicio: typeof m.inicio === "string" ? m.inicio : null,
    fim: typeof m.fim === "string" ? m.fim : null,
  };
}

/** Soma por estilo (cada anúncio conta uma vez: o primeiro da lista vence). */
export function desempenhoPorEstilo(anuncios: AnuncioComEstilo[], origem: OrigemDoDado): DesempenhoDoEstilo[] {
  const vistos = new Set<string>();
  const porEstilo = new Map<string, DesempenhoDoEstilo>();
  for (const a of anuncios) {
    if (!a.ad_id || vistos.has(a.ad_id) || !estiloConhecido(a.estilo)) continue;
    vistos.add(a.ad_id);
    const d = porEstilo.get(a.estilo) ?? { estilo: a.estilo, origem, anuncios: 0, gasto: 0, impressoes: 0, resultados: 0, custo_por_resultado: null, inicio: null, fim: null };
    d.anuncios += 1;
    d.gasto += num(a.gasto);
    d.impressoes += num(a.impressoes);
    d.resultados += num(a.resultados);
    if (a.inicio && (!d.inicio || a.inicio < d.inicio)) d.inicio = a.inicio;
    if (a.fim && (!d.fim || a.fim > d.fim)) d.fim = a.fim;
    porEstilo.set(a.estilo, d);
  }
  return [...porEstilo.values()].map((d) => ({
    ...d,
    gasto: arred2(d.gasto),
    custo_por_resultado: d.resultados > 0 ? arred2(d.gasto / d.resultados) : null,
  }));
}

/** Custo médio por resultado de uma lista (soma do gasto dividida pela soma dos resultados). */
export function custoMedio(lista: { gasto: number; resultados: number }[]): number | null {
  const gasto = lista.reduce((s, d) => s + num(d.gasto), 0);
  const resultados = lista.reduce((s, d) => s + num(d.resultados), 0);
  return resultados > 0 ? arred2(gasto / resultados) : null;
}

const temVolume = (d: DesempenhoDoEstilo) => d.impressoes >= VOLUME_MINIMO_DO_ESTILO.impressoes && d.resultados >= VOLUME_MINIMO_DO_ESTILO.resultados;

// ------------------------------------------------------------------ o que a oferta tem de verdade

export type SinaisDaOferta = Record<RequisitoDoEstilo, boolean>;

type BriefingParaSinais = {
  oferta?: Record<string, unknown> | null;
  provas?: unknown[] | null;
} | null;

type OfertaParaSinais = {
  promessa?: unknown;
  entregaveis?: unknown;
  bonus?: unknown;
  garantia?: unknown;
  urgencia_real?: unknown;
  ancoragem?: unknown;
} | null;

/**
 * O que a oferta e o briefing têm de verdade para sustentar cada estilo. Só o
 * que está escrito conta (depoimento com autorização marcada, número real nos
 * textos da oferta, lista de itens). Transformação visível vem do nicho (o
 * nicho em que antes e depois é permitido e típico).
 */
export function sinaisDaOferta(briefing: BriefingParaSinais, oferta: OfertaParaSinais, nicho: Pick<Nicho, "estilos_que_funcionam"> | null): SinaisDaOferta {
  const o = (briefing?.oferta ?? {}) as Record<string, unknown>;
  const provas = (Array.isArray(briefing?.provas) ? briefing?.provas : []) as Record<string, unknown>[];
  const texto = (v: unknown) => (typeof v === "string" ? v : "");
  const lista = (v: unknown) => (Array.isArray(v) ? v.map((x) => texto(x)).filter(Boolean) : []);
  const textosDaOferta = [
    texto(o.preco_confirmado), texto(o.condicao), texto(o.garantia), texto(o.promessa),
    texto(oferta?.promessa), texto(oferta?.garantia), texto(oferta?.urgencia_real), texto(oferta?.ancoragem),
    ...provas.map((p) => texto(p?.texto)),
  ];
  const itens = lista(oferta?.entregaveis).length + lista(oferta?.bonus).length;
  return {
    depoimento_autorizado: provas.some((p) => p && p.tipo === "depoimento" && p.autorizado === true && !!texto(p.texto).trim()),
    numero_real: numerosReais(textosDaOferta).length > 0,
    transformacao_visivel: !!nicho && nicho.estilos_que_funcionam.includes("antes_depois"),
    itens_da_oferta: itens >= 2 || lista(oferta?.bonus).length >= 1 || /\b(kit|combo|pacote|inclui|incluso|b[oô]nus)\b/i.test(`${texto(o.condicao)} ${texto(o.promessa)}`),
  };
}

// ------------------------------------------------------------------ ordem dos estilos

export type FonteDoEstilo = "cliente" | "carteira" | "nicho" | "base";

export type EstiloRankeado = {
  estilo: string;
  nome: string;
  /** Id de FORMATOS_QUE_CONVERTEM que o estilo executa. */
  formato: string | null;
  pontos: number;
  fonte: FonteDoEstilo;
  /** Uma linha: por que este estilo, com o dado real ou dizendo que é padrão do nicho. */
  porque: string;
  falta: RequisitoDoEstilo[];
  custo_por_resultado: number | null;
  /** Diferença contra a média (positivo = mais barato que a média), em %. */
  diferenca_pct: number | null;
  anuncios: number;
};

export type EntradaDoRanking = {
  nicho: Pick<Nicho, "id" | "nome" | "estilos_que_funcionam"> | null;
  objetivo: string | null;
  sinais: SinaisDaOferta;
  cliente: DesempenhoDoEstilo[];
  carteira: DesempenhoDoEstilo[];
  /** Custo médio por resultado da conta do cliente no período (mesma janela dos dados). */
  mediaConta: number | null;
  mediaCarteira: number | null;
};

const reais = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const dataCurta = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : null);
const nomeCurtoDoNicho = (n: { nome: string }) => n.nome.split(" (")[0].toLowerCase();

/** Nome do custo pelo objetivo (o resultado somado é conversa, lead ou compra). */
export function rotuloDoCusto(objetivo: string | null | undefined): string {
  if (objetivo === "mensagens") return "custo por conversa";
  if (objetivo === "leads") return "custo por lead";
  if (objetivo === "vendas") return "custo por compra";
  return "custo por resultado";
}

function periodo(d: DesempenhoDoEstilo): string {
  const i = dataCurta(d.inicio);
  const f = dataCurta(d.fim);
  const n = `${d.anuncios} anúncio${d.anuncios === 1 ? "" : "s"}`;
  return i && f ? `${n}, ${i} a ${f}` : n;
}

/**
 * Ordena os estilos visuais para este cliente. Pontos:
 * - nicho: +3 para o primeiro estilo típico do nicho, 0,3 a menos para cada posição seguinte;
 * - objetivo: +1 quando o formato do estilo costuma render no objetivo;
 * - risco de política do estilo fora do nicho: alto -3, médio -0,5 (no nicho que o lista, a base já liberou);
 * - requisito que a oferta não tem: -4 cada;
 * - dado do cliente com volume: até +6 quando o custo por resultado é menor que a média da conta,
 *   até -4 quando é maior, -3 quando gastou o dobro da média sem resultado;
 * - dado da carteira (só sem dado do cliente): metade do peso.
 */
export function rankearEstilos(e: EntradaDoRanking): EstiloRankeado[] {
  const rotulo = rotuloDoCusto(e.objetivo);
  const objetivo = OBJETIVOS_DE_CAMPANHA.find((o) => o.id === e.objetivo) ?? null;
  const saida = ESTILOS_VISUAIS.map((estilo): EstiloRankeado => {
    const formato = formatoDoEstilo(estilo.id);
    let pontos = 0;
    let fonte: FonteDoEstilo = "base";
    let porque = "";
    let cpr: number | null = null;
    let diferenca: number | null = null;
    let anuncios = 0;

    const idx = e.nicho ? e.nicho.estilos_que_funcionam.indexOf(estilo.id) : -1;
    if (idx >= 0) {
      pontos += 3 - idx * 0.3;
      fonte = "nicho";
    }
    if (objetivo && formato && formato.objetivos.includes(objetivo.id)) pontos += 1;
    // Risco de política do estilo: fora do nicho pesa; no nicho que o lista (antes e depois em jardim, obra,
    // oficina) a base já diz que é permitido e o Jev confere cada ângulo.
    if (idx < 0 && estilo.risco_politica === "alto") pontos -= 3;
    else if (idx < 0 && estilo.risco_politica === "medio") pontos -= 0.5;
    const falta = (REQUISITOS_DO_ESTILO[estilo.id] ?? []).filter((r) => !e.sinais[r]);
    pontos -= 4 * falta.length;

    const lerDado = (d: DesempenhoDoEstilo | undefined, media: number | null, peso: number, deQuem: "cliente" | "carteira"): boolean => {
      if (!d) return false;
      const onde = deQuem === "cliente" ? "da sua conta" : `da carteira no nicho${e.nicho ? ` ${nomeCurtoDoNicho(e.nicho)}` : ""}`;
      const quem = deQuem === "cliente" ? periodo(d) : `${d.anuncios} anúncio${d.anuncios === 1 ? "" : "s"} de outros clientes`;
      // Gastou bem mais que a média sem nenhum resultado: sinal contra, mesmo sem o volume de resultados.
      if (d.resultados === 0 && media && d.gasto >= 2 * media && d.impressoes >= VOLUME_MINIMO_DO_ESTILO.impressoes) {
        pontos -= 3 * peso;
        porque = `${estilo.nome}: ${reais(d.gasto)} gastos sem resultado nos anúncios ${onde} (${quem}); só com execução nova`;
        anuncios = d.anuncios;
        return true;
      }
      if (!temVolume(d) || d.custo_por_resultado == null) return false;
      cpr = d.custo_por_resultado;
      anuncios = d.anuncios;
      if (!media) {
        pontos += 2 * peso;
        porque = `${estilo.nome}: ${d.resultados} resultados a ${reais(d.custo_por_resultado)} cada nos anúncios ${onde} (${quem})`;
        return true;
      }
      const razao = d.custo_por_resultado / media;
      diferenca = Math.round((1 - razao) * 100);
      if (razao <= 0.95) {
        pontos += Math.min(6, 2 + (1 - razao) * 10) * peso;
        porque = `${estilo.nome}: ${rotulo} ${diferenca}% menor que a média ${onde} (${reais(d.custo_por_resultado)} contra ${reais(media)}, ${quem})`;
      } else if (razao >= 1.15) {
        pontos -= Math.min(4, (razao - 1) * 5) * peso;
        porque = `${estilo.nome}: ${rotulo} ${Math.abs(diferenca)}% maior que a média ${onde} (${reais(d.custo_por_resultado)} contra ${reais(media)}, ${quem}); só com execução nova`;
      } else {
        pontos += 1.5 * peso;
        porque = `${estilo.nome}: ${rotulo} na média ${onde} (${reais(d.custo_por_resultado)}, ${quem})`;
      }
      return true;
    };

    if (lerDado(e.cliente.find((d) => d.estilo === estilo.id), e.mediaConta, 1, "cliente")) fonte = "cliente";
    else if (lerDado(e.carteira.find((d) => d.estilo === estilo.id), e.mediaCarteira, 0.5, "carteira")) fonte = "carteira";
    else if (fonte === "nicho" && e.nicho) porque = `${estilo.nome}: padrão do nicho ${nomeCurtoDoNicho(e.nicho)}; ainda sem dado real seu`;
    else porque = objetivo && formato && formato.objetivos.includes(objetivo.id)
      ? `${estilo.nome}: formato que costuma render em ${objetivo.nome.split(" (")[0].toLowerCase()}; ainda sem dado real seu`
      : `${estilo.nome}: opção da base de formatos; ainda sem dado real seu`;
    if (falta.length) porque = `${porque}. Precisa de ${falta.map((r) => ROTULO_DO_REQUISITO[r]).join(" e ")}, que o briefing ainda não tem`;

    return {
      estilo: estilo.id,
      nome: estilo.nome,
      formato: formato ? formato.id : null,
      pontos: Math.round(pontos * 100) / 100,
      fonte,
      porque,
      falta,
      custo_por_resultado: cpr,
      diferenca_pct: diferenca,
      anuncios,
    };
  });
  const ordemNoNicho = (id: string) => {
    const i = e.nicho ? e.nicho.estilos_que_funcionam.indexOf(id) : -1;
    return i < 0 ? 99 : i;
  };
  return saida.sort((a, b) => b.pontos - a.pontos || ordemNoNicho(a.estilo) - ordemNoNicho(b.estilo) || a.estilo.localeCompare(b.estilo));
}

/** Linhas curtas para o prompt do estrategista (só os primeiros). */
export function rankingParaOPrompt(ranking: Pick<EstiloRankeado, "estilo" | "porque" | "fonte">[], limite = 8): string {
  const temDado = ranking.some((r) => r.fonte === "cliente" || r.fonte === "carteira");
  return [
    `ESTILOS EM ORDEM DE RESULTADO (calculado em código; ${temDado ? "com dado real de anúncios" : "sem dado real ainda: ordem do nicho, do objetivo e da prova disponível"}):`,
    ...ranking.slice(0, limite).map((r, i) => `${i + 1}. ${r.estilo}: ${r.porque}.`),
    "Os primeiros ângulos usam os estilos do topo desta lista, um estilo por ângulo, sem repetir. Estilo marcado com prova que falta só entra se o briefing tiver essa prova.",
  ].join("\n");
}

/** O porquê do estilo do ângulo, pela ordem calculada; fora da lista, diz que foi escolha do estrategista. */
export function porqueDoEstilo(estilo: string | null | undefined, ranking: Pick<EstiloRankeado, "estilo" | "nome" | "porque" | "fonte">[]): { porque: string; fonte: FonteDoEstilo | "estrategista" } | null {
  if (!estilo) return null;
  const r = ranking.find((x) => x.estilo === estilo);
  if (r) return { porque: r.porque, fonte: r.fonte };
  const nome = ESTILOS_VISUAIS.find((x) => x.id === estilo)?.nome;
  return nome ? { porque: `${nome}: escolha do estrategista para este ângulo; ainda sem dado real seu`, fonte: "estrategista" } : null;
}

// ------------------------------------------------------------------ melhor copy

export type NotasDaCopy = {
  clareza?: number | null;
  risco_politica?: number | null;
  parada?: number | null;
  prob_generico?: number | null;
  generico?: boolean | null;
  tom?: number | null;
  alerta_politica?: boolean | null;
};

const PESOS_DA_COPY: [keyof NotasDaCopy | "especifica", number][] = [
  ["clareza", 0.35],
  ["parada", 0.25],
  ["especifica", 0.25],
  ["tom", 0.15],
];

/** Nota composta de 0 a 10 (só com as notas que existem); null sem nenhuma nota. */
export function notaDaCopy(n: NotasDaCopy | null | undefined): number | null {
  if (!n) return null;
  let soma = 0;
  let pesos = 0;
  for (const [chave, peso] of PESOS_DA_COPY) {
    const v = chave === "especifica"
      ? (typeof n.prob_generico === "number" ? 10 * (1 - n.prob_generico) : null)
      : (n[chave] as number | null | undefined);
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    soma += v * peso;
    pesos += peso;
  }
  return pesos > 0 ? Math.round((soma / pesos) * 10) / 10 : null;
}

/** Política como trava: alerta do Jev ou nota de política abaixo de 5 (10 = sem risco). */
export const copyArriscada = (n: NotasDaCopy | null | undefined): boolean =>
  !!n && (n.alerta_politica === true || (typeof n.risco_politica === "number" && n.risco_politica < 5));

/**
 * Escolhe as `quantidade` melhores copies: as sem risco de política primeiro,
 * pela nota composta (sem nota vai depois das com nota), e no empate a ordem
 * do estrategista. Devolve os índices originais em ordem.
 */
export function escolherMelhores(notas: (NotasDaCopy | null | undefined)[], quantidade: number): { ordem: number[]; escolhidos: number[]; descartados: number[] } {
  const ordem = notas
    .map((n, i) => ({ i, risco: copyArriscada(n) ? 1 : 0, nota: notaDaCopy(n) }))
    .sort((a, b) => a.risco - b.risco || (b.nota ?? -1) - (a.nota ?? -1) || a.i - b.i)
    .map((x) => x.i);
  const q = Math.max(0, Math.min(ordem.length, Math.round(quantidade)));
  return { ordem, escolhidos: ordem.slice(0, q), descartados: ordem.slice(q) };
}

const virgula = (v: number) => String(v).replace(".", ",");

/** Por que esta copy, em uma linha: posição entre as escritas, notas do Jev e a estrutura. */
export function porqueDaCopy(n: NotasDaCopy | null | undefined, framework: string | null | undefined, posicao: number, total: number): string {
  const estrutura = nomeDoFramework(framework);
  const fim = estrutura ? ` Estrutura: ${estrutura}.` : "";
  const nota = notaDaCopy(n);
  if (!n || nota == null) return `Sem nota do Jev (a conferência não respondeu): ficou a ordem do estrategista.${fim}`;
  const partes: string[] = [];
  if (typeof n.clareza === "number") partes.push(`clareza ${virgula(n.clareza)}`);
  if (typeof n.parada === "number") partes.push(`parada ${virgula(n.parada)}`);
  if (typeof n.prob_generico === "number") partes.push(n.prob_generico >= 0.6 ? "genérica" : "específica");
  if (typeof n.tom === "number") partes.push(`tom ${virgula(n.tom)}`);
  const cabeca = total > 1
    ? (posicao === 1 ? `Melhor de ${total} pela conferência do Jev` : `${posicao}ª de ${total} pela conferência do Jev`)
    : "Conferida pelo Jev";
  return `${cabeca} (nota ${virgula(nota)}${partes.length ? `: ${partes.join(", ")}` : ""}).${fim}${copyArriscada(n) ? " Atenção: risco de política, revise antes de subir." : ""}`;
}
