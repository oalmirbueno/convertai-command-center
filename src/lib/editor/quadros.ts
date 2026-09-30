/**
 * Quadros do vídeo no navegador (frente V-B): miniatura da linha do tempo,
 * quadro atual para a troca de câmera, último quadro para "continuar" e os
 * quadros que o agente "assiste". Leve: fila única, cache pequeno e no
 * máximo 2 vídeos escondidos, reaproveitados por URL. Tempo exato: o quadro
 * q de um vídeo a `fps` é lido no MEIO dele ((q + 0,5) / fps), o que evita
 * pegar o quadro vizinho por arredondamento do navegador.
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

// ------------------------------------------------------------------ vídeo reaproveitado
//
// Antes, cada quadro criava um <video> novo apontando para o bruto: uma
// requisição nova do arquivo e outra para o salto, sem aproveitar o que já
// tinha baixado (29/09: 169 respostas 206 e 4,18 GB declarados em 1 hora para
// 3 brutos). Agora, no máximo 2 vídeos escondidos ficam de reserva, um por
// URL: o salto para um trecho já baixado não pede nada de novo. Parado por
// 10 s, o vídeo é solto (sem src) e o navegador libera a memória.

interface Reservado {
  url: string;
  v: HTMLVideoElement;
  soltar: ReturnType<typeof setTimeout> | null;
}

const MAXIMO_NA_RESERVA = 2;
const SOLTAR_PARADO_MS = 10_000;
const reserva: Reservado[] = [];

function videoNovo(url: string): HTMLVideoElement {
  const v = document.createElement("video");
  v.crossOrigin = "anonymous";
  v.muted = true;
  v.preload = "auto";
  v.setAttribute("playsinline", "");
  v.src = url;
  return v;
}

function largar(v: HTMLVideoElement) {
  v.removeAttribute("src");
  try {
    v.load();
  } catch {
    /* nada */
  }
}

function tirarDaReserva(r: Reservado) {
  const i = reserva.indexOf(r);
  if (i >= 0) reserva.splice(i, 1);
  if (r.soltar) clearTimeout(r.soltar);
  r.soltar = null;
  largar(r.v);
}

/** O vídeo desta URL que já está pronto, ou um novo (o mais antigo sai da reserva). */
function pegarVideo(url: string, reaproveitar: boolean): { r: Reservado; novo: boolean } {
  for (let i = 0; reaproveitar && i < reserva.length; i++) {
    const r = reserva[i];
    if (r.url !== url) continue;
    if (r.soltar) clearTimeout(r.soltar);
    r.soltar = null;
    // Sem dado do quadro atual (não devia acontecer depois de um salto
    // concluído): não espera um "loadeddata" que já passou; começa de novo.
    if (r.v.readyState < 2) {
      tirarDaReserva(r);
      break;
    }
    reserva.splice(i, 1);
    reserva.push(r);
    return { r, novo: false };
  }
  const r: Reservado = { url, v: videoNovo(url), soltar: null };
  reserva.push(r);
  while (reserva.length > MAXIMO_NA_RESERVA) tirarDaReserva(reserva[0]);
  return { r, novo: true };
}

function devolverVideo(r: Reservado) {
  if (reserva.indexOf(r) < 0) {
    largar(r.v);
    return;
  }
  if (r.soltar) clearTimeout(r.soltar);
  r.soltar = setTimeout(() => tirarDaReserva(r), SOLTAR_PARADO_MS);
}

type Leitura = { quadro: Quadro | null; tentarDeNovo: boolean };

async function lerCom(r: Reservado, novo: boolean, tempo: number, largura: number, qualidade: number, png: boolean): Promise<Leitura> {
  const v = r.v;
  let ok = false;
  try {
    // Vídeo novo: espera o primeiro quadro, como sempre. Reaproveitado: já tem.
    if (novo && !(await esperar(v, "loadeddata", 20000))) return { quadro: null, tentarDeNovo: false };
    const dur = isFinite(v.duration) ? v.duration : tempo;
    const t = Math.max(0, Math.min(tempo, Math.max(0, dur - 0.001)));
    if (Math.abs(v.currentTime - t) > 0.0005) {
      v.currentTime = t;
      // Reaproveitado que falhou ou travou: tenta uma vez com um vídeo novo
      // (o mesmo caminho de antes, que sempre usava um vídeo novo).
      if (!(await esperar(v, "seeked", 15000))) return { quadro: null, tentarDeNovo: !novo };
    }
    const w = v.videoWidth || 320;
    const h = v.videoHeight || 180;
    const lw = Math.max(16, Math.min(largura, w));
    const lh = Math.max(16, Math.round((h / w) * lw));
    const c = document.createElement("canvas");
    c.width = lw;
    c.height = lh;
    const ctx = c.getContext("2d");
    if (!ctx) return { quadro: null, tentarDeNovo: false };
    ctx.drawImage(v, 0, 0, lw, lh);
    const quadro = { dataUrl: png ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", qualidade), largura: lw, altura: lh, tempo_s: t };
    ok = true;
    return { quadro, tentarDeNovo: false };
  } catch {
    return { quadro: null, tentarDeNovo: false }; // canvas sem CORS ou decodificação que o navegador não faz
  } finally {
    if (ok) devolverVideo(r);
    else tirarDaReserva(r);
  }
}

async function ler(url: string, tempo: number, largura: number, qualidade: number, png: boolean): Promise<Quadro | null> {
  const primeiro = pegarVideo(url, true);
  const lido = await lerCom(primeiro.r, primeiro.novo, tempo, largura, qualidade, png);
  if (!lido.tentarDeNovo) return lido.quadro;
  const segundo = pegarVideo(url, false);
  return (await lerCom(segundo.r, segundo.novo, tempo, largura, qualidade, png)).quadro;
}

/**
 * Quadro em `tempo_s` (use tempoDoQuadro antes para cair no meio do quadro).
 * Um por vez; cache por url+tempo+largura. `cancelado`: quem pediu já não
 * precisa (a miniatura saiu da tela); se ainda não chegou a vez, o pedido não
 * roda e nada vai para o cache.
 */
export function extrairQuadro(
  url: string,
  tempo_s: number,
  opcoes: { largura?: number; qualidade?: number; png?: boolean; cancelado?: () => boolean } = {},
): Promise<Quadro | null> {
  const largura = opcoes.largura || 160;
  const qualidade = opcoes.qualidade || 0.6;
  const png = !!opcoes.png;
  const cancelado = opcoes.cancelado;
  const chave = `${url}#${tempo_s.toFixed(4)}@${largura}${png ? "p" : ""}`;
  if (cache.has(chave)) return Promise.resolve(cache.get(chave) || null);
  let pulou = false;
  let doCache = false;
  const p = fila.then(() => {
    if (cancelado && cancelado()) {
      pulou = true;
      return null;
    }
    // Outro pedido igual, que estava na frente na fila, já leu este quadro.
    if (cache.has(chave)) {
      doCache = true;
      return cache.get(chave) || null;
    }
    return ler(url, tempo_s, largura, qualidade, png);
  });
  fila = p.catch(() => null);
  return p.then((q) => {
    if (pulou || doCache) return q;
    if (cache.size >= LIMITE_DO_CACHE) {
      const primeira = cache.keys().next().value;
      if (primeira !== undefined) cache.delete(primeira);
    }
    cache.set(chave, q);
    return q;
  });
}

/** Só para teste: esvazia o cache, a fila e a reserva de vídeos. */
export function __zerarQuadrosParaTeste() {
  cache.clear();
  fila = Promise.resolve();
  while (reserva.length) tirarDaReserva(reserva[0]);
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
