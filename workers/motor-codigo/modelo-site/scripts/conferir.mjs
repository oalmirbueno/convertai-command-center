// Conferência rápida do HTML pronto (o agente roda depois de cada seção).
// A revisão completa (acessibilidade, celular e SEO) roda no motor.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync(resolve(import.meta.dirname, "..", "dist", "index.html"), "utf8");
const problemas = [];
const h1 = (html.match(/<h1[\s>]/gi) || []).length;
if (h1 > 1) problemas.push(`${h1} h1 na página (o certo é um, no hero)`);
const imgs = html.match(/<img\b[^>]*>/gi) || [];
if (imgs.some((i) => !/\balt=/i.test(i))) problemas.push("imagem sem alt");
if (imgs.some((i) => !/\bwidth=/i.test(i) || !/\bheight=/i.test(i))) problemas.push("imagem sem width e height");
const texto = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
if (/[–—]/.test(texto)) problemas.push("travessão no texto (use vírgula ou ponto)");
if (problemas.length) {
  console.error(`CONFERIR:\n- ${problemas.join("\n- ")}`);
  process.exit(1);
}
console.log("conferir ok");
