/**
 * Arquivos com nome reservado do Windows (nul, con, prn, aux, com1..9,
 * lpt1..9) dentro do projeto. O bash do agente é o do Git: um `2>nul` (hábito
 * do cmd) cria um arquivo "nul" de verdade, e o `git add -A` do commit quebra
 * ("short read while indexing nul"), derrubando o trabalho inteiro. Achado na
 * prova da seção inteira da frente UIM (30/09), quando o bash passou a rodar.
 * O worker apaga esses arquivos antes de cada commit; no Windows, só pelo
 * caminho \\?\ (sem ele, "nul" é o dispositivo e nada é apagado).
 */
import { readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export const NOME_RESERVADO = /^(nul|con|prn|aux|com[1-9]|lpt[1-9])(\.[^.]*)?$/i;
const FORA = new Set(["node_modules", ".git", "dist", "dist-ssr", ".vite"]);

/** Os caminhos dos arquivos reservados do projeto (sem entrar em node_modules, .git e build). */
export function arquivosReservados(pasta: string, maxPastas = 400): string[] {
  const achados: string[] = [];
  const fila = [pasta];
  let vistas = 0;
  while (fila.length && vistas < maxPastas) {
    const d = fila.shift() as string;
    vistas++;
    let itens: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> = [];
    try {
      itens = readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const i of itens) {
      if (i.isDirectory()) {
        if (!FORA.has(i.name)) fila.push(join(d, i.name));
      } else if (NOME_RESERVADO.test(i.name)) achados.push(join(d, i.name));
    }
  }
  return achados;
}

/** Apaga os arquivos reservados e devolve quantos saíram. Nunca lança. */
export function apagarArquivosReservados(pasta: string, windows = process.platform === "win32"): number {
  let n = 0;
  for (const c of arquivosReservados(pasta)) {
    try {
      unlinkSync(windows && !/^\\\\\?\\/.test(c) ? `\\\\?\\${c}` : c);
      n++;
    } catch {
      /* sumiu antes ou está em uso: o git dirá */
    }
  }
  return n;
}
