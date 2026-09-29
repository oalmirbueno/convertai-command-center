/**
 * ffmpeg e ffprobe no worker (frente EDT): áudio mono para medir a onda,
 * loudness (LUFS), sonda do arquivo e o -14 LUFS do render em dois passos.
 * Tudo por processo filho, sem shell.
 */

import { spawn } from "node:child_process";
import { filtroLoudnormAplicar, filtroLoudnormMedir, lerLoudnorm, MIXAGEM_PADRAO, type MedidaDoLoudnorm } from "../../supabase/functions/_shared/som-do-editor.ts";

export const FFMPEG = process.env.RENDER_FFMPEG || "ffmpeg";
export const FFPROBE = process.env.RENDER_FFPROBE || "ffprobe";

export interface Execucao {
  codigo: number;
  saida: Buffer;
  erros: string;
}

/** Roda um programa e junta a saída; `aoTexto` recebe cada pedaço de texto (progresso); `sinal` mata. */
export function executar(cmd: string, args: string[], o: { cwd?: string; aoTexto?: (t: string) => void; sinal?: AbortSignal; binario?: boolean } = {}): Promise<Execucao> {
  return new Promise((ok, falhou) => {
    const p = spawn(cmd, args, { cwd: o.cwd, windowsHide: true, signal: o.sinal });
    const partes: Buffer[] = [];
    let erros = "";
    p.stdout.on("data", (d: Buffer) => {
      partes.push(d);
      if (o.aoTexto && !o.binario) o.aoTexto(d.toString("utf8"));
    });
    p.stderr.on("data", (d: Buffer) => {
      const t = d.toString("utf8");
      erros = (erros + t).slice(-20000);
      if (o.aoTexto) o.aoTexto(t);
    });
    p.on("error", falhou);
    p.on("close", (codigo) => ok({ codigo: codigo === null ? -1 : codigo, saida: Buffer.concat(partes), erros }));
  });
}

/** Áudio mono em float (-1..1), na taxa pedida. */
export async function amostrasMono(arquivo: string, taxa = 16000): Promise<Float32Array> {
  const r = await executar(FFMPEG, ["-v", "error", "-i", arquivo, "-vn", "-ac", "1", "-ar", String(taxa), "-f", "f32le", "-"], { binario: true });
  if (r.codigo !== 0) throw new Error(`ffmpeg não leu o áudio: ${r.erros.slice(-300)}`);
  const b = r.saida;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + Math.floor(b.length / 4) * 4));
}

/** Medida do loudnorm (passo 1). Arquivo sem áudio: null. */
export async function medirLoudness(arquivo: string, alvo: number = MIXAGEM_PADRAO.lufs_alvo): Promise<MedidaDoLoudnorm | null> {
  const r = await executar(FFMPEG, ["-hide_banner", "-nostats", "-i", arquivo, "-vn", "-af", filtroLoudnormMedir(alvo), "-f", "null", "-"]);
  if (r.codigo !== 0) return null;
  const m = lerLoudnorm(r.erros);
  return m && isFinite(m.input_i) && m.input_i > -70 ? m : null;
}

export interface Sonda {
  duracao_s: number | null;
  largura: number | null;
  altura: number | null;
  tem_audio: boolean;
}

export async function sondar(arquivo: string): Promise<Sonda> {
  const r = await executar(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", arquivo]);
  if (r.codigo !== 0) throw new Error(`ffprobe falhou: ${r.erros.slice(-200)}`);
  const j = JSON.parse(r.saida.toString("utf8")) as { format?: { duration?: string }; streams?: { codec_type?: string; width?: number; height?: number }[] };
  const v = (j.streams || []).find((s) => s.codec_type === "video");
  const d = Number(j.format && j.format.duration);
  return { duracao_s: isFinite(d) ? Math.round(d * 1000) / 1000 : null, largura: v && v.width ? v.width : null, altura: v && v.height ? v.height : null, tem_audio: (j.streams || []).some((s) => s.codec_type === "audio") };
}

/**
 * -14 LUFS no arquivo final (dois passos do loudnorm, linear quando dá). O
 * vídeo é copiado sem recodificar; o áudio vira AAC 192k. Sem áudio: copia.
 */
export async function normalizarLoudness(entrada: string, saida: string, alvo: number = MIXAGEM_PADRAO.lufs_alvo, sinal?: AbortSignal): Promise<{ antes: number | null; depois: number | null }> {
  const m = await medirLoudness(entrada, alvo);
  if (!m) {
    const c = await executar(FFMPEG, ["-y", "-v", "error", "-i", entrada, "-c", "copy", saida], { sinal });
    if (c.codigo !== 0) throw new Error(`ffmpeg não copiou: ${c.erros.slice(-300)}`);
    return { antes: null, depois: null };
  }
  const r = await executar(FFMPEG, ["-y", "-hide_banner", "-nostats", "-i", entrada, "-c:v", "copy", "-af", `${filtroLoudnormAplicar(m, alvo)},aresample=48000`, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", saida], { sinal });
  if (r.codigo !== 0) throw new Error(`ffmpeg não acertou o volume: ${r.erros.slice(-300)}`);
  const depois = await medirLoudness(saida, alvo);
  return { antes: m.input_i, depois: depois ? depois.input_i : null };
}
