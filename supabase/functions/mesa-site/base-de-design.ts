/**
 * Base de design na Mesa Site (frente UXM, 30/09/2026): a base UI UX Pro Max
 * 2.15.0 escolhida por marca (sites.direcao.base_de_design). Arquivo à parte
 * para não engordar estrutura.ts; o index.ts registra as rotas.
 *
 * - base_sugerir { site_id } (Jev, não grava): requisição 1 com as listas
 *   completas (produto, estilo, padrão, par quando o kit não tem fontes e o
 *   preset da casa) e, se a política pedir, a requisição 2 (Score e Noul por
 *   estilo candidato). Sem o Jev: a sugestão das buscas exatas pelo produto
 *   guardado, com o aviso "escolha à mão".
 * - base_recalcular { site_id, produto, probabilidades } (sem IA): refaz a
 *   política com o produto que a pessoa escolheu, sem chamar o Jev de novo.
 * - base_salvar { site_id, produto?, estilo?, padrao?, par?, aplicar_preset?,
 *   sugestao?, restaurar? }: grava com versão (e Desfazer pela tela com
 *   `restaurar`); o estilo da base aplica o preset da casa ligado a ele.
 * - ux_marcar { site_id, regra, estado: ok|nao_se_aplica|null }: marcação
 *   manual da Revisão.
 * - serie_salvar { site_id, serie|null }: a série real (com fonte) do gráfico
 *   da seção de números.
 *
 * Julgamento é do Jev; o resto é busca exata. O uso do Jev fica registrado
 * (cobrarJev) como no preset e no mapa. Sem travessão.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { cobrarJev, custoJev } from "../_shared/ia-motor.ts";
import { jevPerguntar } from "../_shared/jev.ts";
import { lerContextoDaMarca, lerMarcaParaDirecaoDaMarca } from "../_shared/marca.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import type { LinhaDoSite } from "../_shared/pacote-do-site.ts";
import { normalizarEstilo } from "../_shared/site-biblioteca.ts";
import { estilosDaPersonalidade, type EstiloDeTipo } from "../_shared/tipografia-da-marca.ts";
import { normalizarEstrategia } from "../_shared/estrategia-de-marca.ts";
import { BASE_COMPLETA, comRotulos } from "../_shared/uiux/base-completa.ts";
import { type BaseDeDesign, baseHerdada, type EscolhaDaBase, lerBaseDaMarca, lerBaseDeDesign, lerSerieReal, validarBaseDeDesign } from "../_shared/uiux/consultas.ts";
import {
  candidatosDoRerank,
  type EstadoDaBase,
  MENSAGEM_SEM_JEV,
  notasDosEstilos,
  perguntasDaBase,
  perguntasDoRerank,
  probabilidadesDasRespostas,
  produtoDaSugestao,
  sugestaoDaBase,
  sugestaoSemJev,
  TOKENS_DA_BASE,
  TOKENS_DO_RERANK,
} from "../_shared/uiux/jev-da-base.ts";
import { modoDaRegra, PRESET_DO_ESTILO } from "../_shared/uiux/mapeamentos.ts";
import { camposDoEstilo } from "./estrutura-pura.ts";
import { type ChamadorDaEstrutura, type ContextoDaEstrutura, mudarComVersao } from "./estrutura.ts";

const PAPEL = "site" as const;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const texto = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const arred = (v: number) => Math.round(v * 1e6) / 1e6;

export const ACOES_LONGAS_DA_BASE = ["base_sugerir"];

/** Custo antes (o Jev cobra só a entrada). */
export function estimarDaBase(alvo: string): { estimativa_usd: number; modelo_id: string } | null {
  if (alvo !== "base") return null;
  return { estimativa_usd: arred(custoJev(TOKENS_DA_BASE + TOKENS_DO_RERANK)), modelo_id: "jev" };
}

/** O projeto de Identidade da MESMA marca (a outra marca nunca herda). */
export async function identidadeDaMarca(db: SupabaseClient, clientId: string, marcaId: string | null): Promise<Record<string, unknown> | null> {
  let q = db.from("idv_projetos").select("id, marca_id, dados, atualizado_em").eq("client_id", clientId).is("arquivado_em", null);
  q = marcaId ? q.eq("marca_id", marcaId) : q.is("marca_id", null);
  const { data, error } = await q.order("atualizado_em", { ascending: false }).limit(1);
  if (error) {
    registrarFalha("mesa-site: identidade da marca não lida", error, { client_id: clientId });
    return null;
  }
  const linha = ((data as Array<Record<string, unknown>> | null) ?? [])[0];
  return linha ? obj(linha.dados) : null;
}

/**
 * O base_de_design com que um site novo nasce: o do último site da mesma
 * marca; sem ele, o produto e o par da Identidade dessa marca; sem nada, null.
 */
export async function baseInicialDoSite(db: SupabaseClient, clientId: string, marcaId: string | null): Promise<BaseDeDesign | null> {
  try {
    let q = db.from("sites").select("direcao, marca_id, atualizado_em").eq("client_id", clientId).is("arquivado_em", null);
    q = marcaId ? q.eq("marca_id", marcaId) : q.is("marca_id", null);
    const { data, error } = await q.order("atualizado_em", { ascending: false }).limit(1);
    if (error) throw error;
    const ultimo = ((data as Array<Record<string, unknown>> | null) ?? [])[0];
    if (ultimo) {
      // Herda as escolhas; a sugestão do Jev (probabilidades) e as marcações de UX são do site antigo e ficam lá.
      const b = baseHerdada(validarBaseDeDesign(BASE_COMPLETA, lerBaseDeDesign(obj(ultimo.direcao).base_de_design)));
      if (b.produto || b.estilo || b.padrao || b.par) return comRotulos(b);
    }
    const idv = await identidadeDaMarca(db, clientId, marcaId);
    const daMarca = lerBaseDaMarca(obj(obj(idv).sistema).base_de_design);
    if (daMarca.produto || daMarca.par) return comRotulos(validarBaseDeDesign(BASE_COMPLETA, { versao: daMarca.versao, produto: daMarca.produto, estilo: null, padrao: null, par: daMarca.par, ux: {} }));
    return null;
  } catch (e) {
    registrarFalha("mesa-site: base inicial do site", e, { client_id: clientId });
    return null;
  }
}

/** O estado do Jev pela regra de marca (contexto, briefing do site, referências e a estratégia da Identidade da mesma marca). */
async function estadoDaBase(ctx: ContextoDaEstrutura, s: LinhaDoSite): Promise<{ estado: EstadoDaBase; kitTemFontes: boolean; estilosDeTipo: EstiloDeTipo[] }> {
  const marca = await ctx.marcaDoSite(s);
  const [c, direcao, idv] = await Promise.all([
    lerContextoDaMarca(ctx.servico(), s.client_id, marca).catch((e) => (registrarFalha("mesa-site: contexto da base", e), {})),
    lerMarcaParaDirecaoDaMarca(ctx.servico(), s.client_id, marca),
    identidadeDaMarca(ctx.servico(), s.client_id, s.marca_id),
  ]);
  const co = obj(c);
  const est = normalizarEstrategia(obj(idv).estrategia);
  const respostas = obj(obj(s.briefing).respostas);
  const briefing: Record<string, string> = {};
  for (const k of Object.keys(respostas).slice(0, 20)) briefing[k] = texto(respostas[k], 500);
  const cit = direcao.tipografiaCitada as { titulo?: string | null; texto?: string | null } | null;
  const kitTemFontes = direcao.fontes.length > 0 || !!(cit && (cit.titulo || cit.texto));
  const arquetipo = est.arquetipo.principal || "";
  const estilosDeTipo = estilosDaPersonalidade({ arquetipo: arquetipo || undefined, eixos: est.personalidade.eixos });
  return {
    estado: {
      marca: {
        nome: marca ? marca.nome : s.nome,
        negocio: texto(co.negocio, 800) || null,
        publico: texto(co.publico, 600) || null,
        oferta: texto(co.oferta, 600) || null,
        tom: texto(co.tom_de_voz || direcao.tomDeVoz, 200) || null,
        diferenciais: Array.isArray(co.diferenciais) ? (co.diferenciais as unknown[]).slice(0, 6).map((d) => texto(d, 160)) : [],
        arquetipo: arquetipo || null,
        eixos: est.personalidade.eixos as unknown as Record<string, number>,
      },
      site: { tipo: s.tipo || null, nicho: texto(obj(s.direcao).nicho || obj(s.dna).nicho, 40) || null, objetivo: texto(respostas.objetivo, 400) || null, evitar: texto(respostas.evitar, 400) || null },
      briefing,
      referencias: texto(obj(s.dna).observacoes, 2000) || null,
      kit: { tem_paleta: direcao.paleta.length > 0, tem_fontes: kitTemFontes },
    },
    kitTemFontes,
    estilosDeTipo,
  };
}

/** As duas requisições do Jev (a segunda só quando a política pede). Lança se a primeira falhar. */
export async function perguntarABase(ctx: ContextoDaEstrutura, ch: ChamadorDaEstrutura, s: LinhaDoSite, estado: EstadoDaBase, kitTemFontes: boolean) {
  const r1 = await jevPerguntar({ state: estado, questions: perguntasDaBase(BASE_COMPLETA, { par: !kitTemFontes }) });
  let custo = 0;
  const c1 = await cobrarJev(r1, { clientId: s.client_id, tarefa: PAPEL, referencia: { tipo: "site", id: s.id }, criadoPor: ch.userId });
  custo += c1 ? c1.custoUsd : 0;
  let probs = probabilidadesDasRespostas(r1.answers);
  let aviso: string | null = null;
  const produto = produtoDaSugestao(probs, {});
  const candidatos = candidatosDoRerank(BASE_COMPLETA, notasDosEstilos(BASE_COMPLETA, probs, produto.escolhido ? produto.escolhido.id : null));
  if (candidatos.length) {
    try {
      const r2 = await jevPerguntar({ state: estado, questions: perguntasDoRerank(BASE_COMPLETA, candidatos) });
      const c2 = await cobrarJev(r2, { clientId: s.client_id, tarefa: PAPEL, referencia: { tipo: "site", id: s.id }, criadoPor: ch.userId });
      custo += c2 ? c2.custoUsd : 0;
      probs = { ...probs, ...probabilidadesDasRespostas(r2.answers) };
    } catch (e) {
      registrarFalha("mesa-site: Jev do rerank da base", e, { site_id: s.id });
      aviso = "O Jev não refinou os estilos: a lista usa só a primeira leitura.";
    }
  }
  return { probs, custo: arred(custo), aviso };
}

/** Nome e famílias dos pares sugeridos (a tela não carrega a base de pares). */
const paresInfo = (ids: string[]) =>
  ids
    .map((no) => BASE_COMPLETA.pares.filter((x) => x.no === no)[0])
    .filter((x) => !!x)
    .map((x) => ({ no: x.no, nome: x.nome, titulo: x.titulo, texto: x.texto }));

async function baseSugerir(ctx: ContextoDaEstrutura, ch: ChamadorDaEstrutura, c: Record<string, unknown>) {
  const s = await ctx.lerSite(ch, c.site_id);
  const { estado, kitTemFontes, estilosDeTipo } = await estadoDaBase(ctx, s);
  const guardada = lerBaseDeDesign(obj(s.direcao).base_de_design);
  const politica = { tipo: s.tipo || null, kitTemFontes, estilosDaPersonalidade: estilosDeTipo };
  try {
    const r = await perguntarABase(ctx, ch, s, estado, kitTemFontes);
    const sugestao = sugestaoDaBase(BASE_COMPLETA, r.probs, politica);
    return ctx.json({ sugestao, pares_info: paresInfo((sugestao.pares || []).map((x) => x.id)), probabilidades: r.probs, sem_jev: false, kit_tem_fontes: kitTemFontes, aviso: r.aviso, custo_usd: r.custo });
  } catch (e) {
    // Sem o Jev: nada é chutado. A pessoa escolhe o produto na lista; o resto sai das buscas exatas.
    registrarFalha("mesa-site: Jev da base de design", e, { site_id: s.id });
    const produto = guardada.produto ? guardada.produto.id : null;
    const sugestao = sugestaoSemJev(BASE_COMPLETA, produto, politica);
    return ctx.json({ sugestao, pares_info: paresInfo((sugestao.pares || []).map((x) => x.id)), probabilidades: {}, sem_jev: true, kit_tem_fontes: kitTemFontes, aviso: MENSAGEM_SEM_JEV, custo_usd: 0 });
  }
}

async function baseRecalcular(ctx: ContextoDaEstrutura, ch: ChamadorDaEstrutura, c: Record<string, unknown>) {
  const s = await ctx.lerSite(ch, c.site_id);
  const produto = texto(c.produto, 6);
  if (produto && !BASE_COMPLETA.produtos.some((p) => p.no === produto)) throw ctx.erro(400, "produto_invalido", "Esse tipo de produto não existe na base.");
  const { kitTemFontes, estilosDeTipo } = await estadoDaBase(ctx, s);
  const probs = lerBaseDeDesign({ sugestao: { em: "x", probabilidades: c.probabilidades } }).sugestao;
  const politica = { produtoDaEquipe: produto || null, tipo: s.tipo || null, kitTemFontes, estilosDaPersonalidade: estilosDeTipo };
  const temProbs = probs && Object.keys(probs.probabilidades).length > 0;
  const sugestao = temProbs ? sugestaoDaBase(BASE_COMPLETA, probs!.probabilidades, politica) : sugestaoSemJev(BASE_COMPLETA, produto || null, politica);
  return ctx.json({ sugestao, pares_info: paresInfo((sugestao.pares || []).map((x) => x.id)), kit_tem_fontes: kitTemFontes, custo_usd: 0 });
}

const escolhaDoPedido = (v: unknown, origemPadrao: "jev" | "equipe"): EscolhaDaBase | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v === "string") return { id: v, origem: origemPadrao };
  const o = obj(v);
  return lerBaseDeDesign({ produto: { ...o, origem: o.origem === "jev" ? "jev" : "equipe" } }).produto;
};

async function baseSalvar(ctx: ContextoDaEstrutura, ch: ChamadorDaEstrutura, c: Record<string, unknown>) {
  const s = await ctx.lerSite(ch, c.site_id);
  const direcao = obj(s.direcao);
  const anterior = { base_de_design: direcao.base_de_design ?? null, estilo: s.estilo ?? {}, dna: s.dna ?? {} };
  if (c.restaurar !== undefined) {
    // Desfazer da tela: volta o que estava (base, estilo e DNA), com versão.
    const r = obj(c.restaurar);
    const base = r.base_de_design ? validarBaseDeDesign(BASE_COMPLETA, lerBaseDeDesign(r.base_de_design)) : null;
    const campos: Record<string, unknown> = { direcao: { ...direcao, base_de_design: base }, pacote_mudou_em: new Date().toISOString() };
    if (r.estilo !== undefined) campos.estilo = normalizarEstilo(r.estilo);
    if (r.dna !== undefined && r.dna && typeof r.dna === "object") campos.dna = r.dna;
    const v = await mudarComVersao(ctx, ch, s, campos, "desfazer a base de design");
    return ctx.json({ site: v.site, anterior, aviso_versao: v.aviso_versao, custo_usd: 0 });
  }
  const atual = lerBaseDeDesign(direcao.base_de_design);
  const nova: BaseDeDesign = { ...atual };
  const origem = c.origem === "jev" ? "jev" : "equipe";
  for (const k of ["produto", "estilo", "padrao", "par"] as const) {
    const e = escolhaDoPedido(c[k], origem);
    if (e !== undefined) nova[k] = e;
  }
  if (c.sugestao !== undefined) {
    const sug = lerBaseDeDesign({ sugestao: { em: new Date().toISOString(), probabilidades: obj(c.sugestao).probabilidades } }).sugestao;
    if (sug && Object.keys(sug.probabilidades).length) nova.sugestao = sug;
  }
  const validada = validarBaseDeDesign(BASE_COMPLETA, nova);
  for (const k of ["produto", "estilo", "padrao", "par"] as const) {
    if (nova[k] && !validada[k]) throw ctx.erro(400, "base_invalida", `A escolha de ${k} não existe na base UI UX Pro Max 2.15.0.`);
  }
  const campos: Record<string, unknown> = { direcao: { ...direcao, base_de_design: comRotulos(validada) }, pacote_mudou_em: new Date().toISOString() };
  // O estilo da base aplica o preset da casa ligado a ele (prévia) e o DNA DO ESTILO (não o do preset: 14 estilos
  // caem no mesmo preset e o DNA é o que os diferencia no motor); a equipe troca o preset depois sem perder o estilo.
  const mudouEstilo = validada.estilo && (!atual.estilo || atual.estilo.id !== validada.estilo.id);
  if (mudouEstilo && c.aplicar_preset !== false) {
    const lig = PRESET_DO_ESTILO[validada.estilo!.id];
    if (lig) Object.assign(campos, camposDoEstilo(s, { preset: lig.preset, aplicarDna: true, atributos: lig.dna }));
  }
  const v = await mudarComVersao(ctx, ch, s, campos, "base de design");
  return ctx.json({ site: v.site, anterior, aviso_versao: v.aviso_versao, custo_usd: 0 });
}

async function uxMarcar(ctx: ContextoDaEstrutura, ch: ChamadorDaEstrutura, c: Record<string, unknown>) {
  const s = await ctx.lerSite(ch, c.site_id);
  const regra = texto(c.regra, 20).replace(/^uupm:ux:/, "");
  if (!/^\d{1,3}$/.test(regra) || !BASE_COMPLETA.uxCompleta.some((r) => r.no === regra && (r.plataforma === "Web" || r.plataforma === "All"))) throw ctx.erro(400, "regra_invalida", "Essa regra de UX não existe na base.");
  if (modoDaRegra(regra).modo === "codigo" && c.estado === "ok") throw ctx.erro(409, "regra_do_codigo", "Esta regra é conferida pelo código na revisão; marque só \"não se aplica\".");
  const direcao = obj(s.direcao);
  const b = lerBaseDeDesign(direcao.base_de_design);
  const ux = { ...b.ux };
  if (c.estado === "ok" || c.estado === "nao_se_aplica") ux[regra] = c.estado;
  else delete ux[regra];
  const site = await ctx.atualizarSite(s.id, { direcao: { ...direcao, base_de_design: { ...b, ux } } });
  return ctx.json({ site, custo_usd: 0 });
}

async function serieSalvar(ctx: ContextoDaEstrutura, ch: ChamadorDaEstrutura, c: Record<string, unknown>) {
  const s = await ctx.lerSite(ch, c.site_id);
  const conteudo = obj(s.conteudo);
  if (c.serie === null) {
    const { serie_real: _fora, ...resto } = conteudo;
    const v = await mudarComVersao(ctx, ch, s, { conteudo: resto, pacote_mudou_em: new Date().toISOString() }, "tirar a série do gráfico");
    return ctx.json({ site: v.site, aviso_versao: v.aviso_versao, custo_usd: 0 });
  }
  const serie = lerSerieReal(c.serie);
  if (!serie) throw ctx.erro(400, "serie_invalida", "O gráfico pede ao menos 2 números reais com rótulo e a fonte (briefing, dossiê ou arquivo).");
  const v = await mudarComVersao(ctx, ch, s, { conteudo: { ...conteudo, serie_real: serie }, pacote_mudou_em: new Date().toISOString() }, "série do gráfico");
  return ctx.json({ site: v.site, aviso_versao: v.aviso_versao, custo_usd: 0 });
}

export function rotasDaBase(ctx: ContextoDaEstrutura): Record<string, (ch: ChamadorDaEstrutura, c: Record<string, unknown>) => Promise<Response>> {
  return {
    base_sugerir: (ch, c) => baseSugerir(ctx, ch, c),
    base_recalcular: (ch, c) => baseRecalcular(ctx, ch, c),
    base_salvar: (ch, c) => baseSalvar(ctx, ch, c),
    ux_marcar: (ch, c) => uxMarcar(ctx, ch, c),
    serie_salvar: (ch, c) => serieSalvar(ctx, ch, c),
  };
}
