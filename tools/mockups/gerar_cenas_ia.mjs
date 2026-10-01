#!/usr/bin/env node
/**
 * Gera as cenas dos mockups de IA do catálogo (frente MCK, rodada 2).
 *
 * A IA desenha só a cena, com a superfície LISA e BRANCA onde a marca vai entrar. A marca nunca
 * passa pelo gerador: o mockup_de_ia.py acha a superfície, calcula a perspectiva (4 cantos) e grava
 * as camadas do catálogo; o painel aplica a logo real por código.
 *
 * Chave: só da variável OPENROUTER_API_KEY do processo (nunca em arquivo).
 *
 * Uso:
 *   node tools/mockups/gerar_cenas_ia.mjs [--saida C:/AI/acervo-aceleriq/mockups-trabalho/ia] [--so id1,id2] [--modelo openai/gpt-image-2.5-flare] [--qualidade high] [--seco]
 * Grava <saida>/<id>.png e <saida>/cenas.json (prompt, modelo, custo informado).
 * Já gerada (arquivo existe) é pulada: rodar de novo não cobra de novo.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CENAS_DE_IA } from "./cenas-de-ia.mjs";

function argumentos() {
  const a = process.argv.slice(2);
  const valor = (nome, padrao) => {
    const i = a.indexOf(nome);
    return i >= 0 && a[i + 1] ? a[i + 1] : padrao;
  };
  return {
    saida: valor("--saida", "C:/AI/acervo-aceleriq/mockups-trabalho/ia"),
    so: new Set(valor("--so", "").split(",").filter(Boolean)),
    modelo: valor("--modelo", "openai/gpt-image-2.5-flare"),
    qualidade: valor("--qualidade", "high"),
    seco: a.includes("--seco"),
  };
}

async function gerar(cena, a, chave) {
  const res = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json", "X-Title": "Aceleriq - catalogo de mockups" },
    body: JSON.stringify({ model: a.modelo, prompt: cena.prompt, n: 1, size: cena.tamanho, quality: a.qualidade, output_format: "png" }),
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${texto.slice(0, 300)}`);
  const data = JSON.parse(texto);
  const item = data.data && data.data[0];
  let bytes = null;
  if (item && item.b64_json) bytes = Buffer.from(item.b64_json, "base64");
  else if (item && item.url) {
    const m = /^data:[^;]+;base64,(.+)$/.exec(item.url);
    bytes = m ? Buffer.from(m[1], "base64") : Buffer.from(await (await fetch(item.url)).arrayBuffer());
  }
  if (!bytes || !bytes.length) throw new Error("o gerador não devolveu imagem");
  return { bytes, custo: data.usage && typeof data.usage.cost === "number" ? data.usage.cost : null };
}

async function main() {
  const a = argumentos();
  mkdirSync(a.saida, { recursive: true });
  const registro = existsSync(join(a.saida, "cenas.json")) ? JSON.parse(readFileSync(join(a.saida, "cenas.json"), "utf8")) : { cenas: {} };
  const fila = CENAS_DE_IA.filter((c) => !a.so.size || a.so.has(c.id)).filter((c) => !existsSync(join(a.saida, `${c.id}.png`)));
  console.log(`${fila.length} cenas para gerar com ${a.modelo} (${a.qualidade})`);
  if (a.seco) {
    for (const c of fila) console.log(`  ${c.id} ${c.tamanho}: ${c.prompt.slice(0, 90)}...`);
    return;
  }
  const chave = (process.env.OPENROUTER_API_KEY || "").trim();
  if (!chave) throw new Error("Defina OPENROUTER_API_KEY no processo (nunca em arquivo).");
  let total = 0;
  const falhas = [];
  for (const c of fila) {
    try {
      const r = await gerar(c, a, chave);
      writeFileSync(join(a.saida, `${c.id}.png`), r.bytes);
      registro.cenas[c.id] = { prompt: c.prompt, modelo: a.modelo, qualidade: a.qualidade, tamanho: c.tamanho, custo_usd: r.custo, gerada_em: new Date().toISOString() };
      writeFileSync(join(a.saida, "cenas.json"), JSON.stringify(registro, null, 1));
      total += r.custo || 0;
      console.log(`  ok ${c.id} (${r.custo === null ? "custo não informado" : `US$ ${r.custo.toFixed(4)}`})`);
    } catch (e) {
      falhas.push(`${c.id}: ${e instanceof Error ? e.message : e}`);
      console.error(`  falhou ${c.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`pronto: ${fila.length - falhas.length} cenas, US$ ${total.toFixed(4)} informados pelo OpenRouter`);
  if (falhas.length) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
