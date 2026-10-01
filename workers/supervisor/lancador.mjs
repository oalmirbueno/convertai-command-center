/**
 * Lançador estável do Aceleriq Motores (frente SUP, 01/10/2026).
 *
 * O instalador copia este arquivo para %LOCALAPPDATA%\Aceleriq\Motores\lancador.mjs
 * e o início com o Windows aponta para ele (sem janela: conhost.exe --headless).
 * Ele quase nunca muda; quem muda é a versão em versoes\<versao>. Ele:
 * - roda o supervisor da versão de atual.json;
 * - saída 0: para (Sair no menu, máquina removida, já ligado);
 * - saída 75: a versão foi trocada; relê atual.json e sobe a nova;
 * - outra saída: caiu. Se a versão está em prova e caiu nos primeiros 2 min,
 *   volta para a anterior (e recusa a nova); senão sobe de novo com espera crescente.
 *
 *   node lancador.mjs                      liga (o que o Windows faz ao entrar)
 *   node lancador.mjs --comando estado     conversa com o supervisor ligado
 *                     (estado | reiniciar | pausar | retomar | sair | sair-agora | atualizar)
 * Sem dependência e sem importar nada das versões.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CODIGO_DE_TROCA = 75;
const PROVA_MS = Number(process.env.ACELERIQ_LANCADOR_PROVA_MS) || 120_000;

export function raizDosMotores(env = process.env) {
  if (env.ACELERIQ_MOTORES_PASTA) return path.resolve(env.ACELERIQ_MOTORES_PASTA);
  if (process.platform === "win32") return path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Aceleriq", "Motores");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Aceleriq", "Motores");
  return path.join(env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "aceleriq-motores");
}

export function enderecoDoControle(raiz, usuario = os.userInfo().username) {
  const pasta = createHash("sha256").update(path.resolve(raiz).toLowerCase()).digest("hex").slice(0, 8);
  const nome = `aceleriq-motores-${usuario.replace(/[^A-Za-z0-9_.-]/g, "_").toLowerCase()}-${pasta}`;
  return process.platform === "win32" ? `\\\\.\\pipe\\${nome}` : path.join(raiz, `${nome}.sock`);
}

function lerAtual(raiz) {
  try {
    const a = JSON.parse(readFileSync(path.join(raiz, "atual.json"), "utf8").replace(/^﻿/, ""));
    return { versao: a.versao || null, anterior: a.anterior || null, em_teste: !!a.em_teste, desde: a.desde || null, recusadas: Array.isArray(a.recusadas) ? a.recusadas : [] };
  } catch {
    return { versao: null, anterior: null, em_teste: false, desde: null, recusadas: [] };
  }
}

function gravarAtual(raiz, a) {
  const arq = path.join(raiz, "atual.json");
  const tmp = `${arq}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(a, null, 2) + "\n", "utf8");
  renameSync(tmp, arq);
}

export function entradaDaVersao(raiz, versao) {
  if (!versao || !/^[0-9a-z][0-9a-z._-]{2,40}$/i.test(versao)) return null;
  const e = path.join(raiz, "versoes", versao, "workers", "supervisor", "principal.ts");
  return existsSync(e) ? e : null;
}

/** Volta para a anterior quando a versão em prova cai logo ao subir. Devolve true se voltou. */
export function voltarSePrecisar(raiz, durouMs, registrar) {
  const a = lerAtual(raiz);
  if (!a.em_teste || durouMs > PROVA_MS || !a.anterior || !entradaDaVersao(raiz, a.anterior)) return false;
  const recusadas = Array.from(new Set([...(a.recusadas || []), a.versao])).filter(Boolean).slice(-20);
  gravarAtual(raiz, { versao: a.anterior, anterior: null, em_teste: false, desde: new Date().toISOString(), recusadas });
  registrar(`a versão ${a.versao} caiu ao subir (${Math.round(durouMs / 1000)} s): voltei para a ${a.anterior}`);
  return true;
}

function registrador(raiz) {
  const pasta = path.join(raiz, "logs");
  const arq = path.join(pasta, "lancador.log");
  return (t) => {
    try {
      mkdirSync(pasta, { recursive: true });
      if (existsSync(arq) && statSync(arq).size > 1024 * 1024) renameSync(arq, path.join(pasta, "lancador.1.log"));
      appendFileSync(arq, `${new Date().toISOString()} ${t}\n`, "utf8");
    } catch {
      /* sem disco: segue */
    }
  };
}

function mandarComando(endereco, comando, prazoMs = 15_000) {
  return new Promise((resolver) => {
    const s = net.connect(endereco);
    let buf = "";
    const t = setTimeout(() => {
      s.destroy();
      resolver({ ok: false, erro: "sem resposta" });
    }, prazoMs);
    s.setEncoding("utf8");
    s.on("connect", () => s.write(JSON.stringify({ comando }) + "\n"));
    s.on("data", (d) => (buf += d));
    s.on("end", () => {
      clearTimeout(t);
      try {
        resolver(JSON.parse(buf.trim()));
      } catch {
        resolver({ ok: false, erro: "resposta inválida" });
      }
    });
    s.on("error", () => {
      clearTimeout(t);
      resolver({ ok: false, erro: "desligado" });
    });
  });
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export async function rodarLancador({ raiz = raizDosMotores(), node = process.execPath, registrar = registrador(raiz), umaVez = false } = {}) {
  let quedas = 0;
  for (;;) {
    const a = lerAtual(raiz);
    const entrada = entradaDaVersao(raiz, a.versao);
    if (!entrada) {
      registrar(`nenhuma versão instalada em ${raiz} (atual.json: ${a.versao || "vazio"}); rode o instalador`);
      return 1;
    }
    const inicio = Date.now();
    registrar(`subindo o supervisor da versão ${a.versao}${a.em_teste ? " (em prova)" : ""}`);
    const codigo = await new Promise((resolver) => {
      const p = spawn(node, [entrada], {
        cwd: path.dirname(entrada),
        env: { ...process.env, ACELERIQ_MOTORES_PASTA: raiz },
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
      let erro = "";
      p.stderr.on("data", (d) => (erro = (erro + String(d)).slice(-2000)));
      p.on("error", (e) => {
        registrar(`o supervisor não abriu: ${e.message}`);
        resolver(-1);
      });
      p.on("exit", (c) => {
        if (c !== 0 && c !== CODIGO_DE_TROCA && erro.trim()) registrar(`saída de erro do supervisor: ${erro.trim().split(/\r?\n/).slice(-5).join(" | ")}`);
        resolver(c ?? -1);
      });
    });
    const durou = Date.now() - inicio;
    if (codigo === 0) {
      registrar("o supervisor saiu de propósito; o lançador para");
      return 0;
    }
    if (codigo === CODIGO_DE_TROCA) {
      registrar("troca de versão pedida; subindo a versão de atual.json");
      quedas = 0;
      if (umaVez) return CODIGO_DE_TROCA;
      continue;
    }
    if (voltarSePrecisar(raiz, durou, registrar)) {
      quedas = 0;
      if (umaVez) return codigo;
      continue;
    }
    quedas = durou > 10 * 60_000 ? 1 : quedas + 1;
    const ms = Math.min(300_000, 2_000 * Math.pow(2, Math.min(quedas - 1, 10)));
    registrar(`o supervisor caiu (código ${codigo}, ${Math.round(durou / 1000)} s de pé); sobe de novo em ${Math.round(ms / 1000)} s`);
    if (umaVez) return codigo;
    await esperar(ms);
  }
}

const direto = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (direto) {
  // --pasta <raiz>: outra pasta dos motores (o teste ponta a ponta usa uma temporária).
  const p = process.argv.indexOf("--pasta");
  if (p >= 0 && process.argv[p + 1]) process.env.ACELERIQ_MOTORES_PASTA = path.resolve(process.argv[p + 1]);
  const i = process.argv.indexOf("--comando");
  if (i >= 0) {
    const r = await mandarComando(enderecoDoControle(raizDosMotores()), process.argv[i + 1] || "estado");
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    process.exit(r.ok ? 0 : 1);
  }
  process.exit(await rodarLancador());
}
