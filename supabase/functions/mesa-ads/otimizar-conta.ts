/**
 * "Otimizar" dentro da conta (frente AD4, pedido do dono em 28/09/2026):
 * "compara cada anúncio ativo com os números reais, com a régua do nicho e da
 * conta; se está bom, não mexe; se está ruim, propõe a troca do criativo e da
 * copy pelo melhor candidato do acervo. Simples, rápido e prático."
 *
 * Divisão do trabalho:
 * - CÓDIGO: a janela mínima de dados, a régua (nicho, conta, dono, plano) e o
 *   veredito numérico de cada anúncio (bom, atenção, ruim, cedo), com os
 *   números na frase. Também filtra os candidatos do acervo (arte pronta,
 *   enviados para a conta, imagem única, fora do ar).
 * - JEV (uma chamada só, perguntas em paralelo): Score da saúde de cada
 *   anúncio julgado, Choice do substituto entre os candidatos (com "nenhum")
 *   e Score da copy atual de cada anúncio ruim.
 * - POLÍTICA (código): só propõe troca quando régua E Jev dizem ruim, o Jev
 *   escolheu um candidato com probabilidade suficiente e nenhuma regra do
 *   dono barra. Sem Jev, não propõe troca (mostra a régua e avisa).
 *
 * Nada aqui escreve: o plano vira o cartão "Confirmar" (acoes-conta.ts,
 * tipo trocar_anuncio). Puro (sem Deno, sem banco, sem rede): testado no Vitest.
 * Sem travessão nos textos (regra do dono).
 */
import type { PerguntaJev, RespostaJev } from "../_shared/jev.ts";
import type { FonteDoLimite, Limites } from "./rotina-trafego.ts";

/** Janela do otimizar (dias): a mesma da rotina, onde a fadiga aparece. */
export const DIAS_DO_OTIMIZAR = 7;
/** Trocas por pedido (uma confirmação não mexe em mais que isso). */
export const MAX_TROCAS = 5;
/** Anúncios julgados pelo Jev por pedido (os de maior gasto primeiro). */
export const MAX_JULGADOS = 15;
/** Candidatos por anúncio na pergunta do substituto. */
export const MAX_CANDIDATOS = 12;
/** Saúde do Jev (0 a 4) igual ou abaixo disso concorda com "ruim". */
export const SAUDE_RUIM = 1.5;
/** Saúde do Jev igual ou abaixo disso num anúncio que a régua acha bom vira "atenção" (não mexe). */
export const SAUDE_DUVIDOSA = 1;
/** Probabilidade mínima do candidato escolhido pelo Jev. */
export const PROB_CANDIDATO = 0.35;
/** Nota da copy atual (0 a 4) a partir da qual ela fica quando o problema é só a arte. */
export const COPY_BOA = 3;

export type Problema = "ctr_baixo" | "ctr_abaixo_da_conta" | "sem_resultado" | "custo_alto" | "fadiga" | "cpc_alto";
export type Veredito = "bom" | "atencao" | "ruim" | "cedo";
export type Onde = "criativo" | "copy" | "os_dois";

/** Um anúncio como a conta ao vivo devolve (só o que o otimizar usa). */
export type AnuncioDaConta = {
  ad_id: string;
  nome: string | null;
  status: string | null;
  campanha: string | null;
  conjunto: string | null;
  conjunto_id: string | null;
  formato: string | null;
  metricas: {
    gasto: number;
    impressoes: number;
    resultados: number;
    custo_por_resultado: number | null;
    ctr_saida_pct: number | null;
    cpc: number | null;
    cpm: number | null;
    frequencia_media: number | null;
    dias: number;
    resultado_rotulo?: string | null;
  };
  tendencia: { ctr_var_pct: number | null; custo_resultado_var_pct: number | null; frequencia: number | null } | null;
  titulo: string | null;
  corpo: string | null;
  criativo: { id: string; nome: string | null } | null;
};

/** Um criativo do acervo da Mesa Ads (o que o agente da conta enxerga). */
export type CriativoDoAcervo = {
  id: string;
  nome: string;
  formato: string;
  status: string;
  ad_id: string | null;
  tem_arte: boolean;
  angulo: { nome: string; hipotese: string | null; promessa: string | null } | null;
  plano: string | null;
  copy: { texto_principal: string | null; titulo: string | null; descricao: string | null };
  /** Nota da copy pelo Jev na produção (0 a 10), quando existe. */
  nota_copy: number | null;
  melhor: boolean;
};

/** Status do criativo que conta como "enviado para a conta" (pronto para subir). */
export const STATUS_NA_CONTA = ["pronto", "no_ar", "pausado"];
/** Formatos que sobem como imagem única (carrossel não troca por aqui). */
const FORMATOS_DE_IMAGEM = ["feed_4x5", "quadrado_1x1", "stories_9x16"];

export type Regua = {
  ctr_minimo_pct: number;
  ctr_mediana_pct: number | null;
  cpc_mediana_brl: number | null;
  custo_alvo_brl: number | null;
  fonte_do_alvo: FonteDoLimite;
  multiplo_custo_alto: number;
  resultados_min_para_custo: number;
  limiar_sem_resultado_brl: number;
  frequencia_maxima: number;
  impressoes_minimas: number;
  gasto_minimo_brl: number;
  dias_minimos: number;
};

export type Julgamento = {
  anuncio: AnuncioDaConta;
  veredito: Veredito;
  problemas: Problema[];
  /** Frases curtas da régua, com os números. */
  motivos: string[];
  onde: Onde | null;
};

const arred = (v: number, casas = 2) => Math.round(v * 10 ** casas) / 10 ** casas;
const reais = (v: number | null | undefined) => (v == null ? "sem valor" : `R$ ${v.toFixed(2).replace(".", ",")}`);
const pct = (v: number | null | undefined) => (v == null ? "sem dado" : `${String(arred(v, 2)).replace(".", ",")}%`);
const inteiro = (v: number) => Math.round(v).toLocaleString("pt-BR");
const TRAVESSAO = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]", "g");
const limpo = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").replace(TRAVESSAO, ",").trim().slice(0, max) : "");
const ativo = (s: string | null | undefined) => String(s ?? "").toUpperCase() === "ACTIVE";

function mediana(v: number[]): number | null {
  const l = v.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!l.length) return null;
  const m = Math.floor(l.length / 2);
  return l.length % 2 ? l[m] : (l[m - 1] + l[m]) / 2;
}

/** A janela mínima de dados de um anúncio: volume, gasto e dias com entrega. */
export function temJanela(a: AnuncioDaConta, r: Pick<Regua, "impressoes_minimas" | "gasto_minimo_brl" | "dias_minimos">): boolean {
  return a.metricas.impressoes >= r.impressoes_minimas && a.metricas.gasto >= r.gasto_minimo_brl && a.metricas.dias >= r.dias_minimos;
}

/**
 * A régua da conta: limites da rotina (dono, plano, briefing, conta, nicho) e
 * as medianas dos anúncios ativos com janela (CTR e CPC). Mediana só com 3 ou
 * mais anúncios: menos que isso não é referência.
 */
export function reguaDaConta(anuncios: AnuncioDaConta[], L: Limites, fontes: Record<keyof Limites, FonteDoLimite>): Regua {
  const base = {
    impressoes_minimas: L.impressoes_minimas,
    gasto_minimo_brl: L.gasto_minimo_brl,
    dias_minimos: L.dias_aprendizado,
  };
  const comJanela = anuncios.filter((a) => ativo(a.status) && temJanela(a, base));
  const ctrs = comJanela.map((a) => a.metricas.ctr_saida_pct).filter((x): x is number => typeof x === "number");
  const cpcs = comJanela.map((a) => a.metricas.cpc).filter((x): x is number => typeof x === "number" && x > 0);
  const alvo = L.custo_alvo_brl;
  return {
    ...base,
    ctr_minimo_pct: L.ctr_minimo_pct,
    ctr_mediana_pct: ctrs.length >= 3 ? arred(mediana(ctrs) as number) : null,
    cpc_mediana_brl: cpcs.length >= 3 ? arred(mediana(cpcs) as number) : null,
    custo_alvo_brl: alvo,
    fonte_do_alvo: fontes.custo_alvo_brl,
    multiplo_custo_alto: L.multiplo_custo_alto,
    resultados_min_para_custo: L.resultados_min_para_custo,
    limiar_sem_resultado_brl: alvo ? Math.max(L.gasto_minimo_brl, arred(alvo * L.multiplo_sem_resultado)) : arred(L.gasto_minimo_brl * 2),
    frequencia_maxima: L.frequencia_maxima,
  };
}

const FONTE_DO_ALVO: Record<FonteDoLimite, string> = {
  dono: "definido por você",
  plano: "corte do plano de teste",
  briefing: "custo tolerável do briefing",
  conta: "média da própria conta",
  nicho: "referência do nicho",
  padrao: "padrão",
};
export const fonteDoAlvoEmTexto = (f: FonteDoLimite) => FONTE_DO_ALVO[f] ?? f;

function rotuloDoResultado(a: AnuncioDaConta): string {
  const r = limpo(a.metricas.resultado_rotulo, 40).toLowerCase();
  return r || "resultados";
}

/**
 * Veredito da régua (sem IA): cedo sem a janela mínima; ruim com CTR abaixo
 * do mínimo do nicho ou da metade da mediana da conta, gasto sem resultado,
 * custo por resultado acima do corte ou fadiga; atenção com CPC alto ou custo
 * entre o alvo e o corte; bom sem nada disso.
 */
export function julgarAnuncio(a: AnuncioDaConta, r: Regua): Julgamento {
  const m = a.metricas;
  const rot = rotuloDoResultado(a);
  if (!temJanela(a, r)) {
    const falta: string[] = [];
    if (m.impressoes < r.impressoes_minimas) falta.push(`${inteiro(m.impressoes)} de ${inteiro(r.impressoes_minimas)} impressões`);
    if (m.gasto < r.gasto_minimo_brl) falta.push(`${reais(m.gasto)} de ${reais(r.gasto_minimo_brl)} gastos`);
    if (m.dias < r.dias_minimos) falta.push(`${m.dias} de ${r.dias_minimos} dias com entrega`);
    return { anuncio: a, veredito: "cedo", problemas: [], motivos: [`Pouco dado para julgar: ${falta.join(", ")}.`], onde: null };
  }
  const problemas: Problema[] = [];
  const motivos: string[] = [];
  const ctr = m.ctr_saida_pct;
  if (ctr !== null && ctr < r.ctr_minimo_pct) {
    problemas.push("ctr_baixo");
    motivos.push(`CTR de link ${pct(ctr)} em ${inteiro(m.impressoes)} impressões, abaixo do mínimo de ${pct(r.ctr_minimo_pct)}.`);
  } else if (ctr !== null && r.ctr_mediana_pct !== null && ctr < r.ctr_mediana_pct * 0.5) {
    problemas.push("ctr_abaixo_da_conta");
    motivos.push(`CTR de link ${pct(ctr)}, menos da metade da mediana da conta (${pct(r.ctr_mediana_pct)}).`);
  }
  if (m.resultados <= 0 && m.gasto >= r.limiar_sem_resultado_brl) {
    problemas.push("sem_resultado");
    motivos.push(`${reais(m.gasto)} gastos em ${m.dias} dias sem ${rot} (o limite é ${reais(r.limiar_sem_resultado_brl)}).`);
  }
  const cpr = m.custo_por_resultado;
  const alvo = r.custo_alvo_brl;
  if (alvo && cpr !== null && m.resultados >= r.resultados_min_para_custo && cpr > alvo * r.multiplo_custo_alto) {
    problemas.push("custo_alto");
    motivos.push(`${inteiro(m.resultados)} ${rot} a ${reais(cpr)} cada, acima de ${String(r.multiplo_custo_alto).replace(".", ",")} vezes o alvo de ${reais(alvo)} (${fonteDoAlvoEmTexto(r.fonte_do_alvo)}).`);
  }
  const t = a.tendencia;
  const freq = (t && t.frequencia) ?? m.frequencia_media;
  if (freq !== null && freq >= r.frequencia_maxima && t && ((t.ctr_var_pct !== null && t.ctr_var_pct <= -20) || (t.custo_resultado_var_pct !== null && t.custo_resultado_var_pct >= 20))) {
    problemas.push("fadiga");
    const partes = [`frequência ${String(arred(freq, 1)).replace(".", ",")}`];
    if (t.ctr_var_pct !== null && t.ctr_var_pct <= -20) partes.push(`CTR ${pct(t.ctr_var_pct)} na segunda metade da semana`);
    if (t.custo_resultado_var_pct !== null && t.custo_resultado_var_pct >= 20) partes.push(`custo +${pct(t.custo_resultado_var_pct)}`);
    motivos.push(`Cansou: ${partes.join(", ")}.`);
  }
  const graves = problemas.filter((p) => p !== "cpc_alto");
  if (graves.length) {
    const doClique = graves.some((p) => p === "ctr_baixo" || p === "ctr_abaixo_da_conta" || p === "fadiga");
    const daConversao = graves.some((p) => p === "sem_resultado" || p === "custo_alto");
    return { anuncio: a, veredito: "ruim", problemas, motivos, onde: doClique && daConversao ? "os_dois" : doClique ? "criativo" : "copy" };
  }
  if (m.cpc !== null && r.cpc_mediana_brl !== null && m.cpc > r.cpc_mediana_brl * 2) {
    problemas.push("cpc_alto");
    motivos.push(`CPC ${reais(m.cpc)}, mais que o dobro da mediana da conta (${reais(r.cpc_mediana_brl)}).`);
    return { anuncio: a, veredito: "atencao", problemas, motivos, onde: null };
  }
  if (alvo && cpr !== null && cpr > alvo) {
    motivos.push(`${reais(cpr)} por ${singular(rot)}, acima do alvo de ${reais(alvo)} mas abaixo do corte de ${reais(arred(alvo * r.multiplo_custo_alto))}.`);
    return { anuncio: a, veredito: "atencao", problemas, motivos, onde: null };
  }
  const bons: string[] = [];
  if (cpr !== null) bons.push(`${inteiro(m.resultados)} ${rot} a ${reais(cpr)}${alvo ? ` (alvo ${reais(alvo)})` : ""}`);
  if (ctr !== null) bons.push(`CTR ${pct(ctr)}`);
  motivos.push(bons.length ? `${bons.join(", ")}.` : "Sem alerta na régua.");
  return { anuncio: a, veredito: "bom", problemas, motivos, onde: null };
}

function singular(rotulo: string): string {
  const r = rotulo.toLowerCase();
  if (r.indexOf("conversa") >= 0) return "conversa";
  if (r.indexOf("cadastro") >= 0 || r.indexOf("lead") >= 0) return "cadastro";
  if (r.indexOf("compra") >= 0) return "compra";
  if (r.indexOf("visita") >= 0) return "visita";
  return "resultado";
}

/** Anúncios ativos julgados pela régua, os de maior gasto primeiro. */
export function julgarConta(anuncios: AnuncioDaConta[], r: Regua): Julgamento[] {
  return anuncios
    .filter((a) => ativo(a.status))
    .slice()
    .sort((a, b) => b.metricas.gasto - a.metricas.gasto)
    .map((a) => julgarAnuncio(a, r));
}

/**
 * Candidatos do acervo para um anúncio: arte pronta, enviados para a conta,
 * imagem única e fora do ar (sem anúncio ativo ligado). Os marcados como
 * melhor do ângulo e com nota maior primeiro.
 */
export function candidatosDoAcervo(acervo: CriativoDoAcervo[], adsAtivos: Set<string>): CriativoDoAcervo[] {
  return acervo
    .filter((c) => c.tem_arte && STATUS_NA_CONTA.indexOf(c.status) >= 0 && c.status !== "no_ar" && FORMATOS_DE_IMAGEM.indexOf(c.formato) >= 0 && !(c.ad_id && adsAtivos.has(c.ad_id)))
    .sort((a, b) => Number(b.melhor) - Number(a.melhor) || (b.nota_copy ?? -1) - (a.nota_copy ?? -1))
    .slice(0, MAX_CANDIDATOS);
}

// ------------------------------------------------------------------ Jev

export const NIVEIS_SAUDE = [
  "Queima verba: já gastou o bastante para concluir e não traz o resultado do objetivo, ou quase ninguém clica.",
  "Fraco: clica pouco para o nicho ou o resultado sai bem mais caro que o alvo; pede criativo novo.",
  "Na média: nem vence nem queima; os números ainda permitem esperar.",
  "Bom: custo dentro do alvo e clique saudável para o nicho.",
  "Vencedor: resultado barato e estável, com clique acima da conta.",
];

export const NIVEIS_COPY = [
  "Não diz o que é, para quem é nem qual o próximo passo.",
  "Genérica: fala do negócio e não da dor ou do desejo de quem vê; sem motivo para agir agora.",
  "Clara, mas sem gancho: explica, mas não faz parar nem pedir a ação.",
  "Clara, com gancho e com o próximo passo.",
  "Específica, com gancho forte, prova e pedido de ação alinhado ao objetivo.",
];

export type ContextoDoOtimizar = { nicho: string | null; objetivo: string | null; resultado_principal: string };

/** Anúncios que vão ao Jev: os julgados (com janela), até o teto, os de maior gasto primeiro. */
export function paraOJev(julgados: Julgamento[]): Julgamento[] {
  return julgados.filter((j) => j.veredito !== "cedo").slice(0, MAX_JULGADOS);
}

const eVideo = (a: AnuncioDaConta) => String(a.formato ?? "").toLowerCase() === "video";

/**
 * Estado e perguntas do Jev (uma chamada): saude_k para cada anúncio julgado;
 * para os ruins de imagem com candidatos, substituto_k (Choice com "nenhum")
 * e copy_k (a copy atual segura o clique?). As perguntas de troca são
 * especulativas: o código só usa quando a saúde concorda com a régua.
 */
export function perguntasDoOtimizar(julgados: Julgamento[], candidatos: CriativoDoAcervo[], r: Regua, ctx: ContextoDoOtimizar) {
  const lista = paraOJev(julgados);
  const acervo = candidatos.map((c, j) => ({
    ref: `a${j + 1}`,
    nome: c.nome,
    formato: c.formato,
    angulo: c.angulo ? c.angulo.nome : null,
    hipotese: c.angulo ? c.angulo.hipotese : null,
    promessa: c.angulo ? c.angulo.promessa : null,
    copy: { texto_principal: limpo(c.copy.texto_principal, 400) || null, titulo: limpo(c.copy.titulo, 80) || null },
    nota_da_copy_0_a_10: c.nota_copy,
    melhor_do_angulo: c.melhor,
  }));
  const state = {
    negocio: { nicho: ctx.nicho, objetivo: ctx.objetivo, resultado_principal: ctx.resultado_principal },
    regua: {
      janela_dias: DIAS_DO_OTIMIZAR,
      ctr_minimo_do_nicho_pct: r.ctr_minimo_pct,
      ctr_mediana_da_conta_pct: r.ctr_mediana_pct,
      cpc_mediana_da_conta_brl: r.cpc_mediana_brl,
      custo_alvo_brl: r.custo_alvo_brl,
      fonte_do_custo_alvo: fonteDoAlvoEmTexto(r.fonte_do_alvo),
      frequencia_de_alerta: r.frequencia_maxima,
    },
    anuncios: lista.map((j) => ({
      nome: j.anuncio.nome,
      campanha: j.anuncio.campanha,
      conjunto: j.anuncio.conjunto,
      numeros: {
        gasto_brl: j.anuncio.metricas.gasto,
        impressoes: j.anuncio.metricas.impressoes,
        resultados: j.anuncio.metricas.resultados,
        custo_por_resultado_brl: j.anuncio.metricas.custo_por_resultado,
        ctr_link_pct: j.anuncio.metricas.ctr_saida_pct,
        cpc_brl: j.anuncio.metricas.cpc,
        cpm_brl: j.anuncio.metricas.cpm,
        frequencia: (j.anuncio.tendencia && j.anuncio.tendencia.frequencia) ?? j.anuncio.metricas.frequencia_media,
        dias_com_entrega: j.anuncio.metricas.dias,
        variacao_ctr_pct: j.anuncio.tendencia ? j.anuncio.tendencia.ctr_var_pct : null,
        variacao_custo_pct: j.anuncio.tendencia ? j.anuncio.tendencia.custo_resultado_var_pct : null,
      },
      o_que_a_regua_viu: j.motivos,
      copy_atual: { texto_principal: limpo(j.anuncio.corpo, 500) || null, titulo: limpo(j.anuncio.titulo, 100) || null },
    })),
    acervo,
  };
  const questions: Record<string, PerguntaJev> = {};
  lista.forEach((j, k) => {
    questions[`saude_${k}`] = {
      type: "score",
      instructions: `Você é o gestor de tráfego sênior deste negócio (\`negocio\`). Pelos números de ${DIAS_DO_OTIMIZAR} dias de \`anuncios[${k}]\`, comparados com a \`regua\` do nicho e da conta, como está este anúncio para o objetivo? Olhe o resultado que vende, não curtida.`,
      criteria: NIVEIS_SAUDE,
    };
    if (j.veredito !== "ruim" || eVideo(j.anuncio) || !acervo.length) return;
    const criteria: Record<string, unknown> = {};
    acervo.forEach((c) => {
      criteria[c.ref] = {
        what: `${c.nome}${c.angulo ? `, ângulo "${c.angulo}"` : ""}${c.hipotese ? `: ${limpo(c.hipotese, 220)}` : ""}. Formato ${c.formato}.`,
        copy: c.copy.texto_principal ? limpo(c.copy.texto_principal, 220) : "sem copy gravada",
      };
    });
    criteria.nenhum = {
      what: "Nenhum candidato do acervo resolve o problema deste anúncio.",
      examples: ["o acervo fala de outra oferta ou de outro público", "todos repetem o mesmo gancho que já não chama atenção"],
    };
    questions[`substituto_${k}`] = {
      type: "choice",
      instructions: `O anúncio \`anuncios[${k}]\` está ruim pelos números (\`anuncios[${k}].o_que_a_regua_viu\`). Qual criativo do \`acervo\` deve entrar no lugar dele, no mesmo conjunto (mesmo público e verba)? Com CTR baixo ou fadiga, prefira o gancho e a arte que fazem parar de rolar; com clique bom e custo alto, a promessa e a oferta mais claras. Precisa falar do mesmo produto e do mesmo objetivo (\`negocio\`).`,
      criteria,
    };
    if (j.anuncio.corpo || j.anuncio.titulo) {
      questions[`copy_${k}`] = {
        type: "score",
        instructions: `A copy atual de \`anuncios[${k}].copy_atual\` (texto principal e título) segura quem vê e leva à ação do objetivo (\`negocio.resultado_principal\`)?`,
        criteria: NIVEIS_COPY,
      };
    }
  });
  return { state, questions, julgados: lista, acervo: candidatos };
}

// ------------------------------------------------------------------ decisão

export type AcaoDoOtimizar = "nao_mexer" | "cedo" | "atencao" | "trocar" | "sem_candidato" | "video" | "barrado" | "sem_jev";

export type AvaliacaoFinal = {
  ad_id: string;
  nome: string;
  veredito: Veredito;
  acao: AcaoDoOtimizar;
  motivos: string[];
  /** Saúde pelo Jev (0 a 4), quando julgado. */
  saude: number | null;
  /** Frase da decisão (o que foi feito com este anúncio e por quê). */
  decisao: string;
};

export type Troca = {
  anuncio: AnuncioDaConta;
  candidato: CriativoDoAcervo;
  /** Probabilidade do Jev para o candidato escolhido. */
  prob: number;
  saude: number;
  copy: "candidato" | "atual";
  nota_copy_atual: number | null;
  problemas: Problema[];
  onde: Onde | null;
  /** A frase de prova do item (números, régua, Jev e o candidato). */
  motivo: string;
};

export type PlanoDoOtimizar = {
  avaliados: AvaliacaoFinal[];
  trocas: Troca[];
  jev_ok: boolean;
};

type Resp = RespostaJev | undefined;

const num1 = (v: number) => String(arred(v, 1)).replace(".", ",");

/**
 * Junta régua e Jev. Troca só quando a régua diz ruim, o Jev dá saúde até
 * SAUDE_RUIM e escolhe um candidato (não "nenhum") com PROB_CANDIDATO ou mais;
 * cada candidato entra uma vez (o segundo anúncio fica com o próximo mais
 * provável). `barrado` diz se uma regra do dono proíbe mexer no anúncio.
 */
export function decidirOtimizacao(
  julgados: Julgamento[],
  candidatos: CriativoDoAcervo[],
  answers: Record<string, Resp> | null,
  barrado: (a: AnuncioDaConta) => string | null = () => null,
): PlanoDoOtimizar {
  const noJev = paraOJev(julgados);
  const indice = new Map(noJev.map((j, k) => [j.anuncio.ad_id, k]));
  const usados = new Set<string>();
  const avaliados: AvaliacaoFinal[] = [];
  const trocas: Troca[] = [];
  const jevOk = !!answers;
  for (const j of julgados) {
    const a = j.anuncio;
    const nome = limpo(a.nome, 160) || `Anúncio ${a.ad_id}`;
    const base = { ad_id: a.ad_id, nome, veredito: j.veredito, motivos: j.motivos };
    const k = indice.get(a.ad_id);
    const saudeBruta = k !== undefined && answers ? answers[`saude_${k}`] : undefined;
    const saude = saudeBruta && typeof saudeBruta.score === "number" && Number.isFinite(saudeBruta.score) ? arred(saudeBruta.score, 2) : null;
    if (j.veredito === "cedo") {
      avaliados.push({ ...base, acao: "cedo", saude: null, decisao: "Cedo para julgar: não mexi." });
      continue;
    }
    if (j.veredito !== "ruim") {
      if (saude !== null && saude <= SAUDE_DUVIDOSA && j.veredito === "bom") {
        avaliados.push({ ...base, veredito: "atencao", acao: "atencao", saude, decisao: `A régua não acusa nada, mas o Jev deu saúde ${num1(saude)} de 4. Não mexi; vale olhar.` });
      } else {
        avaliados.push({ ...base, acao: j.veredito === "bom" ? "nao_mexer" : "atencao", saude, decisao: j.veredito === "bom" ? "Está bom: não mexi." : "Atenção, sem troca: ainda dentro do corte." });
      }
      continue;
    }
    // Ruim pela régua.
    if (eVideo(a)) {
      avaliados.push({ ...base, acao: "video", saude, decisao: "Anúncio de vídeo: a troca por aqui é só de imagem. Troque pela Meta." });
      continue;
    }
    const regra = barrado(a);
    if (regra) {
      avaliados.push({ ...base, acao: "barrado", saude, decisao: `Regra sua: "${regra}". Não propus troca.` });
      continue;
    }
    if (!jevOk || k === undefined) {
      avaliados.push({ ...base, acao: "sem_jev", saude: null, decisao: "O Jev não respondeu: sem o segundo julgamento, não propus troca." });
      continue;
    }
    if (saude === null || saude > SAUDE_RUIM) {
      avaliados.push({ ...base, veredito: "atencao", acao: "atencao", saude, decisao: saude === null ? "O Jev não julgou este anúncio: não propus troca." : `A régua acusou, mas o Jev pesou os números e deu saúde ${num1(saude)} de 4. Não troquei; observe mais uns dias.` });
      continue;
    }
    const esc = answers ? answers[`substituto_${k}`] : undefined;
    const probs = esc && esc.probabilities && typeof esc.probabilities === "object" ? esc.probabilities : null;
    const ordem = probs
      ? Object.keys(probs).filter((ref) => ref !== "nenhum" && /^a\d+$/.test(ref)).sort((x, y) => (probs[y] ?? 0) - (probs[x] ?? 0))
      : esc && typeof esc.choice === "string" && /^a\d+$/.test(esc.choice) ? [esc.choice] : [];
    const probDe = (ref: string) => (probs && typeof probs[ref] === "number" ? probs[ref] : esc && esc.choice === ref && typeof esc.confidence === "number" ? esc.confidence : 0);
    const nenhum = !!esc && esc.choice === "nenhum";
    const ref = nenhum ? null : ordem.find((x) => !usados.has(x) && probDe(x) >= PROB_CANDIDATO && !!candidatos[Number(x.slice(1)) - 1]) ?? null;
    if (!candidatos.length || !ref || trocas.length >= MAX_TROCAS) {
      const porque = !candidatos.length
        ? "Nenhum criativo do acervo está na conta (arte pronta e enviado). Envie no Estúdio Ads > Acervo."
        : trocas.length >= MAX_TROCAS
          ? `Limite de ${MAX_TROCAS} trocas por pedido: fica para o próximo.`
          : nenhum
            ? "O Jev não achou no acervo um criativo que resolva este anúncio. Produza um ângulo novo."
            : "Nenhum candidato do acervo passou de 35% de preferência. Produza um ângulo novo.";
      avaliados.push({ ...base, acao: "sem_candidato", saude, decisao: `Ruim, sem troca: ${porque}` });
      continue;
    }
    usados.add(ref);
    const candidato = candidatos[Number(ref.slice(1)) - 1];
    const copyResp = answers ? answers[`copy_${k}`] : undefined;
    const notaCopy = copyResp && typeof copyResp.score === "number" && Number.isFinite(copyResp.score) ? arred(copyResp.score, 2) : null;
    const copy: Troca["copy"] = j.onde === "criativo" && notaCopy !== null && notaCopy >= COPY_BOA ? "atual" : "candidato";
    const prob = arred(probDe(ref), 2);
    const motivo = [
      j.motivos.join(" "),
      `Jev: saúde ${num1(saude)} de 4.`,
      `Entra "${candidato.nome}"${candidato.angulo ? ` (ângulo ${candidato.angulo.nome})` : ""}, ${Math.round(prob * 100)}% de preferência do Jev.`,
      copy === "atual"
        ? `Copy atual mantida (nota ${num1(notaCopy as number)} de 4): o problema é a arte.`
        : `Copy do candidato${notaCopy !== null ? ` (a atual teve nota ${num1(notaCopy)} de 4)` : ""}.`,
    ].join(" ");
    trocas.push({ anuncio: a, candidato, prob, saude, copy, nota_copy_atual: notaCopy, problemas: j.problemas, onde: j.onde, motivo });
    avaliados.push({ ...base, acao: "trocar", saude, decisao: `Trocar por "${candidato.nome}" (confirme no cartão).` });
  }
  return { avaliados, trocas, jev_ok: jevOk };
}

/**
 * A resposta do agente em texto corrido (a conversa mostra texto simples):
 * quantos olhou, a janela, e cada grupo com o nome e o número que decidiu.
 */
export function textoDoOtimizar(p: PlanoDoOtimizar, periodo: { inicio: string; fim: string } | null, r: Regua): string {
  const data = (iso: string) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso);
  const grupo = (acoes: AcaoDoOtimizar[]) => p.avaliados.filter((x) => acoes.indexOf(x.acao) >= 0);
  const linha = (x: AvaliacaoFinal) => `${x.nome}: ${x.motivos[0] ?? ""}${x.acao !== "nao_mexer" && x.acao !== "cedo" ? ` ${x.decisao}` : ""}`.trim();
  const partes: string[] = [];
  const total = p.avaliados.length;
  if (!total) return "Não há anúncio ativo na conta agora: nada para otimizar.";
  partes.push(
    `Olhei ${total} ${total === 1 ? "anúncio ativo" : "anúncios ativos"}${periodo ? ` (${DIAS_DO_OTIMIZAR} dias, ${data(periodo.inicio)} a ${data(periodo.fim)})` : ""} contra a régua: CTR mínimo ${pct(r.ctr_minimo_pct)}${r.ctr_mediana_pct !== null ? `, mediana da conta ${pct(r.ctr_mediana_pct)}` : ""}${r.custo_alvo_brl ? `, custo-alvo ${reais(r.custo_alvo_brl)} (${fonteDoAlvoEmTexto(r.fonte_do_alvo)})` : ""}.`,
  );
  const trocar = grupo(["trocar"]);
  const bons = grupo(["nao_mexer"]);
  const atencao = grupo(["atencao"]);
  const semTroca = grupo(["sem_candidato", "video", "barrado", "sem_jev"]);
  const cedo = grupo(["cedo"]);
  if (trocar.length) partes.push(`\nTrocar (${trocar.length}, confirme no cartão):\n${trocar.map((x) => `• ${linha(x)}`).join("\n")}`);
  if (semTroca.length) partes.push(`\nRuins sem troca agora (${semTroca.length}):\n${semTroca.map((x) => `• ${x.nome}: ${x.decisao}`).join("\n")}`);
  if (atencao.length) partes.push(`\nAtenção, não mexi (${atencao.length}):\n${atencao.map((x) => `• ${linha(x)}`).join("\n")}`);
  if (bons.length) partes.push(`\nBons, não mexi (${bons.length}):\n${bons.map((x) => `• ${linha(x)}`).join("\n")}`);
  if (cedo.length) partes.push(`\nCedo para julgar (${cedo.length}): ${cedo.map((x) => x.nome).join(", ")}.`);
  if (!p.jev_ok) partes.push("\nO Jev não respondeu agora: mostrei só a régua e não propus troca. Peça de novo em instantes.");
  if (trocar.length) partes.push("\nA troca cria um anúncio novo no mesmo conjunto com o criativo do acervo e pausa o antigo (criativo não se edita na Meta). Não mexo em verba, não ativo campanha nem conjunto. Tem Desfazer.");
  return partes.join("\n");
}

/** O pedido é "otimizar" (e nada além)? Mensagem curta com otimizar/otimize, sem outra ordem junto. */
export function pareceOtimizar(mensagem: string): boolean {
  const t = (mensagem || "").toLowerCase().trim();
  if (!t || t.length > 120) return false;
  if (!/\botimiz\w*/.test(t)) return false;
  // Ordem misturada (pausar, verba, renomear, campanha nova) vai para o agente completo.
  return !/\b(paus\w*|ative|ativa|ativar|verba|orçamento|orcamento|renome\w*|duplic\w*|crie|criar|mont\w*|campanha nova)(?![\wà-ú])/.test(t);
}
