/**
 * "Manter só o vídeo X" (lote B, 09/10/2026). PURO, sem import: a tela (agente
 * editor) e a função editor-video usam o mesmo.
 *
 * No histórico real o dono pediu "deixe só um" e, escolhida a opção "Vídeo sobre
 * prazo de entrega (0:00 a 1:12)", o agente rodou reenquadrar: nada saiu. Agora:
 * - o pedido de manter só um trecho é lido pelo código (pedeManterSomente);
 * - a seleção dos clipes é calculada aqui (selecionarParaManter), por trecho da
 *   linha do tempo ou pela fonte (o trecho que aquela fonte ocupa);
 * - clipe de vídeo ou áudio que cruza o limite é ambiguidade: nada muda e o dono
 *   escolhe (pergunta específica, com os clipes e os tempos);
 * - texto e legenda que cruzam o limite ficam do lado onde está a maior parte (e
 *   isso vai no relatório);
 * - enquanto o pedido é de manter só um trecho, reenquadrar e formato são recusados
 *   (não tiram nada).
 */

export interface ClipeParaManter {
  id: string;
  fonte: string | null;
  inicio_s: number;
  entrada_s: number;
  saida_s: number;
  velocidade: number;
  texto?: string | null;
}

export interface TrilhaParaManter {
  id: string;
  tipo: string;
  nome: string;
  clipes: ClipeParaManter[];
}

export type AlvoDoManter = { de_s: number; ate_s: number } | { fonte: string };

export interface ClipeNaSelecao {
  trilha: string;
  tipo: string;
  clipe: string;
  inicio_s: number;
  fim_s: number;
  fonte: string | null;
}

export interface SelecaoDoManter {
  de_s: number;
  ate_s: number;
  manter: ClipeNaSelecao[];
  remover: ClipeNaSelecao[];
  /** Vídeo ou áudio que cruza o limite: o dono decide. */
  cruzam: ClipeNaSelecao[];
  /** Texto e legenda que cruzavam: decididos pela maior parte (vão no relatório). */
  decididosPelaMaiorParte: ClipeNaSelecao[];
  /** Motivo para não seguir (alvo inválido, nada a manter, nada a tirar). */
  erro: string | null;
}

/** Folga de meio quadro a 25 fps: limite que encosta não é cruzamento. */
export const FOLGA_DO_LIMITE_S = 0.05;

const duracao = (c: ClipeParaManter) => Math.max(0, (c.saida_s - c.entrada_s) / (c.velocidade > 0 ? c.velocidade : 1));
const fim = (c: ClipeParaManter) => c.inicio_s + duracao(c);
const ehMidia = (tipo: string) => tipo === "video" || tipo === "audio" || tipo === "sobreposicao";

const semAcento = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** O pedido (ou a resposta à pergunta do agente) é para ficar só com um trecho ou um vídeo? */
export function pedeManterSomente(texto: string): boolean {
  const t = semAcento(texto);
  if (!t.trim()) return false;
  return (
    /\b(mant\w*|deix\w*|fic\w*)\s+(so|somente|apenas)\b/.test(t) ||
    /\b(so|somente|apenas)\s+(o|a|um|uma|com o|com a)\s+(primeir\w*|segund\w*|terceir\w*|ultim\w*|video|trecho|take|parte|assunto)\b/.test(t) ||
    /\b(deix\w*|fic\w*)\s+(com\s+)?(so\s+)?(um|uma)\s+(so|video|trecho)\b/.test(t) ||
    /\b(apag\w*|tir\w*|remov\w*|exclu\w*)\s+(todo\s+)?o\s+resto\b/.test(t) ||
    /\bquer\s+manter\b/.test(t) ||
    /\bqual\b.{0,40}\bmanter\b/.test(t)
  );
}

/** Ferramenta que não serve para "manter só um trecho" (não tira nada): o motivo volta ao modelo, ou null. */
export function barradaPeloManter(pedeManter: boolean, ferramenta: string, args: Record<string, unknown> | null | undefined): string | null {
  if (!pedeManter) return null;
  const skill = String((args || {}).skill || "");
  if (ferramenta === "formato" || (ferramenta === "aplicar_skill" && skill === "reenquadrar")) {
    return "Recusado: o dono pediu para ficar só com um trecho; reenquadrar não tira nada. Use manter_somente com de_s e ate_s do trecho ou com a fonte; se não souber qual, pergunte com as opções.";
  }
  return null;
}

/** Clipes que ficam, saem e cruzam o limite. Nada é alterado aqui. */
export function selecionarParaManter(trilhas: TrilhaParaManter[], alvo: AlvoDoManter): SelecaoDoManter {
  const vazia = (erro: string, de = 0, ate = 0): SelecaoDoManter => ({ de_s: de, ate_s: ate, manter: [], remover: [], cruzam: [], decididosPelaMaiorParte: [], erro });
  let de: number;
  let ate: number;
  if ("fonte" in alvo) {
    const nome = semAcento(alvo.fonte).trim();
    const daFonte: ClipeParaManter[] = [];
    trilhas.forEach((tr) => {
      if (tr.tipo !== "video") return;
      tr.clipes.forEach((c) => {
        if (c.fonte && semAcento(c.fonte) === nome) daFonte.push(c);
      });
    });
    if (!nome || !daFonte.length) return vazia(`Nenhum clipe de vídeo da fonte "${alvo.fonte}" na linha do tempo.`);
    de = Math.min(...daFonte.map((c) => c.inicio_s));
    ate = Math.max(...daFonte.map(fim));
  } else {
    de = Number(alvo.de_s);
    ate = Number(alvo.ate_s);
  }
  if (!isFinite(de) || !isFinite(ate) || de < 0 || ate - de < 0.1) return vazia("Trecho inválido: diga de_s e ate_s (ate_s maior que de_s) ou a fonte.", de, ate);
  const r: SelecaoDoManter = { de_s: de, ate_s: ate, manter: [], remover: [], cruzam: [], decididosPelaMaiorParte: [], erro: null };
  trilhas.forEach((tr) => {
    tr.clipes.forEach((c) => {
      const i = c.inicio_s;
      const f = fim(c);
      const item: ClipeNaSelecao = { trilha: tr.id, tipo: tr.tipo, clipe: c.id, inicio_s: i, fim_s: f, fonte: c.fonte };
      const dentro = i >= de - FOLGA_DO_LIMITE_S && f <= ate + FOLGA_DO_LIMITE_S;
      const fora = f <= de + FOLGA_DO_LIMITE_S || i >= ate - FOLGA_DO_LIMITE_S;
      if (dentro) r.manter.push(item);
      else if (fora) r.remover.push(item);
      else if (ehMidia(tr.tipo)) r.cruzam.push(item);
      else {
        // Texto ou legenda no limite: no começo do trecho sai (puxado para o zero, colidiria com o seguinte);
        // no fim, fica do lado da maior parte.
        const sobra = Math.max(0, Math.min(f, ate) - Math.max(i, de));
        (i >= de - FOLGA_DO_LIMITE_S && sobra >= (f - i) / 2 ? r.manter : r.remover).push(item);
        r.decididosPelaMaiorParte.push(item);
      }
    });
  });
  if (!r.cruzam.length) {
    if (!r.manter.some((x) => x.tipo === "video")) r.erro = "Nenhum clipe de vídeo cabe inteiro nesse trecho: nada para manter.";
    else if (!r.remover.length) r.erro = "Tudo já está dentro desse trecho: nada para tirar.";
  }
  return r;
}

export type OperacaoDoManter = { op: "remover"; clipe: string } | { op: "deslocar_trilha"; trilha: string; delta_s: number };

/**
 * Operações: tira o que está fora e, quando o trecho não começa no zero, puxa cada trilha que ficou
 * com clipe pelo MESMO deslocamento (legenda e vídeo seguem juntos). Trilha inteira, não clipe a clipe:
 * no projeto real as skills de corte deixam clipes vizinhos sobrepostos em 1 quadro, e mover um por um
 * esbarrava na trava de colisão. Só sem cruzamento e sem erro.
 */
export function operacoesDoManter(s: SelecaoDoManter): OperacaoDoManter[] {
  if (s.erro || s.cruzam.length) return [];
  const ops: OperacaoDoManter[] = s.remover.map((x) => ({ op: "remover" as const, clipe: x.clipe }));
  if (s.de_s > FOLGA_DO_LIMITE_S && s.manter.length) {
    const inicio = Math.min(s.de_s, ...s.manter.map((x) => x.inicio_s));
    const trilhas: string[] = [];
    s.manter.forEach((x) => {
      if (trilhas.indexOf(x.trilha) < 0) trilhas.push(x.trilha);
    });
    trilhas.forEach((t) => ops.push({ op: "deslocar_trilha", trilha: t, delta_s: -inicio }));
  }
  return ops;
}

const mmss = (s: number) => {
  const t = Math.max(0, s);
  const m = Math.floor(t / 60);
  const r = t - m * 60;
  return `${m}:${r < 10 ? "0" : ""}${r.toFixed(1).replace(".", ",")}`;
};

/** Texto para o modelo e para o relatório (com apelidos quando houver). */
export function textoDaSelecao(s: SelecaoDoManter, apelido: (id: string) => string = (id) => id): string {
  if (s.cruzam.length) {
    const lista = s.cruzam.map((x) => `${apelido(x.clipe)} (${mmss(x.inicio_s)} a ${mmss(x.fim_s)}${x.fonte ? `, ${x.fonte}` : ""})`).join("; ");
    return `Nada mudou: o limite de ${mmss(s.de_s)} a ${mmss(s.ate_s)} corta ${s.cruzam.length === 1 ? "um clipe" : "clipes"} ao meio: ${lista}. Pergunte ao dono, com opções, se ${s.cruzam.length === 1 ? "esse clipe fica ou sai" : "esses clipes ficam ou saem"} (dê os dois trechos possíveis com os tempos).`;
  }
  if (s.erro) return `Nada mudou: ${s.erro}`;
  const video = (l: ClipeNaSelecao[]) => l.filter((x) => x.tipo === "video");
  const partes = [
    `Fica o trecho ${mmss(s.de_s)} a ${mmss(s.ate_s)}: ${video(s.manter).length} ${video(s.manter).length === 1 ? "clipe de vídeo" : "clipes de vídeo"} (${video(s.manter).map((x) => apelido(x.clipe)).join(", ")}).`,
    `Saem ${s.remover.length} ${s.remover.length === 1 ? "clipe" : "clipes"} fora do trecho (${video(s.remover).length} de vídeo).`,
  ];
  if (s.decididosPelaMaiorParte.length) partes.push(`Textos e legendas no limite seguiram a maior parte: ${s.decididosPelaMaiorParte.map((x) => apelido(x.clipe)).join(", ")}.`);
  if (s.de_s > FOLGA_DO_LIMITE_S) partes.push("O que ficou foi puxado para começar no zero.");
  return partes.join(" ");
}

/** Conferência depois de aplicar: tudo cabe no trecho (já puxado para o zero) e nada de fora sobrou. */
export function conferirManter(trilhasDepois: TrilhaParaManter[], s: SelecaoDoManter): string | null {
  const ids = new Set<string>();
  trilhasDepois.forEach((t) => t.clipes.forEach((c) => ids.add(c.id)));
  const sobrou = s.remover.filter((x) => ids.has(x.clipe));
  if (sobrou.length) return `ainda estão na linha do tempo: ${sobrou.map((x) => x.clipe).join(", ")}`;
  const sumiu = s.manter.filter((x) => !ids.has(x.clipe));
  if (sumiu.length) return `saíram clipes que deviam ficar: ${sumiu.map((x) => x.clipe).join(", ")}`;
  const deslocado = s.de_s > FOLGA_DO_LIMITE_S ? s.de_s : 0;
  const teto = s.ate_s - deslocado + FOLGA_DO_LIMITE_S;
  const pelaMaiorParte = new Set(s.decididosPelaMaiorParte.map((x) => x.clipe));
  const passa: string[] = [];
  trilhasDepois.forEach((t) => t.clipes.forEach((c) => {
    if (pelaMaiorParte.has(c.id)) return;
    if (fim(c) > teto + FOLGA_DO_LIMITE_S || c.inicio_s < -FOLGA_DO_LIMITE_S) passa.push(c.id);
  }));
  return passa.length ? `clipes fora do trecho depois de aplicar: ${passa.join(", ")}` : null;
}
