/**
 * Troca de cenário no worker (frente TCN, rodada 3 parte 1, 01/10/2026).
 *
 * Pedido `cenario` (fila render_pedidos, ligado a video_cenarios.id):
 * - fase "preparar": baixa o vídeo de origem (só da pasta do cliente), corta o
 *   trecho [inicio_s, fim_s] e normaliza para o provedor: H.264, 30 qps, lado
 *   menor entre 720 e 1080 (o Kling O3 Edit pede de 720 a 3840 px), áudio AAC.
 *   Perfil "aleph": lado menor 720 e taxa contida (a API da Runway aceita até
 *   16 MB por envio). Sobe em `destino` e devolve duração e medidas.
 * - fase "compor": monta a final com o ÁUDIO ORIGINAL do trecho:
 *   - Rápido: a pessoa original (recorte com alfa, WebM VP9) sobre o fundo
 *     limpo (imagem), com o fundo levemente desfocado e a cor da pessoa puxada
 *     35% para a média do fundo (luz e cor casadas, ajuste simples);
 *   - Cinema e Aleph: a versão da IA;
 *   - saída "cheio" (no tamanho do trecho), "duas_faixas" (IA em cima, original
 *     embaixo) ou "tres_faixas" (recorte, IA, original) no formato do projeto,
 *     com rótulos pequenos.
 *   Registra o MP4 na Mídia do cliente (video_arquivos, tipo "gerado").
 * Tudo por ffmpeg (sem Remotion: nada aqui precisa de navegador). Sem nova
 * tentativa: erro sobe com o motivo e o pedido falha (a tela mostra).
 */

import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Fila, PedidoDoWorker } from "./fila.ts";
import type { Armazem } from "./armazem.ts";
import { executar, FFMPEG, sondar } from "./midia.ts";

type Avisar = (etapa: string, valor: number, forcar?: boolean) => Promise<void>;

export interface AmbienteDaTroca {
  fila: Fila;
  armazem: Armazem;
  log?: (t: string) => void;
  /** Pasta pública do painel (fontes livres em editor/fontes). */
  publico: string;
}

export type LayoutDaComposicao = "cheio" | "duas_faixas" | "tres_faixas";
export type Rgb = [number, number, number];

const par = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
const extensao = (c: string) => {
  const m = /\.([a-z0-9]{2,5})$/i.exec(c);
  return m ? `.${m[1].toLowerCase()}` : "";
};

/** Caminho que o worker aceita: só da pasta do cliente, sem "..". */
export function caminhoDoCliente(clientId: string, c: unknown): string | null {
  const s = String(c ?? "");
  return s && s.indexOf(`${clientId}/`) === 0 && s.indexOf("..") < 0 && s.length <= 500 ? s : null;
}

// ------------------------------------------------------------------ preparar

/** Argumentos do ffmpeg para cortar e normalizar o trecho. */
export function argsDoPreparo(entrada: string, saida: string, inicio_s: number, duracao_s: number, perfil: "padrao" | "aleph"): string[] {
  const minimo = 720;
  const maximo = perfil === "aleph" ? 720 : 1080;
  const escala = `scale=w='if(lt(iw,ih),min(${maximo},max(${minimo},iw)),-2)':h='if(lt(iw,ih),-2,min(${maximo},max(${minimo},ih)))',setsar=1,fps=30,format=yuv420p`;
  const taxa = perfil === "aleph" ? ["-maxrate", "3M", "-bufsize", "6M"] : [];
  return ["-y", "-v", "error", "-ss", inicio_s.toFixed(3), "-i", entrada, "-t", duracao_s.toFixed(3), "-vf", escala, "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", ...taxa, "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-movflags", "+faststart", saida];
}

// ------------------------------------------------------------------ cor

/** Ganho por canal que puxa a pessoa para a luz do fundo (forca 0..1), preso entre 0,8 e 1,25. */
export function ganhosDeCor(fundo: Rgb, original: Rgb, forca = 0.35): Rgb {
  return [0, 1, 2].map((i) => {
    const o = Math.max(8, original[i]);
    const g = 1 + forca * (Math.max(8, fundo[i]) / o - 1);
    return Math.round(Math.max(0.8, Math.min(1.25, g)) * 1000) / 1000;
  }) as Rgb;
}

/** Cor média de uma imagem ou de um quadro do vídeo (ffmpeg reduz para 1x1 pixel). */
async function corMedia(arquivo: string, emSegundos: number | null): Promise<Rgb | null> {
  const args = ["-v", "error"].concat(emSegundos !== null ? ["-ss", emSegundos.toFixed(2)] : []).concat(["-i", arquivo, "-frames:v", "1", "-vf", "scale=1:1:flags=area,format=rgb24", "-f", "rawvideo", "-"]);
  const r = await executar(FFMPEG, args, { binario: true });
  if (r.codigo !== 0 || r.saida.length < 3) return null;
  return [r.saida[0], r.saida[1], r.saida[2]];
}

// ------------------------------------------------------------------ compor

export interface PlanoDaComposicao {
  layout: LayoutDaComposicao;
  /** Medidas do trecho (saída "cheio"). */
  W: number;
  H: number;
  /** Medidas do formato do projeto (2 e 3 faixas). */
  Wp: number;
  Hp: number;
  /** Índices das entradas do ffmpeg (null = não tem). */
  original: number;
  recorte: number | null;
  placa: number | null;
  ia: number | null;
  ganhos: Rgb | null;
  /** Arquivo de letra para os rótulos (relativo à pasta de trabalho); null = sem rótulo. */
  fonte: string | null;
}

const cobrir = (w: number, h: number) => `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;

function rotulo(fonte: string | null, texto: string, y: number, altura: number): string {
  if (!fonte) return "";
  const tamanho = Math.max(18, Math.round(altura * 0.045));
  return `,drawtext=fontfile=${fonte}:text='${texto}':x=28:y=${y + 22}:fontsize=${tamanho}:fontcolor=white:shadowcolor=black@0.6:shadowx=2:shadowy=2`;
}

/**
 * O filtro do ffmpeg da final. Saída em [v]. Rápido sem IA: a pessoa (recorte)
 * sobre a placa; Cinema/Aleph: a IA. Sem o que cada layout precisa: Error.
 */
export function filtroDaComposicao(p: PlanoDaComposicao): string {
  const W = par(p.W);
  const H = par(p.H);
  const partes: string[] = [];
  const precisaMascara = p.layout === "tres_faixas";
  if (precisaMascara && p.recorte === null) throw new Error("A saída em 3 faixas precisa do recorte.");
  // A versão nova ([ia]).
  if (p.ia !== null) {
    partes.push(`[${p.ia}:v]${cobrir(W, H)},fps=30,format=yuv420p[ia]`);
    if (p.recorte !== null) partes.push(`[${p.recorte}:v]${cobrir(W, H)},format=rgba[rm]`);
  } else {
    if (p.recorte === null || p.placa === null) throw new Error("O Rápido precisa do recorte e do fundo.");
    const g = p.ganhos || [1, 1, 1];
    partes.push(`[${p.placa}:v]${cobrir(W, H)},gblur=sigma=2,format=rgba[bg]`);
    partes.push(`[${p.recorte}:v]${cobrir(W, H)},format=rgba${precisaMascara ? ",split=2[rp][rm]" : "[rp]"}`);
    partes.push(`[rp]colorchannelmixer=rr=${g[0]}:gg=${g[1]}:bb=${g[2]}[fg]`);
    partes.push(`[bg][fg]overlay=0:0:shortest=1:format=auto,format=yuv420p[ia]`);
  }
  if (p.layout === "cheio") {
    partes.push(`[ia]null[v]`);
    return partes.join(";");
  }
  const Wp = par(p.Wp);
  const Hp = par(p.Hp);
  if (p.layout === "duas_faixas") {
    const h = par(Hp / 2);
    partes.push(`[ia]${cobrir(Wp, h)}[t]`);
    partes.push(`[${p.original}:v]${cobrir(Wp, h)},fps=30,format=yuv420p[b]`);
    partes.push(`[t][b]vstack=inputs=2:shortest=1,pad=${Wp}:${Hp}:0:(oh-ih)/2:black${rotulo(p.fonte, "IA", 0, Hp)}${rotulo(p.fonte, "Original", h, Hp)}[v]`);
    return partes.join(";");
  }
  const h = par(Hp / 3);
  partes.push(`[rm]alphaextract,${cobrir(Wp, h)},format=yuv420p[m]`);
  partes.push(`[ia]${cobrir(Wp, h)}[t]`);
  partes.push(`[${p.original}:v]${cobrir(Wp, h)},fps=30,format=yuv420p[b]`);
  const topo = Math.floor((Hp - 3 * h) / 2);
  partes.push(`[m][t][b]vstack=inputs=3:shortest=1,pad=${Wp}:${Hp}:0:(oh-ih)/2:black${rotulo(p.fonte, "Recorte", topo, Hp)}${rotulo(p.fonte, "IA", topo + h, Hp)}${rotulo(p.fonte, "Original", topo + 2 * h, Hp)}[v]`);
  return partes.join(";");
}

/** Entradas na ordem do plano (o recorte VP9 com alfa precisa do decodificador libvpx). */
export function entradasDaComposicao(a: { original: string; recorte: string | null; placa: string | null; ia: string | null }): { args: string[]; indices: Pick<PlanoDaComposicao, "original" | "recorte" | "placa" | "ia"> } {
  const args: string[] = ["-i", a.original];
  let n = 1;
  const indices: Pick<PlanoDaComposicao, "original" | "recorte" | "placa" | "ia"> = { original: 0, recorte: null, placa: null, ia: null };
  if (a.recorte) {
    args.push("-c:v", "libvpx-vp9", "-i", a.recorte);
    indices.recorte = n++;
  }
  if (a.placa) {
    args.push("-loop", "1", "-framerate", "30", "-i", a.placa);
    indices.placa = n++;
  }
  if (a.ia) {
    args.push("-i", a.ia);
    indices.ia = n++;
  }
  return { args, indices };
}

async function sha256(arquivo: string): Promise<string> {
  const h = createHash("sha256");
  await new Promise<void>((ok, erro) => createReadStream(arquivo).on("data", (d) => h.update(d)).on("end", () => ok()).on("error", erro));
  return h.digest("hex");
}

/** Monta a final num arquivo local (usada pelo pedido e pela prova local). */
export async function comporLocal(o: { pasta: string; original: string; recorte: string | null; placa: string | null; ia: string | null; layout: LayoutDaComposicao; Wp: number; Hp: number; fonte: string | null; saida: string }): Promise<{ filtro: string; ganhos: Rgb | null }> {
  const s = await sondar(o.original);
  const W = s.largura || o.Wp;
  const H = s.altura || o.Hp;
  let ganhos: Rgb | null = null;
  if (!o.ia && o.placa) {
    const meio = s.duracao_s ? s.duracao_s / 2 : 0;
    const [corFundo, corOriginal] = await Promise.all([corMedia(o.placa, null), corMedia(o.original, meio)]);
    ganhos = corFundo && corOriginal ? ganhosDeCor(corFundo, corOriginal) : null;
  }
  const e = entradasDaComposicao(o);
  const filtro = filtroDaComposicao({ layout: o.layout, W, H, Wp: o.Wp, Hp: o.Hp, ...e.indices, ganhos, fonte: o.fonte });
  const args = ["-y", "-v", "error", ...e.args, "-filter_complex", filtro, "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", o.saida];
  const r = await executar(FFMPEG, args, { cwd: o.pasta });
  if (r.codigo !== 0) throw new Error(`O ffmpeg não montou a final: ${r.erros.split("\n").filter(Boolean).slice(-4).join(" | ").slice(-500)}`);
  return { filtro, ganhos };
}

// ------------------------------------------------------------------ o pedido

export async function trabalharCenario(amb: AmbienteDaTroca, p: PedidoDoWorker, pasta: string, avisar: Avisar): Promise<{ saida: string; arquivoId: string | null; resultado: Record<string, unknown> }> {
  const e = p.entrada || {};
  const fase = String(e.fase || "");
  const destino = caminhoDoCliente(p.client_id, e.destino);
  if (!destino) throw new Error("Destino fora da pasta do cliente.");
  if (fase === "preparar") {
    const fonte = caminhoDoCliente(p.client_id, e.fonte_path);
    if (!fonte) throw new Error("Vídeo de origem fora da pasta do cliente.");
    const inicio = Math.max(0, Number(e.inicio_s) || 0);
    const fim = Number(e.fim_s) || 0;
    if (!(fim > inicio)) throw new Error("Trecho inválido.");
    await avisar("baixando", 0.05, true);
    const local = path.join(pasta, `origem${extensao(fonte) || ".mp4"}`);
    await amb.armazem.baixar(String(e.fonte_bucket || "mesa"), fonte, local);
    await avisar("montando", 0.3, true);
    const saida = path.join(pasta, "trecho.mp4");
    const r = await executar(FFMPEG, argsDoPreparo(local, saida, inicio, fim - inicio, e.perfil === "aleph" ? "aleph" : "padrao"));
    if (r.codigo !== 0) throw new Error(`O ffmpeg não cortou o trecho: ${r.erros.split("\n").filter(Boolean).slice(-3).join(" | ").slice(-400)}`);
    const s = await sondar(saida);
    const bytes = (await stat(saida)).size;
    if (e.perfil === "aleph" && bytes > 16 * 1024 * 1024) throw new Error(`O trecho ficou com ${Math.round(bytes / 1048576)} MB e a Runway aceita até 16 MB. Escolha um trecho menor.`);
    await avisar("subindo", 0.8, true);
    await amb.armazem.subir("mesa", destino, saida, "video/mp4");
    if (amb.log) amb.log(`troca ${String(e.destino).split("/")[3] || ""}: trecho de ${s.duracao_s} s em ${s.largura}x${s.altura}, ${Math.round(bytes / 1024)} KB`);
    return { saida: destino, arquivoId: null, resultado: { duracao_s: s.duracao_s, largura: s.largura, altura: s.altura, bytes, tem_audio: s.tem_audio } };
  }
  if (fase !== "compor") throw new Error(`Fase desconhecida: ${fase || "vazia"}.`);
  const layout: LayoutDaComposicao = e.layout === "duas_faixas" || e.layout === "tres_faixas" ? e.layout : "cheio";
  const baixar = async (chave: string, nome: string): Promise<string | null> => {
    const c = caminhoDoCliente(p.client_id, e[chave]);
    if (!c) return null;
    const local = path.join(pasta, `${nome}${extensao(c)}`);
    await amb.armazem.baixar("mesa", c, local);
    return local;
  };
  await avisar("baixando", 0.05, true);
  const original = await baixar("original", "original");
  if (!original) throw new Error("Falta o trecho original.");
  const recorte = await baixar("recorte", "recorte");
  const placa = await baixar("placa", "placa");
  const ia = await baixar("ia", "ia");
  // Letra livre do painel para os rótulos (copiada para a pasta: caminho sem ":" para o drawtext).
  let fonte: string | null = null;
  const letra = path.join(amb.publico, "editor", "fontes", "Figtree-Variable.ttf");
  if (layout !== "cheio" && existsSync(letra)) {
    await copyFile(letra, path.join(pasta, "letra.ttf"));
    fonte = "letra.ttf";
  }
  await avisar("renderizando", 0.25, true);
  const saidaLocal = path.join(pasta, "final.mp4");
  const Wp = Number(e.largura) || 1080;
  const Hp = Number(e.altura) || 1920;
  const c = await comporLocal({ pasta, original, recorte, placa, ia, layout, Wp, Hp, fonte, saida: saidaLocal });
  const s = await sondar(saidaLocal);
  const bytes = (await stat(saidaLocal)).size;
  await avisar("subindo", 0.85, true);
  await amb.armazem.subir("mesa", destino, saidaLocal, "video/mp4");
  const titulo = String(e.titulo || "Cenário novo").slice(0, 110);
  const arquivoId = await amb.fila.registrarArquivo({
    client_id: p.client_id,
    nome: `${titulo}${layout === "cheio" ? "" : layout === "duas_faixas" ? " (antes e depois)" : " (3 faixas)"}`.slice(0, 120),
    nome_original: `${p.id}.mp4`,
    storage_bucket: "mesa",
    storage_path: destino,
    tipo: "gerado",
    mime: "video/mp4",
    bytes,
    duracao_s: s.duracao_s,
    largura: s.largura,
    altura: s.altura,
    sha256: await sha256(saidaLocal),
    origem: { tipo: "troca_de_cenario", cenario_id: p.cenario_id || null, render_pedido_id: p.id, qualidade: e.qualidade || null, layout },
  });
  const resumo = `Troca de cenário (${String(e.qualidade || "")}, ${layout.replace("_", " ")}): ${s.duracao_s} s em ${s.largura}x${s.altura}, ${Math.round(bytes / 1024)} KB, com o áudio original.`;
  return { saida: destino, arquivoId, resultado: { resumo, duracao_s: s.duracao_s, largura: s.largura, altura: s.altura, bytes, ganhos_de_cor: c.ganhos } };
}
