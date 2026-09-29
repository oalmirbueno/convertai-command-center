// Pré-render para SEO: injeta o HTML da página no dist/index.html e preenche título,
// descrição e og a partir da copy escolhida (pacote.copy.seo).
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const raiz = resolve(import.meta.dirname, "..");
const { render } = await import(pathToFileURL(resolve(raiz, "dist-ssr", "entry-server.js")).href);
const pacote = JSON.parse(readFileSync(resolve(raiz, ".aceleriq", "pacote.json"), "utf8"));
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const seo = (pacote.copy && pacote.copy.seo) || {};
const titulo = seo.titulo || pacote.cliente || "Site";
const descricao = seo.descricao || (pacote.copy && pacote.copy.subtitulo) || "";
const hero = (pacote.imagens || []).find((i) => i.slot === "hero");
const og = hero ? hero.arquivo : pacote.logo || "";
const destaque = ((pacote.paleta || [])[0] || {}).hex || "#111111";

let html = readFileSync(resolve(raiz, "dist", "index.html"), "utf8");
html = html
  .replace("<!--app-->", render())
  .replace(/<title>[^<]*<\/title>/, `<title>${esc(titulo)}</title>`)
  .replace(/(<meta name="description" content=")[^"]*"/, `$1${esc(descricao)}"`)
  .replace(/(<meta property="og:title" content=")[^"]*"/, `$1${esc(titulo)}"`)
  .replace(/(<meta property="og:description" content=")[^"]*"/, `$1${esc(descricao)}"`)
  .replace(/(<meta property="og:image" content=")[^"]*"/, `$1${esc(og)}"`)
  .replace(/(<meta name="theme-color" content=")[^"]*"/, `$1${esc(destaque)}"`)
  .replace(/(<link rel="icon" href=")[^"]*"/, `$1${esc(pacote.logo || "/favicon.ico")}"`);
writeFileSync(resolve(raiz, "dist", "index.html"), html);
if (existsSync(resolve(raiz, "dist-ssr"))) rmSync(resolve(raiz, "dist-ssr"), { recursive: true, force: true });
console.log(`pré-render ok: ${titulo}`);
