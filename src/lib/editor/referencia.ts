import { batidas, detectarCortes, type MedidaDoNavegador } from "../../../supabase/functions/editor-video/receita";
import { energias, extrairAudio } from "./audio";

/**
 * Medida do vídeo de referência no navegador (frente V-B): lê quadros em
 * tempos fixos (passo de 0,25 s, até 3 minutos), cada um reduzido a 32 x 18
 * tons de cinza (assinatura) + brilho e saturação médios; acha as trocas de
 * plano por diferença de quadros (detectarCortes, determinístico) e, se der,
 * a energia do áudio e as batidas. Mesmo vídeo, mesma medida.
 */

export const PASSO_DA_MEDIDA_S = 0.25;
export const MAX_MEDIDA_S = 180;
const L = 32;
const A = 18;

function esperar(v: HTMLVideoElement, ev: string, ms: number): Promise<boolean> {
  return new Promise((ok) => {
    let feito = false;
    const fim = (r: boolean) => {
      if (feito) return;
      feito = true;
      v.removeEventListener(ev, bom);
      v.removeEventListener("error", ruim);
      clearTimeout(t);
      ok(r);
    };
    const bom = () => fim(true);
    const ruim = () => fim(false);
    const t = setTimeout(() => fim(false), ms);
    v.addEventListener(ev, bom);
    v.addEventListener("error", ruim);
  });
}

export async function medirReferencia(url: string, aoProgresso?: (t: string) => void, cancelado?: () => boolean): Promise<MedidaDoNavegador> {
  const v = document.createElement("video");
  v.crossOrigin = "anonymous";
  v.muted = true;
  v.preload = "auto";
  v.setAttribute("playsinline", "");
  v.src = url;
  try {
    if (!(await esperar(v, "loadeddata", 30000))) throw new Error("Não deu para abrir o vídeo de referência aqui.");
    const duracao = isFinite(v.duration) ? v.duration : 0;
    if (!duracao) throw new Error("O vídeo de referência não diz a duração.");
    const c = document.createElement("canvas");
    c.width = L;
    c.height = A;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Este navegador não lê quadros.");
    const fim = Math.min(duracao, MAX_MEDIDA_S);
    const tempos: number[] = [];
    for (let t = PASSO_DA_MEDIDA_S / 2; t < fim; t += PASSO_DA_MEDIDA_S) tempos.push(Math.round(t * 1000) / 1000);
    const assinaturas: Uint8Array[] = [];
    let brilho = 0;
    let brilho2 = 0;
    let saturacao = 0;
    for (let k = 0; k < tempos.length; k++) {
      if (cancelado && cancelado()) throw new Error("Parado.");
      if (k % 20 === 0 && aoProgresso) aoProgresso(`Lendo quadros: ${k} de ${tempos.length}`);
      v.currentTime = tempos[k];
      if (!(await esperar(v, "seeked", 15000))) throw new Error("O vídeo parou de responder na leitura dos quadros.");
      ctx.drawImage(v, 0, 0, L, A);
      let dados: Uint8ClampedArray;
      try {
        dados = ctx.getImageData(0, 0, L, A).data;
      } catch {
        throw new Error("O navegador não deixou ler os quadros deste vídeo (origem protegida). Suba o arquivo no painel.");
      }
      const cinza = new Uint8Array(L * A);
      let bq = 0;
      let sq = 0;
      for (let i = 0, p = 0; i < dados.length; i += 4, p++) {
        const r = dados[i];
        const g = dados[i + 1];
        const b = dados[i + 2];
        const y = 0.299 * r + 0.587 * g + 0.114 * b;
        cinza[p] = y;
        bq += y / 255;
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        sq += mx > 0 ? (mx - mn) / mx : 0;
      }
      const n = L * A;
      assinaturas.push(cinza);
      brilho += bq / n;
      brilho2 += (bq / n) * (bq / n);
      saturacao += sq / n;
    }
    const q = Math.max(1, assinaturas.length);
    const mediaBrilho = brilho / q;
    const desvio = Math.sqrt(Math.max(0, brilho2 / q - mediaBrilho * mediaBrilho));
    const { cortes, suaves } = detectarCortes(assinaturas, tempos);
    let musica: MedidaDoNavegador["musica"] = null;
    try {
      if (aoProgresso) aoProgresso("Ouvindo o áudio");
      const au = await extrairAudio(url);
      musica = batidas(energias(au.amostras, au.taxa, 50), 0.05);
    } catch {
      musica = null; // sem áudio legível: a receita fica sem batidas
    }
    return {
      duracao_s: Math.round(duracao * 1000) / 1000,
      largura: v.videoWidth || null,
      altura: v.videoHeight || null,
      cortes,
      suaves,
      quadros: assinaturas.length,
      passo_s: PASSO_DA_MEDIDA_S,
      brilho: Math.round(mediaBrilho * 1000) / 1000,
      contraste: Math.round(Math.min(1, desvio * 4) * 1000) / 1000,
      saturacao: Math.round((saturacao / q) * 1000) / 1000,
      musica,
    };
  } finally {
    v.removeAttribute("src");
    try {
      v.load();
    } catch {
      /* nada */
    }
  }
}
