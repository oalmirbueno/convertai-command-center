/**
 * A prévia de um site IMPORTADO (Mesa Site): servidor estático do dist/ em
 * 127.0.0.1, sem rodar código do site (o Vite da casa não serve aqui, porque
 * o projeto pode ser Next, Astro, HTML puro...). Só arquivos de dentro do
 * dist; rota sem arquivo cai no index.html (roteador do lado do navegador).
 * Uso: node servir.mjs <pasta-dist> <porta>
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const raiz = normalize(process.argv[2] || "dist");
const porta = Number(process.argv[3]) || 4173;
const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".avif": "image/avif", ".gif": "image/gif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".mp4": "video/mp4", ".webm": "video/webm", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".webmanifest": "application/manifest+json",
};

createServer((req, res) => {
  try {
    const caminho = decodeURIComponent(String(req.url || "/").split("?")[0].split("#")[0]);
    let arquivo = normalize(join(raiz, caminho));
    if (arquivo.indexOf(raiz) !== 0) return void res.writeHead(403).end();
    if (existsSync(arquivo) && statSync(arquivo).isDirectory()) arquivo = join(arquivo, "index.html");
    if (!existsSync(arquivo) && existsSync(`${arquivo}.html`)) arquivo = `${arquivo}.html`;
    if (!existsSync(arquivo) && !extname(caminho)) arquivo = join(raiz, "index.html");
    if (!existsSync(arquivo)) return void res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end(existsSync(join(raiz, "index.html")) ? "não achado" : "O site ainda está compilando.");
    res.writeHead(200, { "content-type": TIPOS[extname(arquivo).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
    res.end(readFileSync(arquivo));
  } catch {
    res.writeHead(500).end();
  }
}).listen(porta, "127.0.0.1", () => console.log(`http://127.0.0.1:${porta}`));
