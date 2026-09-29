#!/usr/bin/env node
/**
 * Sobe o catálogo de mockups e as texturas para o bucket `mockups` e grava as linhas de
 * public.mockup_catalogo e public.textura_catalogo (upsert pelo id).
 *
 * Antes: aplicar supabase/migrations/20260930110000_estudio_de_mockups.sql (cria bucket e tabelas).
 *
 * Chave de serviço: nunca em arquivo. Vem, nesta ordem,
 *   1) da variável SUPABASE_SERVICE_ROLE_KEY do processo, ou
 *   2) do Supabase CLI já autenticado nesta máquina (credencial no cofre do sistema):
 *      `npx supabase@2.117.0 projects api-keys --project-ref <ref> -o json`, lida só em memória.
 *
 * Uso:
 *   node tools/mockups/subir_catalogo.mjs [--trabalho C:/AI/acervo-aceleriq/mockups-trabalho] [--seco] [--so id1,id2] [--sem-texturas]
 *   --seco: só confere os arquivos e mostra o que subiria (sem rede).
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { BUCKET, enviosDoMockup, linhaDaTextura, linhaDoCatalogo, tipoDoArquivo } from "./catalogo-linhas.mjs";

const PROJETO = "jjjtkowvxemvituvywvf";
const URL_DO_PROJETO = `https://${PROJETO}.supabase.co`;

function argumentos() {
  const a = process.argv.slice(2);
  const valor = (nome, padrao) => {
    const i = a.indexOf(nome);
    return i >= 0 && a[i + 1] ? a[i + 1] : padrao;
  };
  return {
    trabalho: valor("--trabalho", "C:/AI/acervo-aceleriq/mockups-trabalho"),
    seco: a.includes("--seco"),
    so: new Set(valor("--so", "").split(",").filter(Boolean)),
    semTexturas: a.includes("--sem-texturas"),
  };
}

function chaveDeServico() {
  const doAmbiente = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (doAmbiente) return doAmbiente;
  let saida;
  try {
    saida = execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["--yes", "supabase@2.117.0", "projects", "api-keys", "--project-ref", PROJETO, "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: process.platform === "win32",
    });
  } catch {
    throw new Error("Sem chave de serviço: defina SUPABASE_SERVICE_ROLE_KEY no processo ou autentique o Supabase CLI (npx supabase login).");
  }
  const lista = JSON.parse(saida.slice(saida.indexOf("[")));
  const item = lista.find((k) => k && (k.name === "service_role" || k.id === "service_role"));
  if (!item || !item.api_key) throw new Error("O Supabase CLI não devolveu a chave service_role.");
  return item.api_key;
}

function lerJson(caminho) {
  return JSON.parse(readFileSync(caminho, "utf8"));
}

async function main() {
  const a = argumentos();
  const catalogo = lerJson(join(a.trabalho, "catalogo.json"));
  const texturas = !a.semTexturas && existsSync(join(a.trabalho, "texturas.json")) ? lerJson(join(a.trabalho, "texturas.json")) : { itens: [] };

  const linhas = [];
  const envios = [];
  const problemas = [];
  for (const meta of catalogo.itens || []) {
    if (a.so.size && !a.so.has(meta.id)) continue;
    const r = linhaDoCatalogo(meta);
    if (r.erro) {
      problemas.push(r.erro);
      continue;
    }
    const lista = enviosDoMockup(meta.id, join(a.trabalho, "saida", meta.id).replace(/\\/g, "/"));
    const falta = lista.filter((e) => !existsSync(e.local));
    if (falta.length) {
      problemas.push(`${meta.id}: faltam ${falta.map((f) => f.local).join(", ")}`);
      continue;
    }
    linhas.push(r.linha);
    envios.push(...lista);
  }
  const linhasTex = [];
  for (const t of texturas.itens || []) {
    const r = linhaDaTextura(t);
    if (r.erro) {
      problemas.push(r.erro);
      continue;
    }
    const png = join(a.trabalho, "texturas", `${t.id}.png`);
    const mini = join(a.trabalho, "texturas", `${t.id}_mini.png`);
    if (!existsSync(png) || !existsSync(mini)) {
      problemas.push(`${t.id}: PNG ausente`);
      continue;
    }
    linhasTex.push(r.linha);
    envios.push({ local: png, destino: r.linha.caminho }, { local: mini, destino: r.linha.caminho_mini });
  }
  const bytes = envios.reduce((t, e) => t + statSync(e.local).size, 0);
  console.log(`mockups: ${linhas.length} | texturas: ${linhasTex.length} | arquivos: ${envios.length} | ${(bytes / 1e6).toFixed(1)} MB`);
  for (const p of problemas) console.log("  fora:", p);
  if (a.seco) return;

  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(URL_DO_PROJETO, chaveDeServico(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: bucket, error: erroBucket } = await db.storage.getBucket(BUCKET);
  if (erroBucket || !bucket) throw new Error(`O bucket ${BUCKET} não existe. Aplique a migration 20260930110000_estudio_de_mockups.sql antes.`);

  let feitos = 0;
  const falhas = [];
  const fila = envios.slice();
  const trabalhador = async () => {
    for (;;) {
      const e = fila.shift();
      if (!e) return;
      const corpo = readFileSync(e.local);
      let erro = null;
      for (let tentativa = 0; tentativa < 3; tentativa++) {
        const r = await db.storage.from(BUCKET).upload(e.destino, corpo, { contentType: tipoDoArquivo(e.destino), upsert: true, cacheControl: "31536000" });
        erro = r.error;
        if (!erro) break;
      }
      if (erro) falhas.push(`${e.destino}: ${erro.message}`);
      feitos += 1;
      if (feitos % 50 === 0) console.log(`  ${feitos}/${envios.length}`);
    }
  };
  await Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()]);
  if (falhas.length) {
    for (const f of falhas) console.error("  falhou:", f);
    throw new Error(`${falhas.length} arquivos não subiram; as linhas não foram gravadas. Rode de novo (é idempotente).`);
  }
  const agora = new Date().toISOString();
  const { error: e1 } = await db.from("mockup_catalogo").upsert(linhas.map((l) => ({ ...l, atualizado_em: agora })), { onConflict: "id" });
  if (e1) throw new Error(`mockup_catalogo: ${e1.message}`);
  if (linhasTex.length) {
    const { error: e2 } = await db.from("textura_catalogo").upsert(linhasTex, { onConflict: "id" });
    if (e2) throw new Error(`textura_catalogo: ${e2.message}`);
  }
  console.log(`pronto: ${linhas.length} mockups e ${linhasTex.length} texturas no catálogo`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
