// Buscador da skill ui-ux-pro-max (casca da casa). O agente roda
//   node scripts/uiux.mjs "<busca>" [--domain style|ux|typography|chart|...] [--stack react] [-n 3]
//   node scripts/uiux.mjs "<consulta do pacote>" --design-system --persist -p "<cliente>"
// no lugar de "python3 .opencode/skills/ui-ux-pro-max/scripts/search.py": este
// embrulho acha o Python certo (no Windows "python3" é o atalho falso da Store),
// recusa --force, prende a saída na pasta do projeto, corta a saída longa e
// grava uma linha por chamada em .aceleriq/uiux-log.jsonl (a prova de consulta
// que o motor lê). Sem Python, sai com 3 e o motor segue só com o pacote.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = resolve(import.meta.dirname, "..");
export const BUSCADOR = join(".opencode", "skills", "ui-ux-pro-max", "scripts", "search.py");
export const LOG = join(".aceleriq", "uiux-log.jsonl");
export const LIMITE_DA_SAIDA = 12_000;
export const PRAZO_MS = 30_000;
export const SEM_PYTHON = "Sem Python 3 nesta máquina: siga com .aceleriq/pacote.json (base_de_design) e diga isso no resumo.";

// Opções longas do search.py 2.15.0. O argparse aceita abreviação ("--forc" = --force), então o embrulho
// resolve a abreviação antes de conferir.
const OPCOES = ["--domain", "--stack", "--max-results", "--json", "--full", "--design-system", "--project-name", "--format", "--persist", "--page", "--output-dir", "--force", "--variance", "--motion", "--density", "--help"];

/** Nome completo de uma opção longa (abreviação única vira o nome inteiro; ambígua ou desconhecida fica como veio). */
export function opcaoCompleta(nome) {
  if (OPCOES.indexOf(nome) >= 0) return nome;
  const casam = OPCOES.filter((o) => o.indexOf(nome) === 0);
  return casam.length === 1 ? casam[0] : nome;
}

/**
 * Confere e ajusta os argumentos antes de chamar o Python.
 * Devolve { ok: true, args } ou { ok: false, motivo }.
 */
export function prepararArgumentos(entrada, raiz = RAIZ) {
  const args = [];
  let persistir = false;
  let temSaida = false;
  const pasta = (valor) => {
    const v = String(valor || "").trim();
    if (!v) return { erro: "--output-dir vazio" };
    if (/(^|[\\/])\.\.([\\/]|$)/.test(v)) return { erro: "--output-dir com .. não é aceito: use --output-dir . (a raiz do projeto)" };
    const alvo = resolve(raiz, v);
    const rel = relative(raiz, alvo);
    if (rel.indexOf("..") === 0 || isAbsolute(rel)) return { erro: "--output-dir fora do projeto não é aceito: use --output-dir . (a raiz do projeto)" };
    return { valor: rel ? rel.split("\\").join("/") : "." };
  };
  for (let i = 0; i < entrada.length; i++) {
    const a = String(entrada[i]);
    let nome = null;
    let valor = null;
    let colado = false;
    if (/^--[^-]/.test(a)) {
      const igual = a.indexOf("=");
      nome = opcaoCompleta(igual > 0 ? a.slice(0, igual) : a);
      if (igual > 0) {
        valor = a.slice(igual + 1);
        colado = true;
      }
    } else if (/^-o/.test(a)) {
      nome = "--output-dir";
      if (a.length > 2) {
        valor = a.slice(2).replace(/^=/, "");
        colado = true;
      }
    }
    if (nome === "--force") return { ok: false, motivo: "--force não é aceito: o MASTER.md do projeto nunca é sobrescrito. Leia o que já existe em design-system/." };
    if (nome === "--persist") persistir = true;
    if (nome === "--output-dir") {
      if (!colado) {
        valor = entrada[i + 1];
        i++;
      }
      const p = pasta(valor);
      if (p.erro) return { ok: false, motivo: p.erro };
      temSaida = true;
      args.push("--output-dir", p.valor);
      continue;
    }
    args.push(nome && colado ? `${nome}=${valor}` : nome && nome !== a ? nome : a);
  }
  if (persistir && !temSaida) args.push("--output-dir", ".");
  return { ok: true, args };
}

/** Corta a saída longa com o aviso (a janela do agente é cara). */
export function cortarSaida(texto, limite = LIMITE_DA_SAIDA) {
  const t = String(texto || "");
  if (t.length <= limite) return { texto: t, cortado: false };
  return { texto: `${t.slice(0, limite)}\n[cortado: use -n menor ou um --domain]\n`, cortado: true };
}

/** Versão "3.x" de um Python, ou null (o atalho da Store não responde com versão). */
function versaoDoPython(cmd, env) {
  try {
    const r = spawnSync(cmd, ["-c", "import sys; print('%d.%d|%s' % (sys.version_info[0], sys.version_info[1], sys.executable))"], { encoding: "utf8", timeout: 10_000, windowsHide: true, env: { ...env, PYTHONDONTWRITEBYTECODE: "1" } });
    const m = /^(\d+)\.(\d+)\|(.+)$/m.exec(String(r.stdout || "").trim());
    if (r.status !== 0 || !m) return null;
    return { maior: Number(m[1]), menor: Number(m[2]), executavel: m[3].trim() };
  } catch {
    return null;
  }
}

/**
 * O Python 3.8+ desta máquina: UIUX_PYTHON (o worker descobre na partida) ou
 * python3, python e py, nessa ordem. Devolve o caminho do executável ou null.
 */
export function acharPython(env = process.env) {
  const candidatos = [env.UIUX_PYTHON, "python3", "python", "py"].filter((c, i, l) => typeof c === "string" && c.trim() && l.indexOf(c) === i);
  for (const c of candidatos) {
    const v = versaoDoPython(String(c).trim(), env);
    if (v && v.maior === 3 && v.menor >= 8) return v.executavel || String(c).trim();
  }
  return null;
}

function registrar(raiz, linha) {
  try {
    mkdirSync(join(raiz, ".aceleriq"), { recursive: true });
    appendFileSync(join(raiz, LOG), `${JSON.stringify(linha)}\n`);
  } catch {
    /* o log é prova, não trava a busca */
  }
}

/** Roda a busca e devolve { codigo, saida, erro, ms, cortado }. */
export async function buscar(entrada, opcoes = {}) {
  const raiz = opcoes.raiz || RAIZ;
  const env = opcoes.env || process.env;
  const inicio = Date.now();
  const base = { em: new Date().toISOString(), args: entrada.map((a) => String(a).slice(0, 200)).slice(0, 30) };
  const p = prepararArgumentos(entrada, raiz);
  if (!p.ok) {
    registrar(raiz, { ...base, ms: 0, bytes: 0, codigo: 2, ok: false, recusado: p.motivo });
    return { codigo: 2, saida: "", erro: `uiux: ${p.motivo}\n`, ms: 0, cortado: false };
  }
  const buscador = join(raiz, BUSCADOR);
  if (!existsSync(buscador)) {
    registrar(raiz, { ...base, ms: 0, bytes: 0, codigo: 3, ok: false, recusado: "skill ausente" });
    return { codigo: 3, saida: "", erro: `uiux: a skill ui-ux-pro-max não está em .opencode/skills. ${SEM_PYTHON}\n`, ms: 0, cortado: false };
  }
  const python = opcoes.python !== undefined ? opcoes.python : acharPython(env);
  if (!python) {
    registrar(raiz, { ...base, ms: Date.now() - inicio, bytes: 0, codigo: 3, ok: false, recusado: "sem python" });
    return { codigo: 3, saida: "", erro: `uiux: ${SEM_PYTHON}\n`, ms: Date.now() - inicio, cortado: false };
  }
  const prazo = opcoes.prazoMs || PRAZO_MS;
  const r = await new Promise((ok) => {
    const filho = spawn(python, [BUSCADOR, ...p.args], {
      cwd: raiz,
      env: { ...env, PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      windowsHide: true,
    });
    let saida = "";
    let erro = "";
    let estourou = false;
    const relogio = setTimeout(() => {
      estourou = true;
      try {
        filho.kill();
      } catch {
        /* já saiu */
      }
    }, prazo);
    filho.stdout.on("data", (c) => {
      if (saida.length < 400_000) saida += c.toString("utf8");
    });
    filho.stderr.on("data", (c) => {
      if (erro.length < 100_000) erro += c.toString("utf8");
    });
    filho.on("error", (e) => {
      clearTimeout(relogio);
      ok({ codigo: 3, saida, erro: `${erro}\n${e.message}`, estourou });
    });
    filho.on("close", (codigo) => {
      clearTimeout(relogio);
      ok({ codigo: estourou ? 124 : codigo === null ? 1 : codigo, saida, erro, estourou });
    });
  });
  const ms = Date.now() - inicio;
  const corte = cortarSaida(r.saida);
  const erroCortado = cortarSaida(r.erro, 2_000).texto;
  const bytes = Buffer.byteLength(r.saida, "utf8");
  registrar(raiz, { ...base, ms, bytes, codigo: r.codigo, ok: r.codigo === 0, cortado: corte.cortado });
  return { codigo: r.codigo, saida: corte.texto, erro: r.estourou ? `uiux: a busca passou de ${Math.round(prazo / 1000)} s e foi encerrada\n${erroCortado}` : erroCortado, ms, cortado: corte.cortado };
}

/** Rodando direto (não importado pelo worker ou pelo teste). No Windows o caminho não diferencia maiúsculas. */
const mesmoArquivo = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && mesmoArquivo(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  const r = await buscar(process.argv.slice(2));
  if (r.saida) process.stdout.write(r.saida);
  if (r.erro) process.stderr.write(r.erro);
  process.exitCode = r.codigo;
}
