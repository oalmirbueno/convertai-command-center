import { chaveDaFonte, type ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { estimativaDoPlanoUsd, pedidoDoPlano, sistemaDoPlano, type PlanoDaEdicao, type ResumoParaOPlano } from "../../../supabase/functions/editor-video/modulos/plano-da-edicao";
import { estimativaDoRostoUsd, sistemaDoRosto } from "../../../supabase/functions/editor-video/modulos/julgamentos-da-edicao";
import type { AnimacaoEscolhida, DadosDaEdicao } from "./edicaoCompleta";
import { frasesDoProjeto, notasPorRegra, type FraseNaLinha, type ItemParaBroll } from "./skills/pecasDaEdicao";
import { falaNaLinhaDoTempo } from "./transcricao";
import { frasesParaSugerir } from "./motion/sugestoes";
import { limparLeituras } from "./reenquadre";
import { TETO_DOS_SUPERPODERES } from "../../../supabase/functions/_shared/superpoderes-catalogo";
import { brollEmBlocos, capitulosEmBlocos, momentosEmBlocos } from "./julgarEmBlocos";
import { base64DoDataUrl, extrairQuadro, tempoDoQuadro } from "./quadros";
import type { Operacao } from "./operacoes";

/**
 * "Editar com IA", lado da tela (frente EDT, rodada 2): conversa com a função
 * editor-video. O plano é UMA chamada paga (custo antes, a mesma conta do
 * servidor); os julgamentos (Jev) são sem custo para o cliente e, se falharem,
 * viram aviso e a regra da casa entra no lugar (nada fica escondido).
 */

type Chamar = (corpo: Record<string, unknown>) => Promise<any>;

export interface ModeloComPreco {
  id: string;
  preco_entrada_1m: number | null;
  preco_saida_1m: number | null;
}

/** O que o plano lê do vídeo (fala da linha do tempo, músicas da Mídia, marca). */
export function resumoParaOPlano(p: ProjetoDeEdicao, marca: string | null, acervo: number): ResumoParaOPlano {
  const fala = falaNaLinhaDoTempo(p).map((w) => w.t).join(" ");
  const musicas = Object.keys(p.fontes).filter((k) => p.fontes[k].midia === "audio" && p.fontes[k].storage_bucket !== "publico");
  return {
    titulo: p.titulo,
    duracao_s: p.duracao_s,
    formato: p.formato,
    fala: fala.slice(0, 12000),
    musicas,
    tem_onda: Object.keys(p.ondas || {}).length > 0,
    tem_rosto: Object.keys(p.rostos || {}).length > 0,
    marca,
    acervo,
  };
}

/**
 * Custo do plano antes (a mesma conta que a função confere). O método da casa
 * (superpoderes) entra no sistema do modelo, e a função só sabe o tamanho
 * dele depois de escolher: a tela soma o teto (o maior possível), então o
 * conferido nunca passa do mostrado.
 */
export function custoDoPlano(m: ModeloComPreco, instrucao: string, resumo: ResumoParaOPlano, comRaciocinio: boolean): number {
  return estimativaDoPlanoUsd(m.preco_entrada_1m, m.preco_saida_1m, sistemaDoPlano().length + pedidoDoPlano(instrucao, resumo).length + TETO_DOS_SUPERPODERES + 2, comRaciocinio);
}

export async function pedirPlano(chamar: Chamar, e: { clientId: string; modelo: ModeloComPreco; raciocinio?: string | null; instrucao: string; resumo: ResumoParaOPlano; referencia: string }): Promise<{ plano: PlanoDaEdicao; avisos: string[]; custo_usd: number }> {
  const custo = custoDoPlano(e.modelo, e.instrucao, e.resumo, !!e.raciocinio);
  const r = await chamar({ acao: "edicao_planejar", client_id: e.clientId, modelo_id: e.modelo.id, raciocinio: e.raciocinio || undefined, instrucao: e.instrucao, resumo: e.resumo, referencia_id: e.referencia, custo_maximo_usd: custo });
  return { plano: r.plano as PlanoDaEdicao, avisos: Array.isArray(r.avisos) ? r.avisos.map(String) : [], custo_usd: Number(r.custo_usd) || 0 };
}

// ------------------------------------------------------------------ julgamentos (Jev)

export interface ItemDoAcervoParaIa extends ItemParaBroll {
  descricao: string;
}

/**
 * Vídeos do acervo que servem de B-roll: vídeo com duração lida, fora da
 * trilha principal; a descrição junta o nome e o que o agente já viu dele.
 */
export function acervoParaBroll(p: ProjetoDeEdicao, itens: ItemParaBroll[]): ItemDoAcervoParaIa[] {
  const naPrincipal = new Set<string>();
  const t = p.trilhas.find((x) => x.tipo === "video");
  (t ? t.clipes : []).forEach((c) => c.fonte && p.fontes[c.fonte] && naPrincipal.add(String(p.fontes[c.fonte].storage_path)));
  return itens
    .filter((i) => !naPrincipal.has(i.storage_path) && (i.duracao_s || 0) >= 1 && !/\.(wav|mp3|m4a|aac|ogg|flac)$/i.test(i.storage_path))
    .slice(0, 24)
    .map((i) => {
      const chave = Object.keys(p.fontes).find((k) => p.fontes[k].storage_path === i.storage_path);
      const visto = chave && p.visoes[chave] ? p.visoes[chave].trechos.slice(0, 3).map((x) => x.descricao).join("; ") : "";
      const nome = i.nome.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_]+/g, " ");
      return { ...i, descricao: `${nome}${visto ? `: ${visto}` : ""}`.slice(0, 300) };
    });
}

/** Notas do Jev; a frase que ficou sem nota (bloco que não saiu) leva a da regra da casa. */
export function comRegraNoResto(frases: FraseNaLinha[], notas: { k: string; nota: number }[]): { k: string; nota: number }[] {
  const julgadas: Record<string, boolean> = {};
  notas.forEach((n) => (julgadas[n.k] = true));
  return notas.concat(notasPorRegra(frases.filter((f) => !julgadas[f.k])));
}

export interface Julgamentos {
  dados: Omit<DadosDaEdicao, "agora" | "marca">;
  avisos: string[];
}

/**
 * Os julgamentos que o plano pede, sobre o projeto JÁ cortado. Momentos,
 * capítulos e B-roll julgam a fala INTEIRA em blocos (julgarEmBlocos.ts);
 * os três correm em paralelo, cada um com os seus blocos em sequência.
 */
export async function julgar(chamar: Chamar, clientId: string, cortado: ProjetoDeEdicao, plano: PlanoDaEdicao, acervo: ItemDoAcervoParaIa[], aoAndar?: (texto: string) => void): Promise<Julgamentos> {
  const avisos: string[] = [];
  const frases = frasesDoProjeto(cortado);
  const dados: Julgamentos["dados"] = {};
  if (!frases.length) return { dados, avisos };
  const falhou = (o: string) => (e: unknown) => {
    console.error(`[editar com IA] ${o} falhou`, e);
    avisos.push(`${o}: ${e instanceof Error ? e.message : "não respondeu"}${o === "Zoom" ? " (usei a regra da casa)" : ""}.`);
    return null;
  };
  const avisar = (a: string | null) => {
    if (a) avisos.push(a);
  };
  const tarefas: Promise<unknown>[] = [];
  const precisaMomentos = plano.zoom.ligado || plano.virais;
  if (precisaMomentos) {
    tarefas.push(
      momentosEmBlocos(chamar, { clientId, titulo: cortado.titulo, frases, forca: plano.zoom.ligado, virais: plano.virais, aoAndar })
        .then((r) => {
          if (r.forca.length) dados.notas = comRegraNoResto(frases, r.forca);
          if (r.aviso && plano.zoom.ligado) avisos.push("Zoom: o trecho que a IA não julgou seguiu a regra da casa.");
          if (plano.virais) dados.virais = r.virais;
          avisar(r.aviso);
        })
        .catch(falhou(plano.zoom.ligado ? "Zoom" : "Momentos virais")),
    );
  }
  if (plano.capitulos) {
    tarefas.push(
      capitulosEmBlocos(chamar, { clientId, frases })
        .then((r) => {
          dados.capitulos = r.capitulos;
          avisar(r.aviso);
        })
        .catch(falhou("Capítulos")),
    );
  }
  if (plano.broll.ligado && plano.broll.maximo > 0 && acervo.length) {
    tarefas.push(
      brollEmBlocos(chamar, { clientId, frases, acervo: acervo.map((a) => ({ id: a.id, descricao: a.descricao })), maximo: plano.broll.maximo })
        .then((r) => {
          dados.broll = r.escolhas
            .map((x) => ({ inicio_s: x.inicio_s, fim_s: x.fim_s, item: acervo.find((a) => a.id === x.item) as ItemParaBroll }))
            .filter((x) => !!x.item);
          avisar(r.aviso);
        })
        .catch(falhou("B-roll do acervo")),
    );
  } else if (plano.broll.ligado && !acervo.length) avisos.push("B-roll: o acervo do cliente não tem outro vídeo com duração lida. Suba na Entrada ou peça ao agente para gerar (pago, com custo antes).");
  if (plano.motion.ligado) {
    const candidatas = frasesParaSugerir(falaNaLinhaDoTempo(cortado));
    if (candidatas.length) {
      tarefas.push(
        chamar({ acao: "animacoes_sugerir", client_id: clientId, densidade: plano.motion.densidade, frases: candidatas.map((f) => ({ k: f.k, inicio_s: f.inicio_s, fim_s: f.fim_s, texto: f.texto, candidatas: f.candidatas.map((c) => c.peca) })) })
          .then((r) => {
            const sugestoes = (Array.isArray(r.sugestoes) ? r.sugestoes : []) as { k: string; peca: string }[];
            const escolhidas: AnimacaoEscolhida[] = [];
            sugestoes.forEach((s) => {
              const f = candidatas.find((x) => x.k === s.k);
              const c = f ? f.candidatas.find((x) => x.peca === s.peca) : null;
              if (f && c) escolhidas.push({ inicio_s: f.inicio_s, peca: c.peca, params: c.params });
            });
            dados.animacoes = escolhidas;
          })
          .catch(falhou("Animações")),
      );
    }
  }
  await Promise.all(tarefas);
  return { dados, avisos };
}

// ------------------------------------------------------------------ rosto

export const QUADROS_POR_LOTE_DO_ROSTO = 12;
export const MAX_QUADROS_DO_ROSTO_POR_FONTE = 48;

/** Tempos da fonte para o rastreio: um quadro a cada 1,5 s (no mínimo), até 48. */
export function temposDoRosto(duracao: number, fps: number): number[] {
  const d = Math.max(0, duracao);
  if (!d) return [];
  const n = Math.max(1, Math.min(MAX_QUADROS_DO_ROSTO_POR_FONTE, Math.floor(d / 1.5)));
  const passo = d / n;
  const saida: number[] = [];
  for (let k = 0; k < n; k++) saida.push(tempoDoQuadro(k * passo + passo / 2, fps));
  return saida;
}

/** Custo antes de rastrear estas fontes (a mesma conta que a função confere, lote a lote). */
export function custoDoRosto(m: ModeloComPreco, p: ProjetoDeEdicao, chaves: string[]): number {
  let soma = 0;
  chaves.forEach((k) => {
    const n = temposDoRosto(p.fontes[k] ? p.fontes[k].duracao_s || 0 : 0, p.fps).length;
    for (let i = 0; i < n; i += QUADROS_POR_LOTE_DO_ROSTO) {
      const lote = Math.min(QUADROS_POR_LOTE_DO_ROSTO, n - i);
      soma += estimativaDoRostoUsd(m.preco_entrada_1m, m.preco_saida_1m, lote, sistemaDoRosto().length + legendaDoRosto(k, lote).length);
    }
  });
  return Math.ceil(soma * 10000) / 10000;
}

const legendaDoRosto = (fonte: string, n: number) => `Fonte ${fonte.slice(0, 60)}. ${n} quadros, na ordem 1 a ${n}.`;

/** Fontes de vídeo da trilha principal sem rosto rastreado. */
export function fontesSemRosto(p: ProjetoDeEdicao): string[] {
  const t = p.trilhas.find((x) => x.tipo === "video");
  const chaves: string[] = [];
  (t ? t.clipes : []).forEach((c) => {
    if (!c.fonte || chaves.indexOf(c.fonte) >= 0) return;
    const f = p.fontes[c.fonte];
    if (f && f.midia === "video" && f.duracao_s && !(p.rostos || {})[c.fonte]) chaves.push(c.fonte);
  });
  return chaves;
}

/**
 * Rastreia o rosto: quadros pequenos tirados no navegador, lotes de 12 para um
 * modelo com imagem, leituras limpas pelo código (pulo sai, falha herda o
 * vizinho). Devolve a operação de cada fonte (um passo do desfazer).
 *
 * Cada lote é pago. Se a pessoa para, ou um lote falha (sem crédito, tempo
 * esgotado, quadro que não abre), NADA do que já foi pago se perde: a fonte
 * em andamento fecha o rastro com as leituras que já vieram, as fontes
 * anteriores ficam como estão, e o motivo volta em `erro` (sem lançar).
 */
export async function rastrearRosto(
  chamar: Chamar,
  e: { clientId: string; projeto: ProjetoDeEdicao; chaves: string[]; urls: Record<string, string>; modelo: ModeloComPreco; referencia: string; aoAndar?: (texto: string) => void; parado?: () => boolean },
): Promise<{ ops: Operacao[]; custo_usd: number; semRosto: string[]; erro: string | null; falha: unknown; parado: boolean }> {
  const ops: Operacao[] = [];
  const semRosto: string[] = [];
  let custo = 0;
  let erro: string | null = null;
  let falha: unknown = null;
  let parado = false;
  for (const chave of e.chaves) {
    if (erro || parado) break;
    const f = e.projeto.fontes[chave];
    const url = e.urls[chave];
    if (!f || !url) continue;
    const tempos = temposDoRosto(f.duracao_s || 0, e.projeto.fps);
    const leituras: { t: number; x: number | null; y: number | null; w: number | null }[] = [];
    for (let i = 0; i < tempos.length; i += QUADROS_POR_LOTE_DO_ROSTO) {
      if (e.parado && e.parado()) {
        parado = true;
        break;
      }
      const lote = tempos.slice(i, i + QUADROS_POR_LOTE_DO_ROSTO);
      if (e.aoAndar) e.aoAndar(`Rastreando ${f.nome}: ${Math.min(i + lote.length, tempos.length)} de ${tempos.length} quadros`);
      try {
        const quadros: { tempo_s: number; jpeg_base64: string }[] = [];
        for (const t of lote) {
          const q = await extrairQuadro(url, t, { largura: 320, qualidade: 0.6 });
          if (q) quadros.push({ tempo_s: q.tempo_s, jpeg_base64: base64DoDataUrl(q.dataUrl) });
        }
        if (!quadros.length) throw new Error(`Não deu para ler os quadros de ${f.nome} aqui (o navegador não liberou a imagem).`);
        const r = await chamar({
          acao: "rosto_rastrear",
          client_id: e.clientId,
          fonte: chave,
          modelo_id: e.modelo.id,
          quadros,
          referencia_id: e.referencia,
          custo_maximo_usd: estimativaDoRostoUsd(e.modelo.preco_entrada_1m, e.modelo.preco_saida_1m, quadros.length, sistemaDoRosto().length + legendaDoRosto(chave, quadros.length).length),
        });
        custo += Number(r.custo_usd) || 0;
        (Array.isArray(r.leituras) ? r.leituras : []).forEach((l: { t: number; x: number | null; y: number | null; w: number | null }) => leituras.push(l));
      } catch (x) {
        falha = x;
        erro = x instanceof Error ? x.message : "O rastreio não respondeu.";
        console.error(`[editor] rastreio do rosto parou em ${f.nome}`, x);
        break;
      }
    }
    // Fecha o rastro com o que já veio (pago), mesmo parado ou com falha no meio.
    const pontos = limparLeituras(leituras);
    if (!pontos.length) {
      if (!erro && !parado) semRosto.push(f.nome);
      continue;
    }
    ops.push({ op: "rosto", fonte: chaveDaFonte(chave), rastro: { pontos, origem: `visão ${e.modelo.id}`.slice(0, 60), em: new Date().toISOString() } });
  }
  return { ops, custo_usd: Math.round(custo * 10000) / 10000, semRosto, erro, falha, parado };
}
