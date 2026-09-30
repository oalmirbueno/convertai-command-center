/**
 * Revisão de UX do build (frente UXM, 30/09/2026): as regras da base UI UX
 * Pro Max conferidas por código em TODAS as páginas pré-renderizadas
 * (dist/index.html e dist/<slug>/index.html, revisarUxDasPaginas, puro, em
 * _shared/uiux/revisao-ux.ts) e no CSS do dist, mais a prova que o agente do
 * motor deixou em .aceleriq/ux/<seção>.json (regras que pedem o layout vivo).
 *
 * A prova é lida pelo MESMO leitor do evento da passada (normalizarProvaDeUx
 * de prova-da-base.ts: id "uupm:ux:28" ou o nome da regra "Focus States"),
 * só das seções do mapa atual e só quando é a prova da última passada que
 * mexeu na seção (pelo commit: seção refeita sem prova nova não conta).
 * É aviso: nada trava a publicação.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { nomeDoComponente } from "../../../supabase/functions/_shared/site-metodo.ts";
import { type AvisoDeUx, lerTokensDoCss, type PaginaParaRevisar, type ProvaDoAgente, revisarUxDasPaginas } from "../../../supabase/functions/_shared/uiux/revisao-ux.ts";
import { git } from "./projeto.ts";
import { normalizarProvaDeUx, PASTA_DA_PROVA_DE_UX, regrasDeUxDaBase } from "./prova-da-base.ts";

const MAX_CSS = 2_000_000;
const MAX_PAGINAS = 30;
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SECAO = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** O CSS do build (dist/assets/*.css juntos, até 2 MB). */
export function cssDoBuild(pasta: string): string {
  const assets = join(pasta, "dist", "assets");
  if (!existsSync(assets)) return "";
  let css = "";
  for (const nome of readdirSync(assets).filter((n) => /\.css$/i.test(n)).sort()) {
    if (css.length > MAX_CSS) break;
    css += `${readFileSync(join(assets, nome), "utf8")}\n`;
  }
  return css.slice(0, MAX_CSS);
}

function lerPacote(pasta: string): Record<string, unknown> {
  try {
    const o = JSON.parse(readFileSync(join(pasta, ".aceleriq", "pacote.json"), "utf8"));
    return o && typeof o === "object" ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** As páginas do mapa (slug; "" é a inicial), pela ordem do pacote. Pacote antigo: só a inicial. */
export function slugsDoPacote(pacote: Record<string, unknown>): string[] {
  const lista = Array.isArray(pacote.paginas) ? (pacote.paginas as Array<{ slug?: unknown }>) : [];
  const slugs = [""];
  for (const p of lista) {
    const slug = p && typeof p.slug === "string" ? p.slug.replace(/^\/+|\/+$/g, "") : "";
    if (slug && SLUG.test(slug) && slugs.indexOf(slug) < 0) slugs.push(slug);
  }
  return slugs.slice(0, MAX_PAGINAS);
}

/** As seções do mapa atual (as do layout e as de cada página), sem repetir. */
export function secoesDoPacote(pacote: Record<string, unknown>): string[] {
  const saida: string[] = [];
  const por = (v: unknown) => {
    const s = String(v == null ? "" : v);
    if (SECAO.test(s) && saida.indexOf(s) < 0) saida.push(s);
  };
  for (const s of Array.isArray(pacote.secoes) ? pacote.secoes : []) por(s);
  for (const s of Array.isArray(pacote.globais) ? pacote.globais : []) por(s);
  for (const p of Array.isArray(pacote.paginas) ? (pacote.paginas as Array<{ secoes?: unknown }>) : []) for (const s of p && Array.isArray(p.secoes) ? p.secoes : []) por(s);
  return saida;
}

/** O HTML de cada página pré-renderizada que existe no dist (a inicial sempre, as outras pelo mapa). */
export function paginasDoBuild(pasta: string, pacote: Record<string, unknown> = lerPacote(pasta)): PaginaParaRevisar[] {
  const saida: PaginaParaRevisar[] = [];
  for (const slug of slugsDoPacote(pacote)) {
    const arquivo = slug ? join(pasta, "dist", slug, "index.html") : join(pasta, "dist", "index.html");
    if (!existsSync(arquivo)) continue;
    saida.push({ caminho: slug ? `/${slug}/` : "/", html: readFileSync(arquivo, "utf8") });
  }
  return saida;
}

/**
 * Posição de cada arquivo no `git log --name-only` (0 = mexido no commit mais
 * novo). Saída com um "\x01<hash>" por commit, seguido dos arquivos.
 */
export function ordemNoGit(saida: string): Record<string, number> {
  const ordem: Record<string, number> = {};
  let i = -1;
  for (const bruta of String(saida || "").split("\n")) {
    const linha = bruta.trim();
    if (!linha) continue;
    if (linha.charAt(0) === "\u0001") {
      i++;
      continue;
    }
    const caminho = linha.split("\\").join("/");
    if (i >= 0 && ordem[caminho] === undefined) ordem[caminho] = i;
  }
  return ordem;
}

/** Os arquivos da seção no projeto: src/secoes/<Nome>.tsx e o que estiver em src/secoes/<Nome>/. */
export const arquivosDaSecao = (secao: string, ordem: Record<string, number>): string[] => {
  const nome = nomeDoComponente(secao);
  return Object.keys(ordem).filter((c) => c === `src/secoes/${nome}.tsx` || c.indexOf(`src/secoes/${nome}/`) === 0);
};

/**
 * Prova fresca: o último commit que mexeu na prova é o mesmo (a passada commita
 * a seção e a prova juntas) ou mais novo que o último que mexeu na seção. Prova
 * que nunca foi commitada não conta; seção sem arquivo commitado aceita a prova.
 */
export function provaFresca(secao: string, ordem: Record<string, number>): boolean {
  const daProva = ordem[`.aceleriq/ux/${secao}.json`];
  if (daProva === undefined) return false;
  const daSecao = arquivosDaSecao(secao, ordem).map((c) => ordem[c]);
  return !daSecao.length || daProva <= Math.min.apply(null, daSecao);
}

/** Sem git (projeto quebrado): a prova vale se não é mais velha que o arquivo da seção. */
function provaFrescaPelaHora(pasta: string, secao: string): boolean {
  try {
    const prova = statSync(join(pasta, PASTA_DA_PROVA_DE_UX, `${secao}.json`)).mtimeMs;
    const arquivo = join(pasta, "src", "secoes", `${nomeDoComponente(secao)}.tsx`);
    return !existsSync(arquivo) || prova + 1000 >= statSync(arquivo).mtimeMs;
  } catch {
    return false;
  }
}

/**
 * As provas do agente das seções do mapa atual, frescas, pelo leitor único
 * (normalizarProvaDeUx com o mapa de nomes da skill do worker). Arquivo
 * quebrado, seção fora do mapa ou prova velha não viram prova (o checklist
 * mostra a regra como pendente).
 */
export async function provasDoAgente(pasta: string, secoes: string[]): Promise<ProvaDoAgente[]> {
  const dir = join(pasta, PASTA_DA_PROVA_DE_UX);
  if (!existsSync(dir) || !secoes.length) return [];
  let ordem: Record<string, number> | null = null;
  try {
    ordem = ordemNoGit(await git(pasta, ["log", "-n", "400", "--format=%x01%H", "--name-only", "--", ".aceleriq/ux", "src/secoes"]));
  } catch {
    ordem = null;
  }
  const nomes = regrasDeUxDaBase();
  const saida: ProvaDoAgente[] = [];
  for (const secao of secoes.filter((s) => SECAO.test(s)).slice(0, 60)) {
    const arquivo = join(dir, `${secao}.json`);
    if (!existsSync(arquivo)) continue;
    if (ordem ? !provaFresca(secao, ordem) : !provaFrescaPelaHora(pasta, secao)) continue;
    try {
      const prova = normalizarProvaDeUx(JSON.parse(readFileSync(arquivo, "utf8")), nomes);
      if (prova) saida.push({ secao, conferidas: prova.conferidas, pendentes: prova.pendentes });
    } catch {
      // Prova ilegível não vira prova.
    }
  }
  return saida;
}

export type RevisaoDeUx = { avisos: AvisoDeUx[]; paginas: string[]; agente: ProvaDoAgente[] };

/** A revisão de UX do projeto: todas as páginas do dist, o CSS, os tokens de src/marca.css e a prova do agente. */
export async function revisaoDeUx(pasta: string): Promise<RevisaoDeUx> {
  const pacote = lerPacote(pasta);
  const marca = join(pasta, "src", "marca.css");
  const tokens = existsSync(marca) ? lerTokensDoCss(readFileSync(marca, "utf8")) : {};
  const r = revisarUxDasPaginas(paginasDoBuild(pasta, pacote), cssDoBuild(pasta), tokens);
  return { avisos: r.avisos, paginas: r.paginas, agente: await provasDoAgente(pasta, secoesDoPacote(pacote)) };
}
