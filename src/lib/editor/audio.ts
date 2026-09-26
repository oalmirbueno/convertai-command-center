/**
 * Áudio para o botão Timestamp (frente V-B). O navegador tira SÓ o áudio do
 * vídeo (mono, 16 kHz, 16 bits: ~1,9 MB por minuto) antes de mandar, para
 * caber no limite da função (150 s, ~256 MB). Vídeo longo vai em partes de
 * ~60 s; a emenda cai no ponto mais quieto dos últimos segundos da janela
 * (sempre o mesmo ponto para o mesmo áudio: determinístico), e o início de
 * cada parte vai junto para o servidor somar em cada palavra.
 */

export const TAXA_DO_TIMESTAMP = 16000;
export const PARTE_ALVO_S = 60;
export const BUSCA_DA_EMENDA_S = 5;
/** Acima disto o navegador não baixa o vídeo inteiro para tirar o áudio. */
export const MAX_BYTES_PARA_EXTRAIR = 700 * 1024 * 1024;

export interface ParteDoAudio {
  n: number;
  inicio_s: number;
  fim_s: number;
  de: number;
  ate: number;
}

/** Energia (RMS) em janelas de `janelaMs`. */
export function energias(amostras: Float32Array, taxa: number, janelaMs = 20): Float32Array {
  const tam = Math.max(1, Math.round((taxa * janelaMs) / 1000));
  const n = Math.ceil(amostras.length / tam);
  const saida = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let soma = 0;
    const ini = k * tam;
    const fim = Math.min(amostras.length, ini + tam);
    for (let i = ini; i < fim; i++) soma += amostras[i] * amostras[i];
    saida[k] = Math.sqrt(soma / Math.max(1, fim - ini));
  }
  return saida;
}

/** Partes de ~alvo s; cada emenda no ponto mais quieto de [alvo - busca, alvo]. */
export function partesDoAudio(amostras: Float32Array, taxa: number, alvoS = PARTE_ALVO_S, buscaS = BUSCA_DA_EMENDA_S): ParteDoAudio[] {
  const total = amostras.length;
  if (!total) return [];
  const janelaMs = 20;
  const tam = Math.round((taxa * janelaMs) / 1000);
  const e = energias(amostras, taxa, janelaMs);
  const partes: ParteDoAudio[] = [];
  let de = 0;
  while (de < total) {
    const alvo = de + Math.round(alvoS * taxa);
    let ate = total;
    if (alvo < total - Math.round(buscaS * taxa)) {
      const j0 = Math.floor((alvo - Math.round(buscaS * taxa)) / tam);
      const j1 = Math.floor(alvo / tam);
      let melhor = j1;
      for (let j = j0; j <= j1 && j < e.length; j++) if (e[j] < e[melhor] - 1e-9) melhor = j;
      ate = Math.min(total, melhor * tam + Math.round(tam / 2));
    }
    partes.push({ n: partes.length, inicio_s: Math.round((de / taxa) * 1000) / 1000, fim_s: Math.round((ate / taxa) * 1000) / 1000, de, ate });
    de = ate;
  }
  return partes;
}

/** WAV PCM 16 bits mono. */
export function wavDe(amostras: Float32Array, taxa: number): Blob {
  const n = amostras.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const escrever = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  escrever(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  escrever(8, "WAVE");
  escrever(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, taxa, true);
  v.setUint32(28, taxa * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  escrever(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, amostras[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

type Ctx = typeof AudioContext;

function contexto(): Ctx | null {
  const w = window as unknown as { AudioContext?: Ctx; webkitAudioContext?: Ctx };
  return w.AudioContext || w.webkitAudioContext || null;
}

export const suportaExtrairAudio = () => {
  const w = window as unknown as { OfflineAudioContext?: unknown; webkitOfflineAudioContext?: unknown };
  return !!contexto() && !!(w.OfflineAudioContext || w.webkitOfflineAudioContext);
};

/** Baixa o arquivo, decodifica o áudio e devolve mono a 16 kHz. */
export async function extrairAudio(url: string, aoProgresso?: (fase: string) => void): Promise<{ amostras: Float32Array; taxa: number; duracao_s: number }> {
  const C = contexto();
  if (!C) throw new Error("Este navegador não tira o áudio do vídeo. Use Chrome, Edge ou Safari atualizados.");
  if (aoProgresso) aoProgresso("Baixando o vídeo");
  const res = await fetch(url);
  if (!res.ok) throw new Error("Não foi possível ler o vídeo agora.");
  const tamanho = Number(res.headers.get("content-length") || 0);
  if (tamanho > MAX_BYTES_PARA_EXTRAIR) throw new Error("Vídeo grande demais para tirar o áudio no navegador. Suba só o áudio (mp3 ou wav) na Entrada.");
  const bruto = await res.arrayBuffer();
  if (aoProgresso) aoProgresso("Separando o áudio");
  const ctx = new C();
  const decodificado: AudioBuffer = await new Promise((resolve, reject) => {
    // Forma com callback: Safari antigo não devolve Promise.
    ctx.decodeAudioData(bruto, resolve, () => reject(new Error("Não foi possível ler o áudio deste vídeo.")));
  });
  try {
    void ctx.close();
  } catch {
    /* nada */
  }
  const w = window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext };
  const Off = (w.OfflineAudioContext || w.webkitOfflineAudioContext) as typeof OfflineAudioContext;
  const frames = Math.ceil(decodificado.duration * TAXA_DO_TIMESTAMP);
  const off = new Off(1, Math.max(1, frames), TAXA_DO_TIMESTAMP);
  const fonte = off.createBufferSource();
  fonte.buffer = decodificado;
  fonte.connect(off.destination);
  fonte.start(0);
  if (aoProgresso) aoProgresso("Preparando o áudio");
  const pronto: AudioBuffer = await new Promise((resolve, reject) => {
    off.oncomplete = (ev) => resolve(ev.renderedBuffer);
    const r = off.startRendering() as unknown;
    if (r && typeof (r as Promise<AudioBuffer>).then === "function") (r as Promise<AudioBuffer>).then(resolve, reject);
  });
  return { amostras: pronto.getChannelData(0), taxa: TAXA_DO_TIMESTAMP, duracao_s: Math.round(pronto.duration * 1000) / 1000 };
}
