/**
 * Batida do worker de render (frente MTR, 30/09/2026).
 *
 * Antes, o worker só aparecia em render_workers quando olhava a fila
 * (render_pedidos_pegar). Um render de 10 minutos deixava o "visto_em" velho e
 * a tela dizia "a máquina parece desligada" no meio do trabalho. Agora o
 * worker bate a cada 30 s (inclusive durante o render) e diz o que tem nesta
 * máquina (ffmpeg, HyperFrames, GSAP, Chrome), para o Estado dos motores
 * (Configurações) dizer o que falta.
 *
 * A escrita é direta na tabela (a service_role tem ALL em render_workers).
 * Sem as colunas novas (migration 20260930316000), grava só nome, visto_em e
 * versão: a batida nunca derruba o worker.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import { arquivoDoGsap, comandoDoHyperframes } from "./hyperframes.ts";
import { executar, FFMPEG, FFPROBE } from "./midia.ts";

export const INTERVALO_DA_BATIDA_MS = 30_000;

export interface CapacidadesDoRender {
  node: string;
  ffmpeg: boolean;
  ffprobe: boolean;
  hyperframes: boolean;
  gsap: boolean;
  /** "proprio" = RENDER_CHROME apontado e existente; "do_remotion" = o Remotion baixa/usa o dele. */
  chrome: "proprio" | "do_remotion" | "caminho_invalido";
  faltas: string[];
}

async function temPrograma(cmd: string): Promise<boolean> {
  try {
    const r = await executar(cmd, ["-version"], { sinal: AbortSignal.timeout(15_000) });
    return r.codigo === 0;
  } catch {
    return false;
  }
}

const tem = (f: () => unknown) => {
  try {
    f();
    return true;
  } catch {
    return false;
  }
};

/** O que esta máquina tem para renderizar (medido uma vez na partida). */
export async function capacidadesDoWorker(pastaDoWorker: string, env: NodeJS.ProcessEnv = process.env): Promise<CapacidadesDoRender> {
  const [ffmpeg, ffprobe] = await Promise.all([temPrograma(FFMPEG), temPrograma(FFPROBE)]);
  const hyperframes = tem(() => comandoDoHyperframes(pastaDoWorker));
  const gsap = tem(() => arquivoDoGsap(pastaDoWorker));
  const chromeEnv = String(env.RENDER_CHROME || "").trim();
  const chrome: CapacidadesDoRender["chrome"] = chromeEnv ? (existsSync(chromeEnv) ? "proprio" : "caminho_invalido") : "do_remotion";
  return { node: process.version, ffmpeg, ffprobe, hyperframes, gsap, chrome, faltas: faltasDoRender({ ffmpeg, ffprobe, hyperframes, gsap, chrome }) };
}

/** Em português, o que falta para cada tipo de pedido (vai para a tela; vazio = tudo certo). */
export function faltasDoRender(c: Pick<CapacidadesDoRender, "ffmpeg" | "ffprobe" | "hyperframes" | "gsap" | "chrome">): string[] {
  const f: string[] = [];
  if (!c.ffmpeg || !c.ffprobe) f.push("ffmpeg/ffprobe fora do PATH (winget install Gyan.FFmpeg) ou RENDER_FFMPEG e RENDER_FFPROBE");
  if (!c.hyperframes) f.push("HyperFrames não instalado no worker (npm ci na pasta workers/render): cenas do Motion não renderizam");
  if (!c.gsap) f.push("GSAP não instalado no worker (npm ci na pasta workers/render): cenas do Motion não renderizam");
  if (c.chrome === "caminho_invalido") f.push("RENDER_CHROME aponta para um arquivo que não existe");
  return f;
}

/** Uma batida. Devolve false quando nem a linha mínima foi gravada (a fila provavelmente também não responde). */
export async function baterPonto(db: SupabaseClient, nome: string, versao: string, caps: CapacidadesDoRender | null, extra: { pedido_id: string | null; iniciado_em: string }): Promise<boolean> {
  const agora = new Date().toISOString();
  const completa = await db.from("render_workers").upsert({ nome, visto_em: agora, versao: versao.slice(0, 40), capacidades: caps, pedido_id: extra.pedido_id, iniciado_em: extra.iniciado_em });
  if (!completa.error) return true;
  // Banco sem as colunas da frente MTR: a linha mínima basta para a tela saber que a máquina está ligada.
  const minima = await db.from("render_workers").upsert({ nome, visto_em: agora, versao: versao.slice(0, 40) });
  return !minima.error;
}
