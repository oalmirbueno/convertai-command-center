/**
 * Cofre local do Aceleriq Motores (frente SUP, 01/10/2026).
 *
 * As chaves desta máquina (a chave de serviço do Supabase que o pareamento
 * trouxe e, no modo migrar, as dos provedores que estavam nas variáveis do
 * usuário) ficam em cofre.dat, protegidas pelo DPAPI do Windows no escopo do
 * USUÁRIO: só este usuário, nesta máquina, abre. Nunca em texto puro, nunca em
 * variável de ambiente nova. O valor viaja só por cano (stdin/stdout) entre o
 * PowerShell oculto e o supervisor, e vive só na memória dos processos.
 *
 * Formato: o JSON {NOME: valor} em UTF-8, protegido com ProtectedData
 * (CurrentUser) e a entropia abaixo. O instalador (instalar-motores.ps1) grava
 * no mesmo formato.
 *
 * macOS (próximo passo): Keychain (`security add-generic-password -s
 * aceleriq-motores`), mesma interface. Ver docs/motores/ACELERIQ-MOTORES.md.
 */

import { spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";

/** Entropia extra do DPAPI (não é segredo: só separa este cofre de outros blobs do usuário). */
export const ENTROPIA = "Aceleriq Motores v1";

export interface Cofre {
  ler(): Promise<Record<string, string>>;
  gravar(valores: Record<string, string>): Promise<void>;
  apagar(): Promise<void>;
  existe(): boolean;
}

const SCRIPT_LER = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$b = [IO.File]::ReadAllBytes($env:ACELERIQ_COFRE)
$e = [Text.Encoding]::UTF8.GetBytes('${ENTROPIA}')
$d = [Security.Cryptography.ProtectedData]::Unprotect($b, $e, [Security.Cryptography.DataProtectionScope]::CurrentUser)
$o = [Console]::OpenStandardOutput()
$o.Write($d, 0, $d.Length)
$o.Flush()
[Array]::Clear($d, 0, $d.Length)
`;

const SCRIPT_GRAVAR = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$i = [Console]::OpenStandardInput()
$m = New-Object IO.MemoryStream
$i.CopyTo($m)
$d = $m.ToArray()
$e = [Text.Encoding]::UTF8.GetBytes('${ENTROPIA}')
$p = [Security.Cryptography.ProtectedData]::Protect($d, $e, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Array]::Clear($d, 0, $d.Length)
$t = $env:ACELERIQ_COFRE + '.tmp'
[IO.File]::WriteAllBytes($t, $p)
Move-Item -LiteralPath $t -Destination $env:ACELERIQ_COFRE -Force
`;

function powershell(script: string, arquivo: string, entrada?: Buffer): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      env: { ...process.env, ACELERIQ_COFRE: arquivo },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const saida: Buffer[] = [];
    let erro = "";
    p.stdout.on("data", (d: Buffer) => saida.push(d));
    p.stderr.on("data", (d: Buffer) => (erro += String(d)));
    p.on("error", rejeitar);
    p.on("exit", (codigo) => {
      if (codigo === 0) resolver(Buffer.concat(saida));
      // O erro do PowerShell nunca traz o valor (o valor só passa pelo stdin/stdout).
      else rejeitar(new Error(`o cofre do Windows recusou (código ${codigo}): ${erro.replace(/\s+/g, " ").trim().slice(0, 200)}`));
    });
    if (entrada) p.stdin.end(entrada);
    else p.stdin.end();
  });
}

export function cofreDoWindows(arquivo: string): Cofre {
  return {
    existe: () => existsSync(arquivo),
    async ler() {
      if (!existsSync(arquivo)) return {};
      const b = await powershell(SCRIPT_LER, arquivo);
      const d = JSON.parse(b.toString("utf8").replace(/^﻿/, "")) as Record<string, unknown>;
      b.fill(0);
      const s: Record<string, string> = {};
      for (const k of Object.keys(d || {})) if (/^[A-Z][A-Z0-9_]{1,63}$/.test(k) && typeof d[k] === "string" && String(d[k]).trim()) s[k] = String(d[k]).trim();
      return s;
    },
    async gravar(valores) {
      const limpo: Record<string, string> = {};
      for (const k of Object.keys(valores)) if (/^[A-Z][A-Z0-9_]{1,63}$/.test(k) && String(valores[k] || "").trim()) limpo[k] = String(valores[k]).trim();
      const b = Buffer.from(JSON.stringify(limpo), "utf8");
      try {
        await powershell(SCRIPT_GRAVAR, arquivo, b);
      } finally {
        b.fill(0);
      }
    },
    async apagar() {
      if (existsSync(arquivo)) unlinkSync(arquivo);
    },
  };
}

/** Cofre em memória (testes e máquinas sem DPAPI enquanto o Keychain não chega). */
export function cofreEmMemoria(inicial: Record<string, string> = {}): Cofre & { valores: Record<string, string> } {
  const c = {
    valores: { ...inicial },
    existe: () => Object.keys(c.valores).length > 0,
    ler: async () => ({ ...c.valores }),
    gravar: async (v: Record<string, string>) => {
      c.valores = { ...v };
    },
    apagar: async () => {
      c.valores = {};
    },
  };
  return c;
}

/** O cofre desta máquina. Fora do Windows, por enquanto, só o ambiente (ver o próximo passo no doc). */
export function cofreDaMaquina(arquivo: string): Cofre {
  if (process.platform === "win32") return cofreDoWindows(arquivo);
  return cofreEmMemoria();
}
