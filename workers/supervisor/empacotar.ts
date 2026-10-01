/**
 * Publica uma versão dos workers para as máquinas (frente SUP, 01/10/2026).
 *
 *   node workers/supervisor/empacotar.ts                       só monta o zip (em .aceleriq-pacotes/) e mostra versão e sha256
 *   node workers/supervisor/empacotar.ts --subir               monta, sobe no Storage privado e registra a versão
 *   node workers/supervisor/empacotar.ts --subir --se-mudou    só sobe se esta versão ainda não foi publicada
 *   --indice      usa o que está staged em vez do HEAD (testes)
 *   --saida <zip> onde gravar o zip
 *   --nunca-falha falha vira aviso e sai 0 (o `npm run publicar` usa: o site já subiu)
 *
 * A chave de serviço vem do ambiente (SUPABASE_SERVICE_ROLE_KEY) ou do cofre
 * DPAPI do Aceleriq Motores desta máquina. Nunca é mostrada.
 * Depois de publicada, cada máquina baixa e troca sozinha quando os motores
 * dela estiverem ociosos (atualizar.ts).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUCKET_DOS_PACOTES } from "./banco.ts";
import { caminhos, lerMaquina, raizDosMotores, URL_PADRAO_DO_PROJETO } from "./config.ts";
import { montarPacote } from "./pacote.ts";
import { cofreDaMaquina } from "./segredos.ts";

const args = process.argv.slice(2);
const tem = (f: string) => args.indexOf(f) >= 0;
const valor = (f: string) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : undefined);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const caminhoNoStorage = (versao: string) => `${versao}/aceleriq-motores-${versao}.zip`;

async function chaveDeServico(): Promise<string> {
  const doAmbiente = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (doAmbiente) return doAmbiente;
  try {
    return (await cofreDaMaquina(caminhos(raizDosMotores()).cofre).ler()).SUPABASE_SERVICE_ROLE_KEY || "";
  } catch {
    return "";
  }
}

async function publicar(): Promise<void> {
  const saida = valor("--saida") || path.join(REPO, ".aceleriq-pacotes", "aceleriq-motores.zip");
  const p = montarPacote(REPO, saida, tem("--indice") ? "indice" : "HEAD");
  console.log(`Pacote dos workers: versão ${p.versao}, ${(p.tamanho / 1024 / 1024).toFixed(1)} MB, sha256 ${p.sha256}`);
  console.log(`  ${saida}`);
  if (!tem("--subir")) return;
  const url = (process.env.SUPABASE_URL || lerMaquina(caminhos(raizDosMotores())).supabase_url || URL_PADRAO_DO_PROJETO).replace(/\/+$/, "");
  const chave = await chaveDeServico();
  if (!chave) throw new Error("sem SUPABASE_SERVICE_ROLE_KEY (ambiente) nem cofre do Aceleriq Motores nesta máquina: não publiquei o pacote");
  const cab = { apikey: chave, Authorization: `Bearer ${chave}` };
  if (tem("--se-mudou")) {
    const r = await fetch(`${url}/rest/v1/motores_versoes?versao=eq.${p.versao}&select=versao`, { headers: cab });
    if (r.ok && ((await r.json()) as unknown[]).length) {
      console.log(`A versão ${p.versao} já está publicada: nada a fazer.`);
      return;
    }
  }
  const caminho = caminhoNoStorage(p.versao);
  const up = await fetch(`${url}/storage/v1/object/${BUCKET_DOS_PACOTES}/${caminho}`, {
    method: "POST",
    headers: { ...cab, "Content-Type": "application/zip", "x-upsert": "true", "Cache-Control": "no-store" },
    body: readFileSync(saida),
  });
  if (!up.ok) throw new Error(`o Storage recusou o pacote (${up.status}): ${(await up.text()).slice(0, 200)}`);
  const reg = await fetch(`${url}/rest/v1/rpc/motores_versao_publicar`, {
    method: "POST",
    headers: { ...cab, "Content-Type": "application/json" },
    body: JSON.stringify({ _versao: p.versao, _sha256: p.sha256, _caminho: caminho, _tamanho: p.tamanho, _notas: valor("--notas") || null, _por: process.env.USERNAME || process.env.USER || "publicar" }),
  });
  if (!reg.ok) throw new Error(`a versão não foi registrada (${reg.status}): ${(await reg.text()).slice(0, 200)}`);
  console.log(`Publicada a versão ${p.versao}. As máquinas trocam sozinhas quando os motores estiverem ociosos.`);
}

if (process.argv[1] && /empacotar\.ts$/.test(process.argv[1])) {
  publicar().catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (tem("--nunca-falha")) {
      console.warn(`Aviso: o pacote dos motores não foi publicado (${msg}).`);
      process.exit(0);
    }
    console.error(msg);
    process.exit(1);
  });
}
