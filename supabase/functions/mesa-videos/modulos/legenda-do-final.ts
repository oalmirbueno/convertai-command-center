/**
 * Gerador de legenda do vídeo pronto (Mesa Edição, 02/10/2026).
 *
 * O dono: "depois de renderizar, um gerador de legenda para o vídeo". Depois
 * do render, "Gerar legenda" faz o SRT e o VTT do CORTE FINAL:
 * - a trilha de legenda do projeto, quando existe (é o que a equipe revisou);
 * - senão, a fala marcada de cada fonte (transcrições do projeto) levada pelo
 *   corte: cada palavra só entra se cai dentro do trecho que ficou no clipe, e o
 *   tempo vira tempo da linha do tempo (início do clipe + (t - entrada) / velocidade);
 * - senão, a fala do próprio vídeo pronto (Whisper sobre o MP4 final, custo
 *   antes; a tela transcreve e manda as palavras).
 * A amostra (janela do render) desloca os tempos para começar em zero.
 * `projetoComLegenda` monta a versão com a legenda gravada no vídeo: a mesma
 * edição com a trilha de legenda preenchida (o worker renderiza como sempre).
 *
 * Puro: sem Deno, sem banco. A tela, a função e os testes usam o mesmo.
 */

export interface PalavraComTempo {
  t: string;
  i: number;
  f: number;
}

export interface LinhaDaLegenda {
  texto: string;
  i: number;
  f: number;
}

/** O mínimo do projeto de edição (_shared/projeto-de-edicao.ts) que a legenda lê. */
export interface ProjetoParaLegenda {
  fps?: number;
  trilhas: Array<{
    id: string;
    tipo: string;
    oculta?: boolean;
    muda?: boolean;
    clipes: Array<{ id: string; fonte: string | null; inicio_s: number; entrada_s: number; saida_s: number; velocidade: number; texto: string | null; volume?: number; estilo?: Record<string, unknown> | null }>;
  }>;
  transcricoes?: Record<string, { segmentos: Array<{ t: string; i: number; f: number }>; por_palavra: boolean }>;
}

export const MAX_LETRAS_POR_LINHA = 42;
export const MAX_DURACAO_DA_LINHA_S = 6;
export const MIN_DURACAO_DA_LINHA_S = 0.7;
export const PAUSA_QUE_QUEBRA_S = 0.6;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Frases viram palavras com o tempo dividido pelo tamanho de cada palavra (estimado). */
export function palavrasDosSegmentos(segmentos: Array<{ t: string; i: number; f: number }>, porPalavra: boolean): PalavraComTempo[] {
  if (porPalavra) return segmentos.filter((s) => s && String(s.t || "").trim() && isFinite(s.i) && isFinite(s.f) && s.f >= s.i).map((s) => ({ t: String(s.t).trim(), i: s.i, f: s.f }));
  const saida: PalavraComTempo[] = [];
  segmentos.forEach((s) => {
    const ps = String(s.t || "").split(/\s+/).filter(Boolean);
    const total = ps.reduce((n, p) => n + p.length + 1, 0) || 1;
    let cursor = s.i;
    ps.forEach((p) => {
      const d = ((s.f - s.i) * (p.length + 1)) / total;
      saida.push({ t: p, i: r3(cursor), f: r3(cursor + d) });
      cursor += d;
    });
  });
  return saida;
}

const fimDoClipe = (c: { inicio_s: number; entrada_s: number; saida_s: number; velocidade: number }) => c.inicio_s + Math.max(0, c.saida_s - c.entrada_s) / (c.velocidade > 0 ? c.velocidade : 1);

/**
 * Palavras faladas no corte final, no tempo da linha do tempo. Lê as trilhas
 * de vídeo e de áudio visíveis e com som; cada palavra entra se o meio dela
 * cai dentro do trecho do clipe. A mesma palavra em duas trilhas no mesmo
 * instante entra uma vez.
 */
export function falaNoCorte(p: ProjetoParaLegenda): PalavraComTempo[] {
  const transcricoes = p.transcricoes || {};
  const cache: Record<string, PalavraComTempo[]> = {};
  const saida: PalavraComTempo[] = [];
  p.trilhas
    .filter((t) => (t.tipo === "video" || t.tipo === "audio") && !t.oculta && !t.muda)
    .forEach((t) =>
      t.clipes.forEach((c) => {
        if (!c.fonte || !transcricoes[c.fonte] || (typeof c.volume === "number" && c.volume <= 0)) return;
        const tr = transcricoes[c.fonte];
        const palavras = cache[c.fonte] || (cache[c.fonte] = palavrasDosSegmentos(tr.segmentos || [], tr.por_palavra));
        const v = c.velocidade > 0 ? c.velocidade : 1;
        palavras.forEach((w) => {
          const meio = (w.i + w.f) / 2;
          if (meio < c.entrada_s || meio >= c.saida_s) return;
          const ini = Math.max(w.i, c.entrada_s);
          const fim = Math.min(w.f, c.saida_s);
          saida.push({ t: w.t, i: r3(c.inicio_s + (ini - c.entrada_s) / v), f: r3(c.inicio_s + (fim - c.entrada_s) / v) });
        });
      }),
    );
  saida.sort((a, b) => a.i - b.i || a.f - b.f);
  return saida.filter((w, k) => k === 0 || !(saida[k - 1].t === w.t && Math.abs(saida[k - 1].i - w.i) < 0.05));
}

/** Os clipes da trilha de legenda como estão na linha do tempo (o texto que a equipe revisou). */
export function linhasDaTrilhaDeLegenda(p: ProjetoParaLegenda): LinhaDaLegenda[] {
  const saida: LinhaDaLegenda[] = [];
  p.trilhas
    .filter((t) => t.tipo === "legenda" && !t.oculta)
    .forEach((t) =>
      t.clipes.forEach((c) => {
        const textoDoClipe = String(c.texto || "").replace(/\s+/g, " ").trim();
        if (!textoDoClipe) return;
        saida.push({ texto: textoDoClipe, i: r3(c.inicio_s), f: r3(fimDoClipe(c)) });
      }),
    );
  return saida.sort((a, b) => a.i - b.i);
}

/**
 * Palavras em linhas de legenda: até 42 letras, quebra na pausa e no fim de
 * frase, até 6 s cada, pelo menos 0,7 s na tela (sem passar da próxima).
 */
export function linhasDasPalavras(palavras: PalavraComTempo[], o: { maxLetras?: number; maxDuracao?: number; pausa?: number } = {}): LinhaDaLegenda[] {
  const maxLetras = o.maxLetras || MAX_LETRAS_POR_LINHA;
  const maxDuracao = o.maxDuracao || MAX_DURACAO_DA_LINHA_S;
  const pausa = o.pausa || PAUSA_QUE_QUEBRA_S;
  const linhas: LinhaDaLegenda[] = [];
  let atual: PalavraComTempo[] = [];
  const fechar = () => {
    if (!atual.length) return;
    linhas.push({ texto: atual.map((w) => w.t).join(" "), i: atual[0].i, f: atual[atual.length - 1].f });
    atual = [];
  };
  palavras.forEach((w) => {
    const ant = atual.length ? atual[atual.length - 1] : null;
    const letras = atual.reduce((n, x) => n + x.t.length + 1, 0) + w.t.length;
    if (ant && (w.i - ant.f > pausa || /[.!?…]$/.test(ant.t) || letras > maxLetras || w.f - atual[0].i > maxDuracao)) fechar();
    atual.push(w);
  });
  fechar();
  return linhas.map((l, k) => {
    const prox = k + 1 < linhas.length ? linhas[k + 1].i : Infinity;
    const f = Math.min(Math.max(l.f, l.i + MIN_DURACAO_DA_LINHA_S), prox);
    return { texto: l.texto, i: r3(l.i), f: r3(Math.max(f, l.i + 0.05)) };
  });
}

export type OrigemDaLegenda = "trilha" | "fala" | "video";

/**
 * As linhas do vídeo pronto: trilha de legenda > fala no corte > nada (a tela
 * oferece transcrever o próprio vídeo). `janela`: o trecho da amostra.
 */
export function legendaDoFinal(p: ProjetoParaLegenda | null, janela?: { inicio_s: number; fim_s: number } | null): { linhas: LinhaDaLegenda[]; origem: OrigemDaLegenda | null } {
  if (!p) return { linhas: [], origem: null };
  const daTrilha = linhasDaTrilhaDeLegenda(p);
  const origem: OrigemDaLegenda | null = daTrilha.length ? "trilha" : null;
  let linhas = daTrilha.length ? daTrilha : linhasDasPalavras(falaNoCorte(p));
  if (!linhas.length) return { linhas: [], origem: null };
  if (janela && janela.fim_s > janela.inicio_s) linhas = recortarLinhas(linhas, janela.inicio_s, janela.fim_s);
  return { linhas, origem: origem || "fala" };
}

/** Linhas dentro de uma janela, com o tempo a partir do começo dela. */
export function recortarLinhas(linhas: LinhaDaLegenda[], inicio: number, fim: number): LinhaDaLegenda[] {
  return linhas
    .filter((l) => l.f > inicio && l.i < fim)
    .map((l) => ({ texto: l.texto, i: r3(Math.max(0, l.i - inicio)), f: r3(Math.min(fim, l.f) - inicio) }))
    .filter((l) => l.f - l.i > 0.05);
}

// ------------------------------------------------------------------ arquivos

const doisOuTres = (n: number, t = 2) => String(n).padStart(t, "0");

function tempo(s: number, sep: "," | "."): string {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const se = Math.floor((ms % 60000) / 1000);
  return `${doisOuTres(h)}:${doisOuTres(m)}:${doisOuTres(se)}${sep}${doisOuTres(ms % 1000, 3)}`;
}

/** Texto de uma linha no arquivo: sem linha vazia no meio (quebraria o bloco) e sem "-->". */
const limparTexto = (t: string) => String(t || "").replace(/-->/g, "->").replace(/\r/g, "").replace(/\n\s*\n/g, "\n").trim();

export function srtDe(linhas: LinhaDaLegenda[]): string {
  return linhas.map((l, k) => `${k + 1}\n${tempo(l.i, ",")} --> ${tempo(l.f, ",")}\n${limparTexto(l.texto)}\n`).join("\n");
}

export function vttDe(linhas: LinhaDaLegenda[]): string {
  return `WEBVTT\n\n${linhas.map((l) => `${tempo(l.i, ".")} --> ${tempo(l.f, ".")}\n${limparTexto(l.texto)}\n`).join("\n")}`;
}

/** Caminho dos arquivos de legenda ao lado do vídeo pronto (mesma pasta, mesmo nome). */
export function caminhosDaLegenda(caminhoDoVideo: string): { srt: string; vtt: string } {
  const base = String(caminhoDoVideo || "").replace(/\.[a-z0-9]{2,5}$/i, "");
  return { srt: `${base}.srt`, vtt: `${base}.vtt` };
}

// ------------------------------------------------------------------ legenda gravada no vídeo

export const ESTILOS_DA_LEGENDA_GRAVADA = ["simples", "caixa"] as const;
export type EstiloDaLegendaGravada = (typeof ESTILOS_DA_LEGENDA_GRAVADA)[number];

/**
 * A mesma edição com a trilha de legenda preenchida pelas linhas (substitui a
 * trilha de legenda que houver). Clipe de legenda: sem fonte, entrada 0 e
 * saída = duração (o desenho é da composição do worker, como a skill de legendas).
 */
export function projetoComLegenda<P extends ProjetoParaLegenda>(p: P, linhas: LinhaDaLegenda[], estilo: EstiloDaLegendaGravada = "simples", agoraId = "lg"): P {
  const trilhas = p.trilhas.filter((t) => t.tipo !== "legenda").map((t) => ({ ...t, clipes: t.clipes.slice() }));
  const clipes = linhas
    .filter((l) => l.f - l.i > 0.05 && String(l.texto || "").trim())
    .map((l, k) => ({
      id: `${agoraId}-${k + 1}`,
      fonte: null,
      inicio_s: r3(l.i),
      entrada_s: 0,
      saida_s: r3(l.f - l.i),
      velocidade: 1,
      volume: 1,
      texto: String(l.texto).trim().slice(0, 500),
      estilo: { preset: estilo === "caixa" ? "caixa" : "simples", animacao: "nenhuma", posicao: "auto" },
      transicao_entrada: null,
      transicao_saida: null,
      zoom: null,
      cena_ref: null,
      nota: null,
      comparar: null,
      origem: { tipo: "skill", ref: "gerador_de_legenda" },
    }));
  trilhas.push({ id: `${agoraId}-trilha`, tipo: "legenda", nome: "Legenda", muda: false, oculta: false, clipes } as unknown as P["trilhas"][number]);
  return { ...p, trilhas };
}
