// Conferência rápida do HTML pronto (o agente roda depois de cada seção).
// A revisão completa (acessibilidade, celular e SEO) roda no motor.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { urlDasFontes } from "./seo.mjs";

const raiz = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(raiz, "dist", "index.html"), "utf8");
const problemas = [];
const h1 = (html.match(/<h1[\s>]/gi) || []).length;
if (h1 > 1) problemas.push(`${h1} h1 na página (o certo é um, no hero)`);
const imgs = html.match(/<img\b[^>]*>/gi) || [];
if (imgs.some((i) => !/\balt=/i.test(i))) problemas.push("imagem sem alt");
if (imgs.some((i) => !/\bwidth=/i.test(i) || !/\bheight=/i.test(i))) problemas.push("imagem sem width e height");
const texto = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
if (/[–—]/.test(texto)) problemas.push("travessão no texto (use vírgula ou ponto)");

// Três conferências baratas de UX (base ui-ux-pro-max): movimento reduzido, foco visível e fonte com swap.
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

if (problemas.length) {
  console.error(`CONFERIR:\n- ${problemas.join("\n- ")}`);
  process.exit(1);
}
console.log("conferir ok");
