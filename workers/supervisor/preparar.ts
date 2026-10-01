/**
 * Prepara uma versão nesta máquina (frente SUP, 01/10/2026). O instalador chama
 * depois de extrair o pacote (ou, no modo migrar, para copiar de um clone):
 *
 *   node <versao>\workers\supervisor\preparar.ts --pasta <raiz> --motores render,codigo,navegador
 *   node <clone>\workers\supervisor\preparar.ts --pasta <raiz> --do-clone <clone> --motores ...
 *   --sem-npm   não roda npm ci (teste)
 *
 * Faz: (do clone) copia workers\ para versoes\<versao>; instala as dependências
 * de cada motor (deps\ por package-lock, junção node_modules); copia o lançador
 * estável para a raiz; aponta atual.json para esta versão (a que estava vira a
 * anterior). Escreve o passo a passo na tela do instalador.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { caminhos, gravarJson, type IdDoMotor, lerAtual, MOTORES, NOME_DO_MOTOR, pastaDaVersao } from "./config.ts";
import { arvoreDosWorkers, copiarDoClone, PASTAS_DO_PACOTE, prepararDependencias, sha256, versaoDaArvore } from "./pacote.ts";
import type { Registro } from "./registros.ts";

const args = process.argv.slice(2);
const valor = (f: string) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : undefined);
const AQUI = path.dirname(fileURLToPath(import.meta.url));

const tela: Registro = { arquivo: "tela", linha: (t) => console.log(t) };

/** Versão de um clone: o hash das árvores do pacote no git; fora do git, um hash do caminho e da hora. */
export function versaoDoClone(clone: string): string {
  try {
    const st = spawnSync("git", ["-C", clone, "status", "--porcelain", "--", ...PASTAS_DO_PACOTE], { encoding: "utf8", windowsHide: true });
    const limpo = st.status === 0 && !String(st.stdout).trim();
    if (limpo) return versaoDaArvore(arvoreDosWorkers(clone, "HEAD"));
    // Clone com mudança local: versão própria (não confunde com a publicada).
    return sha256(`${clone}|${Date.now()}`).slice(0, 10);
  } catch {
    return sha256(`${clone}|${Date.now()}`).slice(0, 10);
  }
}

async function preparar(): Promise<void> {
  const raiz = path.resolve(valor("--pasta") || "");
  if (!valor("--pasta")) throw new Error("faltou --pasta <pasta dos motores>");
  const c = caminhos(raiz);
  const motores = String(valor("--motores") || MOTORES.join(","))
    .split(",")
    .map((m) => m.trim())
    .filter((m): m is IdDoMotor => MOTORES.indexOf(m as IdDoMotor) >= 0);
  const semNpm = args.indexOf("--sem-npm") >= 0;
  let versao: string;
  let pasta: string;
  const clone = valor("--do-clone");
  if (clone) {
    versao = versaoDoClone(path.resolve(clone));
    pasta = pastaDaVersao(c, versao);
    console.log(`Copiando os workers de ${clone} (versão ${versao})...`);
    mkdirSync(c.versoes, { recursive: true });
    copiarDoClone(path.resolve(clone), pasta);
  } else {
    // Rodando de dentro de versoes\<versao>\workers\supervisor.
    pasta = path.resolve(AQUI, "..", "..");
    versao = path.basename(pasta);
    if (path.resolve(path.dirname(pasta)) !== path.resolve(c.versoes)) throw new Error(`este preparar.ts não está em ${c.versoes}`);
  }
  for (const m of motores) {
    console.log(`Dependências de ${NOME_DO_MOTOR[m]}${semNpm ? " (sem npm, teste)" : " (npm ci; na primeira vez leva alguns minutos)"}...`);
    const r = await prepararDependencias(pasta, c.deps, m, { registro: tela, semNpm });
    console.log(r.instalou ? `  ok, instaladas em ${path.basename(r.deps)}` : `  ok, reaproveitadas de ${path.basename(r.deps)}`);
  }
  copyFileSync(path.join(pasta, "workers", "supervisor", "lancador.mjs"), path.join(raiz, "lancador.mjs"));
  const a = lerAtual(c);
  gravarJson(c.atual, {
    versao,
    anterior: a.versao && a.versao !== versao && existsSync(pastaDaVersao(c, a.versao)) ? a.versao : a.anterior,
    em_teste: false,
    desde: new Date().toISOString(),
    recusadas: (a.recusadas || []).filter((v) => v !== versao),
  });
  console.log(`VERSAO=${versao}`);
}

if (process.argv[1] && /preparar\.ts$/.test(process.argv[1])) {
  preparar().catch((e) => {
    console.error(`Não consegui preparar a versão: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
