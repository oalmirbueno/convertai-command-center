/**
 * Lâmina de vídeo do carrossel estilo X (22/10/2026): baixa o PNG da lâmina e o vídeo do bloco,
 * monta o MP4 com o vídeo inteiro no retângulo do bloco (cantos arredondados pela máscara) e sobe
 * para a pasta do cliente. O contrato e os argumentos do ffmpeg moram em
 * supabase/functions/estudio-arte/modulos/lamina-em-video.ts (a função confere o mesmo).
 */

import { stat } from "node:fs/promises";
import path from "node:path";
import { argumentosDaComposicao, argumentosDaMascara, normalizarEntradaDaLaminaEmVideo, type EntradaDaLaminaEmVideo } from "../../supabase/functions/estudio-arte/modulos/lamina-em-video.ts";
import type { Armazem } from "./armazem.ts";
import type { PedidoDoWorker } from "./fila.ts";
import { executar, FFMPEG, sondar } from "./midia.ts";

const extensao = (c: string) => {
  const m = /\.([a-z0-9]{2,5})$/i.exec(c);
  return m ? `.${m[1].toLowerCase()}` : ".mp4";
};

/** Monta o MP4 a partir de arquivos locais (o teste usa direto, sem Storage). */
export async function comporLaminaLocal(e: EntradaDaLaminaEmVideo, a: { fundo: string; video: string; pasta: string; saida: string }): Promise<{ duracao_s: number | null; largura: number | null; altura: number | null; com_som: boolean }> {
  const mascara = path.join(a.pasta, "mascara.png");
  const m = await executar(FFMPEG, argumentosDaMascara(e, mascara));
  if (m.codigo !== 0) throw new Error(`ffmpeg não fez a máscara dos cantos: ${m.erros.slice(-300)}`);
  const sonda = await sondar(a.video);
  const c = await executar(FFMPEG, argumentosDaComposicao(e, { fundo: a.fundo, video: a.video, mascara, saida: a.saida }, sonda.duracao_s, sonda.tem_audio));
  if (c.codigo !== 0) throw new Error(`ffmpeg não montou a lâmina de vídeo: ${c.erros.slice(-400)}`);
  const final = await sondar(a.saida);
  return { duracao_s: final.duracao_s, largura: final.largura, altura: final.altura, com_som: final.tem_audio };
}

export async function trabalharLaminaVideo(
  amb: { armazem: Armazem; log?: (t: string) => void },
  p: PedidoDoWorker,
  pasta: string,
  avisar: (etapa: string, valor: number, forcar?: boolean) => Promise<void>,
): Promise<{ saida: string; arquivoId: null; resultado: Record<string, unknown> }> {
  const e = normalizarEntradaDaLaminaEmVideo(p.entrada, p.client_id);
  await avisar("baixando", 0.05, true);
  const fundo = path.join(pasta, "lamina.png");
  const video = path.join(pasta, `video${extensao(e.video.caminho)}`);
  await amb.armazem.baixar(e.fundo.bucket, e.fundo.caminho, fundo);
  await amb.armazem.baixar(e.video.bucket, e.video.caminho, video);
  await avisar("montando", 0.3, true);
  const saida = path.join(pasta, "lamina.mp4");
  const r = await comporLaminaLocal(e, { fundo, video, pasta, saida });
  await avisar("subindo", 0.85, true);
  await amb.armazem.subir("mesa", e.saida, saida, "video/mp4");
  const bytes = (await stat(saida)).size;
  if (amb.log) amb.log(`lâmina de vídeo ${e.trabalho_id.slice(0, 8)} #${e.ordem}: ${r.duracao_s}s, ${Math.round(bytes / 1024)} KB`);
  return { saida: e.saida, arquivoId: null, resultado: { ...r, bytes, trabalho_id: e.trabalho_id, ordem: e.ordem, versao: e.versao } };
}
