/**
 * Ícone da bandeja (frente SUP, 01/10/2026).
 *
 * Escolha: NotifyIcon do .NET num PowerShell auxiliar oculto (bandeja/bandeja.ps1),
 * aberto pelo supervisor com windowsHide e falando por cano (JSON por linha).
 * - Não traz binário de terceiro: o systray2 (e parecidos) baixa um .exe em Go
 *   pelo npm, sem assinatura, que antivírus costuma barrar e que ficou sem
 *   manutenção; aqui é só o Windows (PowerShell 5.1 e WinForms vêm em todo
 *   Windows 10 e 11).
 * - Não pede npm ci: o supervisor continua sem dependência.
 * - Se o ícone cair, o supervisor e os motores seguem; ele volta sozinho.
 * Custo: um powershell.exe a mais (uns 40 MB de memória), sem janela.
 *
 * Fora do Windows não faz nada (no macOS o próximo passo é um item de barra de
 * menus; ver docs/motores/ACELERIQ-MOTORES.md).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emLinhas, type Registro } from "./registros.ts";

export type CorDaBandeja = "verde" | "amarelo" | "vermelho" | "cinza";
/** Ações do menu (clique do dono). Só "abrir", "ver-estado" e "registros" abrem algo, com freio de 10 s. */
export type AcaoDaBandeja = "abrir" | "ver-estado" | "reiniciar" | "pausar" | "retomar" | "registros" | "sair";
export const ACOES_DA_BANDEJA: AcaoDaBandeja[] = ["abrir", "ver-estado", "reiniciar", "pausar", "retomar", "registros", "sair"];

export interface EstadoDaBandeja {
  cor: CorDaBandeja;
  titulo: string;
  dica: string;
  pausado: boolean;
  painel: string;
  motores: Array<{ nome: string; texto: string }>;
}

export interface Bandeja {
  mostrar(e: EstadoDaBandeja): void;
  avisar(titulo: string, texto: string): void;
  fechar(): void;
}

export const SCRIPT_DA_BANDEJA = path.join(path.dirname(fileURLToPath(import.meta.url)), "bandeja", "bandeja.ps1");

export function bandejaNula(): Bandeja {
  return { mostrar() {}, avisar() {}, fechar() {} };
}

export function abrirBandeja(aoAgir: (a: AcaoDaBandeja) => void, registro: Registro, o: { script?: string; lancar?: typeof spawn } = {}): Bandeja {
  const script = o.script || SCRIPT_DA_BANDEJA;
  if (process.platform !== "win32" || !existsSync(script)) return bandejaNula();
  let proc: ChildProcess | null = null;
  let ultimo: EstadoDaBandeja | null = null;
  let fechada = false;
  let quedas = 0;
  const subir = () => {
    if (fechada) return;
    const p = (o.lancar || spawn)("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-STA", "-File", script], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    proc = p;
    const saida = emLinhas((l) => {
      try {
        const a = (JSON.parse(l) as { acao?: string }).acao as AcaoDaBandeja;
        if (ACOES_DA_BANDEJA.indexOf(a) >= 0) aoAgir(a);
      } catch {
        /* linha que não é ação */
      }
    });
    p.stdout?.on("data", (d) => saida.escrever(d));
    p.stderr?.on("data", (d) => registro.linha(`[bandeja] ${String(d).trim().slice(0, 300)}`));
    p.on("error", (e) => registro.linha(`[bandeja] não abriu: ${e.message}`));
    p.on("exit", (codigo) => {
      proc = null;
      if (fechada) return;
      quedas++;
      registro.linha(`[bandeja] o ícone saiu (código ${codigo}); volta em ${Math.min(60, 2 * quedas)} s`);
      if (quedas <= 20) setTimeout(subir, Math.min(60, 2 * quedas) * 1000).unref?.();
    });
    p.stdin?.on("error", () => {});
    if (ultimo) escrever({ tipo: "estado", ...ultimo });
  };
  const escrever = (m: unknown) => {
    try {
      proc?.stdin?.write(JSON.stringify(m) + "\n");
    } catch {
      /* ícone caiu: volta sozinho */
    }
  };
  subir();
  return {
    mostrar(e) {
      ultimo = e;
      escrever({ tipo: "estado", ...e });
    },
    avisar(titulo, texto) {
      escrever({ tipo: "aviso", titulo, texto });
    },
    fechar() {
      fechada = true;
      try {
        proc?.stdin?.end();
      } catch {
        /* já fechado */
      }
    },
  };
}
