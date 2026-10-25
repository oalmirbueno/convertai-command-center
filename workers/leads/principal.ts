/**
 * Worker da Máquina de leads (25/10/2026). Puxa as buscas de leads_buscas (RPC leads_busca_pegar), roda o
 * buscar.py (Python com Scrapling: OpenStreetMap e o site da própria empresa, sem disfarce, robots.txt
 * respeitado) e grava os candidatos em leads_candidatos, com o progresso ao vivo para a tela.
 *
 * Ligar à mão (PowerShell, na pasta workers/leads, com a chave só na sessão):
 *   python -m pip install -r requirements.txt
 *   $env:SUPABASE_URL = "https://jjjtkowvxemvituvywvf.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY = "<cole aqui, nunca em arquivo>"
 *   node principal.ts
 * Pelo Aceleriq Motores: motor "leads" (Configurações › Estado dos motores).
 * Opcionais: LEADS_EXECUTOR (nome), LEADS_INTERVALO_S (padrão 20), LEADS_PYTHON (padrão python),
 * LEADS_PRAZO_MIN (padrão 45), LEADS_PAUSA_POR_SITE_S (padrão 3). "--uma-vez" faz uma busca e sai.
 * Sem dependência de npm: só fetch.
 */

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { aoPedirParada, avisarSupervisor, encerrarCanal, esperaQueAcorda } from "../supervisor/canal.ts";
import { entradaDoPython, eventoDaLinha, linhaDoCandidato, progressoDaBusca, semSegredo } from "./regras.ts";

export const VERSAO_DO_WORKER = "lds-1.0";
const AQUI = path.dirname(fileURLToPath(import.meta.url));

export function lerAmbiente(env: NodeJS.ProcessEnv) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const chave = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) throw new Error("Falta SUPABASE_URL (https://<projeto>.supabase.co).");
  if (chave.length < 20) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY na variável de ambiente (nunca em arquivo).");
  return {
    url,
    chave,
    executor: String(env.LEADS_EXECUTOR || `${os.hostname()}-leads`).slice(0, 80),
    intervaloS: Math.max(5, Number(env.LEADS_INTERVALO_S) || 20),
    python: String(env.LEADS_PYTHON || (process.platform === "win32" ? "python" : "python3")).trim(),
    prazoMs: Math.max(5, Number(env.LEADS_PRAZO_MIN) || 45) * 60_000,
  };
}

type Cfg = ReturnType<typeof lerAmbiente>;

function rest(cfg: Cfg) {
  const cab = (extra: Record<string, string> = {}) => ({ apikey: cfg.chave, Authorization: `Bearer ${cfg.chave}`, "Content-Type": "application/json", ...extra });
  async function chamar(caminho: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
    const r = await fetch(`${cfg.url}/rest/v1/${caminho}`, { ...init, headers: cab(init.headers || {}), signal: AbortSignal.timeout(30_000) });
    const texto = await r.text();
    if (!r.ok) throw new Error(`${caminho.split("?")[0]} respondeu ${r.status}: ${semSegredo(texto).slice(0, 160)}`);
    return texto ? JSON.parse(texto) : null;
  }
  return {
    pegar: async (): Promise<Record<string, unknown> | null> => {
      const d = await chamar("rpc/leads_busca_pegar", { method: "POST", body: JSON.stringify({ _worker: cfg.executor }) });
      const l = Array.isArray(d) ? d : d ? [d] : [];
      return (l[0] as Record<string, unknown>) || null;
    },
    /** Atualiza a busca enquanto ela roda; devolve false quando a equipe cancelou (a linha não está mais rodando). */
    atualizar: async (id: string, campos: Record<string, unknown>, soSeRodando = true): Promise<boolean> => {
      const filtro = `leads_buscas?id=eq.${id}${soSeRodando ? "&situacao=eq.rodando" : ""}`;
      const d = await chamar(filtro, { method: "PATCH", body: JSON.stringify(campos), headers: { Prefer: "return=representation" } });
      return Array.isArray(d) && d.length > 0;
    },
    gravarCandidatos: async (linhas: Record<string, unknown>[]) => {
      if (!linhas.length) return;
      await chamar("leads_candidatos?on_conflict=busca_id,chave", { method: "POST", body: JSON.stringify(linhas), headers: { Prefer: "resolution=ignore-duplicates,return=minimal" } });
    },
  };
}

/** Roda uma busca do começo ao fim. Nunca lança: falha vira situacao 'falhou' com o motivo. */
export async function rodarBusca(cfg: Cfg, banco: ReturnType<typeof rest>, busca: Record<string, unknown>, log: (t: string) => void): Promise<void> {
  const id = String(busca.id);
  let encontrados = 0;
  let erro: string | null = null;
  let cancelada = false;
  let fila: Record<string, unknown>[] = [];
  let ultimoProgresso = 0;
  const filho = spawn(cfg.python, [path.join(AQUI, "buscar.py")], { cwd: AQUI, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } });
  const prazo = setTimeout(() => {
    erro = "A busca passou do prazo e foi parada (o que já tinha achado ficou).";
    filho.kill();
  }, cfg.prazoMs);
  let ultimoErroDoPython = "";
  filho.stderr.on("data", (d: Buffer) => {
    const t = String(d).trim();
    if (t) ultimoErroDoPython = t.split(/\r?\n/).slice(-1)[0].slice(0, 200);
  });
  const saiu = new Promise<number>((resolver) => {
    filho.on("error", (e) => {
      erro = `O Python não abriu (${e.message}). Instale o Python 3.10+ e rode: python -m pip install -r requirements.txt`;
      resolver(-1);
    });
    filho.on("exit", (c) => resolver(c ?? -1));
  });
  filho.stdin.end(JSON.stringify(entradaDoPython(busca)));
  const descarregar = async () => {
    const lote = fila;
    fila = [];
    await banco.gravarCandidatos(lote);
  };
  for await (const linha of createInterface({ input: filho.stdout })) {
    const e = eventoDaLinha(linha);
    if (!e) continue;
    try {
      if (e.tipo === "candidato") {
        const l = linhaDoCandidato(id, e as Record<string, unknown>);
        if (l) {
          fila.push(l);
          encontrados += 1;
          if (fila.length >= 10) await descarregar();
        }
      } else if (e.tipo === "progresso") {
        if (Date.now() - ultimoProgresso > 4000) {
          ultimoProgresso = Date.now();
          await descarregar();
          // pego_em renovado: a busca longa não volta para a fila (a RPC devolve as presas há 15 min).
          const segue = await banco.atualizar(id, { progresso: progressoDaBusca(e), encontrados, pego_em: new Date().toISOString() });
          if (!segue) {
            cancelada = true;
            filho.kill();
          }
        }
      } else if (e.tipo === "erro") {
        erro = e.mensagem;
      }
    } catch (err) {
      log(`[leads] falha ao gravar: ${semSegredo(err instanceof Error ? err.message : String(err))}`);
    }
  }
  const codigo = await saiu;
  clearTimeout(prazo);
  try {
    await descarregar();
  } catch (err) {
    erro = erro || `Não gravei os últimos candidatos: ${semSegredo(err instanceof Error ? err.message : String(err))}`;
  }
  if (cancelada) {
    log(`[leads] busca ${id} cancelada pela equipe`);
    await banco.atualizar(id, { encontrados, terminado_em: new Date().toISOString() }, false).catch(() => false);
    return;
  }
  if (codigo !== 0 && !erro) erro = `O buscador saiu com erro${ultimoErroDoPython ? `: ${ultimoErroDoPython}` : "."}`;
  const fim = erro && encontrados === 0
    ? { situacao: "falhou", erro: semSegredo(erro), encontrados, terminado_em: new Date().toISOString() }
    : { situacao: "pronta", erro: erro ? semSegredo(erro) : null, encontrados, terminado_em: new Date().toISOString(), progresso: { etapa: "Pronta", feitos: encontrados, total: encontrados } };
  await banco.atualizar(id, fim, false).catch((e2) => log(`[leads] não fechei a busca ${id}: ${semSegredo(String(e2))}`));
  log(`[leads] busca ${id}: ${fim.situacao}, ${encontrados} candidato(s)${erro ? ` (${semSegredo(erro)})` : ""}`);
}

async function principal() {
  const cfg = lerAmbiente(process.env);
  const banco = rest(cfg);
  const log = (t: string) => console.log(t);
  console.log(`[leads] ${VERSAO_DO_WORKER} · ${cfg.executor} · python: ${cfg.python}`);
  const umaVez = process.argv.indexOf("--uma-vez") >= 0;
  let parar = false;
  const soneca = esperaQueAcorda();
  process.on("SIGINT", () => {
    parar = true;
    soneca.acordar();
  });
  aoPedirParada(() => {
    parar = true;
    soneca.acordar();
    console.log("[leads] o Aceleriq Motores pediu parada: termino a busca atual e saio");
  });
  avisarSupervisor({ tipo: "pronto", motor: "leads", versao: VERSAO_DO_WORKER });
  while (!parar) {
    let pegou = false;
    try {
      const busca = await banco.pegar();
      if (busca) {
        pegou = true;
        avisarSupervisor({ tipo: "ocupado", id: String(busca.id) });
        log(`[leads] busca ${busca.id}: ${busca.nicho} em ${busca.cidade}`);
        await rodarBusca(cfg, banco, busca, log);
        avisarSupervisor({ tipo: "ocioso" });
      }
    } catch (err) {
      console.error(`[leads] falha na fila: ${semSegredo(err instanceof Error ? err.message : String(err))}`);
    }
    if (umaVez) break;
    if (!pegou && !parar) await soneca.esperar(cfg.intervaloS * 1000);
  }
  encerrarCanal();
}

if (process.argv[1] && /principal\.ts$/.test(process.argv[1])) {
  principal().catch((err) => {
    console.error(`[leads] ${semSegredo(err instanceof Error ? err.message : String(err))}`);
    process.exit(1);
  });
}
