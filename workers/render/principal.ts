/**
 * Worker de render da Mesa Edição (frente EDT, 30/09/2026).
 *
 * Roda na máquina da agência e puxa a fila render_pedidos: onda do áudio,
 * amostra de 8 a 15 s e vídeo inteiro; frente MOT: cena HyperFrames (still,
 * amostra de 5 s ou final com alfa) e batidas da trilha da Mesa Motion; frente
 * TCN: troca de cenário (preparar o trecho e compor a final, por ffmpeg). Um pedido por vez. Sem pedido, olha a
 * fila de novo a cada RENDER_INTERVALO_S (padrão 15 s).
 *
 * Ligar (PowerShell, na pasta workers/render, com a chave só na sessão):
 *   $env:SUPABASE_URL = "https://jjjtkowvxemvituvywvf.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY = "<cole aqui, nunca em arquivo>"
 *   npm run worker
 * Opcionais: RENDER_WORKER_NOME, RENDER_CHROME (Chrome Headless Shell já
 * baixado), RENDER_PASTA, RENDER_INTERVALO_S, RENDER_CONCORRENCIA,
 * RENDER_FFMPEG, RENDER_FFPROBE, RENDER_HYPERFRAMES e RENDER_GSAP (frente MOT).
 * "--uma-vez" faz um pedido e sai. RENDER_SAIR_OCIOSO_S (render na nuvem, 02/10):
 * sai sozinho depois de tantos segundos sem pedido, para a máquina da nuvem
 * desligar e não cobrar parada.
 */

import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { aoPedirParada, avisarSupervisor, encerrarCanal, esperaQueAcorda } from "../supervisor/canal.ts";
import { armazemSupabase } from "./armazem.ts";
import { baterPonto, capacidadesDoWorker, INTERVALO_DA_BATIDA_MS } from "./batida.ts";
import { filaSupabase, type Fila } from "./fila.ts";
import { PASTA_DO_WORKER, umPedido, type Ambiente } from "./trabalho.ts";

// Frente TCN (01/10): "+tcn-1" = sabe a troca de cenário (o banco só entrega o tipo "cenario" a quem tem "tcn-").
// Mesa Edição (02/10): "+trt-1" = sabe tratar vídeo (tirar legenda, melhorar qualidade; o banco só entrega o tipo "tratamento" a quem tem "trt-").
export const VERSAO_DO_WORKER = "edt-1.0+mot-1.0+mtr-1+tcn-1+trt-1+mov-1";

export function lerAmbiente(env: NodeJS.ProcessEnv): { url: string; chave: string; nome: string; pasta: string; intervalo: number; chrome: string | null; concorrencia: number | null; sairOciosoS: number | null } {
  const url = String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").trim();
  const chave = String(env.SUPABASE_SERVICE_ROLE_KEY || env.RENDER_CHAVE || "").trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) throw new Error("Falta SUPABASE_URL (https://<projeto>.supabase.co).");
  if (chave.length < 20) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY na variável de ambiente (nunca em arquivo).");
  const intervalo = Math.max(5, Number(env.RENDER_INTERVALO_S) || 15);
  const conc = Number(env.RENDER_CONCORRENCIA);
  const ocioso = Number(env.RENDER_SAIR_OCIOSO_S);
  return {
    url,
    chave,
    nome: String(env.RENDER_WORKER_NOME || `${os.hostname()}-render`).slice(0, 80),
    pasta: env.RENDER_PASTA || path.join(os.tmpdir(), "aceleriq-render"),
    intervalo,
    chrome: env.RENDER_CHROME ? String(env.RENDER_CHROME) : null,
    concorrencia: isFinite(conc) && conc > 0 ? Math.floor(conc) : null,
    sairOciosoS: isFinite(ocioso) && ocioso > 0 ? ocioso : null,
  };
}

async function principal() {
  const cfg = lerAmbiente(process.env);
  const db = createClient(cfg.url, cfg.chave, { auth: { persistSession: false, autoRefreshToken: false } });
  // Frente MTR: batida a cada 30 s, inclusive no meio de um render longo, com o que esta máquina tem.
  const caps = await capacidadesDoWorker(PASTA_DO_WORKER);
  if (caps.faltas.length) console.warn(`Atenção nesta máquina: ${caps.faltas.join("; ")}.`);
  const iniciadoEm = new Date().toISOString();
  let pedidoAtual: string | null = null;
  const filaBase = filaSupabase(db);
  const fila: Fila = {
    ...filaBase,
    async pegar(token, worker, versao) {
      const p = await filaBase.pegar(token, worker, versao);
      pedidoAtual = p ? p.id : null;
      // Frente SUP: o Aceleriq Motores sabe que há render em curso (não troca versão nem para no meio).
      if (p) avisarSupervisor({ tipo: "ocupado", id: p.id });
      return p;
    },
  };
  let avisouBatida = false;
  const bater = async () => {
    const ok = await baterPonto(db, cfg.nome, VERSAO_DO_WORKER, caps, { pedido_id: pedidoAtual, iniciado_em: iniciadoEm }).catch(() => false);
    if (!ok && !avisouBatida) console.error("A batida não foi gravada (rede ou chave?). O worker segue tentando.");
    avisouBatida = !ok;
  };
  await bater();
  const relogio = setInterval(() => void bater(), INTERVALO_DA_BATIDA_MS);
  const amb: Ambiente = {
    fila,
    armazem: armazemSupabase(cfg.url, cfg.chave),
    token: randomUUID(),
    pasta: cfg.pasta,
    chrome: cfg.chrome,
    concorrencia: cfg.concorrencia,
    log: (t) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${t}`),
  };
  const umaVez = process.argv.indexOf("--uma-vez") >= 0;
  let parar = false;
  const soneca = esperaQueAcorda();
  process.on("SIGINT", () => {
    console.log("Parando depois do pedido em curso.");
    parar = true;
    soneca.acordar();
  });
  // Frente SUP: parada limpa pedida pelo Aceleriq Motores (termina o pedido em curso e sai).
  aoPedirParada(() => {
    console.log("O Aceleriq Motores pediu parada: termino o pedido em curso e saio.");
    parar = true;
    soneca.acordar();
  });
  avisarSupervisor({ tipo: "pronto", motor: "render", versao: VERSAO_DO_WORKER });
  console.log(`Worker ${cfg.nome} (${VERSAO_DO_WORKER}) olhando a fila a cada ${cfg.intervalo} s. Ctrl+C para parar.`);
  let ultimoPedido = Date.now();
  while (!parar) {
    let feito = null;
    try {
      feito = await umPedido(amb, cfg.nome, VERSAO_DO_WORKER);
    } catch (e) {
      // Falha ao falar com a fila (rede, banco): espera o intervalo e olha de novo; nada é repetido às cegas.
      console.error(`A fila não respondeu: ${e instanceof Error ? e.message : e}`);
    }
    if (pedidoAtual) avisarSupervisor({ tipo: "ocioso" });
    pedidoAtual = null;
    if (feito) console.log(`${feito.tipo} ${feito.id}: ${feito.estado} (${feito.detalhe})`);
    if (umaVez) break;
    if (feito) ultimoPedido = Date.now();
    else if (cfg.sairOciosoS !== null && Date.now() - ultimoPedido >= cfg.sairOciosoS * 1000) {
      console.log(`Fila vazia há ${cfg.sairOciosoS} s: saio (render na nuvem).`);
      break;
    }
    if (!feito && !parar) await soneca.esperar((cfg.sairOciosoS !== null ? Math.min(cfg.intervalo, 5) : cfg.intervalo) * 1000);
  }
  clearInterval(relogio);
  encerrarCanal();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  principal().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
