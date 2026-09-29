/**
 * Prévia ao vivo: o dev server do Vite do projeto e, quando o cloudflared
 * está instalado, um túnel rápido (https://*.trycloudflare.com, sem conta).
 * Sem cloudflared, a prévia fica local (http://127.0.0.1:<porta>) e a tela
 * diz isso. Uma prévia por projeto, desligada depois de um tempo parada.
 */
import type { ChildProcess } from "node:child_process";
import { esperarNaSaida, matar, portaLivre, rodar, subir } from "./processos.ts";

type Previa = { porta: number; url: string; local: string; publica: boolean; vite: ChildProcess; tunel: ChildProcess | null; usadaEm: number };
const previas = new Map<string, Previa>();

let cloudflaredOk: boolean | null = null;
export async function temCloudflared(): Promise<boolean> {
  if (process.env.MOTOR_TUNEL === "nao") return false;
  if (cloudflaredOk !== null) return cloudflaredOk;
  const r = await rodar("cloudflared", ["--version"], { cwd: process.cwd(), prazoMs: 15_000 });
  cloudflaredOk = r.codigo === 0;
  return cloudflaredOk;
}

const viva = (p: ChildProcess | null) => !!p && p.exitCode === null;

/** Espera o servidor responder (sem depender do texto colorido da saída). */
async function responde(url: string, prazoMs: number, vivo: () => boolean): Promise<boolean> {
  const fim = Date.now() + prazoMs;
  while (Date.now() < fim && vivo()) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (r.status < 500) return true;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/** Sobe (ou reaproveita) a prévia do projeto. */
export async function garantirPrevia(projeto: string, pasta: string): Promise<{ url: string; publica: boolean; nova: boolean; aviso: string | null }> {
  const atual = previas.get(projeto);
  if (atual && viva(atual.vite) && (!atual.publica || viva(atual.tunel))) {
    atual.usadaEm = Date.now();
    return { url: atual.url, publica: atual.publica, nova: false, aviso: null };
  }
  if (atual) desligarPrevia(projeto);
  const tunel = await temCloudflared();
  const porta = await portaLivre();
  const vite = subir("npx", ["vite", "--port", String(porta), "--strictPort"], { cwd: pasta, env: { ...process.env, MOTOR_TUNEL: tunel ? "1" : "0", NO_COLOR: "1" } });
  const local = `http://127.0.0.1:${porta}`;
  if (!(await responde(local, 60_000, () => viva(vite.processo)))) {
    matar(vite.processo);
    throw new Error(`o Vite não subiu: ${vite.saida().slice(-300)}`);
  }
  let url = local;
  let tunelP: ChildProcess | null = null;
  let aviso: string | null = null;
  if (tunel) {
    const t = subir("cloudflared", ["tunnel", "--no-autoupdate", "--url", local], { cwd: pasta });
    const m = await esperarNaSaida(t.saida, /https:\/\/[a-z0-9-]+\.trycloudflare\.com/, 45_000, () => viva(t.processo));
    if (m) {
      url = m[0];
      tunelP = t.processo;
    } else {
      matar(t.processo);
      aviso = "O túnel não abriu: a prévia ficou só nesta máquina.";
    }
  } else {
    aviso = "cloudflared não instalado: a prévia ficou só nesta máquina.";
  }
  previas.set(projeto, { porta, url, local, publica: !!tunelP, vite: vite.processo, tunel: tunelP, usadaEm: Date.now() });
  return { url, publica: !!tunelP, nova: true, aviso };
}

export function desligarPrevia(projeto: string) {
  const p = previas.get(projeto);
  if (!p) return;
  matar(p.tunel);
  matar(p.vite);
  previas.delete(projeto);
}

/** Desliga as prévias paradas há mais que o prazo (padrão 60 min). */
export function limparPrevias(prazoMin = Number(process.env.MOTOR_PREVIA_MINUTOS || 60)) {
  const limite = Date.now() - prazoMin * 60_000;
  for (const [projeto, p] of previas) if (p.usadaEm < limite) desligarPrevia(projeto);
}

export function desligarTodas() {
  for (const projeto of Array.from(previas.keys())) desligarPrevia(projeto);
}
