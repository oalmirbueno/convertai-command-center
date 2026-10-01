/**
 * Montagem do instalador único dos motores (frente SUP, 01/10/2026), sem
 * import do Vite: a tela usa por instaladorDosMotores.ts e o teste ponta a
 * ponta do instalador (workers/instalador/testes) usa direto no Node.
 *
 * - O .cmd confere o sha256 do script que carrega (se mudou no caminho, não roda).
 * - O painel mostra o sha256 do arquivo inteiro, para quem quiser conferir com
 *   `certutil -hashfile instalar-aceleriq-motores.cmd SHA256`.
 * - Nada secreto vai no arquivo: só o endereço do projeto, a chave pública
 *   (publishable, a mesma do painel) e o endereço do painel. A chave de serviço
 *   chega pelo pareamento (código de 10 min) e vai para o cofre DPAPI.
 */

export const MARCA_DO_SCRIPT = "##ACELERIQ-PS1##";
export const NOME_DO_INSTALADOR = "instalar-aceleriq-motores.cmd";

export interface OpcoesDoInstalador {
  supabaseUrl: string;
  chavePublica: string;
  painelUrl: string;
  /** Data do arquivo (padrão: agora); só vai no comentário. */
  quando?: Date;
}

export interface Instalador {
  nome: string;
  conteudo: string;
  sha256DoScript: string;
  sha256DoArquivo: string;
}

export const paraCrlf = (t: string) => t.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");

export async function sha256Hex(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(texto);
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let h = "";
  for (let i = 0; i < d.length; i++) h += (d[i] < 16 ? "0" : "") + d[i].toString(16);
  return h;
}

/** Valor que entra num `set "X=..."` do cmd: nada que o cmd expanda ou quebre. */
export function valorSeguroParaCmd(v: string, campo: string): string {
  const s = String(v || "").trim();
  if (!s || /["%!\r\n^]/.test(s)) throw new Error(`Valor inválido para o instalador: ${campo}.`);
  return s;
}

/** Monta o .cmd (CRLF) com o script dentro. `script` é o texto do instalar-motores.ps1. */
export async function montarInstaladorDe(script: string, o: OpcoesDoInstalador): Promise<Instalador> {
  const url = valorSeguroParaCmd(o.supabaseUrl, "endereço do projeto");
  const chave = valorSeguroParaCmd(o.chavePublica, "chave pública");
  const painel = valorSeguroParaCmd(o.painelUrl, "endereço do painel");
  if (!/^https:\/\//.test(url) || !/^https?:\/\//.test(painel)) throw new Error("O instalador só fala com o projeto por HTTPS.");
  const corpo = paraCrlf(script.replace(/^﻿/, "")).replace(/^(\r\n)+/, "");
  const sha256DoScript = await sha256Hex(corpo);
  const quando = (o.quando || new Date()).toISOString().slice(0, 10);
  // Uma linha só de PowerShell: lê o próprio .cmd, separa o script depois da marca, confere o hash e roda.
  const ps =
    "$t=[IO.File]::ReadAllText($env:ACELERIQ_INSTALADOR,[Text.Encoding]::UTF8);" +
    "$m='##'+'ACELERIQ-PS1'+'##';$i=$t.IndexOf($m);if($i -lt 0){exit 8};" +
    "$s=$t.Substring($i+$m.Length).TrimStart([char]13,[char]10);" +
    "$h=-join (([Security.Cryptography.SHA256]::Create()).ComputeHash([Text.Encoding]::UTF8.GetBytes($s))|ForEach-Object{$_.ToString('x2')});" +
    "if($h -ne $env:ACELERIQ_SHA){Write-Host 'Este instalador foi alterado no caminho. Baixe de novo pelo painel.' -ForegroundColor Red;exit 9};" +
    "& ([ScriptBlock]::Create($s)) -SupabaseUrl $env:ACELERIQ_URL -ChavePublica $env:ACELERIQ_CHAVE_PUBLICA -PainelUrl $env:ACELERIQ_PAINEL;exit $LASTEXITCODE";
  const cabeca = [
    "@echo off",
    `rem Aceleriq Motores: instalador gerado pelo painel em ${quando}. Abra com dois cliques.`,
    "rem Instala os motores (render, motor de codigo e navegador do agente) neste computador,",
    "rem sem janela e abrindo junto com o Windows. Nada secreto vai neste arquivo.",
    `rem Script conferido por sha256 antes de rodar: ${sha256DoScript}`,
    "setlocal",
    'set "ACELERIQ_INSTALADOR=%~f0"',
    `set "ACELERIQ_URL=${url}"`,
    `set "ACELERIQ_CHAVE_PUBLICA=${chave}"`,
    `set "ACELERIQ_PAINEL=${painel}"`,
    `set "ACELERIQ_SHA=${sha256DoScript}"`,
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${ps}"`,
    'set "ACELERIQ_SAIDA=%ERRORLEVEL%"',
    "echo.",
    "pause",
    "exit /b %ACELERIQ_SAIDA%",
    MARCA_DO_SCRIPT,
  ].join("\r\n");
  const conteudo = `${cabeca}\r\n${corpo}`;
  return { nome: NOME_DO_INSTALADOR, conteudo, sha256DoScript, sha256DoArquivo: await sha256Hex(conteudo) };
}
