/**
 * Entrada do Aceleriq Motores (frente SUP, 01/10/2026).
 *
 * Quem chama é o lançador estável (%LOCALAPPDATA%\Aceleriq\Motores\lancador.mjs),
 * que o Windows abre sem janela ao entrar (atalho na pasta Inicializar com
 * `conhost.exe --headless`). Para testar de um clone:
 *
 *   node workers/supervisor/principal.ts            (usa a pasta dos motores do usuário)
 *   ACELERIQ_MOTORES_PASTA=C:\temp\m node workers/supervisor/principal.ts
 *
 * Códigos de saída: 0 = saiu de propósito (Sair, máquina removida, já ligado);
 * 75 = trocar de versão (o lançador relê atual.json e sobe de novo); outro = caiu.
 */

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bancoSupabase } from "./banco.ts";
import { abrirBandeja } from "./bandeja.ts";
import { caminhos, type IdDoMotor, lerMaquina, raizDosMotores } from "./config.ts";
import { abrirControle, enderecoDoControle } from "./controle.ts";
import { abrirRegistro } from "./registros.ts";
import { cofreDaMaquina } from "./segredos.ts";
import { Supervisor } from "./supervisor.ts";

/**
 * Abre endereço ou pasta no programa padrão, sem janela de console. Quem chama
 * é só o menu da bandeja (com freio de 10 s no supervisor). Com
 * ACELERIQ_SEM_NAVEGADOR=1 (testes, ponta a ponta) não abre nada, só registra.
 */
export function abrirNoSistema(alvo: string, env: NodeJS.ProcessEnv = process.env, lancar: typeof spawn = spawn): boolean {
  if (env.ACELERIQ_SEM_NAVEGADOR === "1") return false;
  try {
    if (process.platform === "win32") {
      const ehUrl = /^https?:\/\//i.test(alvo);
      const p = ehUrl ? lancar("rundll32.exe", ["url.dll,FileProtocolHandler", alvo], { detached: true, stdio: "ignore" }) : lancar("explorer.exe", [alvo], { detached: true, stdio: "ignore" });
      p.on("error", () => {});
      p.unref();
    } else {
      const p = lancar(process.platform === "darwin" ? "open" : "xdg-open", [alvo], { detached: true, stdio: "ignore" });
      p.on("error", () => {});
      p.unref();
    }
    return true;
  } catch {
    return false;
  }
}

async function principal(): Promise<void> {
  const c = caminhos(raizDosMotores());
  const raizDoCodigo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const dentroDasVersoes = path.relative(c.versoes, raizDoCodigo);
  const versao = !dentroDasVersoes.startsWith("..") && !path.isAbsolute(dentroDasVersoes) && dentroDasVersoes.indexOf(path.sep) < 0 ? dentroDasVersoes : null;
  const registro = abrirRegistro(c.logs, "supervisor", { tambemNoConsole: process.env.ACELERIQ_MOTORES_CONSOLE === "1" });
  const registros = new Map<IdDoMotor, ReturnType<typeof abrirRegistro>>();
  const registroDe = (m: IdDoMotor) => {
    if (!registros.has(m)) registros.set(m, abrirRegistro(c.logs, m));
    return registros.get(m)!;
  };
  let encerrando = false;
  const sair = (codigo: number) => {
    if (encerrando) return;
    encerrando = true;
    setTimeout(() => process.exit(codigo), 300);
  };
  const s = new Supervisor({
    c,
    maquina: lerMaquina(c),
    versao,
    raizDoCodigo,
    cofre: cofreDaMaquina(c.cofre),
    criarBanco: (url, chave) => bancoSupabase(url, chave),
    criarBandeja: (aoAgir) => abrirBandeja(aoAgir, registro),
    registro,
    registroDe,
    sair,
    abrir: (alvo) => {
      if (!abrirNoSistema(alvo)) registro.linha(`[supervisor] não abri ${alvo.replace(/[?#].*$/, "")} (ACELERIQ_SEM_NAVEGADOR=1)`);
    },
    ambiente: process.env,
  });
  try {
    // O controle local só lê e comanda: nunca abre navegador (ver Supervisor.comando).
    await abrirControle(enderecoDoControle(c.raiz), (cmd) => s.comando(cmd));
  } catch (e) {
    if ((e as { code?: string }).code === "ja_ligado") {
      registro.linha("[supervisor] já há um Aceleriq Motores ligado nesta conta; este sai.");
      process.exit(0);
    }
    registro.linha(`[supervisor] sem controle local: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Windows desligando ou sessão saindo: para com calma o que der.
  for (const sinal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"] as const) {
    try {
      process.on(sinal, () => void s.encerrar(0));
    } catch {
      /* sinal sem suporte nesta plataforma */
    }
  }
  process.on("uncaughtException", (e) => {
    registro.linha(`[supervisor] erro inesperado: ${e instanceof Error ? e.stack || e.message : String(e)}`);
    process.exit(1);
  });
  registro.linha(`[supervisor] ligado como ${os.userInfo().username} (pid ${process.pid}, node ${process.version})`);
  await s.iniciar();
}

if (process.argv[1] && /principal\.ts$/.test(process.argv[1]) && /supervisor/.test(process.argv[1])) {
  principal().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
