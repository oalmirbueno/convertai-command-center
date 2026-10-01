/**
 * Apoio dos testes do Aceleriq Motores: pasta temporária, worker falso (um
 * processo Node de verdade que fala o mesmo canal IPC dos workers) e registro
 * em memória.
 */

import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Registro } from "../registros.ts";

export function pastaTemp(prefixo = "aceleriq-motores-teste-"): string {
  return mkdtempSync(path.join(os.tmpdir(), prefixo));
}

export interface Comportamento {
  /** cai: sai com 1 logo ao subir; normal: atende o "parar"; surdo: ignora o "parar". */
  modo: "cai" | "normal" | "surdo";
  /** Logo ao subir, fica ocupado com um trabalho por N ms (avisa ocupado/ocioso). */
  trabalho_ms?: number;
  /** Abre um neto (cmd + ping) sem windowsHide, como um pacote de terceiro faria. */
  neto?: boolean;
}

/** O worker falso: mesmas mensagens do canal.ts (pronto, ocupado, ocioso, parando). */
const WORKER_FALSO = `
import { appendFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
const aqui = (n) => new URL("./" + n, import.meta.url);
const cfg = JSON.parse(readFileSync(aqui("comportamento.json"), "utf8"));
const marca = (t) => appendFileSync(aqui("eventos.log"), Date.now() + " " + t + "\\n");
const h = (v) => (v ? createHash("sha256").update(v).digest("hex").slice(0, 12) : "-");
marca("subiu " + process.pid + " sup=" + process.env.ACELERIQ_SUPERVISOR + " openrouter=" + h(process.env.OPENROUTER_API_KEY) + " servico=" + h(process.env.SUPABASE_SERVICE_ROLE_KEY));
if (cfg.modo === "cai") { console.error("erro de teste: caí ao subir"); process.exit(1); }
const mandar = (m) => { try { process.send && process.send(m); } catch {} };
mandar({ tipo: "pronto", motor: "falso", versao: "falso-1" });
let parar = false;
let ocupado = false;
if (cfg.neto) {
  const n = spawn("cmd.exe", ["/c", "ping -n 30 127.0.0.1 >nul"], { stdio: "ignore" });
  marca("neto " + n.pid);
}
process.on("message", (m) => {
  if (m && m.tipo === "parar") {
    marca("pediram parar" + (ocupado ? " (ocupado)" : ""));
    if (cfg.modo === "surdo") return;
    parar = true;
    if (!ocupado) sair();
  }
});
function sair() { marca("saiu limpo"); mandar({ tipo: "parando" }); try { process.disconnect(); } catch {} process.exit(0); }
if (cfg.trabalho_ms) {
  ocupado = true;
  mandar({ tipo: "ocupado", id: "trabalho-1" });
  marca("pegou trabalho");
  setTimeout(() => { marca("terminou trabalho"); ocupado = false; mandar({ tipo: "ocioso" }); if (parar) sair(); }, cfg.trabalho_ms);
}
setInterval(() => {}, 1000);
`;

export function criarWorkerFalso(raizDoCodigo: string, pasta: string, arquivo: string, c: Comportamento): string {
  const dir = path.join(raizDoCodigo, "workers", pasta);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, arquivo), WORKER_FALSO);
  writeFileSync(path.join(dir, "comportamento.json"), JSON.stringify(c));
  writeFileSync(path.join(dir, "eventos.log"), "");
  return dir;
}

export function mudarComportamento(dir: string, c: Comportamento): void {
  writeFileSync(path.join(dir, "comportamento.json"), JSON.stringify(c));
}

export function eventos(dir: string): Array<{ em: number; texto: string }> {
  const arq = path.join(dir, "eventos.log");
  if (!existsSync(arq)) return [];
  return readFileSync(arq, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => ({ em: Number(l.slice(0, l.indexOf(" "))), texto: l.slice(l.indexOf(" ") + 1) }));
}

export function registroEmMemoria(): Registro & { linhas: string[] } {
  const linhas: string[] = [];
  return { arquivo: "memoria", linhas, linha: (t: string) => void linhas.push(t) };
}

export async function esperarAte(cond: () => boolean, ms = 10_000, passo = 25): Promise<void> {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error(`a condição não chegou em ${ms} ms`);
    await new Promise((r) => setTimeout(r, passo));
  }
}

export const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
