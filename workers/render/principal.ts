/**
 * Worker de render da Mesa Edição (frente EDT, 30/09/2026).
 *
 * Roda na máquina da agência e puxa a fila render_pedidos: onda do áudio,
 * amostra de 8 a 15 s e vídeo inteiro; frente MOT: cena HyperFrames (still,
 * amostra de 5 s ou final com alfa) e batidas da trilha da Mesa Motion. Um pedido por vez. Sem pedido, olha a
 * fila de novo a cada RENDER_INTERVALO_S (padrão 15 s).
 *
 * Ligar (PowerShell, na pasta workers/render, com a chave só na sessão):
 *   $env:SUPABASE_URL = "https://jjjtkowvxemvituvywvf.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY = "<cole aqui, nunca em arquivo>"
 *   npm run worker
 * Opcionais: RENDER_WORKER_NOME, RENDER_CHROME (Chrome Headless Shell já
 * baixado), RENDER_PASTA, RENDER_INTERVALO_S, RENDER_CONCORRENCIA,
 * RENDER_FFMPEG, RENDER_FFPROBE, RENDER_HYPERFRAMES e RENDER_GSAP (frente MOT).
 * "--uma-vez" faz um pedido e sai.
 */

import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { setTimeout as esperar } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { armazemSupabase } from "./armazem.ts";
import { filaSupabase } from "./fila.ts";
import { umPedido, type Ambiente } from "./trabalho.ts";

export const VERSAO_DO_WORKER = "edt-1.0+mot-1.0";

export function lerAmbiente(env: NodeJS.ProcessEnv): { url: string; chave: string; nome: string; pasta: string; intervalo: number; chrome: string | null; concorrencia: number | null } {
  const url = String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").trim();
  const chave = String(env.SUPABASE_SERVICE_ROLE_KEY || env.RENDER_CHAVE || "").trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) throw new Error("Falta SUPABASE_URL (https://<projeto>.supabase.co).");
  if (chave.length < 20) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY na variável de ambiente (nunca em arquivo).");
  const intervalo = Math.max(5, Number(env.RENDER_INTERVALO_S) || 15);
  const conc = Number(env.RENDER_CONCORRENCIA);
  return {
    url,
    chave,
    nome: String(env.RENDER_WORKER_NOME || `${os.hostname()}-render`).slice(0, 80),
    pasta: env.RENDER_PASTA || path.join(os.tmpdir(), "aceleriq-render"),
    intervalo,
    chrome: env.RENDER_CHROME ? String(env.RENDER_CHROME) : null,
    concorrencia: isFinite(conc) && conc > 0 ? Math.floor(conc) : null,
  };
}

async function principal() {
  const cfg = lerAmbiente(process.env);
  const db = createClient(cfg.url, cfg.chave, { auth: { persistSession: false, autoRefreshToken: false } });
  const amb: Ambiente = {
    fila: filaSupabase(db),
    armazem: armazemSupabase(cfg.url, cfg.chave),
    token: randomUUID(),
    pasta: cfg.pasta,
    chrome: cfg.chrome,
    concorrencia: cfg.concorrencia,
    log: (t) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${t}`),
  };
  const umaVez = process.argv.indexOf("--uma-vez") >= 0;
  let parar = false;
  process.on("SIGINT", () => {
    console.log("Parando depois do pedido em curso.");
    parar = true;
  });
  console.log(`Worker ${cfg.nome} (${VERSAO_DO_WORKER}) olhando a fila a cada ${cfg.intervalo} s. Ctrl+C para parar.`);
  while (!parar) {
    let feito = null;
    try {
      feito = await umPedido(amb, cfg.nome, VERSAO_DO_WORKER);
    } catch (e) {
      // Falha ao falar com a fila (rede, banco): espera o intervalo e olha de novo; nada é repetido às cegas.
      console.error(`A fila não respondeu: ${e instanceof Error ? e.message : e}`);
    }
    if (feito) console.log(`${feito.tipo} ${feito.id}: ${feito.estado} (${feito.detalhe})`);
    if (umaVez) break;
    if (!feito) await esperar(cfg.intervalo * 1000);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  principal().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
