/**
 * O trabalho de um pedido (frente EDT): onda do áudio, amostra ou vídeo inteiro.
 * Fila e Storage entram por interface (os testes trocam por PGlite e por um
 * servidor HTTP local, com o MESMO código de render).
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { medirOnda } from "../../supabase/functions/_shared/onda-do-audio.ts";
import { caminhoDaSaida, fontesUsadas, recortarProjeto } from "../../supabase/functions/_shared/render-do-editor.ts";
import { caminhoDaFonteValido, chaveDaFonteDaMarca } from "../../supabase/functions/_shared/projeto-de-edicao.ts";
import { ganhoDaTrilhaDb, MIXAGEM_PADRAO } from "../../supabase/functions/mesa-motion/modulos/som-do-editor.ts";
import type { Armazem } from "./armazem.ts";
import type { Fila, PedidoDoWorker } from "./fila.ts";
import { amostrasMono, executar, FFMPEG, medirLoudness, normalizarLoudness, sondar } from "./midia.ts";
import { trabalharBatidas, trabalharCenaHf } from "./hyperframes.ts";
import { trabalharCenario } from "./cenario.ts";
import { trabalharTratamento } from "./tratamento.ts";

export const PASTA_DO_WORKER = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ_DO_REPO = path.resolve(PASTA_DO_WORKER, "..", "..");
export const PUBLICO_DO_PAINEL = path.join(RAIZ_DO_REPO, "public");
const CLI_DO_REMOTION = path.join(PASTA_DO_WORKER, "node_modules", "@remotion", "cli", "remotion-cli.js");

export interface Ambiente {
  fila: Fila;
  armazem: Armazem;
  token: string;
  pasta: string;
  /** Chrome/Chrome Headless Shell já instalado (RENDER_CHROME); sem ele, o Remotion usa o dele. */
  chrome?: string | null;
  concorrencia?: number | null;
  log?: (t: string) => void;
  /**
   * Mesa Edição (02/10): o render_final pronto vai para o Workspace do cliente
   * ("Vídeos / <título> / Finais"), mesmo com o editor fechado. Falha aqui
   * nunca derruba o render (só fica no log e na origem do arquivo).
   */
  finalNoWorkspace?: (arquivoId: string) => Promise<{ estado: string; motivo?: string }>;
}

class Parado extends Error {}

type Projeto = {
  titulo?: string;
  fps: number;
  largura: number;
  altura: number;
  duracao_s: number;
  fontes: Record<string, { storage_bucket: string | null; storage_path: string | null; midia?: string; nome?: string }>;
  trilhas: { id: string; tipo: string; oculta: boolean; muda?: boolean; clipes: { id: string; fonte: string | null; inicio_s: number; entrada_s: number; saida_s: number; velocidade: number; estilo: Record<string, unknown> | null }[] }[];
  ondas?: Record<string, { lufs: number | null }>;
  mixagem?: { trilha_abaixo_da_voz_db: number; lufs_alvo: number };
  formato?: string;
  identidade?: { fonte?: string | null; fonte_path?: string | null } | null;
};

const extensao = (c: string) => {
  const m = /\.([a-z0-9]{2,5})$/i.exec(c);
  return m ? `.${m[1].toLowerCase()}` : "";
};

/** Progresso com a trava renovada, no máximo a cada 4 s; pedido que não é mais nosso: para. */
function relator(amb: Ambiente, p: PedidoDoWorker) {
  let ultimo = 0;
  return async (etapa: string, valor: number, forcar = false) => {
    if (!forcar && Date.now() - ultimo < 4000) return;
    ultimo = Date.now();
    const segue = await amb.fila.progresso(p.id, amb.token, etapa, valor);
    if (!segue) throw new Parado("O pedido foi cancelado ou pego por outro worker.");
  };
}

async function sha256(arquivo: string): Promise<string> {
  const h = createHash("sha256");
  await new Promise<void>((ok, erro) => createReadStream(arquivo).on("data", (d) => h.update(d)).on("end", () => ok()).on("error", erro));
  return h.digest("hex");
}

// ------------------------------------------------------------------ onda

export async function trabalharOnda(amb: Ambiente, p: PedidoDoWorker, pasta: string): Promise<Record<string, unknown>> {
  const avisar = relator(amb, p);
  const fontes = (Array.isArray(p.entrada.fontes) ? p.entrada.fontes : []) as { chave: string; bucket: string; caminho: string }[];
  const ondas: Record<string, unknown> = {};
  for (let k = 0; k < fontes.length; k++) {
    const f = fontes[k];
    if (!f.caminho || f.caminho.indexOf(`${p.client_id}/`) !== 0) continue;
    await avisar("baixando", k / fontes.length, true);
    const local = path.join(pasta, `onda-${k}${extensao(f.caminho)}`);
    await amb.armazem.baixar(f.bucket || "mesa", f.caminho, local);
    await avisar("medindo", (k + 0.5) / fontes.length, true);
    const amostras = await amostrasMono(local, 16000);
    const onda = medirOnda(amostras, 16000);
    const lufs = await medirLoudness(local);
    ondas[f.chave] = { ...onda, lufs: lufs ? Math.round(lufs.input_i * 10) / 10 : null, em: new Date().toISOString() };
    if (amb.log) amb.log(`onda ${f.chave}: ${onda.pausas.length} pausas, limiar ${onda.limiar_db} dB`);
  }
  return { ondas };
}

// ------------------------------------------------------------------ render (amostra e vídeo inteiro)

/** Linha de progresso do Remotion ("Rendered 120/300", "Encoded 40/300"). */
/** Render sem nenhum avanço por este tempo é interrompido (o empacotamento leva 1 a 2 min antes do 1º quadro). */
export const SEM_AVANCO_NO_RENDER_MS = 8 * 60_000;

export function progressoDoRemotion(texto: string): number | null {
  const m = /(Rendered|Encoded|Rendering frames|Stitching)[^\d]*(\d+)\s*\/\s*(\d+)/i.exec(texto);
  if (!m) return null;
  const n = Number(m[2]);
  const t = Number(m[3]);
  if (!(t > 0)) return null;
  const base = /encod|stitch/i.test(m[1]) ? 0.5 : 0;
  return Math.max(0, Math.min(1, base + (n / t) * 0.5));
}

/** Nome do MP4 na Mídia: com o formato, para a equipe distinguir os renders de vários formatos ("Título (render 1:1)"). */
export function nomeDoRender(titulo: string, amostra: boolean, formato: string | null): string {
  const tipo = amostra ? "amostra" : "render";
  return `${titulo} (${tipo}${formato ? ` ${formato}` : ""})`.slice(0, 120);
}

/** Caminho da letra da marca que o worker pode baixar: só da pasta do cliente ou da biblioteca de fontes. */
export function letraDaMarcaParaBaixar(projeto: Projeto, clientId: string): string | null {
  const id = projeto.identidade;
  const caminho = id && id.fonte && id.fonte_path ? id.fonte_path : null;
  if (!caminho || !caminhoDaFonteValido(caminho)) return null;
  return caminho.indexOf(`${clientId}/`) === 0 || caminho.indexOf("biblioteca/fontes/") === 0 ? caminho : null;
}

export async function trabalharRender(amb: Ambiente, p: PedidoDoWorker, pasta: string): Promise<{ saida: string; arquivoId: string; resultado: Record<string, unknown> }> {
  const avisar = relator(amb, p);
  if (!p.projeto) throw new Error("Pedido sem projeto.");
  let projeto = p.projeto as unknown as Projeto;
  const amostra = p.tipo === "amostra";
  if (amostra) projeto = recortarProjeto(projeto, Number(p.entrada.inicio_s) || 0, Number(p.entrada.fim_s) || 12);
  const publico = path.join(pasta, "publico");
  await mkdir(path.join(publico, "midia"), { recursive: true });
  // Letras livres do motion (OFL) e sons da biblioteca (CC0) vêm do próprio painel.
  await cp(path.join(PUBLICO_DO_PAINEL, "editor", "fontes"), path.join(publico, "editor", "fontes"), { recursive: true });
  const urls: Record<string, string> = {};
  const usadas = fontesUsadas(projeto);
  const locais: Record<string, string> = {};
  for (let k = 0; k < usadas.length; k++) {
    const chave = usadas[k];
    const f = projeto.fontes[chave];
    if (!f || !f.storage_path) continue;
    await avisar("baixando", (k / Math.max(1, usadas.length)) * 0.1, k === 0);
    if (f.storage_bucket === "publico") {
      if (!/^editor\/[a-z0-9/_.-]+$/i.test(f.storage_path)) continue;
      const destino = path.join(publico, f.storage_path);
      await mkdir(path.dirname(destino), { recursive: true });
      await copyFile(path.join(PUBLICO_DO_PAINEL, f.storage_path), destino);
      urls[chave] = `estatico:${f.storage_path}`;
      locais[chave] = destino;
      continue;
    }
    // Só da pasta do próprio cliente (e a logo do kit, também no bucket mesa do cliente).
    if (f.storage_path.indexOf(`${p.client_id}/`) !== 0) continue;
    const nome = `midia/${chave}${extensao(f.storage_path)}`;
    await amb.armazem.baixar(f.storage_bucket || "mesa", f.storage_path, path.join(publico, nome));
    urls[chave] = `estatico:${nome}`;
    locais[chave] = path.join(publico, nome);
  }
  // Letra da marca: o arquivo do cliente (ou da biblioteca de fontes) vem do bucket mesa; sem ela, o estilo usa a reserva.
  const letra = letraDaMarcaParaBaixar(projeto, p.client_id);
  if (letra) {
    const nome = `midia/letra-da-marca${extensao(letra)}`;
    try {
      await amb.armazem.baixar("mesa", letra, path.join(publico, nome));
      urls[chaveDaFonteDaMarca(letra)] = `estatico:${nome}`;
    } catch (e) {
      if (amb.log) amb.log(`a letra da marca não baixou (${(e as Error).message}); o vídeo sai com a letra do estilo`);
    }
  }
  // Trilha 22 dB abaixo da voz: voz pela onda medida (ou medida agora), trilha medida no arquivo.
  await avisar("montando", 0.1, true);
  const principal = projeto.trilhas.find((t) => t.tipo === "video");
  // Frente MOV: a narração da Mesa Motion (trilha de áudio com papel "voz") também é voz; com ela, a voz é só ela (as cenas em código não têm som).
  const daNarracao = projeto.trilhas.filter((t) => t.tipo === "audio").reduce((l, t) => l.concat(t.clipes.filter((c) => c.estilo && c.estilo.papel === "voz").map((c) => c.fonte).filter((x): x is string => !!x)), [] as string[]);
  const fontesDaVoz = daNarracao.length ? Array.from(new Set(daNarracao)) : principal ? Array.from(new Set(principal.clipes.map((c) => c.fonte).filter((x): x is string => !!x))) : [];
  const ganhos: Record<string, number> = {};
  const trilhas = projeto.trilhas.filter((t) => t.tipo === "audio").reduce((l, t) => l.concat(t.clipes.filter((c) => c.estilo && c.estilo.papel === "trilha")), [] as Projeto["trilhas"][number]["clipes"]);
  let vozLufs: number | null = null;
  if (trilhas.length) {
    const medidas: number[] = [];
    for (const k of fontesDaVoz) {
      const daOnda = projeto.ondas && projeto.ondas[k] ? projeto.ondas[k].lufs : null;
      if (typeof daOnda === "number") medidas.push(daOnda);
      else if (locais[k]) {
        const m = await medirLoudness(locais[k]);
        if (m) medidas.push(m.input_i);
      }
    }
    vozLufs = medidas.length ? medidas.reduce((a, b) => a + b, 0) / medidas.length : MIXAGEM_PADRAO.voz_presumida_lufs;
    for (const c of trilhas) {
      const m = c.fonte && locais[c.fonte] ? await medirLoudness(locais[c.fonte]) : null;
      ganhos[c.id] = ganhoDaTrilhaDb(vozLufs, m ? m.input_i : MIXAGEM_PADRAO.trilha_presumida_lufs, projeto.mixagem ? projeto.mixagem.trilha_abaixo_da_voz_db : MIXAGEM_PADRAO.trilha_abaixo_da_voz_db);
    }
  }
  const props = path.join(pasta, "props.json");
  await writeFile(props, JSON.stringify({ projeto, urls, publico: "estatico", mix: { ganhos_db: ganhos } }));
  const bruto = path.join(pasta, "bruto.mp4");
  const args = [CLI_DO_REMOTION, "render", "remotion/entrada.ts", "ComposicaoDoProjeto", bruto, `--props=${props}`, `--public-dir=${publico}`, "--log=info", "--codec=h264"];
  if (amb.chrome) args.push(`--browser-executable=${amb.chrome}`);
  if (amb.concorrencia) args.push(`--concurrency=${amb.concorrencia}`);
  const controle = new AbortController();
  let parouPorCancelar: Error | null = null;
  // 02/10: o render da nuvem ficou mudo, a trava venceu, o PC assumiu e a nuvem seguiu renderizando à toa.
  // Pulso a cada minuto (renova a trava e para se o pedido foi para outro worker) e teto sem avanço.
  let ultimoValor = 0.12;
  let ultimoAvanco = Date.now();
  let ultimoLog = -1;
  const pulso = setInterval(() => {
    avisar("renderizando", ultimoValor, true).catch((e: Error) => {
      parouPorCancelar = e;
      controle.abort();
    });
    if (Date.now() - ultimoAvanco > SEM_AVANCO_NO_RENDER_MS) {
      parouPorCancelar = new Error(`O render ficou ${Math.round(SEM_AVANCO_NO_RENDER_MS / 60_000)} min sem avançar e foi interrompido. Peça de novo.`);
      controle.abort();
    }
  }, 60_000);
  const renderizar = () => executar(process.execPath, args, {
    cwd: PASTA_DO_WORKER,
    sinal: controle.signal,
    aoTexto: (t) => {
      const v = progressoDoRemotion(t);
      if (v === null) return;
      const valor = 0.12 + v * 0.7;
      if (valor > ultimoValor + 1e-6) ultimoAvanco = Date.now();
      ultimoValor = Math.max(ultimoValor, valor);
      const dez = Math.floor(v * 10);
      if (amb.log && dez !== ultimoLog) {
        ultimoLog = dez;
        amb.log(`render ${Math.round(v * 100)}%`);
      }
      avisar("renderizando", valor).catch((e: Error) => {
        parouPorCancelar = e;
        controle.abort();
      });
    },
  }).catch((e: Error) => {
    if (parouPorCancelar) throw parouPorCancelar;
    throw e;
  });
  let r: Awaited<ReturnType<typeof renderizar>>;
  try {
    r = await renderizar();
    // O Chrome do Remotion tem 25 s fixos para abrir; máquina ocupada estoura. Uma segunda vez só para esse caso
    // (infraestrutura, não correção de conteúdo); o resto do erro vai direto para o pedido.
    if (r.codigo !== 0 && !parouPorCancelar && /trying to connect to the browser/i.test(r.erros)) {
      if (amb.log) amb.log("o Chrome demorou para abrir; tentando uma segunda vez");
      ultimoAvanco = Date.now();
      r = await renderizar();
    }
  } finally {
    clearInterval(pulso);
  }
  if (parouPorCancelar) throw parouPorCancelar;
  if (r.codigo !== 0) throw new Error(`O Remotion não renderizou: ${r.erros.split("\n").filter(Boolean).slice(-6).join(" | ").slice(-500)}`);
  await avisar("mixando", 0.84, true);
  const final = path.join(pasta, "final.mp4");
  const alvo = projeto.mixagem ? projeto.mixagem.lufs_alvo : MIXAGEM_PADRAO.lufs_alvo;
  const volume = await normalizarLoudness(bruto, final, alvo);
  const sonda = await sondar(final);
  const bytes = (await stat(final)).size;
  const saida = caminhoDaSaida(p.client_id, p.id, amostra ? "amostra" : "render_final");
  await avisar("subindo", 0.88, true);
  await amb.armazem.subir("mesa", saida, final, "video/mp4", (feito, total) => {
    void avisar("subindo", 0.88 + (feito / Math.max(1, total)) * 0.1).catch(() => null);
  });
  // Miniatura (frente MOT): um quadro a um terço do vídeo, para a entrega e o portfólio.
  let miniatura: string | null = null;
  if (!amostra && sonda.duracao_s) {
    const jpg = path.join(pasta, "miniatura.jpg");
    const m = await executar(FFMPEG, ["-y", "-v", "error", "-ss", (sonda.duracao_s / 3).toFixed(2), "-i", final, "-frames:v", "1", "-q:v", "3", jpg]);
    if (m.codigo === 0) {
      miniatura = saida.replace(/\.mp4$/, ".jpg");
      await amb.armazem.subir("mesa", miniatura, jpg, "image/jpeg").catch(() => {
        miniatura = null;
      });
    }
  }
  const titulo = (p.versao_id ? await amb.fila.tituloDaVersao(p.versao_id) : null) || String(projeto.titulo || "Vídeo");
  const formatoDoRender = String((p.entrada && p.entrada.formato) || projeto.formato || "").slice(0, 8) || null;
  const arquivoId = await amb.fila.registrarArquivo({
    client_id: p.client_id,
    nome: nomeDoRender(titulo, amostra, formatoDoRender),
    nome_original: `${p.id}.mp4`,
    storage_bucket: "mesa",
    storage_path: saida,
    tipo: amostra ? "amostra" : "render",
    mime: "video/mp4",
    bytes,
    duracao_s: sonda.duracao_s,
    largura: sonda.largura,
    altura: sonda.altura,
    sha256: await sha256(final),
    origem: { render_pedido_id: p.id, versao_id: p.versao_id, revisao: p.revisao, lufs: volume.depois, amostra: amostra ? p.entrada : null, formato: formatoDoRender },
  });
  // Gancho do documento de entrega (frente DOC): o resumo e as provas ficam no resultado do pedido.
  const resumo = `${amostra ? "Amostra" : "Vídeo inteiro"} de ${sonda.duracao_s} s em ${sonda.largura}x${sonda.altura}, ${volume.depois !== null ? `${volume.depois} LUFS` : "sem áudio"}, ${Math.round(bytes / 1024)} KB, revisão ${p.revisao}.`;
  return { saida, arquivoId, resultado: { resumo, miniatura_path: miniatura, duracao_s: sonda.duracao_s, largura: sonda.largura, altura: sonda.altura, bytes, lufs_antes: volume.antes, lufs_final: volume.depois, voz_lufs: vozLufs, ganhos_db: ganhos } };
}

// ------------------------------------------------------------------ um pedido

/** Só o render_final que concluiu vai para o Workspace; erro aqui só vai para o log. */
export async function levarAoWorkspace(amb: Ambiente, p: Pick<PedidoDoWorker, "id" | "tipo">, arquivoId: string | null): Promise<void> {
  if (p.tipo !== "render_final" || !arquivoId || !amb.finalNoWorkspace) return;
  try {
    const w = await amb.finalNoWorkspace(arquivoId);
    if (amb.log) amb.log(`workspace: ${w.estado}${w.motivo ? ` (${w.motivo})` : ""}`);
  } catch (e) {
    if (amb.log) amb.log(`workspace falhou: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Pega UM pedido e faz. Devolve o que fez (ou null quando a fila está vazia). */
export async function umPedido(amb: Ambiente, worker: string, versao: string): Promise<{ id: string; tipo: string; estado: "pronto" | "erro" | "parado"; detalhe: string } | null> {
  const p = await amb.fila.pegar(amb.token, worker, versao);
  if (!p) return null;
  const pasta = path.join(amb.pasta, p.id);
  await rm(pasta, { recursive: true, force: true });
  await mkdir(pasta, { recursive: true });
  const log = amb.log || (() => undefined);
  log(`pedido ${p.id} (${p.tipo}) do cliente ${p.client_id.slice(0, 8)}`);
  try {
    if (p.tipo === "cena_hf" || p.tipo === "batidas") {
      const apoio = { fila: amb.fila, armazem: amb.armazem, log: amb.log, publico: PUBLICO_DO_PAINEL, pastaDoWorker: PASTA_DO_WORKER };
      if (p.tipo === "batidas") {
        const resultado = await trabalharBatidas(apoio, p, pasta, relator(amb, p));
        await amb.fila.concluir(p.id, amb.token, null, null, resultado);
        return { id: p.id, tipo: p.tipo, estado: "pronto", detalhe: String(resultado.resumo || "") };
      }
      const r = await trabalharCenaHf(apoio, p, pasta, relator(amb, p));
      const ok = await amb.fila.concluir(p.id, amb.token, r.saida, r.arquivoId, r.resultado);
      if (!ok) return { id: p.id, tipo: p.tipo, estado: "parado", detalhe: "O pedido não era mais deste worker na hora de concluir." };
      log(`pronto: ${r.saida}`);
      return { id: p.id, tipo: p.tipo, estado: "pronto", detalhe: r.saida };
    }
    if (p.tipo === "cenario") {
      // Frente TCN: preparar o trecho para o provedor ou compor a final da troca de cenário.
      const r = await trabalharCenario({ fila: amb.fila, armazem: amb.armazem, log: amb.log, publico: PUBLICO_DO_PAINEL }, p, pasta, relator(amb, p));
      const ok = await amb.fila.concluir(p.id, amb.token, r.saida, r.arquivoId, r.resultado);
      if (!ok) return { id: p.id, tipo: p.tipo, estado: "parado", detalhe: "O pedido não era mais deste worker na hora de concluir." };
      log(`pronto: ${r.saida}`);
      return { id: p.id, tipo: p.tipo, estado: "pronto", detalhe: r.saida };
    }
    if (p.tipo === "tratamento") {
      // Mesa Edição (02/10): preparar as partes para o provedor ou montar o vídeo tratado (áudio original).
      const r = await trabalharTratamento({ fila: amb.fila, armazem: amb.armazem, log: amb.log }, p, pasta, relator(amb, p));
      const ok = await amb.fila.concluir(p.id, amb.token, r.saida, r.arquivoId, r.resultado);
      if (!ok) return { id: p.id, tipo: p.tipo, estado: "parado", detalhe: "O pedido não era mais deste worker na hora de concluir." };
      log(`pronto: ${r.saida || "partes preparadas"}`);
      return { id: p.id, tipo: p.tipo, estado: "pronto", detalhe: r.saida || "partes preparadas" };
    }
    if (p.tipo === "onda") {
      const resultado = await trabalharOnda(amb, p, pasta);
      await amb.fila.concluir(p.id, amb.token, null, null, resultado);
      return { id: p.id, tipo: p.tipo, estado: "pronto", detalhe: `${Object.keys((resultado.ondas as object) || {}).length} ondas` };
    }
    const r = await trabalharRender(amb, p, pasta);
    const ok = await amb.fila.concluir(p.id, amb.token, r.saida, r.arquivoId, r.resultado);
    if (!ok) return { id: p.id, tipo: p.tipo, estado: "parado", detalhe: "O pedido não era mais deste worker na hora de concluir." };
    log(`pronto: ${r.saida} (${JSON.stringify(r.resultado)})`);
    await levarAoWorkspace(amb, p, r.arquivoId);
    return { id: p.id, tipo: p.tipo, estado: "pronto", detalhe: r.saida };
  } catch (e) {
    if (e instanceof Parado) {
      log(`parado: ${e.message}`);
      return { id: p.id, tipo: p.tipo, estado: "parado", detalhe: e.message };
    }
    const msg = e instanceof Error ? e.message : String(e);
    log(`erro: ${msg}`);
    await amb.fila.falhar(p.id, amb.token, "render_falhou", msg).catch(() => false);
    return { id: p.id, tipo: p.tipo, estado: "erro", detalhe: msg };
  } finally {
    if (!process.env.RENDER_GUARDAR_PASTA) await rm(pasta, { recursive: true, force: true }).catch(() => null);
  }
}

/** Só para teste: roda um comando do ffmpeg (gera o vídeo curto de exemplo). */
export const _executar = executar;
