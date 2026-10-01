/**
 * O diretório de um site na máquina da agência: nasce do modelo
 * (modelo-site/), é um repositório git (um commit por passo; Desfazer = voltar
 * o commit) e recebe o pacote do cliente (.aceleriq/pacote.json, src/marca.css,
 * logo e imagens em public/, anexos em referencias/).
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { PROJETO_VALIDO } from "../../../supabase/functions/_shared/motor-codigo.ts";
import { ajustarAoDestaque, apoioDaPaleta, type ApoioDaPaleta, coresDoSite, type PapelDoApoio, variaveisDoApoio } from "../../../supabase/functions/_shared/uiux/apoio-da-paleta.ts";
import type { Fila } from "./fila.ts";
// SPV: a ponte da prévia editável mora com a Mesa Site (a tela usa a mesma).
import { codigoDaPonte } from "../../../supabase/functions/mesa-site/modulos/ponte-da-previa.ts";
import { ambienteSemSegredos } from "./config-opencode.ts";
import type { ConferenciaDaSecao } from "./marcas-da-resposta.ts";
import { rodar } from "./processos.ts";
// A conferência da seção roda com o conferir.mjs do MODELO (nunca a cópia do projeto, que o agente alcança).
import { conferirSecao, paginasProntas } from "../modelo-site/scripts/conferir.mjs";

// UIM: um `2>nul` do agente no bash do Git cria o arquivo "nul", que quebra o git add do commit.
import { apagarArquivosReservados } from "./nomes-reservados.ts";

export const MODELO_DO_SITE = resolve(import.meta.dirname, "..", "modelo-site");
export type { ConferenciaDaSecao };

export type ArquivoDoPacote = { bucket: string; path: string; destino: string };

/**
 * O git do motor não roda hook nem fsmonitor do projeto (o .git/config e os
 * hooks ficam dentro da pasta do site) e roda sem os segredos do worker.
 */
const GIT_AUTOR = [
  "-c",
  "user.name=Motor Aceleriq",
  "-c",
  "user.email=motor@aceleriq.local",
  "-c",
  "core.autocrlf=false",
  "-c",
  "commit.gpgsign=false",
  "-c",
  `core.hooksPath=${join(tmpdir(), "aceleriq-motor-sem-hooks")}`,
  "-c",
  "core.fsmonitor=false",
];

export async function git(pasta: string, args: string[]): Promise<string> {
  const r = await rodar("git", [...GIT_AUTOR, ...args], { cwd: pasta, prazoMs: 120_000, env: ambienteSemSegredos() });
  if (r.codigo !== 0) throw new Error(`git ${args[0]}: ${(r.erro || r.saida).trim().slice(0, 300)}`);
  return r.saida.trim();
}

export const commitAtual = (pasta: string) => git(pasta, ["rev-parse", "HEAD"]);

/** Commit do que mudou; sem mudança, devolve o commit atual (null = nada novo). */
export async function commitar(pasta: string, mensagem: string): Promise<{ commit: string; novo: boolean }> {
  apagarArquivosReservados(pasta);
  await git(pasta, ["add", "-A"]);
  const status = await git(pasta, ["status", "--porcelain"]);
  if (!status) return { commit: await commitAtual(pasta), novo: false };
  await git(pasta, ["commit", "-q", "--no-verify", "-m", mensagem.replace(/\s+/g, " ").slice(0, 120)]);
  return { commit: await commitAtual(pasta), novo: true };
}

/** Desfazer: um commit novo que volta o que o trabalho fez (o histórico fica). */
export async function voltarCommits(pasta: string, anterior: string, ate: string): Promise<{ commit: string; novo: boolean }> {
  if (!/^[0-9a-f]{7,40}$/i.test(anterior) || !/^[0-9a-f]{7,40}$/i.test(ate)) throw new Error("commit inválido");
  await git(pasta, ["revert", "--no-edit", "--no-commit", `${anterior}..${ate}`]);
  return await commitar(pasta, `Desfazer ${ate.slice(0, 8)}`);
}

export function pastaDoProjeto(raiz: string, projeto: string): string {
  if (!PROJETO_VALIDO.test(projeto)) throw new Error("nome de projeto inválido");
  return join(raiz, projeto);
}

/**
 * O que nunca sai do modelo para um projeto: dependências, build, cache do
 * Python, qualquer pasta .opencode (as skills moram no worker; uma .opencode
 * no projeto faz o opencode instalar pacotes do npm ali) e o que a base de
 * design gera (design system, consulta gravada, log e prova de UX são de
 * cada projeto).
 */
export function copiaDoModelo(origem: string): boolean {
  if (/[\\/](node_modules|dist|dist-ssr|__pycache__|\.opencode)([\\/]|$)/.test(origem) || /\.pyc$/i.test(origem)) return false;
  const rel = origem.slice(MODELO_DO_SITE.length).split("\\").join("/").replace(/^\/+/, "");
  return !/^(design-system|\.aceleriq\/ux|\.aceleriq\/uiux-[a-z]+\.jsonl?)(\/|$)/.test(rel);
}

/** Cria o projeto do modelo (primeira vez) e deixa o git pronto. */
export async function garantirProjeto(pasta: string): Promise<boolean> {
  if (existsSync(join(pasta, ".git"))) return false;
  mkdirSync(pasta, { recursive: true });
  cpSync(MODELO_DO_SITE, pasta, { recursive: true, filter: copiaDoModelo });
  mkdirSync(join(pasta, "public", "marca"), { recursive: true });
  mkdirSync(join(pasta, "public", "imagens"), { recursive: true });
  await git(pasta, ["init", "-q", "-b", "main"]);
  await commitar(pasta, "Modelo da casa");
  return true;
}

/**
 * Casca da casa (SIT2): os arquivos que são do modelo, não do agente (App,
 * entradas, pré-render, integrações, movimento, AGENTS.md). Projeto criado
 * com uma casca mais velha ganha a nova no próximo trabalho, num commit
 * próprio; as seções (src/secoes) e o tema continuam do projeto.
 */
export type CascaDoModelo = { versao: number; arquivos: string[] };

export function lerCasca(pasta: string): CascaDoModelo | null {
  try {
    const c = JSON.parse(readFileSync(join(pasta, ".aceleriq", "casca.json"), "utf8")) as CascaDoModelo;
    return c && typeof c.versao === "number" && Array.isArray(c.arquivos) ? c : null;
  } catch {
    return null;
  }
}

/** Arquivo da casca é caminho relativo simples (nada de .. nem absoluto). */
export const arquivoDaCascaValido = (a: string) => typeof a === "string" && !!a && !/\.\./.test(a) && !/^[\\/]/.test(a) && !/^[a-z]:/i.test(a) && a.indexOf("src/secoes/") !== 0;

export async function atualizarCasca(pasta: string): Promise<number | null> {
  // Projeto numa casca mais velha ganha a nova inteira (o reporCasca cuida da mesma versão).
  const doModelo = lerCasca(MODELO_DO_SITE);
  if (!doModelo) return null;
  const doProjeto = lerCasca(pasta);
  if (doProjeto && doProjeto.versao >= doModelo.versao) return null;
  for (const a of doModelo.arquivos.filter(arquivoDaCascaValido)) {
    const origem = join(MODELO_DO_SITE, a);
    if (!existsSync(origem)) continue;
    mkdirSync(dirname(join(pasta, a)), { recursive: true });
    cpSync(origem, join(pasta, a));
  }
  mkdirSync(join(pasta, ".aceleriq"), { recursive: true });
  writeFileSync(join(pasta, ".aceleriq", "casca.json"), JSON.stringify(doModelo, null, 2));
  await commitar(pasta, `Casca da casa v${doModelo.versao}`);
  return doModelo.versao;
}

/**
 * Repõe a casca da casa (SPM): com o projeto na MESMA versão do modelo, todo
 * arquivo da casca que não bate com o do modelo volta ao original, a lista da
 * casca também, e os scripts do package.json voltam aos do modelo (é o que
 * `npm run checar` e `npm run build` rodam). A edição desses arquivos já é
 * negada ao agente; isto pega o que escapou (e o projeto que ficou com a
 * casca de outra frente na mesma versão). Não faz commit: devolve o que repôs.
 */
export function reporCasca(pasta: string): string[] {
  const doModelo = lerCasca(MODELO_DO_SITE);
  const doProjeto = lerCasca(pasta);
  if (!doModelo || !doProjeto || doProjeto.versao !== doModelo.versao) return [];
  const repostos: string[] = [];
  for (const a of doModelo.arquivos.filter(arquivoDaCascaValido)) {
    const origem = join(MODELO_DO_SITE, a);
    if (!existsSync(origem)) continue;
    const destino = join(pasta, a);
    const original = readFileSync(origem);
    if (existsSync(destino) && readFileSync(destino).equals(original)) continue;
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, original);
    repostos.push(a);
  }
  if (JSON.stringify(doProjeto) !== JSON.stringify(doModelo)) {
    writeFileSync(join(pasta, ".aceleriq", "casca.json"), JSON.stringify(doModelo, null, 2));
    repostos.push(".aceleriq/casca.json");
  }
  try {
    const pj = join(pasta, "package.json");
    const doSite = JSON.parse(readFileSync(pj, "utf8")) as { scripts?: unknown };
    const scripts = (JSON.parse(readFileSync(join(MODELO_DO_SITE, "package.json"), "utf8")) as { scripts?: unknown }).scripts;
    if (JSON.stringify(doSite.scripts) !== JSON.stringify(scripts)) {
      doSite.scripts = scripts;
      writeFileSync(pj, `${JSON.stringify(doSite, null, 2)}\n`);
      repostos.push("package.json (scripts)");
    }
  } catch {
    /* package.json ilegível: o build falha e a tela mostra */
  }
  return repostos;
}


/**
 * A conferência da seção (`conferir --secao <id>`) nas páginas prontas do
 * projeto, com o código do modelo: é a prova de verdade da passada. A PROVA
 * que o agente escreve passa a ser só a declarada.
 */
export function conferirSecaoDoProjeto(pasta: string, secao: string): ConferenciaDaSecao {
  try {
    const paginas = (paginasProntas(join(pasta, "dist")) as string[]).map((c) => ({ caminho: c, nome: relative(pasta, c).split(sep).join("/") }));
    const r = conferirSecao(paginas, secao) as { problemas: string[]; onde: { pagina: string; caracteres?: number; imagens?: number } | null };
    return { rodou: true, ok: r.problemas.length === 0, problemas: r.problemas.slice(0, 3), onde: r.onde || null };
  } catch (e) {
    return { rodou: false, ok: false, problemas: [], onde: null, motivo: `a conferência não rodou: ${e instanceof Error ? e.message.slice(0, 160) : "erro"}` };
  }
}

/**
 * Configuração do opencode que um agente possa ter plantado no site: o
 * opencode.json da raiz e o que houver em .opencode/ fora de skills/
 * (plugins, ferramentas, agentes, comandos e a configuração da pasta).
 * Plugin e ferramenta rodam como código na subida; skill só vale se a
 * permissão liberar. Apaga e devolve o que apagou.
 */
export function limparConfiguracaoDoSite(pasta: string): string[] {
  const apagados: string[] = [];
  const apagar = (rel: string) => {
    try {
      rmSync(join(pasta, rel), { recursive: true, force: true });
      apagados.push(rel);
    } catch {
      /* some na próxima */
    }
  };
  for (const n of ["opencode.json", "opencode.jsonc"]) if (existsSync(join(pasta, n))) apagar(n);
  const dentro = join(pasta, ".opencode");
  if (existsSync(dentro)) {
    let nomes: string[] = [];
    try {
      nomes = readdirSync(dentro);
    } catch {
      nomes = [];
    }
    for (const n of nomes) if (n !== "skills") apagar(`.opencode/${n}`);
  }
  return apagados;
}

/** O que um trabalho mudou (git diff --numstat), para a tela comparar versões. */
export async function arquivosMudados(pasta: string, de: string, ate: string): Promise<Array<{ arquivo: string; mais: number; menos: number }>> {
  if (!/^[0-9a-f]{7,40}$/i.test(de) || !/^[0-9a-f]{7,40}$/i.test(ate) || de === ate) return [];
  const saida = await git(pasta, ["diff", "--numstat", de, ate]);
  return saida
    .split("\n")
    .map((l) => l.split("\t"))
    .filter((p) => p.length >= 3)
    .map((p) => ({ arquivo: p[2].slice(0, 160), mais: Number(p[0]) || 0, menos: Number(p[1]) || 0 }))
    .filter((x) => x.arquivo.indexOf(".aceleriq/") !== 0)
    .slice(0, 40);
}

/**
 * src/marca.css a partir da paleta e das fontes do pacote: destaque = a cor
 * de papel primário (ou a primeira); fundo = a de papel fundo (ou a mais
 * escura se o DNA pede quase preto; senão a mais clara); texto pelo contraste
 * (coresDoSite, com a luminância da Identidade). UXM: o apoio da paleta
 * (pacote.base_de_design.apoio, a marca manda e a base completa) acrescenta
 * borda, anel de foco, erro, texto sobre o destaque, destaque para texto e
 * texto suave, todos com contraste conferido por código (lacuna 4.3).
 */
export function cssDaMarca(pacote: Record<string, unknown>): string {
  const { destaque, fundo, texto } = coresDoSite({ paleta: pacote.paleta, dna: pacote.dna, estilo: pacote.estilo });
  const claro = texto === "#111111";
  const fontes = (Array.isArray(pacote.fontes) ? pacote.fontes : []) as Array<{ nome?: string; papel?: string }>;
  const fonte = (papel: RegExp) => {
    const f = fontes.find((x) => papel.test(String(x.papel || "")));
    return f && f.nome ? `"${String(f.nome).replace(/"/g, "")}", ` : "";
  };
  const extras = variaveisDoApoio(apoioDoPacote(pacote, destaque, fundo, texto));
  return [
    "/* Gerado pelo motor a partir de pacote.paleta, pacote.fontes e pacote.base_de_design.apoio. Não edite à mão. */",
    ":root {",
    `  --cor-destaque: ${destaque};`,
    `  --cor-fundo: ${fundo};`,
    `  --cor-texto: ${texto};`,
    `  --cor-suave: ${claro ? "#5c5c5c" : "#a3a3a3"};`,
    `  --cor-superficie: ${claro ? "#ffffff" : "#18181a"};`,
    ...Object.keys(extras).map((k) => `  ${k}: ${extras[k]};`),
    `  --fonte-titulo: ${fonte(/tit|display|head/i)}ui-sans-serif, system-ui, sans-serif;`,
    `  --fonte-texto: ${fonte(/texto|corpo|body/i)}ui-sans-serif, system-ui, sans-serif;`,
    "}",
    "",
  ].join("\n");
}

/**
 * O apoio do pacote quando ele foi calculado para este fundo; senão, o da
 * marca sem a base (mesmas conferências). Nos dois casos, texto sobre o
 * destaque, destaque para texto e anel saem do MESMO destaque do
 * --cor-destaque (uma regra só; pacote antigo com outro destaque é refeito).
 */
export function apoioDoPacote(pacote: Record<string, unknown>, destaque: string, fundo: string, texto: string): ApoioDaPaleta {
  const bd = pacote.base_de_design && typeof pacote.base_de_design === "object" ? (pacote.base_de_design as { apoio?: unknown }) : null;
  const lista = bd && Array.isArray(bd.apoio) ? (bd.apoio as Array<{ papel?: string; hex?: string; origem?: string }>) : [];
  const papeis = lista.filter((x) => x && typeof x.hex === "string" && /^#[0-9a-f]{6}$/i.test(x.hex) && typeof x.papel === "string").map((x) => ({ papel: x.papel as PapelDoApoio, hex: String(x.hex), origem: String(x.origem || "") }));
  const doFundo = papeis.filter((x) => x.papel === "fundo")[0];
  if (papeis.length && doFundo && doFundo.hex.toLowerCase() === fundo.toLowerCase()) return ajustarAoDestaque({ papeis, avisos: [], citacao: null }, destaque, fundo, texto);
  return apoioDaPaleta({ marca: (Array.isArray(pacote.paleta) ? pacote.paleta : []) as Array<{ hex?: string; papel?: string }>, fundo, texto, destaque });
}

/** Escreve o pacote e baixa os arquivos (logo, fotos reais, imagens, anexos). Devolve os avisos. */
export async function escreverPacote(pasta: string, pacote: Record<string, unknown>, fila: Fila): Promise<string[]> {
  const avisos: string[] = [];
  const { arquivos, ...resto } = pacote as Record<string, unknown> & { arquivos?: ArquivoDoPacote[] };
  mkdirSync(join(pasta, ".aceleriq"), { recursive: true });
  writeFileSync(join(pasta, ".aceleriq", "pacote.json"), JSON.stringify(resto, null, 2));
  writeFileSync(join(pasta, "src", "marca.css"), cssDaMarca(resto));
  // SPV: a ponte da prévia editável (o vite.config da casca serve só no desenvolvimento; o build não leva).
  writeFileSync(join(pasta, ".aceleriq", "ponte.js"), codigoDaPonte());
  for (const a of Array.isArray(arquivos) ? arquivos : []) {
    if (!a || typeof a.destino !== "string" || /\.\./.test(a.destino) || !/^(public|referencias)\//.test(a.destino)) continue;
    const alvo = join(pasta, a.destino);
    if (existsSync(alvo) && a.destino.indexOf("referencias/") !== 0) continue;
    const bytes = await fila.baixar(a.bucket, a.path);
    if (!bytes) {
      avisos.push(`arquivo não baixou: ${a.destino}`);
      continue;
    }
    mkdirSync(dirname(alvo), { recursive: true });
    writeFileSync(alvo, bytes);
  }
  return avisos;
}

const PRAZO_DA_INSTALACAO_MS = 25 * 60_000;

async function npmInstall(pasta: string): Promise<void> {
  // Sem os segredos do worker: os scripts de instalação rodam código de fora.
  const r = await rodar("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", "--prefer-offline"], { cwd: pasta, prazoMs: PRAZO_DA_INSTALACAO_MS, env: ambienteSemSegredos() });
  if (r.codigo !== 0) throw new Error(`npm install${r.estourou ? " passou do prazo" : ""}: ${(r.erro || r.saida).trim().slice(-400)}`);
}

/**
 * Dependências: uma instalação só, na pasta _base ao lado dos projetos, com o
 * package.json do modelo; cada projeto aponta para ela (junção no Windows,
 * link no Linux). Projeto cujo package.json mudou ganha instalação própria.
 * Devolve o que fez ("base", "propria" ou null quando já estava pronto).
 */
export async function instalarSePrecisar(pasta: string): Promise<"base" | "propria" | null> {
  const pkg = readFileSync(join(pasta, "package.json"), "utf8");
  const nm = join(pasta, "node_modules");
  const marcaPropria = join(nm, ".instalado");
  if (existsSync(marcaPropria) && readFileSync(marcaPropria, "utf8") === pkg) return null;
  const doModelo = readFileSync(join(MODELO_DO_SITE, "package.json"), "utf8");
  if (pkg === doModelo) {
    const base = join(dirname(pasta), "_base");
    const marcaBase = join(base, "node_modules", ".instalado");
    if (!existsSync(marcaBase) || readFileSync(marcaBase, "utf8") !== doModelo) {
      mkdirSync(base, { recursive: true });
      writeFileSync(join(base, "package.json"), doModelo);
      await npmInstall(base);
      writeFileSync(marcaBase, doModelo);
    }
    if (!existsSync(nm)) symlinkSync(join(base, "node_modules"), nm, process.platform === "win32" ? "junction" : "dir");
    return "base";
  }
  // O agente mexeu no package.json (não deveria): instalação própria, sem a junção da base.
  if (existsSync(nm) && lstatSync(nm).isSymbolicLink()) unlinkSync(nm);
  await npmInstall(pasta);
  writeFileSync(marcaPropria, pkg);
  return "propria";
}

export async function construirSite(pasta: string): Promise<{ ok: boolean; log: string }> {
  // O build roda as seções que o agente escreveu (pré-render): sem os segredos do worker.
  const r = await rodar("npm", ["run", "build"], { cwd: pasta, prazoMs: 5 * 60_000, env: ambienteSemSegredos() });
  return { ok: r.codigo === 0, log: `${r.saida}\n${r.erro}`.trim().slice(-2000) };
}
