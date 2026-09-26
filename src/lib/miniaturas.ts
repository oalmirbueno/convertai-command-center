import { supabase } from "@/integrations/supabase/client";

/**
 * Miniaturas sem a transformação de imagem do Storage.
 *
 * 26/09/2026: o projeto passou da cota de "Storage Image Transformations"
 * (1.212 imagens de origem no ciclo contra 100 incluídas). Cada imagem que o
 * painel pedia reduzida ao Storage (`createSignedUrl(..., { transform })`)
 * contava na cota. Agora:
 *
 * - Ao subir uma imagem, o próprio navegador grava ao lado duas cópias leves:
 *   `<caminho>.mini.jpg` (lado maior 640 px, para as grades) e, quando o
 *   original passa de 2048 px, `<caminho>.media.jpg` (lado maior 2048 px,
 *   usada pelas funções do servidor em vez de abrir o original pesado).
 *   Origem com transparência (logo em PNG) grava as cópias em PNG, com o
 *   mesmo nome, para a logo não ganhar fundo.
 * - Na exibição, uma chamada só assina a miniatura e o original; a miniatura
 *   vale quando existe, senão entra o original (com loading="lazy").
 * - Imagem antiga sem miniatura, vista por alguém da equipe, ganha as cópias
 *   em segundo plano (uma por vez, sem travar a tela).
 *
 * As cópias ficam na mesma pasta do original: as regras de acesso do bucket
 * por pasta valem igual. No bucket files (e workspace para o cliente), a
 * leitura do cliente é por linha de arquivo; a regra que libera a cópia de
 * quem já pode ler o original está em SQL à parte. Sem ela, o cliente vê o
 * original, como antes.
 */

export const LADO_MINIATURA = 640;
export const LADO_MEDIA = 2048;
export const SUFIXO_MINIATURA = ".mini.jpg";
export const SUFIXO_MEDIA = ".media.jpg";

const QUALIDADE_MINIATURA = 0.8;
const QUALIDADE_MEDIA = 0.9;
/** Arquivo acima disto não é aberto no navegador para gerar cópia. */
const MAX_BYTES_PARA_COPIA = 40 * 1024 * 1024;

export function ehCopiaReduzida(caminho?: string | null): boolean {
  if (!caminho) return false;
  const c = caminho.toLowerCase();
  return c.endsWith(SUFIXO_MINIATURA) || c.endsWith(SUFIXO_MEDIA);
}

export function caminhoDaMiniatura(caminho: string): string {
  return ehCopiaReduzida(caminho) ? caminho : `${caminho}${SUFIXO_MINIATURA}`;
}

export function caminhoDaMedia(caminho: string): string {
  return ehCopiaReduzida(caminho) ? caminho : `${caminho}${SUFIXO_MEDIA}`;
}

const EXTENSOES_RASTER = ["jpg", "jpeg", "png", "webp", "bmp", "avif", "jfif"];

/**
 * Só imagem raster ganha cópia: SVG já é leve, GIF perderia a animação e
 * vídeo/PDF não se aplicam. Sem extensão e sem tipo, tenta (a falha é muda).
 */
export function podeTerMiniatura(nomeOuCaminho?: string | null, mime?: string | null): boolean {
  const m = (mime || "").toLowerCase();
  if (m) {
    if (m === "image/svg+xml" || m === "image/gif") return false;
    if (m.indexOf("image/") === 0) return !ehCopiaReduzida(nomeOuCaminho);
    if (m !== "application/octet-stream") return false;
  }
  const limpo = String(nomeOuCaminho || "").split("?")[0].toLowerCase();
  if (!limpo || ehCopiaReduzida(limpo)) return false;
  const ponto = limpo.lastIndexOf(".");
  const barra = limpo.lastIndexOf("/");
  if (ponto <= barra) return !m;
  return EXTENSOES_RASTER.indexOf(limpo.slice(ponto + 1)) >= 0;
}

/** Tamanho "contain" sem ampliar. */
export function tamanhoQueCabe(largura: number, altura: number, lado: number): { largura: number; altura: number } {
  const escala = Math.min(1, lado / Math.max(1, largura), lado / Math.max(1, altura));
  return { largura: Math.max(1, Math.round(largura * escala)), altura: Math.max(1, Math.round(altura * escala)) };
}

// ------------------------------------------------------------ gerar no navegador

type Fonte = { el: CanvasImageSource; largura: number; altura: number; liberar: () => void };

/**
 * Abre a imagem com <img> e URL de objeto (funciona do Safari 11 em diante,
 * sem depender de createImageBitmap, e respeita a orientação da foto como a
 * própria tela mostra o original).
 */
function abrirImagem(arquivo: Blob): Promise<Fonte> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const largura = img.naturalWidth || img.width;
      const altura = img.naturalHeight || img.height;
      if (!largura || !altura) {
        URL.revokeObjectURL(url);
        reject(new Error("imagem_sem_tamanho"));
        return;
      }
      resolve({ el: img, largura, altura, liberar: () => URL.revokeObjectURL(url) });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("imagem_nao_abre"));
    };
    img.src = url;
  });
}

function tela(largura: number, altura: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = largura;
  c.height = altura;
  return c;
}

function contexto(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas_indisponivel");
  ctx.imageSmoothingEnabled = true;
  try {
    (ctx as CanvasRenderingContext2D & { imageSmoothingQuality?: string }).imageSmoothingQuality = "high";
  } catch {
    // navegador antigo: suavização padrão
  }
  return ctx;
}

/**
 * Desenha reduzindo pela metade até chegar perto do alvo: um salto só de
 * 4000 para 640 px serrilha em alguns navegadores.
 */
function desenharReduzida(fonte: Fonte, lado: number): HTMLCanvasElement {
  const alvo = tamanhoQueCabe(fonte.largura, fonte.altura, lado);
  let el: CanvasImageSource = fonte.el;
  let l = fonte.largura;
  let a = fonte.altura;
  while (l / 2 >= alvo.largura * 1.5 && a / 2 >= alvo.altura * 1.5) {
    const nl = Math.round(l / 2), na = Math.round(a / 2);
    const passo = tela(nl, na);
    contexto(passo).drawImage(el, 0, 0, l, a, 0, 0, nl, na);
    el = passo;
    l = nl;
    a = na;
  }
  const final = tela(alvo.largura, alvo.altura);
  contexto(final).drawImage(el, 0, 0, l, a, 0, 0, alvo.largura, alvo.altura);
  return final;
}

function temTransparencia(c: HTMLCanvasElement): boolean {
  try {
    const ctx = c.getContext("2d");
    if (!ctx) return false;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < data.length; i += 16) if (data[i] < 250) return true;
  } catch {
    // canvas marcado (origem externa): trata como opaca
  }
  return false;
}

function paraBlob(c: HTMLCanvasElement, tipo: string, qualidade: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const porDataUrl = () => {
      try {
        const dataUrl = c.toDataURL(tipo, qualidade);
        const virgula = dataUrl.indexOf(",");
        const bin = atob(dataUrl.slice(virgula + 1));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const real = dataUrl.slice(5, dataUrl.indexOf(";")) || tipo;
        resolve(new Blob([bytes], { type: real }));
      } catch (e) {
        reject(e);
      }
    };
    if (typeof c.toBlob !== "function") {
      porDataUrl();
      return;
    }
    c.toBlob((b) => (b ? resolve(b) : porDataUrl()), tipo, qualidade);
  });
}

function comFundoBranco(c: HTMLCanvasElement): HTMLCanvasElement {
  const f = tela(c.width, c.height);
  const ctx = contexto(f);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, f.width, f.height);
  ctx.drawImage(c, 0, 0);
  return f;
}

export type CopiasReduzidas = { mini: Blob; media: Blob | null; largura: number; altura: number };

/**
 * Cópias leves de uma imagem: miniatura (640 px) sempre e média (2048 px) só
 * quando o original passa de 2048 px. JPEG para foto; PNG quando a imagem tem
 * transparência. Null quando o navegador não abre o arquivo (HEIC fora do
 * Safari, arquivo corrompido): a tela segue com o original.
 */
export async function prepararCopias(arquivo: Blob): Promise<CopiasReduzidas | null> {
  if (typeof document === "undefined" || !arquivo || arquivo.size > MAX_BYTES_PARA_COPIA) return null;
  let fonte: Fonte | null = null;
  try {
    fonte = await abrirImagem(arquivo);
    const miniTela = desenharReduzida(fonte, LADO_MINIATURA);
    const transparente = /png|webp|avif/i.test(arquivo.type || "png") && temTransparencia(miniTela);
    const tipo = transparente ? "image/png" : "image/jpeg";
    const mini = await paraBlob(transparente ? miniTela : comFundoBranco(miniTela), tipo, QUALIDADE_MINIATURA);
    let media: Blob | null = null;
    if (Math.max(fonte.largura, fonte.altura) > LADO_MEDIA) {
      const mediaTela = desenharReduzida(fonte, LADO_MEDIA);
      media = await paraBlob(transparente ? mediaTela : comFundoBranco(mediaTela), tipo, QUALIDADE_MEDIA);
    }
    return { mini, media, largura: fonte.largura, altura: fonte.altura };
  } catch {
    return null;
  } finally {
    fonte?.liberar();
  }
}

/** Buckets onde o painel grava as cópias (os que as grades mostram). */
const BUCKETS_COM_COPIA = ["files", "mcp-files", "workspace", "mesa"];

/**
 * Grava as cópias ao lado do original. Nunca falha para quem chamou: sem
 * cópia, a tela mostra o original. Espera terminar (use sem await para não
 * atrasar o envio).
 */
export async function subirCopiasReduzidas(
  bucket: string,
  caminho: string,
  arquivo: Blob,
  opcoes: { nome?: string | null; mime?: string | null } = {},
): Promise<boolean> {
  try {
    if (BUCKETS_COM_COPIA.indexOf(bucket) < 0 || !caminho || ehCopiaReduzida(caminho)) return false;
    if (!podeTerMiniatura(opcoes.nome || caminho, opcoes.mime || arquivo.type || null)) return false;
    const copias = await prepararCopias(arquivo);
    if (!copias) return false;
    const envios: Promise<{ error: unknown }>[] = [
      supabase.storage.from(bucket).upload(caminhoDaMiniatura(caminho), copias.mini, {
        contentType: copias.mini.type || "image/jpeg",
        upsert: true,
        cacheControl: "86400",
      }) as Promise<{ error: unknown }>,
    ];
    if (copias.media) {
      envios.push(
        supabase.storage.from(bucket).upload(caminhoDaMedia(caminho), copias.media, {
          contentType: copias.media.type || "image/jpeg",
          upsert: true,
          cacheControl: "86400",
        }) as Promise<{ error: unknown }>,
      );
    }
    const resultados = await Promise.all(envios);
    esquecerUrl(bucket, caminho);
    return !resultados[0].error;
  } catch {
    return false;
  }
}

let filaDeEnvio: Promise<unknown> = Promise.resolve();

/**
 * Dispara a gravação das cópias sem esperar (o envio do original já
 * terminou). Uma imagem por vez: vinte fotos de 12 MP abertas juntas
 * estouravam a memória do celular.
 */
export function gravarCopiasSemEsperar(bucket: string, caminho: string, arquivo: Blob, opcoes: { nome?: string | null; mime?: string | null } = {}) {
  filaDeEnvio = filaDeEnvio.then(() => subirCopiasReduzidas(bucket, caminho, arquivo, opcoes)).catch(() => false);
}

// ------------------------------------------------------------ exibir

type UrlLeve = { url: string; miniatura: boolean };
const CACHE_MS = 40 * 60_000;
const cacheDeUrls = new Map<string, { valor: UrlLeve; ate: number }>();
const chave = (bucket: string, caminho: string) => `${bucket}|${caminho}`;

function esquecerUrl(bucket: string, caminho: string) {
  cacheDeUrls.delete(chave(bucket, caminho));
}

type LinhaAssinada = { path: string | null; signedUrl?: string | null; error?: string | null };

/**
 * Uma chamada assina a miniatura e o original. A miniatura só vem quando
 * existe (o Storage não assina objeto ausente nem objeto que a pessoa não
 * pode ler). Falha no original lança erro (como resolveFileUrl): a tela não
 * mostra link quebrado.
 */
export async function urlLeve(bucket: string, caminho: string, expiraEm = 3600): Promise<UrlLeve> {
  const k = chave(bucket, caminho);
  const guardado = cacheDeUrls.get(k);
  if (guardado && guardado.ate > Date.now()) return guardado.valor;
  const querMini = podeTerMiniatura(caminho);
  const caminhos = querMini ? [caminhoDaMiniatura(caminho), caminho] : [caminho];
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(caminhos, expiraEm);
  if (error) throw error;
  const linhas = (data || []) as LinhaAssinada[];
  const achar = (p: string) => linhas.find((l) => l.path === p && !!l.signedUrl && !l.error)?.signedUrl || null;
  const mini = querMini ? achar(caminhoDaMiniatura(caminho)) : null;
  const original = achar(caminho);
  const valor: UrlLeve | null = mini ? { url: mini, miniatura: true } : original ? { url: original, miniatura: false } : null;
  if (!valor) throw new Error("URL indisponível");
  cacheDeUrls.set(k, { valor, ate: Date.now() + Math.min(CACHE_MS, Math.max(60_000, (expiraEm - 300) * 1000)) });
  if (!valor.miniatura && querMini) agendarMiniatura(bucket, caminho, valor.url);
  return valor;
}

/**
 * Várias imagens de uma vez (grade do Workspace): caminho → URL leve, numa
 * chamada só. Caminho sem URL fica de fora do resultado.
 */
export async function urlsLevesEmLote(bucket: string, caminhos: string[], expiraEm = 3600): Promise<Record<string, string>> {
  const unicos = caminhos.filter((c, i) => !!c && caminhos.indexOf(c) === i);
  if (!unicos.length) return {};
  const pedidos: string[] = [];
  for (const c of unicos) {
    if (podeTerMiniatura(c)) pedidos.push(caminhoDaMiniatura(c));
    pedidos.push(c);
  }
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(pedidos, expiraEm);
  if (error) throw error;
  const porCaminho: Record<string, string> = {};
  for (const l of (data || []) as LinhaAssinada[]) {
    if (l.path && l.signedUrl && !l.error) porCaminho[l.path] = l.signedUrl;
  }
  const saida: Record<string, string> = {};
  for (const c of unicos) {
    const mini = podeTerMiniatura(c) ? porCaminho[caminhoDaMiniatura(c)] : undefined;
    const url = mini || porCaminho[c];
    if (url) saida[c] = url;
    if (!mini && porCaminho[c] && podeTerMiniatura(c)) agendarMiniatura(bucket, c, porCaminho[c]);
  }
  return saida;
}

// ------------------------------------------------------------ cópias das imagens antigas

let autoLigado = false;
const tentados = new Set<string>();
const pastasSemPermissao = new Set<string>();
const fila: { bucket: string; caminho: string; url: string }[] = [];
let processando = false;
const MAX_NA_FILA = 200;
const MAX_POR_SESSAO = 300;
let feitosNaSessao = 0;

/** Liga as cópias em segundo plano (só para a equipe: o cliente não grava no Storage). */
export function definirAutoMiniaturas(ligado: boolean, admin = false) {
  autoLigado = ligado;
  if (!ligado) fila.length = 0;
  // Admin ganha no console a geração em lote das cópias das imagens antigas (miniaturasEmLote.ts).
  if (admin && typeof window !== "undefined") {
    void import("./miniaturasEmLote").then((m) => m.registrarNoConsole()).catch(() => undefined);
  }
}

const pastaDe = (bucket: string, caminho: string) => `${bucket}/${caminho.split("/")[0] || ""}`;

/**
 * Imagem mostrada sem miniatura: entra na fila para ganhar as cópias. Uma por
 * vez, com pausa entre elas; pasta sem permissão de gravação sai da fila na
 * primeira recusa.
 */
export function agendarMiniatura(bucket: string, caminho: string, urlOriginal: string) {
  if (!autoLigado || typeof window === "undefined") return;
  if (BUCKETS_COM_COPIA.indexOf(bucket) < 0 || !podeTerMiniatura(caminho)) return;
  const k = chave(bucket, caminho);
  if (tentados.has(k) || pastasSemPermissao.has(pastaDe(bucket, caminho))) return;
  if (fila.length >= MAX_NA_FILA || feitosNaSessao >= MAX_POR_SESSAO) return;
  tentados.add(k);
  fila.push({ bucket, caminho, url: urlOriginal });
  if (!processando) void processarFila();
}

const pausa = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function recusaDePermissao(erro: unknown): boolean {
  const e = erro as { statusCode?: string | number; status?: number; message?: string } | null;
  const codigo = String(e?.statusCode ?? e?.status ?? "");
  return codigo === "403" || codigo === "401" || /row-level security|not authorized|unauthorized|forbidden/i.test(String(e?.message || ""));
}

async function processarFila() {
  processando = true;
  try {
    while (fila.length && autoLigado) {
      const item = fila.shift()!;
      if (pastasSemPermissao.has(pastaDe(item.bucket, item.caminho))) continue;
      feitosNaSessao++;
      try {
        const resposta = await fetch(item.url);
        if (!resposta.ok) continue;
        const blob = await resposta.blob();
        const copias = await prepararCopias(blob);
        if (!copias) continue;
        const { error } = await supabase.storage.from(item.bucket).upload(caminhoDaMiniatura(item.caminho), copias.mini, {
          contentType: copias.mini.type || "image/jpeg",
          upsert: true,
          cacheControl: "86400",
        });
        if (error) {
          if (recusaDePermissao(error)) pastasSemPermissao.add(pastaDe(item.bucket, item.caminho));
          continue;
        }
        if (copias.media) {
          await supabase.storage.from(item.bucket).upload(caminhoDaMedia(item.caminho), copias.media, {
            contentType: copias.media.type || "image/jpeg",
            upsert: true,
            cacheControl: "86400",
          });
        }
        esquecerUrl(item.bucket, item.caminho);
      } catch {
        // sem cópia: a tela continua com o original
      }
      await pausa(400);
    }
  } finally {
    processando = false;
  }
}

/** Só para testes: zera a fila e o estado da sessão. */
export function __zerarMiniaturasParaTeste() {
  autoLigado = false;
  tentados.clear();
  pastasSemPermissao.clear();
  fila.length = 0;
  processando = false;
  feitosNaSessao = 0;
  cacheDeUrls.clear();
}
