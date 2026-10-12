/**
 * Medir antes, conferir depois (12/10/2026, a partir da ffmpeg-skill).
 *
 * Antes do render: ffprobe de cada mídia baixada. Taxa de quadros variável, HDR, rotação gravada e
 * vídeo sem áudio viram avisos no resultado do pedido (não param nada; ajudam a explicar um corte
 * que escorregou ou uma cor lavada).
 *
 * Depois do render, antes de subir: o arquivo final é conferido contra o projeto. Duração, tamanho,
 * codec e áudio que faltou PARAM o pedido (o vídeo não chega ao cliente com defeito); volume fora do
 * alvo, pico alto e imagem parada viram aviso. Vídeo quase todo preto, ou mudo quando o projeto tem
 * som, também para. As regras são puras (testáveis sem ffmpeg); a medida é um processo filho.
 */

import { executar, FFMPEG, FFPROBE } from "./midia.ts";

// ------------------------------------------------------------------ antes: a sonda das mídias

export interface SondaDetalhada {
  duracao_s: number | null;
  largura: number | null;
  altura: number | null;
  codec: string | null;
  pix_fmt: string | null;
  /** Quadros por segundo nominais (r_frame_rate) e médios (avg_frame_rate). */
  fps_nominal: number | null;
  fps_medio: number | null;
  transferencia: string | null;
  rotacao: number;
  tem_video: boolean;
  tem_audio: boolean;
}

type StreamDoProbe = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  color_transfer?: string;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
  disposition?: { attached_pic?: number };
};

const fracao = (t: string | undefined): number | null => {
  if (!t) return null;
  const [a, b] = t.split("/").map(Number);
  const v = b ? a / b : a;
  return isFinite(v) && v > 0 ? Math.round(v * 1000) / 1000 : null;
};

/** Lê o JSON do ffprobe (separado para teste). */
export function lerSonda(json: string): SondaDetalhada {
  const j = JSON.parse(json) as { format?: { duration?: string }; streams?: StreamDoProbe[] };
  const streams = j.streams || [];
  const v = streams.find((s) => s.codec_type === "video" && !(s.disposition && s.disposition.attached_pic));
  const d = Number(j.format && j.format.duration);
  const lado = v && v.side_data_list ? v.side_data_list.find((x) => typeof x.rotation === "number") : undefined;
  const rot = lado ? Number(lado.rotation) : v && v.tags && v.tags.rotate ? Number(v.tags.rotate) : 0;
  return {
    duracao_s: isFinite(d) ? Math.round(d * 1000) / 1000 : null,
    largura: v && v.width ? v.width : null,
    altura: v && v.height ? v.height : null,
    codec: v && v.codec_name ? v.codec_name : null,
    pix_fmt: v && v.pix_fmt ? v.pix_fmt : null,
    fps_nominal: v ? fracao(v.r_frame_rate) : null,
    fps_medio: v ? fracao(v.avg_frame_rate) : null,
    transferencia: v && v.color_transfer ? v.color_transfer : null,
    rotacao: isFinite(rot) ? ((Math.round(rot) % 360) + 360) % 360 : 0,
    tem_video: !!v,
    tem_audio: streams.some((s) => s.codec_type === "audio"),
  };
}

export async function sondarDetalhado(arquivo: string): Promise<SondaDetalhada> {
  const r = await executar(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", arquivo]);
  if (r.codigo !== 0) throw new Error(`ffprobe falhou: ${r.erros.slice(-200)}`);
  return lerSonda(r.saida.toString("utf8"));
}

const HDR = new Set(["smpte2084", "arib-std-b67"]);

/** Avisos de uma mídia de entrada. `papel` diz se ela é a voz do vídeo (aí faltar áudio importa). */
export function avisosDaEntrada(nome: string, s: SondaDetalhada, papel: "voz" | "outra" = "outra"): string[] {
  const a: string[] = [];
  if (!s.tem_video) {
    if (!s.tem_audio) a.push(`${nome}: o arquivo não tem imagem nem som legíveis.`);
    return a;
  }
  if (s.fps_nominal && s.fps_medio && Math.abs(s.fps_nominal - s.fps_medio) / s.fps_nominal > 0.01) {
    a.push(`${nome}: taxa de quadros variável (${s.fps_medio} de média para ${s.fps_nominal} nominais, típico de celular); um corte pode escorregar alguns quadros.`);
  }
  if (s.transferencia && HDR.has(s.transferencia)) a.push(`${nome}: gravado em HDR (${s.transferencia}); as cores podem sair lavadas no vídeo final.`);
  if (s.rotacao === 90 || s.rotacao === 270) a.push(`${nome}: gravado com rotação de ${s.rotacao}°; confira se a imagem saiu em pé.`);
  if (papel === "voz" && !s.tem_audio) a.push(`${nome}: é a voz do vídeo, mas o arquivo não tem áudio.`);
  return a;
}

// ------------------------------------------------------------------ depois: o conteúdo do arquivo final

export interface Deteccoes {
  preto_s: number;
  congelado_s: number;
  silencio_s: number;
}

/**
 * Soma os trechos de preto, imagem parada e silêncio no stderr do ffmpeg (blackdetect, freezedetect,
 * silencedetect). Um começo sem fim vai até o fim do vídeo.
 */
export function lerDeteccoes(stderr: string, duracao_s: number): Deteccoes {
  let preto = 0;
  for (const m of stderr.matchAll(/black_duration:\s*([\d.]+)/g)) preto += Number(m[1]) || 0;
  const somar = (inicio: RegExp, fim: RegExp) => {
    const eventos: { t: number; tipo: "i" | "f" }[] = [];
    for (const m of stderr.matchAll(inicio)) eventos.push({ t: Number(m[1]), tipo: "i" });
    for (const m of stderr.matchAll(fim)) eventos.push({ t: Number(m[1]), tipo: "f" });
    eventos.sort((a, b) => (a.t === b.t ? (a.tipo === "i" ? -1 : 1) : a.t - b.t));
    let total = 0;
    let aberto: number | null = null;
    for (const e of eventos) {
      if (!isFinite(e.t)) continue;
      if (e.tipo === "i" && aberto === null) aberto = e.t;
      else if (e.tipo === "f" && aberto !== null) {
        total += Math.max(0, e.t - aberto);
        aberto = null;
      }
    }
    if (aberto !== null) total += Math.max(0, duracao_s - aberto);
    return total;
  };
  const congelado = somar(/freeze_start:\s*([\d.]+)/g, /freeze_end:\s*([\d.]+)/g);
  const silencio = somar(/silence_start:\s*(-?[\d.]+)/g, /silence_end:\s*([\d.]+)/g);
  const r = (x: number) => Math.round(Math.min(x, duracao_s) * 100) / 100;
  return { preto_s: r(preto), congelado_s: r(congelado), silencio_s: r(silencio) };
}

/** Um passo só do ffmpeg, com a imagem reduzida (a detecção não precisa de 1080p). */
export async function detectarConteudo(arquivo: string, duracao_s: number, temAudio: boolean, sinal?: AbortSignal): Promise<Deteccoes> {
  const args = ["-hide_banner", "-nostats", "-i", arquivo, "-map", "0:v:0", "-vf", "scale=320:-2,blackdetect=d=0.5:pix_th=0.10,freezedetect=n=-60dB:d=2"];
  if (temAudio) args.push("-map", "0:a:0", "-af", "silencedetect=n=-50dB:d=1");
  args.push("-f", "null", "-");
  const r = await executar(FFMPEG, args, { sinal });
  if (r.codigo !== 0) throw new Error(`ffmpeg não conferiu o conteúdo: ${r.erros.slice(-300)}`);
  return lerDeteccoes(r.erros, duracao_s);
}

// ------------------------------------------------------------------ as regras

export type EstadoDaLinha = "ok" | "aviso" | "falha";
export interface LinhaDaConferencia {
  item: string;
  estado: EstadoDaLinha;
  detalhe: string;
}

export interface Esperado {
  duracao_s: number;
  largura: number;
  altura: number;
  /** O projeto tem som (voz, trilha ou efeito numa trilha de áudio visível). */
  tem_som: boolean;
  lufs_alvo: number;
}

export interface Medido {
  sonda: SondaDetalhada;
  lufs: number | null;
  pico_db: number | null;
  conteudo: Deteccoes | null;
}

/** Quase todo o vídeo: a partir daqui, preto e mudo param o pedido. */
export const QUASE_TUDO = 0.95;
export const TOLERANCIA_DE_LOUDNESS = 2;
export const TETO_DO_PICO_DB = -1;

const n1 = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");

export function conferirSaida(m: Medido, e: Esperado): LinhaDaConferencia[] {
  const l: LinhaDaConferencia[] = [];
  const s = m.sonda;
  const dur = s.duracao_s;
  if (dur === null) l.push({ item: "duração", estado: "falha", detalhe: "o arquivo não diz a duração" });
  else {
    const folga = Math.max(0.5, e.duracao_s * 0.02);
    const dif = Math.abs(dur - e.duracao_s);
    l.push({ item: "duração", estado: dif <= folga ? "ok" : "falha", detalhe: `${n1(dur)} s para ${n1(e.duracao_s)} s do projeto${dif <= folga ? "" : ` (diferença de ${n1(dif)} s)`}` });
  }
  const tamanhoOk = s.largura === e.largura && s.altura === e.altura;
  l.push({ item: "tamanho", estado: tamanhoOk ? "ok" : "falha", detalhe: `${s.largura ?? "?"}x${s.altura ?? "?"}${tamanhoOk ? "" : ` (o projeto é ${e.largura}x${e.altura})`}` });
  const codecOk = s.codec === "h264" && (s.pix_fmt === "yuv420p" || s.pix_fmt === "yuvj420p");
  l.push({ item: "formato", estado: codecOk ? "ok" : "falha", detalhe: `${s.codec ?? "sem vídeo"} ${s.pix_fmt ?? ""}`.trim() + (codecOk ? "" : " (as redes pedem h264 yuv420p)") });
  if (e.tem_som && !s.tem_audio) l.push({ item: "áudio", estado: "falha", detalhe: "o projeto tem som e o arquivo saiu sem áudio" });
  else l.push({ item: "áudio", estado: "ok", detalhe: s.tem_audio ? "presente" : "sem áudio (o projeto não tem som)" });
  if (s.tem_audio && m.lufs !== null) {
    const ok = Math.abs(m.lufs - e.lufs_alvo) <= TOLERANCIA_DE_LOUDNESS;
    l.push({ item: "volume", estado: ok ? "ok" : "aviso", detalhe: `${n1(m.lufs)} LUFS para o alvo de ${n1(e.lufs_alvo)}` });
  }
  if (s.tem_audio && m.pico_db !== null) {
    const ok = m.pico_db <= TETO_DO_PICO_DB;
    l.push({ item: "pico", estado: ok ? "ok" : "aviso", detalhe: `${n1(m.pico_db)} dBTP${ok ? "" : ` (acima de ${TETO_DO_PICO_DB}; pode distorcer no celular)`}` });
  }
  if (m.conteudo && dur) {
    const c = m.conteudo;
    const preto = c.preto_s / dur;
    l.push({ item: "imagem", estado: preto >= QUASE_TUDO ? "falha" : "ok", detalhe: preto >= QUASE_TUDO ? `${Math.round(preto * 100)}% do vídeo está preto` : c.preto_s > 0 ? `${n1(c.preto_s)} s de preto` : "sem trecho preto" });
    const parado = c.congelado_s / dur;
    // Imagem parada vira aviso: um vídeo de foto com narração é legítimo.
    l.push({ item: "movimento", estado: parado >= QUASE_TUDO ? "aviso" : "ok", detalhe: parado >= QUASE_TUDO ? `${Math.round(parado * 100)}% do vídeo com a imagem parada` : c.congelado_s > 0 ? `${n1(c.congelado_s)} s de imagem parada` : "imagem em movimento" });
    if (s.tem_audio) {
      const mudo = c.silencio_s / dur;
      const ruim = mudo >= QUASE_TUDO;
      l.push({ item: "som", estado: ruim ? (e.tem_som ? "falha" : "aviso") : "ok", detalhe: ruim ? `${Math.round(mudo * 100)}% do vídeo em silêncio` : c.silencio_s > 0 ? `${n1(c.silencio_s)} s de silêncio` : "sem silêncio longo" });
    }
  }
  return l;
}

export const falhasDa = (linhas: LinhaDaConferencia[]) => linhas.filter((x) => x.estado === "falha");
export const avisosDa = (linhas: LinhaDaConferencia[]) => linhas.filter((x) => x.estado === "aviso");

/** A frase do erro quando a conferência para o pedido. */
export function motivoDaFalha(linhas: LinhaDaConferencia[]): string {
  return `O vídeo saiu com problema e não foi entregue: ${falhasDa(linhas).map((x) => `${x.item} (${x.detalhe})`).join("; ")}. Peça de novo; se repetir, avise a equipe.`;
}

/**
 * O projeto tem som? Clipe com arquivo numa trilha de áudio visível e não muda, ou clipe de vídeo
 * (trilha não muda) cuja mídia tem áudio pela sonda. Mídia não sondada não conta.
 */
export function projetoTemSom(
  projeto: { trilhas: { tipo: string; oculta: boolean; muda?: boolean; clipes: { fonte: string | null }[] }[] },
  audioDaFonte: (chave: string) => boolean = () => false,
): boolean {
  return projeto.trilhas.some((t) => !t.oculta && !t.muda && t.clipes.some((c) => !!c.fonte && (t.tipo === "audio" || (t.tipo === "video" && audioDaFonte(c.fonte)))));
}
