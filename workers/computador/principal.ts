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
 * COMPUTADOR_CHROME (Chrome já baixado). Computer use com modelo (frente CUS, 01/10):
 * COMPUTADOR_COM_MODELO_LIGADO=1 e a chave de cada provedor que a máquina vai usar,
 * ANTHROPIC_API_KEY (Claude Sonnet 5.5 e Opus 5.5) e/ou OPENAI_API_KEY (GPT-6.1 Sol e GPT-6 Astra);
 * o worker escolhe o provedor pelo modelo de cada tarefa e só pega tarefa de provedor com chave.
 * ANTHROPIC_WORKSPACE_ID (opcional): chave da Anthropic sem workspace.
 * COMPUTADOR_MODELO=opus-5-5 troca o padrão das tarefas sem modelo (Sonnet 5.5).
 * Atalho: workers\ligar\ligar-navegador.cmd. "--uma-vez" faz uma tarefa e sai.
 */

import os from "node:os";
import { createClient } from "@supabase/supabase-js";
import { aoPedirParada, avisarSupervisor, encerrarCanal, esperaQueAcorda } from "../supervisor/canal.ts";
import { armazemSupabase, filaSupabase } from "./fila.ts";
import { abrirNavegador } from "./navegador.ts";
import { clienteAnthropic, clienteOpenAI, modeloDoComputador, semSegredo } from "./modelo.ts";
import { type Ambiente, casosDoWorker, pegarERodar, provedoresDoWorker } from "./trabalho.ts";

export const VERSAO_DO_WORKER = "cus-1.2";

export function lerAmbiente(env: NodeJS.ProcessEnv) {
  const url = String(env.SUPABASE_URL || "").trim();
  const chave = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) throw new Error("Falta SUPABASE_URL (https://<projeto>.supabase.co).");
  if (chave.length < 20) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY na variável de ambiente (nunca em arquivo).");
  const comModelo = String(env.COMPUTADOR_COM_MODELO_LIGADO || "").trim() === "1";
  const chaveDoModelo = String(env.ANTHROPIC_API_KEY || "").trim();
  const chaveDaOpenai = String(env.OPENAI_API_KEY || "").trim();
  return {
    url,
    chave,
    executor: String(env.COMPUTADOR_EXECUTOR || `${os.hostname()}-navegador`).slice(0, 80),
    intervaloS: Math.max(5, Number(env.COMPUTADOR_INTERVALO_S) || 20),
    chrome: String(env.COMPUTADOR_CHROME || "").trim() || null,
    comModelo,
    chaveDoModelo: comModelo && chaveDoModelo.length > 20 ? chaveDoModelo : "",
    chaveDaOpenai: comModelo && chaveDaOpenai.length > 20 ? chaveDaOpenai : "",
    workspaceAnthropic: String(env.ANTHROPIC_WORKSPACE_ID || "").trim().slice(0, 80),
    qualModelo: modeloDoComputador(env.COMPUTADOR_MODELO),
  };
}

async function principal() {
  const cfg = lerAmbiente(process.env);
  const db = createClient(cfg.url, cfg.chave, { auth: { persistSession: false, autoRefreshToken: false } });
  const filaBase = filaSupabase(db);
  let tarefaAtual: string | null = null;
  const amb: Ambiente = {
    // Frente SUP: avisa o Aceleriq Motores quando pega uma tarefa (não troca versão nem para no meio).
    fila: {
      ...filaBase,
      async pegar(token, executor, casos, versao, provedores) {
        const t = await filaBase.pegar(token, executor, casos, versao, provedores);
        if (t) {
          tarefaAtual = t.id;
          avisarSupervisor({ tipo: "ocupado", id: t.id });
        }
        return t;
      },
    },
    armazem: armazemSupabase(db),
    abrir: (op) => abrirNavegador({ ...op, executavel: cfg.chrome }),
    comModelo: cfg.comModelo,
    modelo: cfg.chaveDoModelo ? clienteAnthropic(cfg.chaveDoModelo, cfg.workspaceAnthropic) : null,
    openai: cfg.chaveDaOpenai ? clienteOpenAI(cfg.chaveDaOpenai) : null,
    qualModelo: cfg.qualModelo,
    executor: cfg.executor,
    versao: VERSAO_DO_WORKER,
    log: (m) => console.log(m),
  };
  const provedores = provedoresDoWorker(amb);
  console.log(
    `[navegador] ${VERSAO_DO_WORKER} · ${cfg.executor} · casos: ${casosDoWorker(amb).join(", ")}` +
      (provedores.length ? ` · computer use: ${provedores.join(" e ")} (padrão ${cfg.qualModelo.api})` : "") +
      (cfg.comModelo && !provedores.length ? " · computer use pedido sem ANTHROPIC_API_KEY nem OPENAI_API_KEY: fica desligado" : "") +
      (!cfg.comModelo ? " · computer use desligado (COMPUTADOR_COM_MODELO_LIGADO diferente de 1)" : ""),
  );
  const umaVez = process.argv.indexOf("--uma-vez") >= 0;
  let parar = false;
  const soneca = esperaQueAcorda();
  process.on("SIGINT", () => {
    parar = true;
    soneca.acordar();
    console.log("[navegador] parando depois da tarefa atual");
  });
  aoPedirParada(() => {
    parar = true;
    soneca.acordar();
    console.log("[navegador] o Aceleriq Motores pediu parada: termino a tarefa atual e saio");
  });
  avisarSupervisor({ tipo: "pronto", motor: "navegador", versao: VERSAO_DO_WORKER });
  let comErro = false;
  while (!parar) {
    let pegou = false;
    try {
      pegou = await pegarERodar(amb);
      // A fila voltou: o Estado dos motores deixa de mostrar o erro antigo.
      if (comErro && amb.fila.erro) await amb.fila.erro(amb.executor, null);
      comErro = false;
    } catch (err) {
      const texto = semSegredo(err instanceof Error ? err.message : String(err));
      console.error(`[navegador] falha na fila: ${texto}`);
      comErro = true;
      if (amb.fila.erro) await amb.fila.erro(amb.executor, `Falha na fila: ${texto}`).catch(() => undefined);
    }
    if (tarefaAtual) avisarSupervisor({ tipo: "ocioso" });
    tarefaAtual = null;
    if (umaVez) break;
    if (!pegou && !parar) await soneca.esperar(cfg.intervaloS * 1000);
  }
  encerrarCanal();
}

if (process.argv[1] && /principal\.ts$/.test(process.argv[1])) {
  principal().catch((err) => {
    console.error(`[navegador] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
