/**
 * Quadros do vídeo no navegador (frente V-B): miniatura da linha do tempo,
 * quadro atual para a troca de câmera, último quadro para "continuar" e os
 * quadros que o agente "assiste". Leve: um vídeo escondido por vez, fila
 * única, cache pequeno. Tempo exato: o quadro q de um vídeo a `fps` é lido no
 * MEIO dele ((q + 0,5) / fps), o que evita pegar o quadro vizinho por
 * arredondamento do navegador.
 *
 * Sem CORS liberado (canvas "sujo"), não há como ler o quadro: devolve null e
 * a tela mostra o ícone no lugar (sem quebrar).
 */

export interface Quadro {
  dataUrl: string;
  largura: number;
  altura: number;
  tempo_s: number;
}

/** Tempo seguro para ler o quadro do instante `s` (meio do quadro). */
export function tempoDoQuadro(s: number, fps: number): number {
  const f = fps > 0 ? fps : 25;
  const q = Math.floor(s * f + 1e-6);
  return Math.round(((q + 0.5) / f) * 100000) / 100000;
}

/** Último quadro de um trecho que acaba em `fim_s` (continuar a partir daqui). */
export const tempoDoUltimoQuadro = (fim_s: number, fps: number) => tempoDoQuadro(Math.max(0, fim_s - 1 / (fps > 0 ? fps : 25)), fps);

export const suportaCaptura = (): boolean => {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext && c.getContext("2d")) && typeof document.createElement("video").canPlayType === "function";
  } catch {
    return false;
  }
};

const cache = new Map<string, Quadro | null>();
const LIMITE_DO_CACHE = 240;
let fila: Promise<unknown> = Promise.resolve();

function esperar(alvo: HTMLVideoElement, evento: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let feito = false;
    const fim = (ok: boolean) => {
      if (feito) return;
      feito = true;
      alvo.removeEventListener(evento, aoEvento);
      alvo.removeEventListener("error", aoErro);
      clearTimeout(t);
      resolve(ok);
    };
    const aoEvento = () => fim(true);
    const aoErro = () => fim(false);
    const t = setTimeout(() => fim(false), ms);
    alvo.addEventListener(evento, aoEvento);
    alvo.addEventListener("error", aoErro);
  });
}

async function ler(url: string, tempo: number, largura: number, qualidade: number, png: boolean): Promise<Quadro | null> {
  const v = document.createElement("video");
  v.crossOrigin = "anonymous";
  v.muted = true;
  v.preload = "auto";
  v.setAttribute("playsinline", "");
  v.src = url;
  try {
    if (!(await esperar(v, "loadeddata", 20000))) return null;
    const dur = isFinite(v.duration) ? v.duration : tempo;
    const t = Math.max(0, Math.min(tempo, Math.max(0, dur - 0.001)));
    if (Math.abs(v.currentTime - t) > 0.0005) {
      v.currentTime = t;
      if (!(await esperar(v, "seeked", 15000))) return null;
    }
    const w = v.videoWidth || 320;
    const h = v.videoHeight || 180;
    const lw = Math.max(16, Math.min(largura, w));
    const lh = Math.max(16, Math.round((h / w) * lw));
    const c = document.createElement("canvas");
    c.width = lw;
    c.height = lh;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, lw, lh);
    return { dataUrl: png ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", qualidade), largura: lw, altura: lh, tempo_s: t };
  } catch {
    return null; // canvas sem CORS ou decodificação que o navegador não faz
  } finally {
    v.removeAttribute("src");
    try {
      v.load();
    } catch {
      /* nada */
    }
  }
}

/** Quadro em `tempo_s` (use tempoDoQuadro antes para cair no meio do quadro). Um por vez; cache por url+tempo+largura. */
export function extrairQuadro(url: string, tempo_s: number, opcoes: { largura?: number; qualidade?: number; png?: boolean } = {}): Promise<Quadro | null> {
  const largura = opcoes.largura || 160;
  const qualidade = opcoes.qualidade || 0.6;
  const png = !!opcoes.png;
  const chave = `${url}#${tempo_s.toFixed(4)}@${largura}${png ? "p" : ""}`;
  if (cache.has(chave)) return Promise.resolve(cache.get(chave) || null);
  const p = fila.then(() => ler(url, tempo_s, largura, qualidade, png));
  fila = p.catch(() => null);
  return p.then((q) => {
    if (cache.size >= LIMITE_DO_CACHE) {
      const primeira = cache.keys().next().value;
      if (primeira !== undefined) cache.delete(primeira);
    }
    cache.set(chave, q);
    return q;
  });
}

/** Imagem (URL assinada) lida como quadro, para imagens da biblioteca. */
export function lerImagem(url: string, largura = 768, qualidade = 0.85): Promise<Quadro | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const lw = Math.min(largura, img.naturalWidth || largura);
        const lh = Math.round(((img.naturalHeight || lw) / (img.naturalWidth || lw)) * lw);
        const c = document.createElement("canvas");
        c.width = lw;
        c.height = lh;
        const ctx = c.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, lw, lh);
        resolve({ dataUrl: c.toDataURL("image/jpeg", qualidade), largura: lw, altura: lh, tempo_s: 0 });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function blobDoDataUrl(dataUrl: string): Blob {
  const [cab, dados] = dataUrl.split(",");
  const mime = (/data:([^;]+)/.exec(cab) || [])[1] || "image/jpeg";
  const bin = atob(dados || "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export const base64DoDataUrl = (dataUrl: string) => String(dataUrl || "").replace(/^data:[^,]+,/, "");
