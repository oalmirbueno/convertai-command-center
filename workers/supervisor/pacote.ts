/**
 * Pacote dos workers (frente SUP, 01/10/2026).
 *
 * Versão = os 10 primeiros caracteres do hash da árvore `workers/` no git: o
 * mesmo código dá a mesma versão (publicado do main ou montado de um clone),
 * e qualquer mudança em qualquer worker dá versão nova.
 *
 * O pacote é o zip dessa árvore (`git archive`), com o caminho `workers/...`.
 * Na máquina: extrai em versoes\<versao>, instala as dependências de cada
 * motor numa pasta por package-lock (deps\<motor>-<hash>) e liga por junção,
 * então duas versões com o mesmo lock não baixam nada de novo.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ENTRADA_DO_MOTOR, type IdDoMotor } from "./config.ts";
import type { Registro } from "./registros.ts";

export const FORMATO_DA_VERSAO = /^[0-9a-f]{10}$/;

function git(repo: string, args: string[]): string {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${String(r.stderr || r.error || "").trim().slice(0, 300)}`);
  return String(r.stdout).trim();
}

/** Árvore `workers/` do HEAD (publicação) ou do índice (o que está staged, para testes e o modo migrar). */
export function arvoreDosWorkers(repo: string, deOnde: "HEAD" | "indice" = "HEAD"): string {
  const raiz = deOnde === "indice" ? git(repo, ["write-tree"]) : "HEAD";
  return git(repo, ["rev-parse", `${raiz}:workers`]);
}

export const versaoDaArvore = (arvore: string) => arvore.slice(0, 10).toLowerCase();

/** Monta o zip da árvore dos workers. Devolve versão, sha256 e tamanho. */
export function montarPacote(repo: string, destinoZip: string, deOnde: "HEAD" | "indice" = "HEAD"): { versao: string; sha256: string; tamanho: number; arvore: string } {
  const arvore = arvoreDosWorkers(repo, deOnde);
  mkdirSync(path.dirname(destinoZip), { recursive: true });
  git(repo, ["-c", "core.autocrlf=false", "archive", "--format=zip", "--prefix=workers/", "-o", destinoZip, arvore]);
  const bytes = readFileSync(destinoZip);
  return { versao: versaoDaArvore(arvore), sha256: sha256(bytes), tamanho: bytes.length, arvore };
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface Rodar {
  (comando: string, args: string[], opcoes: { cwd: string; registro?: Registro; env?: NodeJS.ProcessEnv; prazoMs?: number }): Promise<number>;
}

/** Roda um programa sem janela e manda a saída para o registro. Devolve o código de saída. */
export const rodar: Rodar = (comando, args, o) =>
  new Promise((resolver) => {
    const p = spawn(comando, args, { cwd: o.cwd, env: o.env || process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const linha = (d: Buffer) => {
      for (const l of String(d).split(/\r?\n/)) if (l.trim()) o.registro?.linha(`  ${l}`);
    };
    p.stdout.on("data", linha);
    p.stderr.on("data", linha);
    const t = o.prazoMs ? setTimeout(() => p.kill(), o.prazoMs) : null;
    p.on("error", (e) => {
      o.registro?.linha(`  falhou ao rodar ${comando}: ${e.message}`);
      if (t) clearTimeout(t);
      resolver(-1);
    });
    p.on("exit", (c) => {
      if (t) clearTimeout(t);
      resolver(c ?? -1);
    });
  });

/** O tar do sistema (no Windows, o bsdtar de System32, que lê zip; nunca o GNU tar do Git, que não lê). */
export function comandoDoTar(): string {
  if (process.platform !== "win32") return "tar";
  const t = path.join(process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows", "System32", "tar.exe");
  return existsSync(t) ? t : "tar";
}

/** Extrai o zip (tar do Windows 10+ e do macOS lê zip) numa pasta nova e só então renomeia. */
export async function extrairPacote(zip: string, destino: string, registro?: Registro, r: Rodar = rodar): Promise<void> {
  const tmp = `${destino}.extraindo`;
  tirarJuncoes(tmp);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const codigo = await r(comandoDoTar(), ["-xf", zip, "-C", tmp], { cwd: tmp, registro });
  if (codigo !== 0) throw new Error(`não consegui extrair o pacote (tar saiu com ${codigo})`);
  if (!existsSync(path.join(tmp, "workers", "supervisor", "principal.ts"))) throw new Error("o pacote não tem workers/supervisor/principal.ts");
  tirarJuncoes(destino);
  rmSync(destino, { recursive: true, force: true });
  renameSync(tmp, destino);
}

/** Copia a árvore dos workers de um clone (modo migrar) para versoes\<versao>, sem node_modules. */
export function copiarDoClone(origemWorkers: string, destino: string): void {
  const tmp = `${destino}.copiando`;
  tirarJuncoes(tmp);
  rmSync(tmp, { recursive: true, force: true });
  cpSync(origemWorkers, path.join(tmp, "workers"), {
    recursive: true,
    // Sem dependências, provas locais, build e arquivos .env (chave mora no cofre DPAPI, nunca copiada em texto).
    filter: (de) => !/[\\/](node_modules|tmp|\.vite|dist|\.git)([\\/]|$)|[\\/]\.env(\.[^\\/]*)?$/.test(de.slice(origemWorkers.length)),
  });
  tirarJuncoes(destino);
  rmSync(destino, { recursive: true, force: true });
  renameSync(tmp, destino);
}

/** O npm desta instalação do Node (npm-cli.js ao lado do node.exe), sem depender do PATH. */
export function comandoDoNpm(node = process.execPath): { comando: string; args: string[] } {
  const candidatos = [
    path.join(path.dirname(node), "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(node), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const c of candidatos) if (existsSync(c)) return { comando: node, args: [c] };
  return { comando: process.platform === "win32" ? "npm.cmd" : "npm", args: [] };
}

const MARCA = ".aceleriq-deps-ok";

export function hashDoLock(pastaDoWorker: string): string {
  const lock = path.join(pastaDoWorker, "package-lock.json");
  const pkg = path.join(pastaDoWorker, "package.json");
  return sha256(Buffer.concat([existsSync(pkg) ? readFileSync(pkg) : Buffer.alloc(0), existsSync(lock) ? readFileSync(lock) : Buffer.alloc(0)])).slice(0, 12);
}

/** Liga `alvo` em `caminho` (junção no Windows, link simbólico fora dele). */
export function ligarPasta(alvo: string, caminho: string): void {
  try {
    const st = lstatSync(caminho);
    if (st.isSymbolicLink() || st.isDirectory()) rmSync(caminho, { recursive: false, force: true });
  } catch {
    /* não existe */
  }
  symlinkSync(alvo, caminho, process.platform === "win32" ? "junction" : "dir");
}

/**
 * Dependências de um motor numa versão: pasta por hash do lock em deps\, `npm ci`
 * só se ainda não houver, e a junção node_modules na pasta do worker.
 */
export async function prepararDependencias(
  pastaDaVersao: string,
  pastaDeps: string,
  motor: IdDoMotor,
  o: { registro?: Registro; rodar?: Rodar; node?: string; semNpm?: boolean } = {},
): Promise<{ deps: string; instalou: boolean }> {
  const r = o.rodar || rodar;
  const pastaDoWorker = path.join(pastaDaVersao, "workers", ENTRADA_DO_MOTOR[motor].pasta);
  if (!existsSync(path.join(pastaDoWorker, "package.json"))) throw new Error(`o pacote não tem workers/${ENTRADA_DO_MOTOR[motor].pasta}/package.json`);
  const deps = path.join(pastaDeps, `${ENTRADA_DO_MOTOR[motor].pasta}-${hashDoLock(pastaDoWorker)}`);
  let instalou = false;
  if (!existsSync(path.join(deps, MARCA))) {
    mkdirSync(deps, { recursive: true });
    for (const a of ["package.json", "package-lock.json"]) if (existsSync(path.join(pastaDoWorker, a))) cpSync(path.join(pastaDoWorker, a), path.join(deps, a));
    if (!o.semNpm) {
      const npm = comandoDoNpm(o.node);
      o.registro?.linha(`[supervisor] instalando as dependências de ${motor} (npm ci)`);
      const temLock = existsSync(path.join(deps, "package-lock.json"));
      const codigo = await r(npm.comando, [...npm.args, temLock ? "ci" : "install", "--no-audit", "--no-fund", "--prefer-offline", "--loglevel=error"], { cwd: deps, registro: o.registro, prazoMs: 30 * 60_000 });
      if (codigo !== 0) throw new Error(`npm ci de ${motor} saiu com ${codigo}`);
    } else {
      mkdirSync(path.join(deps, "node_modules"), { recursive: true });
    }
    writeFileSync(path.join(deps, MARCA), new Date().toISOString());
    instalou = true;
  }
  mkdirSync(path.join(deps, "node_modules"), { recursive: true });
  ligarPasta(path.join(deps, "node_modules"), path.join(pastaDoWorker, "node_modules"));
  if (motor === "navegador" && !o.semNpm && existsSync(path.join(deps, "node_modules", "playwright-core", "cli.js"))) {
    // O Chromium do navegador do agente (fica em %LOCALAPPDATA%\ms-playwright; já baixado, é instantâneo).
    await r(o.node || process.execPath, [path.join(deps, "node_modules", "playwright-core", "cli.js"), "install", "chromium"], { cwd: pastaDoWorker, registro: o.registro, prazoMs: 20 * 60_000 });
  }
  return { deps, instalou };
}

/** Desfaz as junções node_modules de uma versão antes de apagá-la (nunca apagar o que está em deps\ por elas). */
export function tirarJuncoes(pastaDaVersao: string): void {
  const ws = path.join(pastaDaVersao, "workers");
  if (!existsSync(ws)) return;
  for (const w of readdirSync(ws)) {
    const nm = path.join(ws, w, "node_modules");
    try {
      if (lstatSync(nm).isSymbolicLink()) unlinkSync(nm);
    } catch {
      /* não há */
    }
  }
}

const alvoDaJuncao = (caminho: string) => path.resolve(readlinkSync(caminho).replace(/^\\\\\?\\/, ""));

/** Tira versões e dependências que nada usa (mantém a atual, a anterior e a que está chegando). */
export function limparAntigas(pastaVersoes: string, pastaDeps: string, manter: Array<string | null>): string[] {
  const fica = new Set(manter.filter(Boolean) as string[]);
  const tirados: string[] = [];
  if (existsSync(pastaVersoes)) {
    for (const v of readdirSync(pastaVersoes)) {
      if (fica.has(v)) continue;
      tirarJuncoes(path.join(pastaVersoes, v));
      rmSync(path.join(pastaVersoes, v), { recursive: true, force: true });
      tirados.push(`versoes/${v}`);
    }
  }
  // Dependências ainda ligadas por alguma versão que ficou.
  const usadas = new Set<string>();
  for (const v of fica) {
    const ws = path.join(pastaVersoes, v, "workers");
    if (!existsSync(ws)) continue;
    for (const w of readdirSync(ws)) {
      try {
        usadas.add(path.basename(path.dirname(alvoDaJuncao(path.join(ws, w, "node_modules")))));
      } catch {
        /* sem junção */
      }
    }
  }
  if (existsSync(pastaDeps)) {
    for (const d of readdirSync(pastaDeps)) {
      if (usadas.has(d)) continue;
      rmSync(path.join(pastaDeps, d), { recursive: true, force: true });
      tirados.push(`deps/${d}`);
    }
  }
  return tirados;
}

/** Troca pasta pronta por pasta pronta (usada pelo migrar e pelos testes). */
export function moverPara(origem: string, destino: string): void {
  tirarJuncoes(destino);
  rmSync(destino, { recursive: true, force: true });
  renameSync(origem, destino);
}
