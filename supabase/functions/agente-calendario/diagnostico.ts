/**
 * Diagnóstico estruturado do Mês (Frente O, 26/09/2026).
 *
 * Pedido do dono: "o diagnóstico de pesquisa do mês está vindo como um textão
 * que polui muito" e "ter uma inteligência muito grande atrás do Mês".
 *
 * O propor_temas ganha uma quarta chamada, em paralelo com as três frentes de
 * temas: a pesquisa do mês. Ela cruza a pesquisa na web dirigida ao nicho
 * (pautas de conhecimento-social.ts), as datas do Brasil calculadas aqui no
 * código, a leitura do perfil calculada pelas regras de _shared/evolucao.ts
 * (a mesma da Mesa Ads: orgânico e anúncios, só leitura) e o cérebro do
 * cliente, e devolve o diagnóstico em JSON. Ele fica em
 * calendario_propostas.parametros.diagnostico_estruturado (sem SQL novo) e o
 * campo `diagnostico` continua existindo, agora em texto curto.
 *
 * Se a pesquisa falhar ou atrasar, os temas não esperam: o diagnóstico sai
 * das frentes (diagnosticoDasFrentes), com a marca origem "frentes".
 *
 * Puro: sem Deno, sem banco e sem rede (o Vitest importa direto). Sem travessão.
 */

import type { DesempenhoDoCliente, LeituraDeEvolucao } from "../_shared/evolucao.ts";
import type { DataSazonal } from "../_shared/conhecimento-social.ts";

export const VERSAO_DIAGNOSTICO = "2026-09-26.1";

/** Quanto tempo, depois das frentes de temas, a proposta espera a pesquisa do mês antes de responder. */
export const GRACA_DO_DIAGNOSTICO_MS = 45_000;

// ------------------------------------------------------------------ esquema

const S = (type: string | string[], extra: Record<string, unknown> = {}) => ({ type, ...extra });
const obj = (props: Record<string, unknown>) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });
const lista = (items: unknown) => ({ type: "array", items });

export const ESQUEMA_DIAGNOSTICO = {
  nome: "diagnostico_do_mes",
  schema: obj({
    resumo: S("string"),
    o_que_funciona: lista(obj({ ponto: S("string"), evidencia: S("string") })),
    o_que_nao_funciona: lista(obj({ ponto: S("string"), evidencia: S("string") })),
    oportunidades_do_mes: lista(obj({ data: S(["string", "null"]), tema: S("string"), por_que: S("string") })),
    tendencias_do_nicho: lista(obj({ tendencia: S("string"), como_usar: S("string"), fonte: S(["string", "null"]) })),
    recomendacoes: lista(obj({ acao: S("string"), por_que: S("string"), prioridade: S("string", { enum: ["alta", "media", "baixa"] }) })),
    mistura_sugerida: obj({ topo: S("integer"), meio: S("integer"), fundo: S("integer"), justificativa: S("string") }),
    sinais_para_medir: lista(S("string")),
    limites: lista(S("string")),
    fontes: lista(obj({ titulo: S("string"), url: S("string") })),
  }),
};

// ------------------------------------------------------------------ tipos

export type PontoComEvidencia = { ponto: string; evidencia: string };
export type Oportunidade = { data: string | null; tema: string; por_que: string };
export type Tendencia = { tendencia: string; como_usar: string; fonte: string | null };
export type Recomendacao = { acao: string; por_que: string; prioridade: "alta" | "media" | "baixa" };
export type Mistura = { topo: number; meio: number; fundo: number; justificativa: string };
export type Fonte = { titulo: string; url: string };

export type DiagnosticoEstruturado = {
  versao: string;
  /** "pesquisa": a chamada própria do diagnóstico; "frentes": montado das frentes de temas (a pesquisa falhou ou atrasou). */
  origem: "pesquisa" | "frentes";
  gerado_em: string;
  resumo: string;
  o_que_funciona: PontoComEvidencia[];
  o_que_nao_funciona: PontoComEvidencia[];
  oportunidades_do_mes: Oportunidade[];
  tendencias_do_nicho: Tendencia[];
  recomendacoes: Recomendacao[];
  mistura_sugerida: Mistura | null;
  sinais_para_medir: string[];
  limites: string[];
  fontes: Fonte[];
  /** O texto curto gravado em `diagnostico` junto com este JSON: a tela sabe se a conversa mudou o texto depois. */
  texto_base?: string;
};

// ------------------------------------------------------------------ normalização

/** Tira travessão e espaço sobrando (regra do dono). */
export const semTravessao = (t: string) => t.replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/\s+/g, " ").trim();
const txt = (v: unknown, max: number) => (typeof v === "string" ? semTravessao(v).slice(0, max) : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const URL_OK = /^https?:\/\/[^\s]+$/i;

/** Links http(s) de um texto livre (a pesquisa das frentes), sem repetir. */
export function urlsDoTexto(t: unknown): string[] {
  const s = typeof t === "string" ? t : "";
  const achados = s.match(/https?:\/\/[^\s)\]}>"'<,]+/gi) ?? [];
  const saida: string[] = [];
  for (const u of achados) {
    const limpo = u.replace(/[.;:!?]+$/, "");
    if (saida.indexOf(limpo) < 0) saida.push(limpo);
  }
  return saida;
}

function unicos<T>(itens: T[], chave: (t: T) => string, max: number): T[] {
  const vistos: string[] = [];
  const saida: T[] = [];
  for (const i of itens) {
    const k = chave(i).toLowerCase();
    if (!k || vistos.indexOf(k) >= 0) continue;
    vistos.push(k);
    saida.push(i);
    if (saida.length >= max) break;
  }
  return saida;
}

/** Mistura em porcentagem que soma 100 (ou null sem número). */
export function normalizarMistura(v: unknown): Mistura | null {
  const m = rec(v);
  const n = (x: unknown) => (typeof x === "number" && isFinite(x) && x > 0 ? x : 0);
  const topo = n(m.topo), meio = n(m.meio), fundo = n(m.fundo);
  const soma = topo + meio + fundo;
  if (soma <= 0) return null;
  const t = Math.round((topo / soma) * 100);
  const me = Math.round((meio / soma) * 100);
  return { topo: t, meio: me, fundo: Math.max(0, 100 - t - me), justificativa: txt(m.justificativa, 400) };
}

/** Valida e limpa o JSON do modelo. Null quando não sobra nem o resumo. */
export function normalizarDiagnostico(bruto: unknown, opcoes: { fontesExtras?: string[]; origem?: "pesquisa" | "frentes"; agora?: Date } = {}): DiagnosticoEstruturado | null {
  const r = rec(bruto);
  const resumo = txt(r.resumo, 500);
  if (!resumo) return null;
  const pontos = (v: unknown) =>
    unicos(arr(v).map((x) => ({ ponto: txt(rec(x).ponto, 200), evidencia: txt(rec(x).evidencia, 300) })).filter((x) => x.ponto), (x) => x.ponto, 6);
  const fontesModelo = arr(r.fontes)
    .map((x) => ({ titulo: txt(rec(x).titulo, 140), url: String(rec(x).url ?? "").trim() }))
    .filter((f) => URL_OK.test(f.url));
  const fontesExtras = (opcoes.fontesExtras ?? []).filter((u) => URL_OK.test(u)).map((url) => ({ titulo: "", url }));
  const tendencias = unicos(
    arr(r.tendencias_do_nicho).map((x) => {
      const fonte = String(rec(x).fonte ?? "").trim();
      return { tendencia: txt(rec(x).tendencia, 200), como_usar: txt(rec(x).como_usar, 300), fonte: URL_OK.test(fonte) ? fonte : null };
    }).filter((x) => x.tendencia),
    (x) => x.tendencia,
    6,
  );
  return {
    versao: VERSAO_DIAGNOSTICO,
    origem: opcoes.origem ?? "pesquisa",
    gerado_em: (opcoes.agora ?? new Date()).toISOString(),
    resumo,
    o_que_funciona: pontos(r.o_que_funciona),
    o_que_nao_funciona: pontos(r.o_que_nao_funciona),
    oportunidades_do_mes: unicos(
      arr(r.oportunidades_do_mes).map((x) => {
        const d = String(rec(x).data ?? "").trim();
        return { data: DATA.test(d) ? d : null, tema: txt(rec(x).tema, 200), por_que: txt(rec(x).por_que, 300) };
      }).filter((x) => x.tema),
      (x) => `${x.data ?? ""}|${x.tema}`,
      8,
    ).sort((a, b) => (a.data ?? "9999") < (b.data ?? "9999") ? -1 : (a.data ?? "9999") > (b.data ?? "9999") ? 1 : 0),
    tendencias_do_nicho: tendencias,
    recomendacoes: unicos(
      arr(r.recomendacoes).map((x) => {
        const p = String(rec(x).prioridade ?? "");
        return { acao: txt(rec(x).acao, 240), por_que: txt(rec(x).por_que, 300), prioridade: (p === "alta" || p === "baixa" ? p : "media") as Recomendacao["prioridade"] };
      }).filter((x) => x.acao),
      (x) => x.acao,
      7,
    ).sort((a, b) => ORDEM_PRIORIDADE[a.prioridade] - ORDEM_PRIORIDADE[b.prioridade]),
    mistura_sugerida: normalizarMistura(r.mistura_sugerida),
    sinais_para_medir: unicos(arr(r.sinais_para_medir).map((x) => txt(x, 200)).filter(Boolean), (x) => x, 6),
    limites: unicos(arr(r.limites).map((x) => txt(x, 240)).filter(Boolean), (x) => x, 5),
    fontes: unicos([...fontesModelo, ...tendencias.filter((t) => t.fonte).map((t) => ({ titulo: "", url: t.fonte as string })), ...fontesExtras], (f) => f.url, 12),
  };
}

const ORDEM_PRIORIDADE: Record<Recomendacao["prioridade"], number> = { alta: 0, media: 1, baixa: 2 };

// ------------------------------------------------------------------ texto curto (compatibilidade)

const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/**
 * O `diagnostico` em texto curto: a tela antiga, o detalhar ("DIAGNÓSTICO JÁ
 * FEITO"), o Jev e o agente do mês continuam lendo este campo.
 */
export function textoCurtoDoDiagnostico(d: DiagnosticoEstruturado, extras: { publicos?: string[]; pilares?: string[]; hipoteses?: string[] } = {}, max = 2800): string {
  const linhas: string[] = [d.resumo];
  const bloco = (titulo: string, itens: string[]) => {
    if (itens.length) linhas.push(`${titulo}: ${itens.join("; ")}.`);
  };
  bloco("Funciona", d.o_que_funciona.slice(0, 3).map((p) => (p.evidencia ? `${p.ponto} (${p.evidencia})` : p.ponto)));
  bloco("Não funciona", d.o_que_nao_funciona.slice(0, 3).map((p) => (p.evidencia ? `${p.ponto} (${p.evidencia})` : p.ponto)));
  bloco("Oportunidades", d.oportunidades_do_mes.slice(0, 5).map((o) => (o.data ? `${dataBr(o.data)} ${o.tema}` : o.tema)));
  bloco("Tendências", d.tendencias_do_nicho.slice(0, 3).map((t) => t.tendencia));
  bloco("Recomendações", d.recomendacoes.slice(0, 4).map((r) => r.acao));
  if (d.mistura_sugerida) linhas.push(`Mistura sugerida: topo ${d.mistura_sugerida.topo}%, meio ${d.mistura_sugerida.meio}%, fundo ${d.mistura_sugerida.fundo}%.`);
  bloco("Públicos prioritários", (extras.publicos ?? []).slice(0, 4));
  bloco("Pilares", (extras.pilares ?? []).slice(0, 5));
  bloco("Hipóteses (dado indisponível)", [...d.limites, ...(extras.hipoteses ?? [])].slice(0, 3));
  let saida = "";
  for (const l of linhas) {
    const prox = saida ? `${saida}\n\n${l}` : l;
    if (prox.length > max) break;
    saida = prox;
  }
  return saida;
}

// ------------------------------------------------------------------ reserva: das frentes

type TemaParaMistura = { fase: string; tema: string; sazonal?: boolean; data_sazonal?: string | null; por_que?: string };

/** Mistura real dos temas propostos: fase 1 é topo, 2 é meio e 3 é fundo. */
export function misturaDosTemas(temas: TemaParaMistura[]): Mistura | null {
  const conta = { topo: 0, meio: 0, fundo: 0 };
  for (const t of temas) {
    if (t.fase === "1") conta.topo++;
    else if (t.fase === "2") conta.meio++;
    else if (t.fase === "3") conta.fundo++;
  }
  const m = normalizarMistura(conta);
  return m ? { ...m, justificativa: `Proporção dos ${temas.length} temas propostos por fase do funil.` } : null;
}

/** Primeiras frases de um texto (sem cortar no meio da palavra). */
export function primeirasFrases(t: string, n = 2, max = 420): string {
  const limpo = semTravessao(String(t ?? "")).replace(/\n+/g, " ");
  const frases = limpo.match(/[^.!?]+[.!?]+/g) ?? (limpo ? [limpo] : []);
  let s = frases.slice(0, n).join(" ").trim();
  if (s.length > max) s = `${s.slice(0, max).replace(/\s+\S*$/, "")}...`;
  return s;
}

/**
 * Diagnóstico de reserva quando a pesquisa do mês falha ou atrasa: resumo da
 * fase 1, oportunidades dos temas sazonais, mistura real dos temas e os links
 * que as frentes citaram. Nada inventado: o que não existe fica vazio.
 */
export function diagnosticoDasFrentes(e: { textoFase1: string; temas: TemaParaMistura[]; pesquisas: string[]; hipoteses: string[]; motivo: string; agora?: Date }): DiagnosticoEstruturado | null {
  const resumo = primeirasFrases(e.textoFase1);
  if (!resumo) return null;
  const oportunidades = e.temas
    .filter((t) => t.sazonal && t.data_sazonal && DATA.test(t.data_sazonal))
    .map((t) => ({ data: t.data_sazonal as string, tema: t.tema, por_que: semTravessao(String(t.por_que ?? "")).slice(0, 300) }));
  const d = normalizarDiagnostico({ resumo }, { origem: "frentes", fontesExtras: e.pesquisas.flatMap(urlsDoTexto), agora: e.agora });
  if (!d) return null;
  d.oportunidades_do_mes = unicos(oportunidades, (o) => `${o.data}|${o.tema}`, 8).sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  d.mistura_sugerida = misturaDosTemas(e.temas);
  d.limites = unicos([e.motivo, ...e.hipoteses.map((h) => semTravessao(h).slice(0, 240))], (x) => x, 5);
  return d;
}

// ------------------------------------------------------------------ leitura do perfil (números do código)

type ItemCurto = { nome: string; motivo: string; formato?: string | number | null };
const itemCurto = (i: { nome: string; motivo: string; numeros?: Record<string, unknown> }): ItemCurto => ({
  nome: String(i.nome ?? "").slice(0, 90),
  motivo: semTravessao(String(i.motivo ?? "")).slice(0, 260),
  ...(i.numeros && i.numeros.formato != null ? { formato: i.numeros.formato as string } : {}),
});

type PostLido = { media_type: string | null; reach: number | null; saved: number | null; shares: number | null; comments_count: number | null; like_count: number | null };

const FORMATOS: Record<string, string> = { VIDEO: "vídeo (Reels)", REELS: "vídeo (Reels)", IMAGE: "imagem única", CAROUSEL_ALBUM: "carrossel" };

/** Média de alcance, salvamentos e envios por alcance em cada formato (só com 2 posts ou mais). */
export function porFormato(posts: PostLido[]): Array<{ formato: string; posts: number; alcance_medio: number; salvos_por_mil: number; envios_por_mil: number; comentarios_por_mil: number }> {
  const grupos = new Map<string, PostLido[]>();
  for (const p of posts) {
    if (typeof p.reach !== "number" || p.reach <= 0) continue;
    const f = FORMATOS[String(p.media_type ?? "").toUpperCase()] ?? (p.media_type ? String(p.media_type).toLowerCase() : "outro");
    grupos.set(f, [...(grupos.get(f) ?? []), p]);
  }
  const porMil = (l: PostLido[], campo: "saved" | "shares" | "comments_count") =>
    Math.round((l.reduce((s, p) => s + (Number(p[campo]) || 0) / (p.reach as number), 0) / l.length) * 10000) / 10;
  return [...grupos.entries()]
    .filter(([, l]) => l.length >= 2)
    .map(([formato, l]) => ({
      formato,
      posts: l.length,
      alcance_medio: Math.round(l.reduce((s, p) => s + (p.reach as number), 0) / l.length),
      salvos_por_mil: porMil(l, "saved"),
      envios_por_mil: porMil(l, "shares"),
      comentarios_por_mil: porMil(l, "comments_count"),
    }))
    .sort((a, b) => b.alcance_medio - a.alcance_medio);
}

/**
 * Leitura compacta do perfil para o prompt: base do perfil, formatos,
 * destaques, abaixo da média, sinais, aprendizados e anúncios. Tudo calculado
 * pelas regras de _shared/evolucao.ts; o modelo só interpreta.
 */
export function resumoDoPerfil(d: Pick<DesempenhoDoCliente, "periodo" | "organico" | "anuncios"> & { _posts?: PostLido[] }, leitura: LeituraDeEvolucao | null) {
  const semanas = d.organico.semanas ?? [];
  const primeira = semanas[0], ultima = semanas[semanas.length - 1];
  const posts = d._posts ?? [];
  return {
    periodo_lido: d.periodo,
    posts_no_periodo: d.organico.totais.posts,
    posts_medidos: d.organico.totais.posts_medidos,
    seguidores: d.organico.contas.map((c) => ({ conta: c.handle, seguidores: c.seguidores, variacao_no_periodo: c.seguidores_variacao })),
    semanas: semanas.length
      ? {
          quantas: semanas.length,
          alcance_primeira: primeira?.alcance ?? null,
          alcance_ultima: ultima?.alcance ?? null,
          seguidores_primeira: primeira?.seguidores ?? null,
          seguidores_ultima: ultima?.seguidores ?? null,
        }
      : null,
    totais: {
      salvos: d.organico.totais.salvos,
      compartilhamentos: d.organico.totais.compartilhamentos,
      comentarios: d.organico.totais.comentarios,
      curtidas: d.organico.totais.curtidas,
    },
    por_formato: porFormato(posts),
    base_do_perfil: leitura?.base.perfil ?? null,
    destaques: (leitura?.conteudo.destaques ?? []).slice(0, 5).map(itemCurto),
    abaixo_da_media: (leitura?.conteudo.abaixo ?? []).slice(0, 4).map(itemCurto),
    sinais: (leitura?.conteudo.sinais ?? []).slice(0, 5).map(itemCurto),
    aprendizados: (leitura?.aprendizados ?? []).slice(0, 8).map((a) => `${a.canal === "anuncios" ? "Anúncios" : "Perfil"}, ${a.tipo}: ${a.texto}`),
    anuncios: d.anuncios.conectada
      ? {
          investimento: d.anuncios.totais.gasto,
          resultados: d.anuncios.totais.resultados,
          resultado: d.anuncios.totais.resultado_rotulo,
          custo_por_resultado: d.anuncios.totais.custo_por_resultado,
          vencedores: (leitura?.vencedores ?? []).slice(0, 3).map(itemCurto),
          descartar: (leitura?.descartar ?? []).slice(0, 2).map(itemCurto),
        }
      : null,
    limites: leitura?.limites ?? [],
  };
}

// ------------------------------------------------------------------ pedido

/** O pedido da pesquisa do mês (vai depois do contexto do cliente, que é o mesmo das frentes). */
export function pedidoDoDiagnostico(e: {
  pedido: string;
  plano: string;
  datas: DataSazonal[];
  pautas: string[];
  perfil: unknown | null;
  perfilErro?: string | null;
}): string {
  return `TAREFA: pesquisa e diagnóstico do mês para o calendário. ${e.pedido}${e.plano}
Outras três chamadas, ao mesmo tempo, propõem os temas; ESTA faz só o diagnóstico, que a equipe lê antes de escolher os temas.

LEITURA DO PERFIL (calculada no código pelas mesmas regras da Mesa Ads; use estes números como evidência, sem arredondar para cima e sem inventar outros):
${e.perfil ? JSON.stringify(e.perfil) : `indisponível agora${e.perfilErro ? ` (${e.perfilErro})` : ""}; use as métricas do contexto e declare o limite.`}

DATAS DO BRASIL NO PERÍODO E LOGO DEPOIS (calculadas no código; escolha só as que se ligam a este cliente):
${e.datas.length ? e.datas.map((d) => `- ${d.data} ${d.nome}${d.dica ? ` (${d.dica})` : ""}`).join("\n") : "- nenhuma data da lista"}

PESQUISA NA WEB (faça antes de responder; troque [nicho] pelo nicho real do cliente, lido no dossiê, no kit e no cérebro; priorize as primeiras):
${e.pautas.map((p, i) => `${i + 1}. ${p}`).join("\n")}
Use fontes de 2025 e 2026. Cada tendência cita a fonte (link) de onde veio; sem fonte, não é tendência, vira hipótese em limites.

Devolva:
- resumo: 1 ou 2 frases, a leitura principal do perfil e o foco do mês.
- o_que_funciona e o_que_nao_funciona: de 2 a 5 cada, com a evidência em número da leitura do perfil (alcance, salvamentos, envios, comentários, formato). Sem dado, lista vazia e o motivo em limites.
- oportunidades_do_mes: de 3 a 8, com data (AAAA-MM-DD, dia útil quando for publicar; null quando não é data) e o tema ligado ao cliente.
- tendencias_do_nicho: de 2 a 5, com como_usar neste cliente e a fonte (link).
- recomendacoes: de 3 a 6 ações concretas para o mês (o que postar, em que formato, com que gancho ou CTA, em que proporção), com prioridade.
- mistura_sugerida: porcentagem de topo, meio e fundo que soma 100, pelo objetivo e pelos números, com a justificativa em uma frase.
- sinais_para_medir: de 2 a 4 métricas do mês, ligadas às recomendações.
- limites: o que faltou de dado ou o que é hipótese.
- fontes: os links usados (título curto e url).
Tudo em frases curtas, sem parágrafo longo, específico deste cliente. Formatos do calendário: só carrossel ou post estático.`;
}
