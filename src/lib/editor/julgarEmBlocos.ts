import { MAX_FRASES_JULGADAS } from "../../../supabase/functions/editor-video/modulos/julgamentos-da-edicao";

/**
 * Julgamentos do Jev no vídeo INTEIRO (frente EDT, rodada 2, correção do
 * revisor): a função julga até 60 frases por chamada (o limite de perguntas
 * do Jev), então a tela manda a fala em blocos, um de cada vez, e junta.
 *
 * - força das frases: blocos de 60 seguidos; nota por frase (k único);
 * - momentos virais: a janela desliza (cada bloco repete o fim do anterior),
 *   para não perder um corte que passa pela emenda; junta sem sobrepor;
 * - capítulos: cada bloco começa com a última frase do anterior, para a
 *   fronteira entre blocos também ser julgada; o capítulo dessa frase de
 *   emenda sai (é do bloco anterior) e o espaço mínimo vale no todo;
 * - B-roll do acervo: blocos de 30 frases, um vídeo por vez e 6 s entre eles.
 *
 * Um bloco que falha para tudo e devolve o que já saiu, com o aviso "julguei
 * só até mm:ss" (nada fica escondido). Se nenhum bloco saiu, o erro sobe.
 */

type Chamar = (corpo: Record<string, unknown>) => Promise<any>;

export interface FraseParaJulgar {
  k: string;
  inicio_s: number;
  fim_s: number;
  texto: string;
}

export const FRASES_POR_BLOCO = MAX_FRASES_JULGADAS;
export const FRASES_POR_BLOCO_DO_BROLL = 30;
/** Teto de blocos por pedido (24 x 60 frases: bem mais de 1 h de fala). */
export const MAX_BLOCOS = 24;
/** Frases do fim do bloco anterior que entram de novo no seguinte (virais). */
export const EMENDA_DOS_VIRAIS = 15;

export function mmss(s: number): string {
  const t = Math.max(0, Math.floor(Number(s) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Blocos de `tamanho` frases; `emenda` frases do fim de um bloco repetem no começo do seguinte. */
export function blocosDeFrases<T>(frases: T[], tamanho: number, emenda = 0, maxBlocos = MAX_BLOCOS): { blocos: T[][]; cortado: boolean } {
  const tam = Math.max(1, Math.floor(tamanho));
  const passo = Math.max(1, tam - Math.max(0, Math.min(tam - 1, Math.floor(emenda))));
  const blocos: T[][] = [];
  for (let i = 0; i < frases.length; i += passo) {
    if (blocos.length >= maxBlocos) return { blocos, cortado: true };
    blocos.push(frases.slice(i, i + tam));
    if (i + tam >= frases.length) break;
  }
  return { blocos, cortado: false };
}

function avisoDoCorte(frases: FraseParaJulgar[], ate: number | null, erro: string | null, o: string): string | null {
  if (ate === null) return null;
  const ultima = frases.length ? frases[frases.length - 1].fim_s : 0;
  if (ate >= ultima - 0.001 && !erro) return null;
  return `${o}: julguei só até ${mmss(ate)} de ${mmss(ultima)}${erro ? ` (${erro})` : " (fala longa demais para um pedido)"}.`;
}

const mensagem = (e: unknown) => (e instanceof Error ? e.message : "não respondeu");

interface Andamento {
  aoAndar?: (texto: string) => void;
}

/**
 * Roda os blocos em sequência. Devolve o fim (s) da última frase julgada e o
 * erro do bloco que parou; sem nenhum bloco feito, o erro sobe.
 */
async function emSequencia<T extends FraseParaJulgar>(blocos: T[][], rotulo: string, a: Andamento, f: (bloco: T[], b: number) => Promise<void>): Promise<{ ate: number | null; erro: string | null }> {
  let ate: number | null = null;
  for (let b = 0; b < blocos.length; b++) {
    if (a.aoAndar && blocos.length > 1) a.aoAndar(`${rotulo}: parte ${b + 1} de ${blocos.length}`);
    try {
      await f(blocos[b], b);
      ate = blocos[b][blocos[b].length - 1].fim_s;
    } catch (e) {
      if (ate === null) throw e;
      console.error(`[editor] ${rotulo}: a parte ${b + 1} falhou`, e);
      return { ate, erro: mensagem(e) };
    }
  }
  return { ate, erro: null };
}

export interface MomentoJulgado {
  inicio_s: number;
  fim_s: number;
  nota: number;
  texto: string;
}

/** Junta os virais dos blocos: maior nota primeiro, sem sobrepor, até `maximo`. */
export function juntarVirais(lista: MomentoJulgado[], maximo: number): MomentoJulgado[] {
  const ficam: MomentoJulgado[] = [];
  lista
    .slice()
    .sort((a, b) => b.nota - a.nota || a.inicio_s - b.inicio_s)
    .forEach((m) => {
      if (ficam.length >= maximo) return;
      if (ficam.some((x) => m.inicio_s < x.fim_s && m.fim_s > x.inicio_s)) return;
      ficam.push(m);
    });
  return ficam.sort((a, b) => a.inicio_s - b.inicio_s);
}

export async function momentosEmBlocos(
  chamar: Chamar,
  e: { clientId: string; titulo: string; frases: FraseParaJulgar[]; forca: boolean; virais: boolean } & Andamento,
): Promise<{ forca: { k: string; nota: number }[]; virais: MomentoJulgado[]; aviso: string | null }> {
  const { blocos } = blocosDeFrases(e.frases, FRASES_POR_BLOCO, e.virais ? EMENDA_DOS_VIRAIS : 0);
  const notas: Record<string, number> = {};
  const ordem: string[] = [];
  const virais: MomentoJulgado[] = [];
  const r = await emSequencia(blocos, e.virais && !e.forca ? "Momentos virais" : "Força das frases", e, async (bloco) => {
    const resp = await chamar({ acao: "momentos_avaliar", client_id: e.clientId, titulo: e.titulo, frases: bloco, forca: e.forca, virais: e.virais });
    (Array.isArray(resp.forca) ? resp.forca : []).forEach((n: { k: string; nota: number }) => {
      if (notas[n.k] !== undefined) return;
      notas[n.k] = Number(n.nota);
      ordem.push(n.k);
    });
    (Array.isArray(resp.virais) ? resp.virais : []).forEach((v: MomentoJulgado) => virais.push({ inicio_s: Number(v.inicio_s), fim_s: Number(v.fim_s), nota: Number(v.nota), texto: String(v.texto || "") }));
  });
  const maximo = Math.min(12, 5 + 2 * (blocos.length - 1));
  return {
    forca: ordem.map((k) => ({ k, nota: notas[k] })),
    virais: juntarVirais(virais, maximo),
    aviso: avisoDoCorte(e.frases, r.ate, r.erro, e.forca ? "Momentos fortes" : "Momentos virais"),
  };
}

/** Junta os capítulos dos blocos: em ordem, `minimo_s` entre começos; "Parte N" renumerada. */
export function juntarCapitulos(lista: { inicio_s: number; titulo: string }[], minimo_s = 20): { inicio_s: number; titulo: string }[] {
  const ficam: { inicio_s: number; titulo: string }[] = [];
  lista
    .filter((c) => isFinite(Number(c.inicio_s)) && c.titulo)
    .sort((a, b) => a.inicio_s - b.inicio_s)
    .forEach((c) => {
      const ant = ficam[ficam.length - 1];
      if (ant && c.inicio_s - ant.inicio_s < minimo_s) return;
      ficam.push({ inicio_s: Number(c.inicio_s), titulo: String(c.titulo) });
    });
  return ficam.map((c, i) => (/^Parte \d+$/.test(c.titulo) ? { ...c, titulo: `Parte ${i + 1}` } : c));
}

export async function capitulosEmBlocos(
  chamar: Chamar,
  e: { clientId: string; frases: FraseParaJulgar[]; minimo_s?: number } & Andamento,
): Promise<{ capitulos: { inicio_s: number; titulo: string }[]; aviso: string | null }> {
  const { blocos } = blocosDeFrases(e.frases, FRASES_POR_BLOCO, 1);
  const todos: { inicio_s: number; titulo: string }[] = [];
  const r = await emSequencia(blocos, "Capítulos", e, async (bloco, b) => {
    const resp = await chamar({ acao: "capitulos_sugerir", client_id: e.clientId, frases: bloco, ...(e.minimo_s ? { minimo_s: e.minimo_s } : {}) });
    const emenda = b > 0 ? bloco[0].inicio_s : null;
    (Array.isArray(resp.capitulos) ? resp.capitulos : []).forEach((c: { inicio_s: number; titulo: string }) => {
      // O capítulo que começa na frase de emenda é do bloco anterior.
      if (emenda !== null && Math.abs(Number(c.inicio_s) - emenda) < 0.001) return;
      todos.push({ inicio_s: Number(c.inicio_s), titulo: String(c.titulo || "") });
    });
  });
  return { capitulos: juntarCapitulos(todos, e.minimo_s || 20), aviso: avisoDoCorte(e.frases, r.ate, r.erro, "Capítulos") };
}

export interface EscolhaJulgada {
  item: string;
  inicio_s: number;
  fim_s: number;
  probabilidade: number;
}

/** Junta o B-roll dos blocos: mais provável primeiro, um vídeo uma vez, 6 s entre eles, até `maximo`. */
export function juntarBroll(lista: EscolhaJulgada[], maximo: number): EscolhaJulgada[] {
  const ficam: EscolhaJulgada[] = [];
  lista
    .slice()
    .sort((a, b) => b.probabilidade - a.probabilidade || a.inicio_s - b.inicio_s)
    .forEach((c) => {
      if (ficam.length >= maximo) return;
      if (ficam.some((x) => x.item === c.item || Math.abs(x.inicio_s - c.inicio_s) < 6)) return;
      ficam.push(c);
    });
  return ficam.sort((a, b) => a.inicio_s - b.inicio_s);
}

export async function brollEmBlocos(
  chamar: Chamar,
  e: { clientId: string; frases: FraseParaJulgar[]; acervo: { id: string; descricao: string }[]; maximo: number } & Andamento,
): Promise<{ escolhas: EscolhaJulgada[]; aviso: string | null }> {
  const { blocos } = blocosDeFrases(e.frases, FRASES_POR_BLOCO_DO_BROLL);
  const todas: EscolhaJulgada[] = [];
  const r = await emSequencia(blocos, "B-roll do acervo", e, async (bloco) => {
    const resp = await chamar({ acao: "broll_escolher", client_id: e.clientId, frases: bloco, acervo: e.acervo, maximo: e.maximo });
    (Array.isArray(resp.escolhas) ? resp.escolhas : []).forEach((x: EscolhaJulgada) =>
      todas.push({ item: String(x.item), inicio_s: Number(x.inicio_s), fim_s: Number(x.fim_s), probabilidade: Number(x.probabilidade) || 0 }),
    );
  });
  return { escolhas: juntarBroll(todas, e.maximo), aviso: avisoDoCorte(e.frases, r.ate, r.erro, "B-roll") };
}
