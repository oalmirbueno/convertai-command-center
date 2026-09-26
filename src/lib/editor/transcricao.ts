import { type ClipeDoProjeto, type ProjetoDeEdicao, type SegmentoDaFala, type TranscricaoDaFonte } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { emOrdem, fimDoClipe } from "./operacoes";
import { arred } from "./tempo";

/**
 * Fala do projeto (frente V-B). A transcrição fica guardada no tempo DA FONTE;
 * a legenda e o corte de silêncio usam o mapa fonte -> linha do tempo dos
 * clipes (o clipe diz qual trecho da fonte aparece e onde). Nada de subtrair a
 * mesma duração de todos os tempos: cada palavra passa pelo clipe onde está.
 */

const tempoSrt = (h: string, m: string, s: string, ms: string) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;

/** SRT (ou VTT simples) em trechos de fala. Blocos quebrados são ignorados. */
export function segmentosDoSrt(srt: string): SegmentoDaFala[] {
  const saida: SegmentoDaFala[] = [];
  const blocos = String(srt || "").replace(/\r/g, "").split(/\n\s*\n/);
  blocos.forEach((b) => {
    const linhas = b.split("\n").map((l) => l.trim()).filter(Boolean);
    const i = linhas.findIndex((l) => l.indexOf("-->") > 0);
    if (i < 0) return;
    const m = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/.exec(linhas[i]);
    if (!m) return;
    const ini = tempoSrt(m[1], m[2], m[3], m[4].length === 3 ? m[4] : String(Number(m[4]) * Math.pow(10, 3 - m[4].length)));
    const fim = tempoSrt(m[5], m[6], m[7], m[8].length === 3 ? m[8] : String(Number(m[8]) * Math.pow(10, 3 - m[8].length)));
    const texto = linhas.slice(i + 1).join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (texto && fim > ini) saida.push({ t: texto.slice(0, 120), i: arred(ini), f: arred(fim) });
  });
  return saida.sort((a, b) => a.i - b.i);
}

export const transcricaoDoSrt = (srt: string, origem = "srt", versao = 1, em: string | null = null): TranscricaoDaFonte => ({ segmentos: segmentosDoSrt(srt), por_palavra: false, origem, versao, em });

/**
 * Palavras com tempo. Transcrição por palavra: como está. Por frase: divide o
 * tempo da frase pelo tamanho de cada palavra (estimado; a tela avisa).
 */
export function palavrasDaTranscricao(tr: TranscricaoDaFonte): SegmentoDaFala[] {
  if (tr.por_palavra) return tr.segmentos;
  const saida: SegmentoDaFala[] = [];
  tr.segmentos.forEach((s) => {
    const palavras = s.t.split(/\s+/).filter(Boolean);
    const total = palavras.reduce((n, p) => n + p.length + 1, 0) || 1;
    let cursor = s.i;
    palavras.forEach((p) => {
      const d = ((s.f - s.i) * (p.length + 1)) / total;
      saida.push({ t: p, i: arred(cursor), f: arred(cursor + d) });
      cursor += d;
    });
  });
  return saida;
}

export interface PalavraNaLinha {
  t: string;
  /** Tempo na linha do tempo. */
  i: number;
  f: number;
  clipe: string;
}

/** Palavras da trilha de vídeo levadas para a linha do tempo, clipe a clipe. */
export function falaNaLinhaDoTempo(p: ProjetoDeEdicao, trilhaId?: string): PalavraNaLinha[] {
  const t = trilhaId ? p.trilhas.find((x) => x.id === trilhaId) : p.trilhas.find((x) => x.tipo === "video");
  if (!t) return [];
  const saida: PalavraNaLinha[] = [];
  const cache: Record<string, SegmentoDaFala[]> = {};
  emOrdem(t).forEach((c) => {
    if (!c.fonte || !p.transcricoes[c.fonte]) return;
    const palavras = cache[c.fonte] || (cache[c.fonte] = palavrasDaTranscricao(p.transcricoes[c.fonte]));
    palavras.forEach((w) => {
      const meio = (w.i + w.f) / 2;
      if (meio < c.entrada_s || meio >= c.saida_s) return;
      const ini = Math.max(w.i, c.entrada_s);
      const fim = Math.min(w.f, c.saida_s);
      saida.push({ t: w.t, i: arred(c.inicio_s + (ini - c.entrada_s) / c.velocidade), f: arred(c.inicio_s + (fim - c.entrada_s) / c.velocidade), clipe: c.id });
    });
  });
  return saida.sort((a, b) => a.i - b.i);
}

export interface Silencio {
  de_s: number;
  ate_s: number;
}

/**
 * Silêncios DENTRO do trecho do clipe (tempo da fonte). Pausa de `limiar_s`
 * ou mais vira corte, deixando `respiro_depois_s` depois da fala e
 * `respiro_antes_s` antes da próxima (padrão do clone 03: 0,10 e 0,08).
 * Começo e fim mudos do clipe também saem, com o mesmo respiro.
 */
export function silenciosDoClipe(
  c: Pick<ClipeDoProjeto, "entrada_s" | "saida_s">,
  fala: SegmentoDaFala[],
  o: { limiar_s: number; respiro_depois_s: number; respiro_antes_s: number },
): Silencio[] {
  const dentro = fala.filter((s) => s.f > c.entrada_s && s.i < c.saida_s).map((s) => ({ i: Math.max(s.i, c.entrada_s), f: Math.min(s.f, c.saida_s) }));
  if (!dentro.length) return [];
  // Junta falas encostadas (ou sobrepostas).
  const juntas: { i: number; f: number }[] = [];
  dentro.forEach((s) => {
    const u = juntas.length ? juntas[juntas.length - 1] : null;
    if (u && s.i <= u.f + 1e-6) u.f = Math.max(u.f, s.f);
    else juntas.push({ ...s });
  });
  const saida: Silencio[] = [];
  const pausa = (de: number, ate: number, antes: number, depois: number) => {
    if (ate - de < o.limiar_s - 1e-6) return;
    const a = arred(de + depois);
    const b = arred(ate - antes);
    if (b - a > 0.02) saida.push({ de_s: a, ate_s: b });
  };
  pausa(c.entrada_s, juntas[0].i, o.respiro_antes_s, 0);
  for (let k = 1; k < juntas.length; k++) pausa(juntas[k - 1].f, juntas[k].i, o.respiro_antes_s, o.respiro_depois_s);
  pausa(juntas[juntas.length - 1].f, c.saida_s, 0, o.respiro_depois_s);
  return saida;
}

/** Tem fala guardada para alguma fonte da trilha de vídeo? */
export function temFala(p: ProjetoDeEdicao): boolean {
  const t = p.trilhas.find((x) => x.tipo === "video");
  return !!t && t.clipes.some((c) => !!c.fonte && !!p.transcricoes[c.fonte] && p.transcricoes[c.fonte].segmentos.length > 0);
}

export const fimDaTrilha = (p: ProjetoDeEdicao, trilhaId: string) => {
  const t = p.trilhas.find((x) => x.id === trilhaId);
  return t ? t.clipes.reduce((m, c) => Math.max(m, fimDoClipe(c)), 0) : 0;
};
