import { duracaoDoClipe, type FonteDoProjeto, type ProjetoDeEdicao, type TipoDeTrilha } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { BIBLIOTECA_DE_SONS, caminhoDoSom, chaveDoSom, planoDeSons, somPorId, type EventoDeMovimento } from "../../../../supabase/functions/mesa-motion/modulos/som-do-editor";
import { colide, fimDoClipe } from "../operacoes";
import { arred } from "../tempo";
import { falaNaLinhaDoTempo } from "../transcricao";
import type { Montador } from "../skills/tipos";
import { acharNaFala, definicaoDaPeca, noQuadroDoProjeto, numeroFoiDito, parametrosDaPeca, temposDosItens, type IdDaPeca } from "./catalogo";

/**
 * Motion, logo, efeitos e trilha na linha do tempo (frente EDT, F3). Funções
 * que montam operações num Montador (a mesma porta das skills): nada muda
 * sem a proposta, tudo desfaz num passo.
 */

export const NOME_DA_TRILHA_DE_MOTION = "Motion";
export const NOME_DA_TRILHA_DE_EFEITOS = "Efeitos";
export const NOME_DA_TRILHA_DE_MUSICA = "Trilha";
export const CHAVE_DA_LOGO = "logo-do-cliente";

/** Trilha do tipo e nome dados onde [ini, fim) cabe; sem nenhuma, cria (com o nome). */
export function trilhaLivre(m: Montador, tipo: TipoDeTrilha, nome: string, ini: number, fim: number): string {
  const livre = m.projeto.trilhas.find((t) => t.tipo === tipo && t.nome.indexOf(nome) === 0 && !colide(t, ini, fim));
  if (livre) return livre.id;
  const antes = m.projeto.trilhas.map((t) => t.id);
  m.aplicar({ op: "trilha_nova", tipo });
  const nova = m.projeto.trilhas.find((t) => antes.indexOf(t.id) < 0);
  if (!nova) throw new Error("Não deu para criar a trilha.");
  const iguais = m.projeto.trilhas.filter((t) => t.tipo === tipo && t.nome.indexOf(nome) === 0).length;
  m.aplicar({ op: "trilha", trilha: nova.id, campos: { nome: iguais ? `${nome} ${iguais + 1}` : nome } });
  return nova.id;
}

export interface PedidoDePeca {
  peca: IdDaPeca;
  /** Expressão dita onde a peça entra (o tempo sai da palavra medida). */
  palavra_ref?: string | null;
  /** Sem palavra: tempo da linha. */
  inicio_s?: number | null;
  duracao_s?: number | null;
  params?: Record<string, unknown> | null;
  /** Fonte da imagem (polaroide, logo). */
  fonte?: string | null;
}

/**
 * Põe uma peça no tempo da palavra dita. Número, porcentagem e preço só entram
 * se foram DITOS no trecho (a peça não inventa dado). Lança Error com o motivo.
 */
export function porPeca(m: Montador, pedido: PedidoDePeca): { clipe: string; inicio_s: number; duracao_s: number } {
  const d = definicaoDaPeca(pedido.peca);
  if (!d) throw new Error(`Peça desconhecida: ${pedido.peca}.`);
  const p = m.projeto;
  const fala = falaNaLinhaDoTempo(p);
  let inicio: number | null = null;
  if (pedido.palavra_ref) {
    const achou = acharNaFala(fala, pedido.palavra_ref);
    if (!achou) throw new Error(`"${pedido.palavra_ref}" não foi dito na fala marcada. Diga outra expressão ou o tempo.`);
    inicio = achou.i;
  } else if (typeof pedido.inicio_s === "number" && isFinite(pedido.inicio_s)) inicio = Math.max(0, pedido.inicio_s);
  if (inicio === null) throw new Error("Diga a palavra (dita) ou o tempo em que a peça entra.");
  inicio = noQuadroDoProjeto(inicio, p.fps);
  const dur = noQuadroDoProjeto(Math.max(0.6, Math.min(12, Number(pedido.duracao_s) || d.duracao_s)), p.fps);
  const params = parametrosDaPeca(pedido.peca, pedido.params || {});
  const trechoDito = fala.filter((w) => w.i >= inicio! - 1.5 && w.i <= inicio! + dur + 2).map((w) => w.t).join(" ");
  const numero = pedido.peca === "contador" ? params.ate : pedido.peca === "barra" ? params.valor : null;
  if (typeof numero === "number" && !numeroFoiDito(numero, trechoDito)) throw new Error(`O número ${numero} não foi dito nesse trecho: a peça não inventa dado.`);
  if (pedido.peca === "preco" && typeof params.por === "string") {
    const n = Number(String(params.por).replace(/[^0-9,]/g, "").replace(",", "."));
    if (isFinite(n) && n > 0 && !numeroFoiDito(n, trechoDito) && !numeroFoiDito(Math.round(n), trechoDito)) throw new Error(`O preço ${params.por} não foi dito nesse trecho.`);
  }
  let tempos: number[] | undefined;
  const itens = Array.isArray(params.itens) ? (params.itens as string[]) : Array.isArray(params.palavras) ? (params.palavras as string[]) : null;
  if (itens) tempos = temposDosItens(itens, fala, inicio, dur);
  if (pedido.fonte && !p.fontes[pedido.fonte]) throw new Error("A imagem da peça não está no projeto.");
  const trilha = trilhaLivre(m, "sobreposicao", NOME_DA_TRILHA_DE_MOTION, inicio, inicio + dur);
  const antes = new Set(m.projeto.trilhas.reduce((l, t) => l.concat(t.clipes.map((c) => c.id)), [] as string[]));
  m.aplicar({
    op: "inserir",
    trilha,
    clipe: {
      inicio_s: inicio,
      entrada_s: 0,
      saida_s: dur,
      fonte: pedido.fonte || null,
      estilo: { peca: pedido.peca, params, ...(tempos ? { tempos } : {}) },
      origem: { tipo: "skill", ref: `motion:${pedido.peca}` },
    },
  });
  const t = m.projeto.trilhas.find((x) => x.id === trilha);
  const novo = t ? t.clipes.find((c) => !antes.has(c.id)) : null;
  return { clipe: novo ? novo.id : "", inicio_s: inicio, duracao_s: dur };
}

/** Logo do cliente (do kit da marca aberta; entra pelo código, nunca pelo gerador). */
export function porLogo(m: Montador, logo: { storage_path: string; nome?: string | null }, onde: "canto" | "cartao_final" | "sting"): { inicio_s: number; duracao_s: number } {
  const p = m.projeto;
  if (!p.fontes[CHAVE_DA_LOGO] || p.fontes[CHAVE_DA_LOGO].storage_path !== logo.storage_path) {
    const fonte: FonteDoProjeto = { chave: CHAVE_DA_LOGO, arquivo_id: null, nome: logo.nome || "Logo do cliente", tipo: "quadro", storage_bucket: "mesa", storage_path: logo.storage_path, duracao_s: null, largura: null, altura: null, midia: "imagem" };
    m.aplicar({ op: "fonte", fonte });
  }
  const total = Math.max(1, m.projeto.duracao_s);
  const q = (s: number) => noQuadroDoProjeto(s, p.fps);
  const inicio = onde === "cartao_final" ? q(Math.max(0, total - 3)) : 0;
  const dur = onde === "canto" ? q(total) : onde === "sting" ? q(Math.min(1.6, total)) : q(Math.min(3, total));
  const trilha = trilhaLivre(m, "sobreposicao", NOME_DA_TRILHA_DE_MOTION, inicio, inicio + dur);
  m.aplicar({ op: "inserir", trilha, clipe: { inicio_s: inicio, entrada_s: 0, saida_s: dur, fonte: CHAVE_DA_LOGO, estilo: { peca: "logo", params: { onde } }, origem: { tipo: "skill", ref: "motion:logo" } } });
  return { inicio_s: inicio, duracao_s: dur };
}

/** Fonte de um som da biblioteca (mora no painel, bucket "publico"). */
export function fonteDoSom(id: string): FonteDoProjeto | null {
  const s = somPorId(id);
  if (!s) return null;
  return { chave: chaveDoSom(s.id), arquivo_id: null, nome: `Som: ${s.rotulo}`, tipo: "audio", storage_bucket: "publico", storage_path: caminhoDoSom(s), duracao_s: s.duracao_s, largura: null, altura: null, midia: "audio" };
}

/** Eventos de movimento: cada peça de motion no auge da entrada, com o som do catálogo. */
export function eventosDasPecas(p: ProjetoDeEdicao): EventoDeMovimento[] {
  const saida: EventoDeMovimento[] = [];
  p.trilhas
    .filter((t) => t.tipo === "sobreposicao" && !t.oculta)
    .forEach((t) =>
      t.clipes.forEach((c) => {
        const e = (c.estilo || {}) as Record<string, unknown>;
        const d = typeof e.peca === "string" ? definicaoDaPeca(e.peca) : null;
        if (!d) return;
        if (d.id === "logo" && (e.params as Record<string, unknown> | undefined)?.onde === "canto") return;
        saida.push({ pico_s: arred(c.inicio_s + d.pico_s), som: typeof e.som === "string" && somPorId(e.som) ? e.som : d.som, prioridade: d.prioridade, ref: c.id });
      }),
    );
  return saida;
}

/**
 * Efeitos sonoros casados: tira os efeitos que a skill pôs antes e põe de novo
 * pelo plano (pico do som no quadro do auge do movimento, 0,65 s entre eles).
 */
export function porEfeitos(m: Montador, modo: "casados" | "poucos" = "casados"): number {
  m.projeto.trilhas.forEach((t) =>
    t.clipes
      .filter((c) => t.tipo === "audio" && c.estilo && (c.estilo as Record<string, unknown>).papel === "efeito")
      .map((c) => c.id)
      .forEach((id) => m.aplicar({ op: "remover", clipe: id })),
  );
  const plano = planoDeSons(eventosDasPecas(m.projeto), { modo, fps: m.projeto.fps });
  plano.forEach((x) => {
    const f = fonteDoSom(x.som);
    const s = somPorId(x.som);
    if (!f || !s) return;
    if (!m.projeto.fontes[f.chave]) m.aplicar({ op: "fonte", fonte: f });
    const fim = x.inicio_s + s.duracao_s;
    const trilha = trilhaLivre(m, "audio", NOME_DA_TRILHA_DE_EFEITOS, x.inicio_s, fim);
    m.aplicar({ op: "inserir", trilha, clipe: { inicio_s: x.inicio_s, entrada_s: 0, saida_s: s.duracao_s, fonte: f.chave, volume: 0.8, estilo: { papel: "efeito", som: s.id, pico_s: x.pico_s }, origem: { tipo: "skill", ref: `som:${s.id}` } } });
  });
  return plano.length;
}

/**
 * Trilha (música da Mídia do cliente, licença conferida pela equipe): do começo
 * ao fim do vídeo, 22 dB abaixo da voz (medida no render) e sobe nas pausas.
 */
export function porTrilha(m: Montador, fonte: string, abaixoDb?: number | null): { duracao_s: number } {
  const f = m.projeto.fontes[fonte];
  if (!f) throw new Error("Essa música não está no projeto. Ponha pela Mídia primeiro.");
  if (f.midia !== "audio") throw new Error(`${f.nome} não é um áudio.`);
  m.projeto.trilhas.forEach((t) =>
    t.clipes
      .filter((c) => t.tipo === "audio" && c.estilo && (c.estilo as Record<string, unknown>).papel === "trilha")
      .map((c) => c.id)
      .forEach((id) => m.aplicar({ op: "remover", clipe: id })),
  );
  const principal = m.projeto.trilhas.find((t) => t.tipo === "video");
  const total = principal ? principal.clipes.reduce((x, c) => Math.max(x, fimDoClipe(c)), 0) : m.projeto.duracao_s;
  const dur = noQuadroDoProjeto(Math.min(total || 0, f.duracao_s || total || 0), m.projeto.fps);
  if (dur <= 0) throw new Error("Sem duração para a trilha (linha do tempo vazia ou música sem duração lida).");
  const trilha = trilhaLivre(m, "audio", NOME_DA_TRILHA_DE_MUSICA, 0, dur);
  m.aplicar({ op: "inserir", trilha, clipe: { inicio_s: 0, entrada_s: 0, saida_s: dur, fonte, estilo: { papel: "trilha" }, origem: { tipo: "skill", ref: "trilha" } } });
  if (typeof abaixoDb === "number" && isFinite(abaixoDb)) m.aplicar({ op: "mixagem", campos: { trilha_abaixo_da_voz_db: Math.max(18, Math.min(30, abaixoDb)), duck: true } });
  return { duracao_s: dur };
}

/** Resumo das peças do projeto para o agente (apelido do clipe não entra: a peça é citada pelo tempo). */
export function pecasDoProjeto(p: ProjetoDeEdicao): { peca: string; inicio_s: number; duracao_s: number }[] {
  const saida: { peca: string; inicio_s: number; duracao_s: number }[] = [];
  p.trilhas.forEach((t) =>
    t.clipes.forEach((c) => {
      const e = (c.estilo || {}) as Record<string, unknown>;
      if (typeof e.peca === "string") saida.push({ peca: e.peca, inicio_s: c.inicio_s, duracao_s: duracaoDoClipe(c) });
    }),
  );
  return saida.sort((a, b) => a.inicio_s - b.inicio_s);
}

export const SONS_DISPONIVEIS = BIBLIOTECA_DE_SONS.map((s) => s.id);
