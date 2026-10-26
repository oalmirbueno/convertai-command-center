/**
 * Motor "ego" do worker do navegador (26/10/2026): roda o pedido no Ego Lite do PC do dono, com os logins
 * dele, pelo CLI oficial (`ego-browser nodejs`), em vez do Chromium descartável.
 *
 * - Acha o CLI pela versão instalada mais nova em "C:\Program Files\Citro Labs\ego lite\Application\<versão>\"
 *   (o atalho ~/.local/share/ego/active_version_dir pode apontar para versão velha; não é usado).
 *   EGO_BROWSER_BIN troca o caminho.
 * - Se o Ego não estiver aberto, abre (ego.exe): sem a janela do Ego o CLI fica esperando para sempre.
 * - Escreve um .mjs por pedido (dados embutidos; o runtime do Ego não herda variáveis de ambiente) que
 *   importa ego-roteiro.mjs, roda com tempo máximo e lê o resultado de uma linha marcada.
 * - Nunca lê cookie, senha ou token; nunca exporta o perfil; nunca limpa estado do navegador.
 *
 * Modo (COMPUTADOR_EGO): "logado" (padrão: os pedidos do PC e também as conferências de post em sites onde o
 * dono fica logado, a lista do navegador do PC, vão para o Ego), "so_pc" (só os pedidos dos agentes pelo
 * MCP; o resto continua no Chromium descartável), "desligado" (o worker não anuncia o navegador do PC).
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ALVO_SENSIVEL_DO_PC,
  CAMINHO_PROIBIDO_DO_PC,
  CAMPO_DE_BUSCA,
  CASO_DO_PC,
  DOMINIOS_DO_PC,
  hostPermitidoNoPc,
  HOSTS_PROIBIDOS_DO_PC,
  type PassoDoPc,
  URL_DE_LOGIN,
} from "../../supabase/functions/computador-do-agente/modulos/navegador-do-pc.ts";

export type ModoDoEgo = "desligado" | "so_pc" | "logado";
export type Motor = "ego" | "chromium";

/** Casos que o motor ego sabe rodar (os outros precisam do Chromium do Playwright: tela inteira, celular, modelo). */
export const CASOS_DO_EGO = [CASO_DO_PC, "conferir_post"] as const;

export const MARCA_DO_RESULTADO = "@@ACELERIQ_EGO@@";
export const ARQUIVO_DO_RESULTADO = "resultado.json";
export const TEMPO_MAXIMO_PADRAO_S = 240;

/** Mesmas fontes do módulo de regras, para o roteiro que roda dentro do Ego (sem TypeScript lá). */
export const REGRAS_DO_EGO = {
  dominios: DOMINIOS_DO_PC,
  hostsProibidos: HOSTS_PROIBIDOS_DO_PC.source,
  caminhoProibido: CAMINHO_PROIBIDO_DO_PC.source,
  alvoSensivel: ALVO_SENSIVEL_DO_PC.source,
  campoDeBusca: CAMPO_DE_BUSCA.source,
  urlDeLogin: URL_DE_LOGIN.source,
};

export function modoDoEgo(env: NodeJS.ProcessEnv): ModoDoEgo {
  const v = String(env.COMPUTADOR_EGO || "").trim().toLowerCase();
  if (v === "desligado" || v === "0" || v === "nao" || v === "não") return "desligado";
  if (v === "so_pc" || v === "só_pc" || v === "pc") return "so_pc";
  return "logado";
}

const versao = (v: string) => v.split(".").map((n) => Number(n) || 0);
function maisNova(a: string, b: string): number {
  const x = versao(a);
  const y = versao(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0);
  return 0;
}

export interface CaminhosDoEgo {
  cli: string;
  app: string | null;
  versao: string | null;
}

/** Acha o ego-browser.exe da versão instalada mais nova (ou EGO_BROWSER_BIN). null = Ego não instalado. */
export function acharEgo(env: NodeJS.ProcessEnv, existe: (p: string) => boolean = existsSync, listar: (p: string) => string[] = (p) => readdirSync(p)): CaminhosDoEgo | null {
  const manual = String(env.EGO_BROWSER_BIN || "").trim();
  if (manual) {
    if (!existe(manual)) return null;
    const app = path.join(path.dirname(path.dirname(manual)), "ego.exe");
    return { cli: manual, app: existe(app) ? app : null, versao: path.basename(path.dirname(manual)) };
  }
  const bases = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Programs") : null, "C:\\Program Files"]
    .filter(Boolean)
    .map((b) => path.join(String(b), "Citro Labs", "ego lite", "Application"));
  for (const base of Array.from(new Set(bases))) {
    let versoes: string[] = [];
    try {
      versoes = listar(base).filter((n) => /^\d+(\.\d+)+$/.test(n)).sort(maisNova);
    } catch {
      continue;
    }
    for (const v of versoes) {
      const cli = path.join(base, v, "ego-browser.exe");
      if (existe(cli)) {
        const app = path.join(base, "ego.exe");
        return { cli, app: existe(app) ? app : null, versao: v };
      }
    }
  }
  return null;
}

/** Qual motor roda a tarefa. Pedido do PC sem Ego = null (indisponível). */
export function motorDoPedido(t: { caso: string; url_inicial: string }, modo: ModoDoEgo | null): Motor | null {
  const temEgo = !!modo && modo !== "desligado";
  if (t.caso === CASO_DO_PC) return temEgo ? "ego" : null;
  if (!temEgo || modo === "so_pc" || (CASOS_DO_EGO as readonly string[]).indexOf(t.caso) < 0) return "chromium";
  // "logado": só sites em que o dono fica logado (a lista do navegador do PC); o resto, Chromium descartável.
  return hostPermitidoNoPc(t.url_inicial) ? "ego" : "chromium";
}

export interface PassoFeitoNoEgo {
  passo: number;
  acao: string;
  ok: boolean;
  url?: string;
  texto?: string;
  rotulo?: string;
  popup?: boolean;
}

export interface SaidaDoEgo {
  passos: PassoFeitoNoEgo[];
  prints: Array<{ caminho: string; legenda: string }>;
  parou: { codigo: string; motivo: string } | null;
  erro: string | null;
  url_final: string | null;
  titulo: string | null;
  texto_final: string | null;
  espaco?: string;
}

export interface EntradaDoEgo {
  nomeDoEspaco: string;
  passos: PassoDoPc[];
  limiteTexto?: number;
}

export interface MotorDoEgo {
  modo: ModoDoEgo;
  versao: string | null;
  rodar(entrada: EntradaDoEgo): Promise<SaidaDoEgo>;
  /** Lê um print que o roteiro gravou e apaga a pasta do pedido. */
  lerPrint(caminho: string): Uint8Array;
  limpar(saida: SaidaDoEgo): void;
}

/** Tira do resultado a linha marcada (o resto da saída do CLI é log). */
export function lerSaidaDoEgo(stdout: string): SaidaDoEgo | null {
  const linhas = String(stdout || "").split(/\r?\n/);
  for (let i = linhas.length - 1; i >= 0; i--) {
    const k = linhas[i].indexOf(MARCA_DO_RESULTADO);
    if (k >= 0) {
      try {
        return JSON.parse(linhas[i].slice(k + MARCA_DO_RESULTADO.length)) as SaidaDoEgo;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** O .mjs que o Ego roda: dados embutidos e o roteiro importado por URL de arquivo. */
export function scriptDoPedido(roteiroUrl: string, dirSaida: string, entrada: EntradaDoEgo): string {
  const pedido = { passos: entrada.passos, regras: REGRAS_DO_EGO, limiteTexto: entrada.limiteTexto || 8000 };
  return [
    `const { rodar } = await import(${JSON.stringify(roteiroUrl)});`,
    `const saida = await rodar({ taskSpace, dirSaida: ${JSON.stringify(dirSaida.replace(/\\/g, "/"))}, nomeDoEspaco: ${JSON.stringify(entrada.nomeDoEspaco)} }, ${JSON.stringify(pedido)});`,
    // Arquivo é o caminho firme (o CLI pode quebrar linha longa no console); a linha marcada fica de reserva.
    `const fs = await import("node:fs/promises");`,
    `await fs.writeFile(${JSON.stringify(`${dirSaida.replace(/\\/g, "/")}/${ARQUIVO_DO_RESULTADO}`)}, JSON.stringify(saida), "utf8");`,
    `console.log(${JSON.stringify(MARCA_DO_RESULTADO)} + JSON.stringify({ ok: true }));`,
    "",
  ].join("\n");
}

function rodarProcesso(cmd: string, args: string[], tempoS: number): Promise<{ codigo: number | null; saida: string; erro: string; estourou: boolean }> {
  return new Promise((ok) => {
    const filho = spawn(cmd, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let saida = "";
    let erro = "";
    let estourou = false;
    const prazo = setTimeout(() => {
      estourou = true;
      filho.kill();
    }, tempoS * 1000);
    filho.stdout.on("data", (d) => (saida = (saida + d.toString()).slice(-400_000)));
    filho.stderr.on("data", (d) => (erro = (erro + d.toString()).slice(-20_000)));
    filho.on("error", (e) => {
      clearTimeout(prazo);
      ok({ codigo: null, saida, erro: `${erro}\n${e.message}`, estourou });
    });
    filho.on("close", (codigo) => {
      clearTimeout(prazo);
      ok({ codigo, saida, erro, estourou });
    });
  });
}

/** O Ego (janela) está aberto? Só pelo nome do processo; nada é lido de dentro dele. */
export async function egoAberto(): Promise<boolean> {
  if (process.platform !== "win32") return true;
  const r = await rodarProcesso("tasklist", ["/FI", "IMAGENAME eq ego.exe", "/NH"], 15);
  return /ego\.exe/i.test(r.saida);
}

async function garantirEgoAberto(app: string | null, log: (m: string) => void): Promise<boolean> {
  if (await egoAberto()) return true;
  if (!app) return false;
  log("[navegador] Ego fechado: abrindo o Ego Lite do dono");
  const filho = spawn(app, [], { detached: true, stdio: "ignore", windowsHide: false });
  filho.unref();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await egoAberto()) {
      await new Promise((r) => setTimeout(r, 4000));
      return true;
    }
  }
  return false;
}

const ROTEIRO = path.join(path.dirname(fileURLToPath(import.meta.url)), "ego-roteiro.mjs");

/** O motor real (Ego deste PC). null quando desligado ou sem Ego instalado. */
export function motorDoEgo(env: NodeJS.ProcessEnv, log: (m: string) => void = () => undefined): MotorDoEgo | null {
  const modo = modoDoEgo(env);
  if (modo === "desligado") return null;
  const caminhos = acharEgo(env);
  if (!caminhos) return null;
  const tempoS = Math.max(30, Math.min(900, Number(env.COMPUTADOR_EGO_TEMPO_S) || TEMPO_MAXIMO_PADRAO_S));
  const raiz = path.join(os.tmpdir(), "aceleriq-ego");
  return {
    modo,
    versao: caminhos.versao,
    async rodar(entrada) {
      const vazia = (motivo: string): SaidaDoEgo => ({ passos: [], prints: [], parou: null, erro: motivo, url_final: null, titulo: null, texto_final: null });
      if (!(await garantirEgoAberto(caminhos.app, log))) return vazia("O Ego Lite não abriu neste PC.");
      const dir = path.join(raiz, entrada.nomeDoEspaco.replace(/[^a-z0-9-]/gi, "_"));
      mkdirSync(dir, { recursive: true });
      const arquivo = path.join(dir, "pedido.mjs");
      writeFileSync(arquivo, scriptDoPedido(pathToFileURL(ROTEIRO).href, dir, entrada), "utf8");
      // Entrada ASCII de uma linha, sem aspas duplas (o guia do Ego pede isso no Windows).
      const r = await rodarProcesso(caminhos.cli, ["nodejs", "-e", `await import('${pathToFileURL(arquivo).href}')`], tempoS);
      const arquivoDoResultado = path.join(dir, ARQUIVO_DO_RESULTADO);
      if (existsSync(arquivoDoResultado)) {
        try {
          return JSON.parse(readFileSync(arquivoDoResultado, "utf8")) as SaidaDoEgo;
        } catch {
          // Cai para a linha marcada abaixo.
        }
      }
      const saida = lerSaidaDoEgo(r.saida);
      if (saida && Array.isArray(saida.passos)) return saida;
      if (r.estourou) return vazia(`O Ego não terminou em ${tempoS} s.`);
      return vazia(`O Ego não devolveu resultado (código ${r.codigo}): ${(r.erro || r.saida).replace(/\s+/g, " ").slice(-300)}`);
    },
    lerPrint(caminho) {
      return new Uint8Array(readFileSync(caminho));
    },
    limpar(saida) {
      const pastas = new Set(saida.prints.map((p) => path.dirname(p.caminho)));
      if (saida.espaco) pastas.add(path.join(raiz, saida.espaco.replace(/[^a-z0-9-]/gi, "_")));
      for (const p of pastas) if (path.resolve(p).startsWith(path.resolve(raiz))) rmSync(p, { recursive: true, force: true });
    },
  };
}
