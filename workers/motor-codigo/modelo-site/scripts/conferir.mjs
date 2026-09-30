// Conferência rápida do HTML pronto (o agente roda depois de cada seção).
// A revisão completa (acessibilidade, celular e SEO) roda no motor.
//
// Com --secao <id> (método da casa, TDD da seção): varre dist/**/index.html e
// falha quando não há elemento com data-secao="<id>" ou quando ele tem menos
// de 20 caracteres de texto e nenhuma imagem. Rode ANTES de escrever a seção,
// sem build (tem de falhar; sem dist já é a falha), e DEPOIS de npm run checar
// (tem de passar). O motor roda a mesma conferência, com a cópia do modelo,
// depois do build dele.
//
// Sem --secao, além da página inicial, roda as três conferências baratas de UX
// da base ui-ux-pro-max (movimento reduzido, foco visível e fonte com swap).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { urlDasFontes } from "./seo.mjs";

const RAIZ = resolve(import.meta.dirname, "..");
const DIST = join(RAIZ, "dist");

/** O id pedido em --secao <id> ou --secao=<id> (null sem a opção). */
export function secaoDosArgumentos(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === "--secao") return String(argv[i + 1] || "");
    if (a.indexOf("--secao=") === 0) return a.slice(8);
  }
  return null;
}

/** Todas as páginas prontas: dist/index.html e dist/<página>/index.html. */
export function paginasProntas(dist) {
  const saida = [];
  if (!existsSync(dist)) return saida;
  (function andar(d) {
    for (const nome of readdirSync(d)) {
      const c = join(d, nome);
      if (statSync(c).isDirectory()) andar(c);
      else if (nome === "index.html") saida.push(c);
    }
  })(dist);
  return saida.sort();
}

const semAspas = (id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** O HTML de dentro do elemento com data-secao="<id>" (a primeira ocorrência), ou null. */
export function mioloDaSecao(html, id) {
  const abre = new RegExp(`<([a-zA-Z][a-zA-Z0-9-]*)\\b[^>]*\\sdata-secao\\s*=\\s*["']${semAspas(id)}["'][^>]*>`, "i");
  const m = abre.exec(html);
  if (!m) return null;
  const tag = m[1].toLowerCase();
  const inicio = m.index + m[0].length;
  if (/\/>$/.test(m[0])) return "";
  // Fecha a tag certa contando as aberturas e os fechamentos da mesma tag.
  const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, "gi");
  re.lastIndex = inicio;
  let nivel = 1;
  let t;
  while ((t = re.exec(html))) {
    if (t[1]) nivel--;
    else if (!t[2]) nivel++;
    if (nivel === 0) return html.slice(inicio, t.index);
  }
  return html.slice(inicio);
}

export const textoDoHtml = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Confere uma seção nas páginas prontas. Devolve os problemas (vazio = passou) e onde achou. */
export function conferirSecao(paginas, id) {
  if (!/^[a-z0-9][a-z0-9_-]{0,60}$/i.test(id)) return { problemas: [`id de seção inválido: "${id}"`], onde: null };
  // Sem build ainda: para o RED isso já é a falha esperada (não rode build só para o RED).
  if (!paginas.length) return { problemas: [`a seção ${id} ainda não está no build (não há dist/index.html). No RED isso basta: não rode build antes de escrever. No GREEN, rode npm run checar e confira de novo`], onde: null };
  let achou = null;
  for (const p of paginas) {
    const html = readFileSync(p.caminho, "utf8");
    const miolo = mioloDaSecao(html, id);
    if (miolo === null) continue;
    const texto = textoDoHtml(miolo);
    const imgs = miolo.match(/<img\b[^>]*>/gi) || [];
    const problemas = [];
    if (texto.length < 20 && !imgs.length) problemas.push(`a seção ${id} está quase vazia (${texto.length} caracteres de texto e nenhuma imagem)`);
    if (imgs.some((i) => !/\balt=/i.test(i))) problemas.push(`imagem sem alt na seção ${id}`);
    if (imgs.some((i) => !/\bwidth=/i.test(i) || !/\bheight=/i.test(i))) problemas.push(`imagem sem width e height na seção ${id}`);
    if (/[–—]/.test(texto)) problemas.push(`travessão no texto da seção ${id} (use vírgula ou ponto)`);
    if (!problemas.length) return { problemas: [], onde: { pagina: p.nome, caracteres: texto.length, imagens: imgs.length } };
    if (!achou) achou = { problemas, pagina: p.nome };
  }
  if (achou) return { problemas: achou.problemas, onde: { pagina: achou.pagina } };
  return { problemas: [`não há elemento com data-secao="${id}" em nenhuma página (a raiz da seção leva data-secao="${id}")`], onde: null };
}

/** A conferência de sempre (sem --secao): a página inicial inteira. */
export function conferirPagina(html) {
  const problemas = [];
  const h1 = (html.match(/<h1[\s>]/gi) || []).length;
  if (h1 > 1) problemas.push(`${h1} h1 na página (o certo é um, no hero)`);
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  if (imgs.some((i) => !/\balt=/i.test(i))) problemas.push("imagem sem alt");
  if (imgs.some((i) => !/\bwidth=/i.test(i) || !/\bheight=/i.test(i))) problemas.push("imagem sem width e height");
  const texto = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  if (/[–—]/.test(texto)) problemas.push("travessão no texto (use vírgula ou ponto)");
  return problemas;
}

/**
 * Três conferências baratas de UX (base ui-ux-pro-max), na página inteira:
 * movimento reduzido, foco visível e fonte com swap. `raiz` é a pasta do site
 * (lê dist/assets/*.css e .aceleriq/pacote.json).
 */
export function conferirUx(raiz, html) {
  const problemas = [];
  const pastaCss = resolve(raiz, "dist", "assets");
  const css = existsSync(pastaCss) ? readdirSync(pastaCss).filter((n) => /\.css$/.test(n)).map((n) => readFileSync(resolve(pastaCss, n), "utf8")).join("\n") : "";
  if (!/prefers-reduced-motion/.test(css)) problemas.push("CSS sem @media (prefers-reduced-motion) (uupm:ux:9): o tema.css da casa tem a regra, não apague");
  if (!/:focus-visible/.test(css)) problemas.push("CSS sem :focus-visible (uupm:ux:28): foco visível em botões e links");
  let pacote = {};
  try {
    pacote = JSON.parse(readFileSync(resolve(raiz, ".aceleriq", "pacote.json"), "utf8"));
  } catch {
    pacote = {};
  }
  const linksDeFonte = html.match(/<link\b[^>]*fonts\.googleapis\.com\/css[^>]*>/gi) || [];
  if (urlDasFontes(pacote) && !linksDeFonte.length) problemas.push("as fontes do pacote não entraram no HTML (uupm:ux:50): não mexa em scripts/");
  if (linksDeFonte.some((l) => !/display=swap/.test(l))) problemas.push("fonte sem display=swap (uupm:ux:75): use a URL do pacote");
  return problemas;
}

function principal() {
  const secao = secaoDosArgumentos(process.argv.slice(2));
  if (secao !== null) {
    const paginas = paginasProntas(DIST).map((c) => ({ caminho: c, nome: relative(RAIZ, c).split("\\").join("/") }));
    const r = conferirSecao(paginas, secao);
    if (r.problemas.length) {
      console.error(`CONFERIR --secao ${secao}:\n- ${r.problemas.join("\n- ")}`);
      process.exit(1);
    }
    console.log(`conferir --secao ${secao} ok (${r.onde.pagina}: ${r.onde.caracteres} caracteres de texto, ${r.onde.imagens} imagem(ns))`);
    return;
  }
  const html = readFileSync(join(DIST, "index.html"), "utf8");
  const problemas = conferirPagina(html).concat(conferirUx(RAIZ, html));
  if (problemas.length) {
    console.error(`CONFERIR:\n- ${problemas.join("\n- ")}`);
    process.exit(1);
  }
  console.log("conferir ok");
}

if (process.argv[1] && /conferir\.mjs$/.test(process.argv[1])) principal();
