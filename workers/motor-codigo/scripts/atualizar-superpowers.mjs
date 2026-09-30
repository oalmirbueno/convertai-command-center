// Atualiza a cópia fixada do Superpowers (obra/superpowers, MIT) em
// workers/motor-codigo/vendor/superpowers. Frente SPM, 30/09/2026.
//
// Regras (cadeia de suprimento: as skills são ordens que o agente obedece):
// - só uma TAG de versão (vX.Y.Z), nunca main, HEAD ou branch;
// - a tag do clone local tem de apontar para o mesmo commit que a tag do
//   GitHub (git ls-remote);
// - o clone tem de estar limpo; a árvore sai por `git archive` da tag, sem
//   conversão de fim de linha, e nada dentro do vendor é editado;
// - sem --aplicar, só confere e imprime o diff das SKILL.md para revisão;
// - com --aplicar, troca o vendor e regrava superpoderes/versao.json (tag,
//   commit, hash da árvore, data, origem, o sha256 de cada SKILL.md e o de
//   cada arquivo que roda: plugin, index.js, hooks e scripts das skills).
//   O vitest confere a árvore inteira (calculada) e esses sha256.
//
// Uso (na pasta workers/motor-codigo):
//   node scripts/atualizar-superpowers.mjs --tag v6.4.2 --clone C:\AI\acervo-aceleriq\superpowers
//   node scripts/atualizar-superpowers.mjs --tag v6.5.0 --clone <clone limpo> --aplicar
// Depois de aplicar: rode o teste sem gasto (node teste-superpoderes.ts) e o
// vitest do painel (spm-motor-superpoderes.test.ts), e revise o diff no git.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const ORIGEM = "https://github.com/obra/superpowers.git";
export const PASTA_DO_WORKER = resolve(import.meta.dirname, "..");
export const VENDOR = join(PASTA_DO_WORKER, "vendor", "superpowers");
export const ARQUIVO_DA_VERSAO = join(PASTA_DO_WORKER, "superpoderes", "versao.json");
export const TAG_VALIDA = /^v\d+\.\d+\.\d+$/;

/** sha256 de cada skills/<nome>/SKILL.md de uma árvore do Superpowers, em ordem de nome. */
export function skillsDaArvore(raiz) {
  const pasta = join(raiz, "skills");
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta)
    .filter((n) => statSync(join(pasta, n)).isDirectory() && existsSync(join(pasta, n, "SKILL.md")))
    .sort()
    .map((nome) => ({ nome, arquivo: `skills/${nome}/SKILL.md`, sha256: createHash("sha256").update(readFileSync(join(pasta, nome, "SKILL.md"))).digest("hex") }));
}

/** O que roda como código (plugin, index.js, hooks, scripts das skills e qualquer .js/.ts/.py/.sh), com o sha256. */
export const CODIGO = /\.(js|mjs|cjs|ts|py|sh|cmd|ps1)$/i;
export function executaveisDaArvore(raiz) {
  return arquivosDe(raiz)
    .filter((f) => CODIGO.test(f) || /^hooks\//.test(f) || /^skills\/[^/]+\/scripts\//.test(f))
    .map((arquivo) => ({ arquivo, sha256: createHash("sha256").update(readFileSync(join(raiz, arquivo))).digest("hex") }));
}

function git(args, opcoes = {}) {
  const r = spawnSync("git", ["-c", "core.autocrlf=false", "-c", "core.eol=lf", ...args], { encoding: opcoes.binario ? "buffer" : "utf8", maxBuffer: 256 * 1024 * 1024, cwd: opcoes.cwd });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${String(r.stderr || r.error || "").trim().slice(0, 400)}`);
  return r.stdout;
}

const arg = (nome) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] || "" : null;
};

export function arquivosDe(raiz) {
  const saida = [];
  (function andar(d, rel) {
    for (const n of readdirSync(d)) {
      const c = join(d, n);
      const r = rel ? `${rel}/${n}` : n;
      if (statSync(c).isDirectory()) andar(c, r);
      else saida.push(r);
    }
  })(raiz, "");
  return saida.sort();
}

function principal() {
  const tag = arg("tag");
  const clone = arg("clone");
  const aplicar = process.argv.indexOf("--aplicar") >= 0;
  if (!tag || !TAG_VALIDA.test(tag)) throw new Error(`passe --tag vX.Y.Z (só tag de versão; nunca main, HEAD nem branch). Recebido: ${tag || "nada"}`);
  if (!clone || !existsSync(join(clone, ".git"))) throw new Error("passe --clone <pasta de um clone de obra/superpowers>");

  // 1) Clone limpo e a tag local.
  const sujo = git(["status", "--porcelain"], { cwd: clone }).trim();
  if (sujo) throw new Error(`o clone tem mudanças locais; use um clone limpo:\n${sujo.slice(0, 400)}`);
  git(["show-ref", "--verify", `refs/tags/${tag}`], { cwd: clone });
  const commit = git(["rev-parse", "--verify", `${tag}^{commit}`], { cwd: clone }).trim();

  // 2) A tag do GitHub aponta para o mesmo commit (a anotada vem com ^{}).
  const remoto = git(["ls-remote", "--tags", ORIGEM, `refs/tags/${tag}`, `refs/tags/${tag}^{}`]).trim().split("\n").filter(Boolean);
  const linha = remoto.find((l) => /\^\{\}$/.test(l)) || remoto[0];
  const commitRemoto = linha ? linha.split(/\s+/)[0] : "";
  if (!commitRemoto) throw new Error(`a tag ${tag} não existe em ${ORIGEM}`);
  if (commitRemoto !== commit) throw new Error(`a tag ${tag} do clone (${commit}) não bate com a do GitHub (${commitRemoto}): não atualizo`);
  const data = git(["log", "-1", "--format=%cI", commit], { cwd: clone }).trim();
  // Hash da árvore da tag: depois do commit, `git rev-parse HEAD:workers/motor-codigo/vendor/superpowers` tem de dar o mesmo.
  const arvore = git(["rev-parse", `${tag}^{tree}`], { cwd: clone }).trim();

  // 3) A árvore da tag, sem .git e sem conversão de fim de linha, por um índice
  //    temporário (não mexe no índice nem na pasta do clone; não depende de tar).
  const tmp = mkdtempSync(join(tmpdir(), "superpowers-"));
  const nova = join(tmp, "superpowers");
  mkdirSync(nova, { recursive: true });
  const indice = { ...process.env, GIT_INDEX_FILE: join(tmp, "indice") };
  const passo = (args) => {
    const r = spawnSync("git", ["-c", "core.autocrlf=false", "-c", "core.eol=lf", ...args], { cwd: clone, env: indice, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args[0]}: ${String(r.stderr || r.error || "").trim().slice(0, 300)}`);
  };
  passo(["read-tree", `${tag}^{tree}`]);
  passo(["checkout-index", "-a", "-f", `--prefix=${nova.split("\\").join("/")}/`]);
  if (!existsSync(join(nova, "LICENSE"))) throw new Error("a árvore da tag veio sem LICENSE: não atualizo");

  // 4) Diff para revisão: SKILL.md inteiras, os outros arquivos só pelo nome.
  const antes = existsSync(VENDOR) ? skillsDaArvore(VENDOR) : [];
  const depois = skillsDaArvore(nova);
  const porNome = (l) => Object.fromEntries(l.map((s) => [s.nome, s]));
  const a = porNome(antes);
  const d = porNome(depois);
  console.log(`[superpowers] ${tag} = ${commit} (${data}); GitHub confere.`);
  for (const nome of Array.from(new Set([...Object.keys(a), ...Object.keys(d)])).sort()) {
    if (!a[nome]) console.log(`  + skill nova: ${nome}`);
    else if (!d[nome]) console.log(`  - skill removida: ${nome}`);
    else if (a[nome].sha256 !== d[nome].sha256) {
      console.log(`  ~ skill mudou: ${nome}`);
      const r = spawnSync("git", ["diff", "--no-index", "--no-color", join(VENDOR, a[nome].arquivo), join(nova, d[nome].arquivo)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      console.log(r.stdout);
    }
  }
  if (existsSync(VENDOR)) {
    const fa = new Set(arquivosDe(VENDOR));
    const fd = new Set(arquivosDe(nova));
    const outros = [];
    fd.forEach((f) => {
      if (!fa.has(f)) outros.push(`+ ${f}`);
      else if (!/SKILL\.md$/.test(f) && !readFileSync(join(VENDOR, f)).equals(readFileSync(join(nova, f)))) outros.push(`~ ${f}`);
    });
    fa.forEach((f) => !fd.has(f) && outros.push(`- ${f}`));
    if (outros.length) console.log(`  outros arquivos (${outros.length}):\n    ${outros.join("\n    ")}`);
  }

  const versao = {
    pacote: "obra/superpowers",
    origem: ORIGEM.replace(/\.git$/, ""),
    licenca: "MIT (Copyright (c) 2025 Jesse Vincent); a LICENSE original fica em vendor/superpowers/LICENSE",
    tag,
    commit,
    arvore,
    data,
    como_atualizar: "node scripts/atualizar-superpowers.mjs --tag <vX.Y.Z> --clone <clone limpo> [--aplicar]; nunca main",
    skills: depois,
    executaveis: executaveisDaArvore(nova),
  };
  if (!aplicar) {
    console.log("[superpowers] só conferência (sem --aplicar): nada foi trocado.");
    rmSync(tmp, { recursive: true, force: true });
    return;
  }
  if (existsSync(VENDOR)) rmSync(VENDOR, { recursive: true, force: true });
  mkdirSync(join(PASTA_DO_WORKER, "vendor"), { recursive: true });
  renameSync(nova, VENDOR);
  mkdirSync(join(PASTA_DO_WORKER, "superpoderes"), { recursive: true });
  writeFileSync(ARQUIVO_DA_VERSAO, `${JSON.stringify(versao, null, 2)}\n`);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`[superpowers] vendor trocado para ${tag} (${depois.length} skills) e versao.json regravado. Revise o diff no git antes de integrar.`);
}

if (process.argv[1] && /atualizar-superpowers\.mjs$/.test(process.argv[1])) {
  try {
    principal();
  } catch (e) {
    console.error(`[superpowers] ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
