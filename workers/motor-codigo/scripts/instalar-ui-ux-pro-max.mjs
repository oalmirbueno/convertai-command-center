#!/usr/bin/env node
/**
 * Instala a skill UI UX Pro Max no motor pelo método oficial, com a versão
 * fixada, em workers/motor-codigo/vendor/ui-ux-pro-max (ao lado do
 * vendor/superpowers). A skill fica no WORKER e entra no opencode por
 * `skills.paths`: o projeto do cliente não recebe cópia (uma pasta .opencode
 * dentro do projeto faz o opencode instalar pacotes do npm em cada projeto).
 * Reproduzível: rode de novo e o resultado é o mesmo (só muda a data do ORIGEM.md).
 *
 *   node scripts/instalar-ui-ux-pro-max.mjs                instala (precisa do npm e de rede)
 *   node scripts/instalar-ui-ux-pro-max.mjs --conferir     confere os SHA-256 com o manifesto (sem rede)
 *   node scripts/instalar-ui-ux-pro-max.mjs --refazer-casa reescreve LICENSE, ORIGEM.md e manifesto.json
 *                                                          sem rede (recusa se um arquivo oficial mudou)
 *
 * Como instala:
 *  1. confere a integridade do pacote no registro (npm view) e a do tarball
 *     baixado (npm pack) contra a fixada aqui; diferente, aborta;
 *  2. roda `npx --yes ui-ux-pro-max-cli@2.15.0 init --ai opencode` numa pasta
 *     temporária (o instalador nunca toca nas skills do superpowers nem no
 *     resto do modelo);
 *  3. confere o SKILL.md (nome, descrição, caminho relativo, nada de "{{");
 *  4. copia SÓ a pasta ui-ux-pro-max, sem scripts/tests e sem __pycache__,
 *     com fim de linha LF. As 6 skills irmãs que o instalador traz ficam de
 *     fora (a "design" chama APIs externas com chave);
 *  5. escreve LICENSE (MIT do repositório: o pacote npm não traz o arquivo),
 *     ORIGEM.md e manifesto.json (SHA-256 de cada arquivo).
 * A skill não é editada: o que a casa quer diferente vai no AGENTS.md.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const PACOTE = "ui-ux-pro-max-cli";
export const VERSAO = "2.15.0";
export const INTEGRIDADE = "sha512-D0J/C40xrzzi5si6ZLtRGbEE5v3QjL7d4wJNnasmP3yfDSrGiuqVCdwQiqCNnIkbqOuVoA/uonR2o1WKXh3urw==";
export const GIT_HEAD = "a38d04c3d5c298c851dbe5e6ee1965ee3de42cb5";
export const REPOSITORIO = "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill";
export const SKILL = "ui-ux-pro-max";
/** As skills que o instalador oficial traz junto e que ficam de fora do motor. */
export const IRMAS = ["banner-design", "brand", "design", "design-system", "slides", "ui-styling"];
export const COMANDO = `npx --yes ${PACOTE}@${VERSAO} init --ai opencode`;
/**
 * Caminho que o SKILL.md oficial usa no modo de projeto. A skill não é
 * editada: no motor, o AGENTS.md manda trocar esse comando por
 * `node scripts/uiux.mjs`, que acha o buscador do worker por UIUX_BUSCADOR.
 */
export const CAMINHO_DO_BUSCADOR = ".opencode/skills/ui-ux-pro-max/scripts/search.py";

const AQUI = dirname(fileURLToPath(import.meta.url));
/** A pasta de vendor do worker (as skills de terceiros ficam aqui, fora dos projetos). */
export const PASTA_DO_VENDOR = resolve(AQUI, "..", "vendor");
export const DESTINO = join(PASTA_DO_VENDOR, SKILL);

/** O que a casa escreve na pasta da skill (fora do que o instalador gera). */
export const ARQUIVOS_DA_CASA = ["LICENSE", "ORIGEM.md", "manifesto.json"];

// Texto MIT do repositório (o pacote npm 2.15.0 não traz o LICENSE).
export const LICENCA = `MIT License

Copyright (c) 2024 Next Level Builder

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

/** Caminho que não entra na cópia: testes da skill e cache do Python. */
export const foraDaCopia = (rel) => /(^|\/)__pycache__(\/|$)/.test(rel) || /^scripts\/tests(\/|$)/.test(rel) || /\.pyc$/.test(rel);

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Todos os arquivos de uma pasta, relativos e com "/", em ordem. */
export function listarArquivos(pasta) {
  const saida = [];
  (function andar(atual) {
    for (const nome of readdirSync(atual)) {
      const c = join(atual, nome);
      if (statSync(c).isDirectory()) andar(c);
      else saida.push(relative(pasta, c).split(sep).join("/"));
    }
  })(pasta);
  return saida.sort();
}

/** Texto com CRLF vira LF; arquivo com byte nulo (binário) fica como está. */
export function emLf(bytes) {
  if (bytes.indexOf(0) >= 0) return bytes;
  const t = bytes.toString("utf8");
  return t.indexOf("\r\n") >= 0 ? Buffer.from(t.replace(/\r\n/g, "\n"), "utf8") : bytes;
}

/** Problemas do SKILL.md oficial (lista vazia = ok). */
export function problemasDoSkillMd(texto) {
  const problemas = [];
  const topo = /^---\n([\s\S]*?)\n---/.exec(String(texto).replace(/\r\n/g, "\n"));
  if (!topo) return ["SKILL.md sem cabeçalho (frontmatter)"];
  const nome = /^name:\s*"?([^"\n]+)"?\s*$/m.exec(topo[1]);
  if (!nome || nome[1].trim() !== SKILL) problemas.push(`name diferente de ${SKILL}`);
  const desc = /^description:\s*"?([\s\S]*?)"?\s*$/m.exec(topo[1]);
  const d = desc ? desc[1].trim() : "";
  if (d.length < 1 || d.length > 1024) problemas.push(`description com ${d.length} caracteres (o OpenCode aceita de 1 a 1024)`);
  if (texto.indexOf(CAMINHO_DO_BUSCADOR) < 0) problemas.push(`SKILL.md sem o caminho relativo ${CAMINHO_DO_BUSCADOR}`);
  if (texto.indexOf("{{") >= 0) problemas.push("SKILL.md com marcador {{ sobrando");
  if (/[A-Za-z]:\\|~\/\.opencode/.test(texto)) problemas.push("SKILL.md com caminho absoluto ou da pasta pessoal");
  return problemas;
}

/** Manifesto: SHA-256 de cada arquivo da skill (menos o próprio manifesto). */
export function montarManifesto(pasta, extra = {}) {
  const arquivos = {};
  for (const rel of listarArquivos(pasta)) if (rel !== "manifesto.json") arquivos[rel] = sha256(readFileSync(join(pasta, rel)));
  return { pacote: PACOTE, versao: VERSAO, integridade: INTEGRIDADE, gitHead: GIT_HEAD, skill: SKILL, ...extra, arquivos };
}

/**
 * Conferência sem rede: recalcula os SHA-256 e compara com o manifesto.
 * Também recusa as skills irmãs e as pastas que não deviam estar ali.
 */
export function conferirManifesto(pasta = DESTINO) {
  const problemas = [];
  const caminho = join(pasta, "manifesto.json");
  if (!existsSync(caminho)) return { ok: false, arquivos: 0, problemas: ["manifesto.json não existe (rode a instalação)"] };
  let manifesto;
  try {
    manifesto = JSON.parse(readFileSync(caminho, "utf8"));
  } catch {
    return { ok: false, arquivos: 0, problemas: ["manifesto.json quebrado"] };
  }
  if (manifesto.versao !== VERSAO || manifesto.integridade !== INTEGRIDADE) problemas.push(`manifesto de outra versão (${manifesto.versao})`);
  const esperados = manifesto.arquivos || {};
  const presentes = listarArquivos(pasta).filter((r) => r !== "manifesto.json");
  for (const rel of presentes) {
    if (foraDaCopia(rel)) problemas.push(`não devia estar na skill: ${rel}`);
    else if (!esperados[rel]) problemas.push(`arquivo fora do manifesto: ${rel}`);
    else if (sha256(readFileSync(join(pasta, rel))) !== esperados[rel]) problemas.push(`SHA-256 diferente: ${rel}`);
  }
  for (const rel of Object.keys(esperados)) if (presentes.indexOf(rel) < 0) problemas.push(`faltando: ${rel}`);
  const vizinhas = dirname(pasta);
  if (existsSync(vizinhas)) for (const irma of IRMAS) if (existsSync(join(vizinhas, irma))) problemas.push(`skill irmã não pode ficar no motor: ${irma}`);
  if (existsSync(join(pasta, "SKILL.md"))) problemasDoSkillMd(readFileSync(join(pasta, "SKILL.md"), "utf8")).forEach((p) => problemas.push(p));
  return { ok: problemas.length === 0, arquivos: presentes.length, problemas };
}

export function origemMd(data, removidas, tamanho) {
  return `# Origem da skill ui-ux-pro-max

Instalada pelo script \`workers/motor-codigo/scripts/instalar-ui-ux-pro-max.mjs\` (Aceleriq). Não edite à mão: rode o script de novo.

| Item | Valor |
|---|---|
| Pacote | \`${PACOTE}\` (npm) |
| Versão | ${VERSAO} |
| Integridade npm | \`${INTEGRIDADE}\` |
| gitHead | \`${GIT_HEAD}\` |
| Repositório | ${REPOSITORIO} |
| Licença | MIT, Copyright (c) 2024 Next Level Builder (arquivo LICENSE ao lado) |
| Comando | \`${COMANDO}\`, numa pasta temporária |
| Data | ${data} |
| Arquivos | ${tamanho} (com LICENSE, ORIGEM.md e manifesto.json) |

## O que ficou de fora e por quê
- As skills irmãs que o instalador traz junto: ${removidas.length ? removidas.map((s) => `\`${s}\``).join(", ") : "nenhuma"}. A \`design\` chama APIs externas com chave e a \`ui-styling\` tem outra licença (Apache 2.0); o motor usa só a \`ui-ux-pro-max\`.
- \`scripts/tests/\`: testes da própria skill, sem uso no motor.
- \`__pycache__/\`: cache do Python.

## O que a casa acrescentou
- \`LICENSE\`: o texto MIT do repositório (o pacote npm 2.15.0 não traz o arquivo, e a MIT pede o aviso junto da cópia).
- \`ORIGEM.md\` (este arquivo) e \`manifesto.json\` (SHA-256 de cada arquivo; \`--conferir\` refaz a conta sem rede).

## Como a casa usa
- A skill fica no worker (\`workers/motor-codigo/vendor/ui-ux-pro-max\`) e entra no opencode por \`skills.paths\`. O projeto do cliente não recebe cópia: nada dela vai para o zip do código nem para o site publicado.
- O agente de código carrega a skill pela ferramenta \`skill\` e roda o buscador por \`node scripts/uiux.mjs\` (o embrulho acha este \`scripts/search.py\` por UIUX_BUSCADOR, acha o Python certo e grava a prova em \`.aceleriq/uiux-log.jsonl\` do projeto).
- O design system do projeto (\`design-system/<cliente>/MASTER.md\`) é o worker que gera, pela consulta do pacote, e refaz quando a consulta muda.
- O \`AGENTS.md\` do projeto vence a skill: paleta, fontes, logo e copy vêm do pacote do cliente.
`;
}

/** npm e npx são .cmd no Windows: vão pela shell numa linha só, com aspas onde precisa. */
function rodar(cmd, args, opcoes = {}) {
  const base = { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...opcoes };
  const aspas = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
  const r = process.platform === "win32" ? spawnSync([cmd, ...args].map(aspas).join(" "), { ...base, shell: true }) : spawnSync(cmd, args, base);
  return { codigo: r.status, saida: String(r.stdout || ""), erro: String(r.stderr || "") + (r.error ? `\n${r.error.message}` : "") };
}

function falhar(msg) {
  console.error(`[uiux] ${msg}`);
  process.exit(1);
}

async function instalar() {
  // 1. Integridade: registro e tarball baixado precisam bater com a fixada.
  const vista = rodar("npm", ["view", `${PACOTE}@${VERSAO}`, "dist.integrity"]);
  if (vista.codigo !== 0) falhar(`npm view falhou: ${vista.erro.trim().slice(-300)}`);
  if (vista.saida.trim() !== INTEGRIDADE) falhar(`integridade do registro mudou: ${vista.saida.trim()} (esperado ${INTEGRIDADE})`);
  const tmp = mkdtempSync(join(tmpdir(), "uiux-"));
  try {
    const pack = rodar("npm", ["pack", `${PACOTE}@${VERSAO}`, "--json", "--pack-destination", tmp]);
    if (pack.codigo !== 0) falhar(`npm pack falhou: ${pack.erro.trim().slice(-300)}`);
    let info;
    try {
      info = JSON.parse(pack.saida)[0];
    } catch {
      falhar("npm pack não devolveu JSON");
    }
    if (!info || info.integrity !== INTEGRIDADE) falhar(`integridade do tarball diferente: ${info && info.integrity}`);
    console.log(`[uiux] integridade conferida: ${INTEGRIDADE.slice(0, 24)}...`);

    // 2. Instalador oficial numa pasta temporária.
    const projeto = join(tmp, "projeto");
    mkdirSync(projeto, { recursive: true });
    const init = rodar("npx", ["--yes", `${PACOTE}@${VERSAO}`, "init", "--ai", "opencode"], { cwd: projeto, env: { ...process.env, npm_config_yes: "true", NO_COLOR: "1" } });
    if (init.codigo !== 0) falhar(`o instalador falhou: ${(init.erro || init.saida).trim().slice(-400)}`);
    const skills = join(projeto, ".opencode", "skills");
    const origem = join(skills, SKILL);
    if (!existsSync(join(origem, "SKILL.md"))) falhar("o instalador não gerou .opencode/skills/ui-ux-pro-max/SKILL.md");
    const trazidas = readdirSync(skills).filter((n) => n !== SKILL).sort();

    // 3. SKILL.md oficial.
    const problemas = problemasDoSkillMd(readFileSync(join(origem, "SKILL.md"), "utf8"));
    if (problemas.length) falhar(`SKILL.md fora do esperado:\n- ${problemas.join("\n- ")}`);

    // 4. Só a ui-ux-pro-max, sem testes nem cache, em LF.
    if (existsSync(DESTINO)) rmSync(DESTINO, { recursive: true, force: true });
    const copiados = [];
    for (const rel of listarArquivos(origem)) {
      if (foraDaCopia(rel)) continue;
      const alvo = join(DESTINO, ...rel.split("/"));
      mkdirSync(dirname(alvo), { recursive: true });
      writeFileSync(alvo, emLf(readFileSync(join(origem, ...rel.split("/")))));
      copiados.push(rel);
    }

    // 5. O que a casa escreve.
    writeFileSync(join(DESTINO, "LICENSE"), LICENCA);
    writeFileSync(join(DESTINO, "ORIGEM.md"), origemMd(new Date().toISOString().slice(0, 10), trazidas, copiados.length + ARQUIVOS_DA_CASA.length));
    const manifesto = montarManifesto(DESTINO, { comando: COMANDO, removidas: trazidas, sem: ["scripts/tests/", "__pycache__/"] });
    writeFileSync(join(DESTINO, "manifesto.json"), `${JSON.stringify(manifesto, null, 2)}\n`);
    const c = conferirManifesto(DESTINO);
    if (!c.ok) falhar(`conferência depois da instalação falhou:\n- ${c.problemas.join("\n- ")}`);
    console.log(`[uiux] instalada em ${relative(process.cwd(), DESTINO) || DESTINO}: ${c.arquivos} arquivos; de fora: ${trazidas.join(", ") || "nada"}, scripts/tests, __pycache__`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Sem rede: reescreve os arquivos da casa (LICENSE, ORIGEM.md e manifesto.json)
 * com o texto deste script, mantendo a data e as removidas do manifesto. Só
 * roda se TODO arquivo oficial ainda bate com o SHA-256 do manifesto: não dá
 * para "lavar" uma skill mexida.
 */
export function refazerArquivosDaCasa(pasta = DESTINO) {
  const caminho = join(pasta, "manifesto.json");
  if (!existsSync(caminho)) return { ok: false, problemas: ["manifesto.json não existe (rode a instalação)"] };
  const antigo = JSON.parse(readFileSync(caminho, "utf8"));
  const esperados = antigo.arquivos || {};
  const problemas = [];
  const oficiais = listarArquivos(pasta).filter((r) => ARQUIVOS_DA_CASA.indexOf(r) < 0);
  for (const rel of oficiais) {
    if (foraDaCopia(rel)) problemas.push(`não devia estar na skill: ${rel}`);
    else if (!esperados[rel] || sha256(readFileSync(join(pasta, rel))) !== esperados[rel]) problemas.push(`arquivo oficial mudou ou está fora do manifesto: ${rel}`);
  }
  for (const rel of Object.keys(esperados)) if (ARQUIVOS_DA_CASA.indexOf(rel) < 0 && oficiais.indexOf(rel) < 0) problemas.push(`faltando: ${rel}`);
  if (problemas.length) return { ok: false, problemas };
  const data = (/\| Data \| (\d{4}-\d{2}-\d{2}) \|/.exec(existsSync(join(pasta, "ORIGEM.md")) ? readFileSync(join(pasta, "ORIGEM.md"), "utf8") : "") || [])[1] || new Date().toISOString().slice(0, 10);
  const removidas = Array.isArray(antigo.removidas) ? antigo.removidas : IRMAS;
  writeFileSync(join(pasta, "LICENSE"), LICENCA);
  writeFileSync(join(pasta, "ORIGEM.md"), origemMd(data, removidas, oficiais.length + ARQUIVOS_DA_CASA.length));
  const manifesto = montarManifesto(pasta, { comando: antigo.comando || COMANDO, removidas, sem: antigo.sem || ["scripts/tests/", "__pycache__/"] });
  writeFileSync(caminho, `${JSON.stringify(manifesto, null, 2)}\n`);
  return { ok: true, problemas: [] };
}

const mesmoArquivo = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && mesmoArquivo(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  if (process.argv.indexOf("--refazer-casa") >= 0) {
    const r = refazerArquivosDaCasa(DESTINO);
    if (!r.ok) {
      console.error(`[uiux] não reescrevi os arquivos da casa:\n- ${r.problemas.join("\n- ")}`);
      process.exit(1);
    }
    const c = conferirManifesto(DESTINO);
    console.log(`[uiux] arquivos da casa reescritos; manifesto ${c.ok ? "ok" : "com problema"}: ${c.arquivos} arquivos`);
    if (!c.ok) process.exit(1);
  } else if (process.argv.indexOf("--conferir") >= 0) {
    const c = conferirManifesto(DESTINO);
    if (!c.ok) {
      console.error(`[uiux] conferência falhou:\n- ${c.problemas.join("\n- ")}`);
      process.exit(1);
    }
    console.log(`[uiux] manifesto ok: ${c.arquivos} arquivos conferidos (${PACOTE}@${VERSAO})`);
  } else {
    await instalar();
  }
}
