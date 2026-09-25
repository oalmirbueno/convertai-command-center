/**
 * Conhecimento de cada agente das mesas, por tarefa, com teto (Frente H, 25/09/2026).
 *
 * Pedido do dono (25/09): "cada área tem um agente específico; deixe cada um
 * mais completo, estruturado, forte, com mais detalhes, sem mudar a essência.
 * Na parte de ads, trazer a base do Pedro Sobral e reforçar com a Natália
 * Torres, sem perder o que já tem. As skills de marketing, design etc. têm que
 * estar dentro do sistema e funcionando."
 *
 * Este arquivo só escolhe e corta blocos que já existem:
 * - conhecimento-especialistas-ads.ts (Pedro Sobral e Natália Torres);
 * - conhecimento-marketing.ts (skills de marketing, vendas e design destiladas).
 * A base principal de cada agente (conhecimento-ads.ts, conhecimento-design.ts,
 * prompt do banco, regras da casa) continua onde está e vem ANTES deste bloco.
 *
 * Regras (docs/conhecimento/COMO-INTEGRAR.md):
 * - Blocos inteiros: corta bloco, nunca o meio de um bloco.
 * - Ordem de corte quando passa do teto: o de menor "corte" sai primeiro
 *   (roteiro de vídeo, posicionamento, marketing, Natália, e por último Sobral).
 * - O texto sai sempre na mesma ordem (prefixo fixo para o cache do provedor);
 *   o checklist do objetivo, que muda por pedido, vai no fim.
 * - A frase de prioridade entre as bases vai uma vez, no começo do bloco, e
 *   fica fora do teto (ela é regra, não base).
 *
 * Puro: sem Deno, sem banco. O Vitest monta o sistema de cada agente com ele
 * (src/test/conhecimento-dos-agentes.test.ts). Sem travessão.
 */

import {
  ANALISE_DE_DESEMPENHO,
  ANTI_GENERICO,
  CALENDARIO_EDITORIAL,
  CTA_PRINCIPIOS,
  ESTRUTURAS_DE_CONTEUDO,
  FORMULAS_DE_TITULO,
  IDENTIDADE_DE_MARCA,
  OBJECOES_E_VOZ_DO_CLIENTE,
  PLANO_DE_CAMPANHA,
  POSICIONAMENTO_E_CONCORRENCIA,
  REVISAO_DE_MARCA,
  VERSAO_CONHECIMENTO_MARKETING,
  VOZ_DE_MARCA,
} from "./conhecimento-marketing.ts";
import {
  CHECKLIST_CRIATIVO_POR_OBJETIVO,
  CRIATIVO_NATALIA,
  ERROS_COMUNS_TRAFEGO,
  ESTRUTURA_DE_CONTA,
  GANCHOS_DOS_ESPECIALISTAS,
  type ObjetivoAds,
  ORCAMENTO_INICIAL,
  PLANO_DE_TESTE,
  REGRAS_DE_CORTE_E_ESCALA,
  VERSAO_ESPECIALISTAS_ADS,
} from "./conhecimento-especialistas-ads.ts";
import {
  ALCANCE_E_CONVERSAO,
  CARROSSEL_DE_RETENCAO,
  CHECKLIST_SALVA_E_ENVIA,
  DATAS_E_OPORTUNIDADES,
  GANCHOS_POR_TIPO,
  MISTURA_DO_MES,
  SINAIS_DO_ALGORITMO,
  SINAIS_PARA_MEDIR,
  VERSAO_CONHECIMENTO_SOCIAL,
} from "./conhecimento-social.ts";

/** Versão do conjunto (vai no texto do prompt e no log de quem quiser registrar). */
export const VERSAO_CONHECIMENTO_DOS_AGENTES = `especialistas ${VERSAO_ESPECIALISTAS_ADS}, marketing ${VERSAO_CONHECIMENTO_MARKETING}, social ${VERSAO_CONHECIMENTO_SOCIAL}`;

/** A frase de prioridade entre as bases (regra de ouro 1 do COMO-INTEGRAR). */
export const PRIORIDADE_DAS_BASES = `PRIORIDADE ENTRE AS BASES (versões: ${VERSAO_CONHECIMENTO_DOS_AGENTES}). Quando discordarem, vale nesta ordem: 1) dado real do cliente e régua do briefing ou do kit da marca (custo tolerável, paleta, logo, regras aprendidas com o cliente); 2) a base principal deste agente, que vem antes deste bloco; 3) o método dos especialistas de tráfego (Pedro Sobral e Natália Torres); 4) a base de marketing. Os blocos abaixo complementam: nenhuma regra anterior sai.`;

export type BlocoDeConhecimento = { id: string; texto: string; corte: number };

export type ConhecimentoMontado = {
  /** Frase de prioridade + blocos que couberam; vazio quando nenhum coube. */
  texto: string;
  /** Blocos que entraram, na ordem do texto. */
  ids: string[];
  /** Blocos que ficaram de fora por teto, na ordem em que saíram. */
  cortados: string[];
  /** Tamanho só dos blocos (sem a frase de prioridade): é o que o teto limita. */
  tamanho: number;
  teto: number;
};

const SEPARADOR = "\n\n";
const tamanhoDe = (lista: readonly BlocoDeConhecimento[]) =>
  lista.reduce((s, b, i) => s + b.texto.length + (i ? SEPARADOR.length : 0), 0);

/**
 * Junta os blocos na ordem recebida e, se passar do teto, tira inteiro o de
 * menor `corte` até caber. Nunca corta no meio.
 */
export function montarComTeto(blocos: readonly BlocoDeConhecimento[], teto: number, cabecalho = PRIORIDADE_DAS_BASES): ConhecimentoMontado {
  let ficam = blocos.filter((b) => b.texto && b.texto.trim());
  const cortados: string[] = [];
  const ordemDeCorte = ficam.slice().sort((a, b) => a.corte - b.corte);
  for (const b of ordemDeCorte) {
    if (tamanhoDe(ficam) <= teto) break;
    ficam = ficam.filter((x) => x !== b);
    cortados.push(b.id);
  }
  const corpo = ficam.map((b) => b.texto).join(SEPARADOR);
  return {
    texto: corpo ? (cabecalho ? `${cabecalho}${SEPARADOR}${corpo}` : corpo) : "",
    ids: ficam.map((b) => b.id),
    cortados,
    tamanho: corpo.length,
    teto,
  };
}

// ------------------------------------------------------------------ blocos com ordem de corte
// Menor "corte" sai primeiro. Ordem do COMO-INTEGRAR: roteiro de vídeo,
// posicionamento, (marketing), princípios da Natália e por último Sobral.

const b = (id: string, texto: string, corte: number): BlocoDeConhecimento => ({ id, texto, corte });

const POSICIONAMENTO = b("posicionamento_e_concorrencia", POSICIONAMENTO_E_CONCORRENCIA, 1);
const REVISAO = b("revisao_de_marca", REVISAO_DE_MARCA, 2);
const CTA = b("cta_principios", CTA_PRINCIPIOS, 3);
const OBJECOES = b("objecoes_e_voz_do_cliente", OBJECOES_E_VOZ_DO_CLIENTE, 4);
const ANTI = b("anti_generico", ANTI_GENERICO, 5);
const NATALIA = b("criativo_natalia", CRIATIVO_NATALIA, 6);
const ORCAMENTO = b("orcamento_inicial", ORCAMENTO_INICIAL, 7);
const ERROS = b("erros_comuns_trafego", ERROS_COMUNS_TRAFEGO, 8);
const GANCHOS = b("ganchos_dos_especialistas", GANCHOS_DOS_ESPECIALISTAS, 9);
const CORTE_ESCALA = b("regras_de_corte_e_escala", REGRAS_DE_CORTE_E_ESCALA, 10);
const TESTE = b("plano_de_teste", PLANO_DE_TESTE, 11);
const ESTRUTURA = b("estrutura_de_conta", ESTRUTURA_DE_CONTA, 12);

// ------------------------------------------------------------------ Mesa Ads

/**
 * Tarefas do estrategista de anúncios.
 * - angulos: plano de teste com ângulos e estrutura (plano_gerar, plano_conversar, biblioteca do nicho).
 * - copy: copy e criativos (criativos_produzir, copy_variar, reescrita por política).
 * - pacote: pacote de copy para o gestor, com conjuntos, corte, escala e verba.
 * - oferta: oferta e briefing (oferta_conversar, oferta_do_contexto, briefing_sugerir).
 * - conta: leitura de conta, evolução e aprendizado (conta_analisar, evolucao, aprendizado_registrar).
 */
export type TarefaAds = "angulos" | "copy" | "pacote" | "oferta" | "conta";
export const TAREFAS_ADS: readonly TarefaAds[] = ["angulos", "copy", "pacote", "oferta", "conta"];

/** Teto dos blocos por tarefa (caracteres), do COMO-INTEGRAR. */
export const TETO_ADS: Record<TarefaAds, number> = {
  angulos: 12_500,
  copy: 12_500,
  pacote: 12_500,
  oferta: 5_000,
  conta: 5_000,
};

/**
 * Blocos de cada tarefa, na ordem do texto. ROTEIRO_DE_VIDEO não entra: a
 * Mesa Ads produz peça estática (feed, quadrado, stories, carrossel) e ele é
 * o primeiro da ordem de corte do COMO-INTEGRAR.
 */
const BLOCOS_ADS: Record<TarefaAds, readonly BlocoDeConhecimento[]> = {
  angulos: [GANCHOS, NATALIA, ESTRUTURA, TESTE, ORCAMENTO, CORTE_ESCALA, OBJECOES, POSICIONAMENTO, CTA, ANTI],
  copy: [GANCHOS, NATALIA, OBJECOES, CTA, ANTI, REVISAO],
  pacote: [GANCHOS, NATALIA, ESTRUTURA, TESTE, ORCAMENTO, CORTE_ESCALA, OBJECOES, CTA, ANTI, REVISAO],
  oferta: [OBJECOES, POSICIONAMENTO, CTA, ANTI],
  conta: [ESTRUTURA, CORTE_ESCALA, ERROS],
};

const OBJETIVOS_COM_CHECKLIST = Object.keys(CHECKLIST_CRIATIVO_POR_OBJETIVO) as ObjetivoAds[];
const TAREFAS_COM_CHECKLIST = new Set<TarefaAds>(["angulos", "copy", "pacote"]);

/** Id do objetivo aceito pelo checklist (mesmos ids de OBJETIVOS_DE_CAMPANHA), ou null. */
export function objetivoDoChecklist(objetivo: unknown): ObjetivoAds | null {
  const id = typeof objetivo === "string"
    ? objetivo
    : objetivo && typeof objetivo === "object" && typeof (objetivo as { id?: unknown }).id === "string"
    ? (objetivo as { id: string }).id
    : "";
  return (OBJETIVOS_COM_CHECKLIST as string[]).includes(id) ? (id as ObjetivoAds) : null;
}

/**
 * Conhecimento dos especialistas e de marketing para uma tarefa da Mesa Ads.
 * `objetivo` (id ou objeto com id) acrescenta o checklist de criativo do
 * objetivo no fim, nas tarefas de criativo; ele é o último a ser cortado.
 */
export function conhecimentoAdsPara(tarefa: TarefaAds, opcoes: { objetivo?: unknown } = {}): ConhecimentoMontado {
  const blocos = [...BLOCOS_ADS[tarefa]];
  const objetivo = TAREFAS_COM_CHECKLIST.has(tarefa) ? objetivoDoChecklist(opcoes.objetivo) : null;
  if (objetivo) blocos.push(b(`checklist_${objetivo}`, CHECKLIST_CRIATIVO_POR_OBJETIVO[objetivo], 13));
  return montarComTeto(blocos, TETO_ADS[tarefa]);
}

// ------------------------------------------------------------------ calendário e campanhas

/**
 * - mes: detalhar, conversar, completar itens e as outras escritas do mês.
 * - temas: propor os temas do mês (as três frentes do propor_temas).
 * - diagnostico: a pesquisa e o diagnóstico estruturado do mês (Frente O, 26/09).
 * - campanha: criar, ajustar e conversar sobre campanha.
 * ESTRUTURAS_DE_CONTEUDO fica por último no mês: a BASE_DO_ESTRATEGISTA já
 * traz as regras do carrossel e do estático, e o resto dele (blog, página)
 * não é formato do calendário. ROTEIRO_DE_VIDEO nunca entra: o calendário
 * proíbe vídeo (REGRAS_DE_SAIDA). Os blocos de social media
 * (conhecimento-social.ts) somam ganchos de capa, carrossel de retenção e o
 * checklist de salvar e enviar a quem escreve; mistura do mês, datas e
 * alcance contra conversão a quem propõe temas; sinais e leitura do perfil
 * ao diagnóstico.
 */
export type MomentoDoCalendario = "mes" | "campanha" | "temas" | "diagnostico";
/** Teto da campanha (e o antigo teto único do calendário). */
export const TETO_CALENDARIO = 7_500;
/** Teto por momento (Frente O): o mês e os temas ganharam os blocos de social media. */
export const TETO_CALENDARIO_POR_MOMENTO: Record<MomentoDoCalendario, number> = {
  mes: 11_000,
  temas: 12_500,
  diagnostico: 11_000,
  campanha: TETO_CALENDARIO,
};

const BLOCOS_CALENDARIO: Record<MomentoDoCalendario, readonly BlocoDeConhecimento[]> = {
  mes: [
    b("calendario_editorial", CALENDARIO_EDITORIAL, 9),
    b("formulas_de_titulo", FORMULAS_DE_TITULO, 6),
    b("cta_principios", CTA_PRINCIPIOS, 5),
    b("voz_de_marca", VOZ_DE_MARCA, 4),
    b("anti_generico", ANTI_GENERICO, 8),
    b("ganchos_por_tipo", GANCHOS_POR_TIPO, 7),
    b("carrossel_de_retencao", CARROSSEL_DE_RETENCAO, 7.5),
    b("checklist_salva_e_envia", CHECKLIST_SALVA_E_ENVIA, 6.5),
    b("estruturas_de_conteudo", ESTRUTURAS_DE_CONTEUDO, 1),
  ],
  temas: [
    b("calendario_editorial", CALENDARIO_EDITORIAL, 9),
    b("mistura_do_mes", MISTURA_DO_MES, 8.5),
    b("datas_e_oportunidades", DATAS_E_OPORTUNIDADES, 8),
    b("ganchos_por_tipo", GANCHOS_POR_TIPO, 7.5),
    b("alcance_e_conversao", ALCANCE_E_CONVERSAO, 7),
    b("formulas_de_titulo", FORMULAS_DE_TITULO, 6),
    b("cta_principios", CTA_PRINCIPIOS, 5),
    b("voz_de_marca", VOZ_DE_MARCA, 4),
    b("anti_generico", ANTI_GENERICO, 8.8),
    b("estruturas_de_conteudo", ESTRUTURAS_DE_CONTEUDO, 1),
  ],
  diagnostico: [
    b("sinais_do_algoritmo", SINAIS_DO_ALGORITMO, 9),
    b("sinais_para_medir", SINAIS_PARA_MEDIR, 8.5),
    b("alcance_e_conversao", ALCANCE_E_CONVERSAO, 8),
    b("mistura_do_mes", MISTURA_DO_MES, 7.5),
    b("datas_e_oportunidades", DATAS_E_OPORTUNIDADES, 7),
    b("analise_de_desempenho", ANALISE_DE_DESEMPENHO, 5),
    b("calendario_editorial", CALENDARIO_EDITORIAL, 4),
    b("anti_generico", ANTI_GENERICO, 3),
  ],
  campanha: [
    b("plano_de_campanha", PLANO_DE_CAMPANHA, 9),
    b("voz_de_marca", VOZ_DE_MARCA, 7),
    b("formulas_de_titulo", FORMULAS_DE_TITULO, 5),
    b("cta_principios", CTA_PRINCIPIOS, 6),
    b("anti_generico", ANTI_GENERICO, 8),
    b("calendario_editorial", CALENDARIO_EDITORIAL, 1),
  ],
};

export function conhecimentoCalendarioPara(momento: MomentoDoCalendario): ConhecimentoMontado {
  return montarComTeto(BLOCOS_CALENDARIO[momento], TETO_CALENDARIO_POR_MOMENTO[momento]);
}

// ------------------------------------------------------------------ Estúdio

/**
 * - direcao: direção de arte de post e carrossel e a conversa com o diretor
 *   (logo depois de CONHECIMENTO_DIRETOR).
 * - legenda: legenda final do post.
 * PADRAO_NA_IMAGEM (texto ao gerador de imagem) não recebe nada.
 */
export type MomentoDoEstudio = "direcao" | "legenda";
export const TETO_ESTUDIO: Record<MomentoDoEstudio, number> = { direcao: 6_000, legenda: 3_500 };

const BLOCOS_ESTUDIO: Record<MomentoDoEstudio, readonly BlocoDeConhecimento[]> = {
  direcao: [
    b("anti_generico", ANTI_GENERICO, 5),
    b("voz_de_marca", VOZ_DE_MARCA, 4),
    b("revisao_de_marca", REVISAO_DE_MARCA, 3),
    b("cta_principios", CTA_PRINCIPIOS, 2),
    b("identidade_de_marca", IDENTIDADE_DE_MARCA, 1),
  ],
  legenda: [
    b("formulas_de_titulo", FORMULAS_DE_TITULO, 3),
    b("cta_principios", CTA_PRINCIPIOS, 2),
    b("anti_generico", ANTI_GENERICO, 1),
  ],
};

export function conhecimentoEstudioPara(momento: MomentoDoEstudio): ConhecimentoMontado {
  return montarComTeto(BLOCOS_ESTUDIO[momento], TETO_ESTUDIO[momento]);
}

// ------------------------------------------------------------------ Mesa Foto

/** SISTEMA_CAMPANHA e SISTEMA_AGENTE. Leitor, kits, conferência e identificação não recebem nada. */
export const TETO_MESA_FOTO = 5_000;

export function conhecimentoMesaFoto(): ConhecimentoMontado {
  return montarComTeto([
    b("anti_generico", ANTI_GENERICO, 3),
    b("identidade_de_marca", IDENTIDADE_DE_MARCA, 2),
    b("criativo_natalia", CRIATIVO_NATALIA, 1),
  ], TETO_MESA_FOTO);
}

// ------------------------------------------------------------------ agente de contexto

/** SISTEMA_CONTEXTO e SISTEMA_CONVERSA. Leitura e acervo não recebem nada. */
export const TETO_CONTEXTO = 6_500;

export function conhecimentoContexto(): ConhecimentoMontado {
  return montarComTeto([
    b("voz_de_marca", VOZ_DE_MARCA, 4),
    b("posicionamento_e_concorrencia", POSICIONAMENTO_E_CONCORRENCIA, 3),
    b("objecoes_e_voz_do_cliente", OBJECOES_E_VOZ_DO_CLIENTE, 2),
    b("identidade_de_marca", IDENTIDADE_DE_MARCA, 1),
  ], TETO_CONTEXTO);
}
