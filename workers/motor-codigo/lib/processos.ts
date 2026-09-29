/**
 * Processos do worker: rodar um comando com prazo e guardar a saída, sem
 * travar o laço. No Windows, npm e npx são .cmd e precisam de shell; git,
 * opencode e cloudflared são .exe e rodam direto (sem shell, sem aspas).
 */
import { spawn, type ChildProcess } from "node:child_process";

export type SaidaDoComando = { codigo: number | null; saida: string; erro: string; estourou: boolean };

const ehWindows = process.platform === "win32";
const PRECISA_DE_SHELL = new Set(["npm", "npx"]);

export function rodar(cmd: string, args: string[], opcoes: { cwd: string; env?: NodeJS.ProcessEnv; prazoMs?: number } ): Promise<SaidaDoComando> {
  return new Promise((resolver) => {
    const shell = ehWindows && PRECISA_DE_SHELL.has(cmd);
    const p = spawn(cmd, args, { cwd: opcoes.cwd, env: opcoes.env || process.env, shell, windowsHide: true });
    let saida = "";
    let erro = "";
    let estourou = false;
    const relogio = setTimeout(() => {
      estourou = true;
      matar(p);
    }, opcoes.prazoMs ?? 10 * 60_000);
    p.stdout?.on("data", (c) => {
      saida = (saida + c.toString()).slice(-200_000);
    });
    p.stderr?.on("data", (c) => {
      erro = (erro + c.toString()).slice(-200_000);
    });
    p.on("error", (e) => {
      clearTimeout(relogio);
      resolver({ codigo: -1, saida, erro: `${erro}\n${e.message}`, estourou });
    });
    p.on("close", (codigo) => {
      clearTimeout(relogio);
      resolver({ codigo, saida, erro, estourou });
    });
  });
}

/** Sobe um processo que fica vivo (servidor), com a saída guardada para achar a URL. */
export function subir(cmd: string, args: string[], opcoes: { cwd: string; env?: NodeJS.ProcessEnv }): { processo: ChildProcess; saida: () => string } {
  const shell = ehWindows && PRECISA_DE_SHELL.has(cmd);
  const p = spawn(cmd, args, { cwd: opcoes.cwd, env: opcoes.env || process.env, shell, windowsHide: true });
  let saida = "";
  const juntar = (c: Buffer) => {
    saida = (saida + c.toString()).slice(-100_000);
  };
  p.stdout?.on("data", juntar);
  p.stderr?.on("data", juntar);
  return { processo: p, saida: () => saida };
}

/** Espera um texto aparecer na saída (ex.: a URL do servidor). */
export async function esperarNaSaida(saida: () => string, padrao: RegExp, prazoMs: number, vivo: () => boolean = () => true): Promise<RegExpExecArray | null> {
  const fim = Date.now() + prazoMs;
  while (Date.now() < fim) {
    const m = padrao.exec(saida());
    if (m) return m;
    if (!vivo()) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

/** Mata o processo e os filhos (no Windows, taskkill /T; shell deixa filhos órfãos). */
export function matar(p: ChildProcess | null | undefined) {
  if (!p || p.exitCode !== null || !p.pid) return;
  if (ehWindows) {
    spawn("taskkill", ["/PID", String(p.pid), "/T", "/F"], { windowsHide: true }).on("error", () => {});
  } else {
    try {
      p.kill("SIGTERM");
    } catch {
      /* já saiu */
    }
  }
}

/** Uma porta livre em 127.0.0.1. */
export async function portaLivre(): Promise<number> {
  const net = await import("node:net");
  return await new Promise((resolver, rejeitar) => {
    const s = net.createServer();
    s.unref();
    s.on("error", rejeitar);
    s.listen(0, "127.0.0.1", () => {
      const endereco = s.address();
      const porta = typeof endereco === "object" && endereco ? endereco.port : 0;
      s.close(() => resolver(porta));
    });
  });
}

export const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
