// Endereço do worker já montado pelo Vite (worker clássico no build; o Safari 11.0 não tem worker de módulo).
import urlDoWorker from "./limpeza.worker.ts?worker&url";
import { contaDaLimpeza, type PedidoDaLimpeza, type ResultadoDaLimpeza } from "./contaDaLimpeza";

/**
 * Limpeza da logo no navegador sem travar a tela (revisão IDR, 01/10).
 *
 * - A logo é lida na resolução de verdade, até LADO_MAXIMO e AREA_MAXIMA
 *   (o canvas do iPhone não passa de ~16 MP). Passou disso, quem chama
 *   recebe `reduzida` e avisa a equipe ("de X para Y px").
 * - A conta vai para um worker (limpeza.worker.ts). Sem worker (navegador
 *   sem suporte ou falha ao carregar), a mesma conta roda no fio principal,
 *   depois de devolver a vez à tela.
 */

export const LADO_MAXIMO = 4096;
export const AREA_MAXIMA = 12_000_000;
/** Prazo de uma conta no worker antes de fazer no fio principal. */
const PRAZO_DO_WORKER_MS = 90_000;

export type PixelsLidos = {
  data: Uint8ClampedArray;
  largura: number;
  altura: number;
  /** Tamanho do arquivo original (antes da redução, se houve). */
  larguraOriginal: number;
  alturaOriginal: number;
  reduzida: boolean;
};

/** Escala que cabe em `lado` e na área máxima (1 = sem reduzir). */
export function escalaQueCabe(largura: number, altura: number, lado = LADO_MAXIMO, area = AREA_MAXIMA): number {
  const w = Math.max(1, largura), h = Math.max(1, altura);
  return Math.min(1, lado / Math.max(w, h), Math.sqrt(area / (w * h)));
}

function abrir(url: string): Promise<HTMLImageElement> {
  return new Promise((resolver, rejeitar) => {
    const img = new Image();
    img.onload = () => resolver(img);
    img.onerror = () => rejeitar(new Error("O navegador não conseguiu abrir a logo."));
    img.src = url;
  });
}

/** Os pixels da imagem, no tamanho de verdade até `lado` (e AREA_MAXIMA). */
export async function lerPixels(blob: Blob, lado = LADO_MAXIMO): Promise<PixelsLidos> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await abrir(url);
    const w0 = img.naturalWidth || 800, h0 = img.naturalHeight || 400;
    const e = escalaQueCabe(w0, h0, lado);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w0 * e));
    c.height = Math.max(1, Math.round(h0 * e));
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("O navegador não conseguiu desenhar a logo.");
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    return { data: d.data, largura: c.width, altura: c.height, larguraOriginal: w0, alturaOriginal: h0, reduzida: e < 1 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

type Resposta = (ResultadoDaLimpeza & { id: number }) | { id: number; erro: string };

let worker: Worker | null = null;
let workerQuebrado = false;
let proximo = 1;
const esperando = new Map<number, (r: Resposta | null) => void>();

function soltarTodos() {
  esperando.forEach((responder) => responder(null));
  esperando.clear();
}

function oWorker(): Worker | null {
  if (worker) return worker;
  if (workerQuebrado || typeof Worker === "undefined") return null;
  try {
    // Em desenvolvimento o Vite serve o arquivo como módulo (com import); no build ele vira worker clássico.
    const w = import.meta.env.DEV ? new Worker(urlDoWorker, { type: "module" }) : new Worker(urlDoWorker);
    w.onmessage = (e: MessageEvent<Resposta>) => {
      const r = e.data;
      const responder = r && esperando.get(r.id);
      if (!responder) return;
      esperando.delete(r.id);
      responder(r);
    };
    w.onerror = () => {
      workerQuebrado = true;
      worker = null;
      try {
        w.terminate();
      } catch {
        /* nada */
      }
      soltarTodos();
    };
    worker = w;
    return w;
  } catch {
    workerQuebrado = true;
    return null;
  }
}

function noFioPrincipal(p: PedidoDaLimpeza): Promise<ResultadoDaLimpeza> {
  // Devolve a vez à tela (o "limpando" aparece) antes da conta.
  return new Promise((resolver, rejeitar) =>
    window.setTimeout(() => {
      try {
        resolver(contaDaLimpeza(p));
      } catch (e) {
        rejeitar(e);
      }
    }, 30),
  );
}

/** A conta (limpar, diagnosticar ou mockup) fora da tela quando dá; os pixels de entrada não mudam. */
export async function limparForaDaTela(p: PedidoDaLimpeza): Promise<ResultadoDaLimpeza> {
  const w = oWorker();
  if (w) {
    const id = proximo++;
    const copia = new Uint8ClampedArray(p.data);
    const r = await new Promise<Resposta | null>((resolver) => {
      const prazo = window.setTimeout(() => {
        esperando.delete(id);
        resolver(null);
      }, PRAZO_DO_WORKER_MS);
      esperando.set(id, (x) => {
        window.clearTimeout(prazo);
        resolver(x);
      });
      try {
        w.postMessage({ ...p, data: copia, id }, [copia.buffer]);
      } catch {
        window.clearTimeout(prazo);
        esperando.delete(id);
        resolver(null);
      }
    });
    if (r) {
      if ("erro" in r && typeof r.erro === "string") throw new Error(r.erro);
      const ok = r as ResultadoDaLimpeza;
      return { data: ok.data, diagnostico: ok.diagnostico, haloAntes: ok.haloAntes, haloDepois: ok.haloDepois };
    }
  }
  return noFioPrincipal(p);
}

/** Pixels de volta em PNG, reduzidos a `lado` quando passam dele. */
export function pngDosPixels(data: Uint8ClampedArray, w: number, h: number, lado?: number): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return Promise.reject(new Error("O navegador não conseguiu desenhar a versão."));
  const img = ctx.createImageData(w, h);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  let alvo = c;
  if (lado && Math.max(w, h) > lado) {
    const e = lado / Math.max(w, h);
    alvo = document.createElement("canvas");
    alvo.width = Math.max(1, Math.round(w * e));
    alvo.height = Math.max(1, Math.round(h * e));
    const c2 = alvo.getContext("2d");
    if (c2) c2.drawImage(c, 0, 0, alvo.width, alvo.height);
  }
  return new Promise((resolver, rejeitar) => alvo.toBlob((b) => (b ? resolver(b) : rejeitar(new Error("A versão não virou PNG."))), "image/png"));
}
