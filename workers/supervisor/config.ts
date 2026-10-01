/**
 * Onde o Aceleriq Motores guarda as coisas nesta máquina (frente SUP, 01/10/2026).
 *
 *   %LOCALAPPDATA%\Aceleriq\Motores\
 *     lancador.mjs        o lançador estável (o início com o Windows aponta para ele)
 *     atual.json          versão em uso, a anterior e as recusadas (volta de versão)
 *     maquina.json        id da máquina no painel, nome, motores desta máquina, endereço do projeto
 *     cofre.dat           chaves protegidas pelo DPAPI do Windows (só este usuário nesta máquina abre)
 *     versoes\<versao>\workers\...   o código de cada versão
 *     deps\<motor>-<hash>\node_modules   dependências por package-lock (versões iguais reaproveitam)
 *     logs\               registros com rotação (supervisor.log, render.log, codigo.log, navegador.log)
 *
 * No macOS (próximo passo, ver docs/motores/ACELERIQ-MOTORES.md) a raiz seria
 * ~/Library/Application Support/Aceleriq/Motores. Nada aqui guarda chave em texto.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type IdDoMotor = "render" | "codigo" | "navegador";
export const MOTORES: IdDoMotor[] = ["render", "codigo", "navegador"];

export const NOME_DO_MOTOR: Record<IdDoMotor, string> = {
  render: "Render (Motion e Edição)",
  codigo: "Motor de código (Site)",
  navegador: "Navegador do agente",
};

/** Pasta e arquivo de entrada de cada worker dentro de workers/. */
export const ENTRADA_DO_MOTOR: Record<IdDoMotor, { pasta: string; arquivo: string; args: string[] }> = {
  render: { pasta: "render", arquivo: "principal.ts", args: [] },
  codigo: { pasta: "motor-codigo", arquivo: "worker.ts", args: ["--env-file-if-exists=.env"] },
  navegador: { pasta: "computador", arquivo: "principal.ts", args: [] },
};

export const URL_PADRAO_DO_PROJETO = "https://jjjtkowvxemvituvywvf.supabase.co";
export const URL_PADRAO_DO_PAINEL = "https://aceleriq.online";

export function raizDosMotores(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ACELERIQ_MOTORES_PASTA) return path.resolve(env.ACELERIQ_MOTORES_PASTA);
  if (process.platform === "win32") return path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Aceleriq", "Motores");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Aceleriq", "Motores");
  return path.join(env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "aceleriq-motores");
}

export interface Caminhos {
  raiz: string;
  atual: string;
  maquina: string;
  cofre: string;
  versoes: string;
  deps: string;
  logs: string;
  baixados: string;
}

export function caminhos(raiz = raizDosMotores()): Caminhos {
  return {
    raiz,
    atual: path.join(raiz, "atual.json"),
    maquina: path.join(raiz, "maquina.json"),
    cofre: path.join(raiz, "cofre.dat"),
    versoes: path.join(raiz, "versoes"),
    deps: path.join(raiz, "deps"),
    logs: path.join(raiz, "logs"),
    baixados: path.join(raiz, "baixados"),
  };
}

export interface ConfigDaMaquina {
  /** id em public.motores_maquinas (null até a primeira batida, no modo migrar). */
  maquina_id: string | null;
  nome: string;
  /** Motores que ESTA máquina roda (o painel pode mudar; a batida traz a lista de lá). */
  motores: IdDoMotor[];
  supabase_url: string;
  painel_url: string;
  /** Pausado pelo menu da bandeja: continua pausado depois de reiniciar o Windows. */
  pausado?: boolean;
  /** Removida no painel: o supervisor não liga mais nada aqui. */
  revogada?: boolean;
}

export interface Atual {
  versao: string | null;
  anterior: string | null;
  /** Versão nova ainda em prova (sobe; se cair logo, volta para a anterior). */
  em_teste: boolean;
  desde: string | null;
  /** Versões que falharam ao subir: não tenta de novo. */
  recusadas: string[];
}

const ler = <T>(arq: string, padrao: T): T => {
  try {
    return { ...padrao, ...(JSON.parse(readFileSync(arq, "utf8").replace(/^﻿/, "")) as T) };
  } catch {
    return padrao;
  }
};

/** Grava JSON de forma atômica (escreve ao lado e renomeia): queda de luz não deixa arquivo pela metade. */
export function gravarJson(arq: string, dados: unknown): void {
  mkdirSync(path.dirname(arq), { recursive: true });
  const tmp = `${arq}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(dados, null, 2) + "\n", "utf8");
  renameSync(tmp, arq);
}

export function lerAtual(c: Caminhos): Atual {
  return ler<Atual>(c.atual, { versao: null, anterior: null, em_teste: false, desde: null, recusadas: [] });
}

export function lerMaquina(c: Caminhos, env: NodeJS.ProcessEnv = process.env): ConfigDaMaquina {
  const m = ler<ConfigDaMaquina>(c.maquina, {
    maquina_id: null,
    nome: os.hostname(),
    motores: [...MOTORES],
    supabase_url: env.SUPABASE_URL || URL_PADRAO_DO_PROJETO,
    painel_url: URL_PADRAO_DO_PAINEL,
  });
  m.motores = (Array.isArray(m.motores) ? m.motores : []).filter((x): x is IdDoMotor => MOTORES.indexOf(x as IdDoMotor) >= 0);
  return m;
}

export function pastaDaVersao(c: Caminhos, versao: string): string {
  if (!/^[0-9a-z][0-9a-z._-]{2,40}$/i.test(versao)) throw new Error(`versão inválida: ${versao}`);
  return path.join(c.versoes, versao);
}

export function versaoInstalada(c: Caminhos, versao: string): boolean {
  return existsSync(path.join(pastaDaVersao(c, versao), "workers", "supervisor", "principal.ts"));
}
