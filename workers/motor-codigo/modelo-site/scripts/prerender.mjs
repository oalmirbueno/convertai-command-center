// Pré-render para SEO (casca da casa): uma página HTML pronta por página do mapa
// (dist/index.html, dist/<slug>/index.html), com título, descrição, canonical, og,
// twitter, robots e o schema do negócio (JSON-LD que o painel montou), mais
// robots.txt e sitemap.xml. O que o SEO diz vem de pacote.seo (Mesa Site); pacote
// antigo usa pacote.copy.seo.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { montarPagina, paginasDoPacote, sitemapDoPacote } from "./seo.mjs";

const raiz = resolve(import.meta.dirname, "..");
const { render } = await import(pathToFileURL(resolve(raiz, "dist-ssr", "entry-server.js")).href);
const pacote = JSON.parse(readFileSync(resolve(raiz, ".aceleriq", "pacote.json"), "utf8"));
const base = readFileSync(resolve(raiz, "dist", "index.html"), "utf8");

const paginas = paginasDoPacote(pacote);
for (const p of paginas) {
  const caminho = p.slug ? `/${p.slug}/` : "/";
  const html = montarPagina(base, render(caminho), pacote, p);
  const pasta = p.slug ? resolve(raiz, "dist", p.slug) : resolve(raiz, "dist");
  mkdirSync(pasta, { recursive: true });
  writeFileSync(resolve(pasta, "index.html"), html);
}

const seo = pacote.seo || {};
writeFileSync(resolve(raiz, "dist", "robots.txt"), seo.robots || "User-agent: *\nAllow: /\n");
const sitemap = sitemapDoPacote(pacote, new Date().toISOString().slice(0, 10));
if (sitemap) writeFileSync(resolve(raiz, "dist", "sitemap.xml"), sitemap);

if (existsSync(resolve(raiz, "dist-ssr"))) rmSync(resolve(raiz, "dist-ssr"), { recursive: true, force: true });
console.log(`pré-render ok: ${paginas.length} página(s)${sitemap ? " + sitemap" : ""}`);
