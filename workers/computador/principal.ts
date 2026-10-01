/**
 * Worker do navegador do agente (frente MOD, 30/09/2026).
 *
 * Roda na máquina da agência (a mesma do worker de render) e puxa as tarefas
 * de navegador que o DONO confirmou no painel: capturar a tela inteira de um
 * site de referência (Mesa Site) e conferir se um post está no ar (Agenda).
 * A coleta de dados públicos com computer use do Claude (proposta) está
 * pronta e desligada. Uma tarefa por vez; sem tarefa, olha de novo a cada
 * COMPUTADOR_INTERVALO_S (padrão 20 s).
 *
 * Ligar (PowerShell, na pasta workers/computador, com a chave só na sessão):
 *   npm install
 *   npm run navegador                     (baixa o Chromium do Playwright, uma vez)
 *   $env:SUPABASE_URL = "https://jjjtkowvxemvituvywvf.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY = "<cole aqui, nunca em arquivo>"
 *   npm run worker
 * Opcionais: COMPUTADOR_EXECUTOR (nome), COMPUTADOR_INTERVALO_S,
 * COMPUTADOR_CHROME (Chrome já baixado). Computer use com modelo (desligado):
 * COMPUTADOR_COM_MODELO_LIGADO=1 e ANTHROPIC_API_KEY, os dois na sessão;
 * COMPUTADOR_MODELO=opus-5-5 troca o Sonnet 5.5 (padrão) pelo Opus 5.5.
 * "--uma-vez" faz uma tarefa e sai.
 */

import os from "node:os";
import { setTimeout as esperar } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { armazemSupabase, filaSupabase } from "./fila.ts";
import { abrirNavegador } from "./navegador.ts";
import { clienteAnthropic, modeloDoComputador } from "./modelo.ts";
import { type Ambiente, casosDoWorker, pegarERodar } from "./trabalho.ts";

export const VERSAO_DO_WORKER = "mod-1.1";

export function lerAmbiente(env: NodeJS.ProcessEnv) {
  const url = String(env.SUPABASE_URL || "").trim();
  const chave = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) throw new Error("Falta SUPABASE_URL (https://<projeto>.supabase.co).");
  if (chave.length < 20) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY na variável de ambiente (nunca em arquivo).");
  const comModelo = String(env.COMPUTADOR_COM_MODELO_LIGADO || "").trim() === "1";
  const chaveDoModelo = String(env.ANTHROPIC_API_KEY || "").trim();
  return {
    url,
    chave,
    executor: String(env.COMPUTADOR_EXECUTOR || `${os.hostname()}-navegador`).slice(0, 80),
    intervaloS: Math.max(5, Number(env.COMPUTADOR_INTERVALO_S) || 20),
    chrome: String(env.COMPUTADOR_CHROME || "").trim() || null,
    comModelo,
    chaveDoModelo: comModelo && chaveDoModelo.length > 20 ? chaveDoModelo : "",
    qualModelo: modeloDoComputador(env.COMPUTADOR_MODELO),
  };
}

async function principal() {
  const cfg = lerAmbiente(process.env);
  const db = createClient(cfg.url, cfg.chave, { auth: { persistSession: false, autoRefreshToken: false } });
  const amb: Ambiente = {
    fila: filaSupabase(db),
    armazem: armazemSupabase(db),
    abrir: (op) => abrirNavegador({ ...op, executavel: cfg.chrome }),
    comModelo: cfg.comModelo,
    modelo: cfg.chaveDoModelo ? clienteAnthropic(cfg.chaveDoModelo) : null,
    qualModelo: cfg.qualModelo,
    executor: cfg.executor,
    versao: VERSAO_DO_WORKER,
    log: (m) => console.log(m),
  };
  console.log(`[navegador] ${VERSAO_DO_WORKER} · ${cfg.executor} · casos: ${casosDoWorker(amb).join(", ")}${amb.modelo ? ` · ${cfg.qualModelo.api}` : ""}${cfg.comModelo && !amb.modelo ? " · computer use pedido sem ANTHROPIC_API_KEY: fica desligado" : ""}`);
  const umaVez = process.argv.indexOf("--uma-vez") >= 0;
  let parar = false;
  process.on("SIGINT", () => {
    parar = true;
    console.log("[navegador] parando depois da tarefa atual");
  });
  while (!parar) {
    let pegou = false;
    try {
      pegou = await pegarERodar(amb);
    } catch (err) {
      console.error(`[navegador] falha na fila: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (umaVez) break;
    if (!pegou) await esperar(cfg.intervaloS * 1000);
  }
}

if (process.argv[1] && /principal\.ts$/.test(process.argv[1])) {
  principal().catch((err) => {
    console.error(`[navegador] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
