/**
 * Registros do Aceleriq Motores com rotação (frente SUP, 01/10/2026).
 *
 * Um arquivo por fonte (supervisor.log, render.log, codigo.log, navegador.log)
 * em %LOCALAPPDATA%\Aceleriq\Motores\logs. Passou do tamanho, vira .1.log (o
 * .1 vira .2 e assim por diante) e o mais velho sai: o disco nunca enche.
 *
 * Nenhuma chave entra no registro: cada linha passa por `semSegredo`, que tira
 * os valores conhecidos (a chave de serviço e as dos provedores, que o
 * supervisor conhece) e os formatos de chave mais comuns.
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

export const TAMANHO_MAXIMO = 5 * 1024 * 1024;
export const ARQUIVOS_GUARDADOS = 5;

/** Formatos de segredo que nunca podem aparecer, mesmo que o supervisor não conheça o valor. */
const FORMATOS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT (service_role antiga)
  /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g, // chaves novas do Supabase
  /\bsk-(?:ant-|or-|proj-)?[A-Za-z0-9_-]{16,}/g, // Anthropic, OpenRouter, OpenAI
  /\b(?:vercel|vc)_[A-Za-z0-9]{16,}/gi,
];

/** Valores conhecidos (o supervisor registra aqui toda chave que carrega). */
const conhecidos = new Set<string>();

export function registrarSegredo(valor: string | null | undefined): void {
  const v = String(valor || "").trim();
  if (v.length >= 12) conhecidos.add(v);
}

export function esquecerSegredos(): void {
  conhecidos.clear();
}

export function semSegredo(texto: string): string {
  let t = String(texto);
  for (const v of conhecidos) if (t.indexOf(v) >= 0) t = t.split(v).join("[chave]");
  for (const f of FORMATOS) t = t.replace(f, "[chave]");
  return t;
}

export interface Registro {
  linha(texto: string): void;
  arquivo: string;
}

/** Gira o arquivo: base.log -> base.1.log -> ... -> base.N.log (o último sai). */
export function girar(arquivo: string, guardados = ARQUIVOS_GUARDADOS): void {
  const ext = path.extname(arquivo);
  const base = arquivo.slice(0, arquivo.length - ext.length);
  const nome = (i: number) => (i === 0 ? arquivo : `${base}.${i}${ext}`);
  if (existsSync(nome(guardados))) unlinkSync(nome(guardados));
  for (let i = guardados - 1; i >= 0; i--) if (existsSync(nome(i))) renameSync(nome(i), nome(i + 1));
}

export function abrirRegistro(pasta: string, fonte: string, opcoes: { maximo?: number; guardados?: number; tambemNoConsole?: boolean } = {}): Registro {
  mkdirSync(pasta, { recursive: true });
  const arquivo = path.join(pasta, `${fonte}.log`);
  const maximo = opcoes.maximo ?? TAMANHO_MAXIMO;
  const guardados = opcoes.guardados ?? ARQUIVOS_GUARDADOS;
  let tamanho = existsSync(arquivo) ? statSync(arquivo).size : 0;
  return {
    arquivo,
    linha(texto: string) {
      const limpo = semSegredo(String(texto).replace(/\r?\n$/, ""));
      const l = `${new Date().toISOString()} ${limpo}\n`;
      try {
        if (tamanho + Buffer.byteLength(l) > maximo && tamanho > 0) {
          girar(arquivo, guardados);
          tamanho = 0;
        }
        appendFileSync(arquivo, l, "utf8");
        tamanho += Buffer.byteLength(l);
      } catch {
        /* disco cheio ou arquivo preso: o registro nunca derruba o supervisor */
      }
      if (opcoes.tambemNoConsole) process.stdout.write(l);
    },
  };
}

/** Junta pedaços de saída de um processo em linhas inteiras. */
export function emLinhas(aoTerLinha: (l: string) => void): { escrever: (pedaco: Buffer | string) => void; fechar: () => void } {
  let resto = "";
  return {
    escrever(pedaco) {
      resto += String(pedaco);
      let i: number;
      while ((i = resto.indexOf("\n")) >= 0) {
        aoTerLinha(resto.slice(0, i).replace(/\r$/, ""));
        resto = resto.slice(i + 1);
      }
      if (resto.length > 16_000) {
        aoTerLinha(resto);
        resto = "";
      }
    },
    fechar() {
      if (resto) aoTerLinha(resto);
      resto = "";
    },
  };
}
