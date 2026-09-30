/**
 * Cenas HyperFrames e batidas da trilha no worker (frente MOT, 30/09/2026).
 *
 * Pedido `cena_hf` (Mesa Motion): monta a pasta do projeto com o documento da
 * cena (supabase/functions/_shared/cena-hf.ts, o MESMO que a função valida),
 * o GSAP local, as fontes livres do painel, a logo do kit e as provas reais
 * (baixadas da pasta do cliente), roda `hyperframes lint` e `check`, e faz UMA
 * saída conforme o modo:
 * - still: o quadro herói em PNG (para aprovar antes de animar);
 * - amostra: os primeiros 5 s em meia resolução (MP4) e a folha de contato;
 * - final: a cena inteira em WebM VP9 com alfa (entra na Mesa Edição) e a
 *   folha de contato.
 * Lint com erro ou erro de execução da cena: o pedido falha com a lista (sem
 * nova tentativa: a equipe decide). O `check` (layout e contraste) vai no
 * resultado como aviso para a crítica.
 *
 * Pedido `batidas`: baixa a trilha, mede o mapa de batidas e o LUFS.
 *
 * HyperFrames: RENDER_HYPERFRAMES (caminho do bin/hyperframes.mjs) ou o
 * pacote em node_modules desta pasta. GSAP: RENDER_GSAP ou node_modules/gsap.
 */

import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { medirBatidas } from "../../supabase/functions/_shared/batidas-da-trilha.ts";
import { AMOSTRA_DA_CENA_S, type CenaDoFilme, ehFormato, type FormatoDoMotion, type MarcaDaCena, montarDocumento, tempoDoStill } from "../../supabase/functions/_shared/cena-hf.ts";
import { caminhoDaCena, type ModoDoPedidoDaCena } from "../../supabase/functions/_shared/motion-metodo.ts";
import type { Fila, PedidoDoWorker } from "./fila.ts";
import type { Armazem } from "./armazem.ts";
import { amostrasMono, executar, FFMPEG, medirLoudness, sondar } from "./midia.ts";

type Avisar = (etapa: string, valor: number, forcar?: boolean) => Promise<void>;

export interface AmbienteDaCena {
  fila: Fila;
  armazem: Armazem;
  log?: (t: string) => void;
  /** Pasta pública do painel (fontes livres em editor/fontes). */
  publico: string;
  /** Pasta deste worker (node_modules). */
  pastaDoWorker: string;
}

const TEMPO_MAXIMO_MS = 15 * 60 * 1000;

export function comandoDoHyperframes(pastaDoWorker: string): string {
  const env = process.env.RENDER_HYPERFRAMES;
  if (env && existsSync(env)) return env;
  const local = path.join(pastaDoWorker, "node_modules", "hyperframes", "bin", "hyperframes.mjs");
  if (existsSync(local)) return local;
  throw new Error("O HyperFrames não está instalado neste worker (npm install na pasta workers/render, ou RENDER_HYPERFRAMES com o caminho do bin/hyperframes.mjs).");
}

export function arquivoDoGsap(pastaDoWorker: string): string {
  const env = process.env.RENDER_GSAP;
  if (env && existsSync(env)) return env;
  const local = path.join(pastaDoWorker, "node_modules", "gsap", "dist", "gsap.min.js");
  if (existsSync(local)) return local;
  throw new Error("Falta o GSAP no worker (npm install na pasta workers/render, ou RENDER_GSAP com o caminho do gsap.min.js).");
}

async function sha256(arquivo: string): Promise<string> {
  const h = createHash("sha256");
  await new Promise<void>((ok, erro) => createReadStream(arquivo).on("data", (d) => h.update(d)).on("end", () => ok()).on("error", erro));
  return h.digest("hex");
}

function lerJson(texto: string): Record<string, unknown> | null {
  const i = texto.indexOf("{");
  const f = texto.lastIndexOf("}");
  if (i < 0 || f <= i) return null;
  try {
    return JSON.parse(texto.slice(i, f + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

type Achado = { code?: string; rule?: string; message?: string; severity?: string };
const achados = (s: unknown): Achado[] => (s && typeof s === "object" && Array.isArray((s as { findings?: unknown }).findings) ? ((s as { findings: Achado[] }).findings) : []);
const resumoDoAchado = (a: Achado) => `${a.code || a.rule || "achado"}${a.message ? `: ${String(a.message).slice(0, 160)}` : ""}`;

/** Resumo do `check --json` que vai para a crítica (números e os primeiros achados). */
export function resumoDoCheck(j: Record<string, unknown> | null): Record<string, unknown> {
  if (!j) return { lido: false };
  const secao = (k: string) => {
    const s = (j[k] && typeof j[k] === "object" ? j[k] : {}) as Record<string, unknown>;
    return { ok: s.ok !== false, errorCount: Number(s.errorCount) || 0, warningCount: Number(s.warningCount) || 0, achados: achados(s).slice(0, 5).map(resumoDoAchado) };
  };
  const contraste = (j.contrast && typeof j.contrast === "object" ? j.contrast : {}) as Record<string, unknown>;
  return { lido: true, ok: j.ok !== false, lint: secao("lint"), runtime: secao("runtime"), layout: secao("layout"), contrast: { ...secao("contrast"), checked: Number(contraste.checked) || 0, passed: Number(contraste.passed) || 0 } };
}

/** Folha de contato: 4 quadros lado a lado, em tamanho de celular (cada um com 360 px de largura). */
async function folhaDeContato(video: string, duracao: number, destino: string): Promise<boolean> {
  const n = 4;
  const passo = Math.max(0.2, duracao / (n + 1));
  const filtro = `fps=1/${passo.toFixed(3)},scale=360:-2,tile=${n}x1:padding=8:margin=8:color=0x222222`;
  const r = await executar(FFMPEG, ["-y", "-v", "error", "-ss", (passo * 0.5).toFixed(3), "-i", video, "-vf", filtro, "-frames:v", "1", destino]);
  return r.codigo === 0 && existsSync(destino);
}

export async function trabalharCenaHf(amb: AmbienteDaCena, p: PedidoDoWorker, pasta: string, avisar: Avisar): Promise<{ saida: string; arquivoId: string; resultado: Record<string, unknown> }> {
  const e = p.entrada as Record<string, unknown>;
  const modo = (e.modo === "still" || e.modo === "amostra" || e.modo === "final" ? e.modo : null) as ModoDoPedidoDaCena | null;
  if (!modo) throw new Error("Pedido de cena sem modo (still, amostra ou final).");
  const formato = (ehFormato(e.formato) ? e.formato : null) as FormatoDoMotion | null;
  if (!formato) throw new Error("Pedido de cena sem formato válido.");
  const cena = e.cena as CenaDoFilme;
  const marca = e.marca as MarcaDaCena;
  if (!cena || typeof cena !== "object" || !cena.id || !marca || !marca.cores) throw new Error("Pedido de cena sem a cena ou sem a marca.");
  const filmeId = String(p.motion_id || "");
  const log = amb.log || (() => undefined);

  await avisar("montando", 0.02, true);
  const escala = modo === "amostra" ? 0.5 : 1;
  const doc = montarDocumento(cena, marca, { formato, escala, duracao_s: modo === "amostra" ? AMOSTRA_DA_CENA_S : undefined });
  const proj = path.join(pasta, "cena");
  await mkdir(path.join(proj, "fontes"), { recursive: true });
  await mkdir(path.join(proj, "marca"), { recursive: true });
  await mkdir(path.join(proj, "midia"), { recursive: true });
  await writeFile(path.join(proj, "index.html"), doc.html, "utf8");
  await copyFile(arquivoDoGsap(amb.pastaDoWorker), path.join(proj, "gsap.min.js"));
  for (const f of [marca.fonte_titulo, marca.fonte_texto]) {
    if (!/^[A-Za-z0-9_-]+\.(ttf|otf|woff2?)$/.test(f)) throw new Error("Fonte da cena fora das fontes livres do painel.");
    await copyFile(path.join(amb.publico, "editor", "fontes", f), path.join(proj, "fontes", f));
  }
  // Logo e provas: só da pasta do cliente, pelo código (nunca pelo gerador de imagem).
  const logoPath = typeof e.logo_path === "string" ? e.logo_path : "";
  if (doc.precisa_de_logo) {
    if (!logoPath || logoPath.indexOf(`${p.client_id}/`) !== 0) throw new Error("A cena usa a logo, mas o kit da marca não tem logo nesta pasta do cliente.");
    await avisar("baixando", 0.05, true);
    await amb.armazem.baixar("mesa", logoPath, path.join(proj, "marca", "logo.png"));
  }
  for (const img of doc.imagens) {
    if (img.caminho.indexOf(`${p.client_id}/`) !== 0) throw new Error("Imagem de prova fora da pasta do cliente.");
    await amb.armazem.baixar("mesa", img.caminho, path.join(proj, img.destino));
  }

  const hf = comandoDoHyperframes(amb.pastaDoWorker);
  const rodar = (args: string[]) => executar(process.execPath, [hf, ...args], { cwd: proj, sinal: AbortSignal.timeout(TEMPO_MAXIMO_MS) });

  await avisar("montando", 0.1, true);
  const lint = await rodar(["lint", "--json", "."]);
  const lintJ = lerJson(lint.saida.toString("utf8"));
  const errosDoLint = achados(lintJ).filter((a) => a.severity === "error");
  if (!lintJ || Number(lintJ.errorCount) > 0) {
    const lista = errosDoLint.length ? errosDoLint.map(resumoDoAchado) : [lint.erros.split("\n").filter(Boolean).slice(-3).join(" | ")];
    throw new Error(`A cena não passou no lint do HyperFrames: ${lista.slice(0, 5).join("; ")}`);
  }
  const check = await rodar(["check", "--json", "."]);
  const checkJ = resumoDoCheck(lerJson(check.saida.toString("utf8")));
  const runtime = (checkJ.runtime || {}) as { errorCount?: number; achados?: string[] };
  if (Number(runtime.errorCount) > 0) throw new Error(`A cena deu erro ao rodar no navegador: ${(runtime.achados || []).join("; ")}`);
  log(`cena ${cena.id} ${modo} ${formato}: lint ok, check ${checkJ.ok ? "ok" : "com avisos"}`);

  const saida = caminhoDaCena(p.client_id, filmeId, cena.id, modo, formato, p.id);
  let arquivo = "";
  let mime = "image/png";
  let tipo = "still";
  await avisar("renderizando", 0.2, true);
  if (modo === "still") {
    const pastaSnap = path.join(pasta, "still");
    const s = await rodar(["snapshot", ".", "--at", String(tempoDoStill(cena)), "--no-end", "-o", pastaSnap]);
    const pngs = existsSync(pastaSnap) ? (await readdir(pastaSnap)).filter((x) => /^frame-.*\.png$/.test(x)).sort() : [];
    if (!pngs.length) throw new Error(`O HyperFrames não tirou o still: ${s.erros.split("\n").filter(Boolean).slice(-3).join(" | ")}`);
    arquivo = path.join(pastaSnap, pngs[0]);
  } else {
    const fmt = modo === "final" ? "webm" : "mp4";
    arquivo = path.join(pasta, `cena.${fmt}`);
    const r = await rodar(["render", ".", "--format", fmt, "-o", arquivo, "--fps", "30", "--quiet"]);
    if (r.codigo !== 0 || !existsSync(arquivo)) throw new Error(`O HyperFrames não renderizou: ${r.erros.split("\n").filter(Boolean).slice(-4).join(" | ").slice(-500)}`);
    mime = modo === "final" ? "video/webm" : "video/mp4";
    tipo = modo === "final" ? "cena" : "amostra";
  }
  await avisar("subindo", 0.85, true);
  const sonda = modo === "still" ? { duracao_s: null, largura: doc.largura, altura: doc.altura, tem_audio: false } : await sondar(arquivo);
  const bytes = (await stat(arquivo)).size;
  await amb.armazem.subir("mesa", saida, arquivo, mime);
  let folhaPath: string | null = null;
  if (modo !== "still" && sonda.duracao_s) {
    const folha = path.join(pasta, "folha.png");
    if (await folhaDeContato(arquivo, sonda.duracao_s, folha)) {
      folhaPath = saida.replace(/\.(mp4|webm)$/, "-folha.png");
      await amb.armazem.subir("mesa", folhaPath, folha, "image/png");
    }
  }
  const arquivoId = await amb.fila.registrarArquivo({
    client_id: p.client_id,
    nome: `${cena.titulo} (${modo === "still" ? "still" : modo === "amostra" ? "amostra 5 s" : "cena"} ${formato})`.slice(0, 120),
    nome_original: path.basename(saida),
    storage_bucket: "mesa",
    storage_path: saida,
    tipo,
    mime,
    bytes,
    duracao_s: sonda.duracao_s,
    largura: sonda.largura,
    altura: sonda.altura,
    sha256: await sha256(arquivo),
    origem: { render_pedido_id: p.id, motion_id: filmeId, cena_id: cena.id, modo, formato, assinatura: e.assinatura || null },
  });
  const resumo = modo === "still" ? `Still da cena "${cena.titulo}" em ${doc.largura}x${doc.altura}.` : `${modo === "amostra" ? "Amostra de 5 s" : "Cena com alfa"} "${cena.titulo}": ${sonda.duracao_s} s em ${sonda.largura}x${sonda.altura}, ${Math.round(bytes / 1024)} KB.`;
  return {
    saida,
    arquivoId,
    resultado: { resumo, modo, formato, cena_id: cena.id, assinatura: e.assinatura || null, chave: e.chave || null, check: checkJ, folha_path: folhaPath, duracao_s: sonda.duracao_s, largura: sonda.largura, altura: sonda.altura, bytes, picos: doc.picos, avisos: doc.avisos },
  };
}

export async function trabalharBatidas(amb: AmbienteDaCena, p: PedidoDoWorker, pasta: string, avisar: Avisar): Promise<Record<string, unknown>> {
  const e = p.entrada as Record<string, unknown>;
  const caminho = String(e.caminho || "");
  if (!caminho || caminho.indexOf(`${p.client_id}/`) !== 0) throw new Error("Trilha fora da pasta do cliente.");
  await avisar("baixando", 0.1, true);
  const m = /\.([a-z0-9]{2,5})$/i.exec(caminho);
  const local = path.join(pasta, `trilha${m ? `.${m[1].toLowerCase()}` : ""}`);
  await amb.armazem.baixar(String(e.bucket || "mesa"), caminho, local);
  await avisar("medindo", 0.5, true);
  const taxa = 22050;
  const mapa = medirBatidas(await amostrasMono(local, taxa), taxa);
  const lufs = await medirLoudness(local);
  return { batidas: mapa, lufs: lufs ? Math.round(lufs.input_i * 10) / 10 : null, chave: e.chave || null, resumo: `${mapa.bpm} BPM, ${mapa.batidas.length} batidas${mapa.drop_s !== null ? `, drop em ${mapa.drop_s} s` : ""}.` };
}
