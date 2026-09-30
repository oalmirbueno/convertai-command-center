/**
 * O diretório de um site na máquina da agência: nasce do modelo
 * (modelo-site/), é um repositório git (um commit por passo; Desfazer = voltar
 * o commit) e recebe o pacote do cliente (.aceleriq/pacote.json, src/marca.css,
 * logo e imagens em public/, anexos em referencias/).
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PROJETO_VALIDO } from "../../../supabase/functions/_shared/motor-codigo.ts";
import { ajustarAoDestaque, apoioDaPaleta, type ApoioDaPaleta, coresDoSite, type PapelDoApoio, variaveisDoApoio } from "../../../supabase/functions/_shared/uiux/apoio-da-paleta.ts";
import type { Fila } from "./fila.ts";
import { rodar } from "./processos.ts";

// UIM: um `2>nul` do agente no bash do Git cria o arquivo "nul", que quebra o git add do commit.
import { apagarArquivosReservados } from "./nomes-reservados.ts";

export const MODELO_DO_SITE = resolve(import.meta.dirname, "..", "modelo-site");

export type ArquivoDoPacote = { bucket: string; path: string; destino: string };

const GIT_AUTOR = ["-c", "user.name=Motor Aceleriq", "-c", "user.email=motor@aceleriq.local", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false"];

export async function git(pasta: string, args: string[]): Promise<string> {
  const r = await rodar("git", [...GIT_AUTOR, ...args], { cwd: pasta, prazoMs: 120_000 });
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
  const r = await rodar("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", "--prefer-offline"], { cwd: pasta, prazoMs: PRAZO_DA_INSTALACAO_MS });
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
  const r = await rodar("npm", ["run", "build"], { cwd: pasta, prazoMs: 5 * 60_000 });
  return { ok: r.codigo === 0, log: `${r.saida}\n${r.erro}`.trim().slice(-2000) };
}
