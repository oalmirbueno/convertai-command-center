import { supabase } from "@/integrations/supabase/client";
import { caminhoDaMiniatura, LADO_MINIATURA } from "@/lib/miniaturas";

/**
 * Quadros de vídeo no navegador (frente V-A, 26/09/2026).
 *
 * Extração DETERMINÍSTICA do primeiro e do último quadro de um vídeo, sem
 * servidor (a função tem 2 s de CPU e não decodifica vídeo):
 * - primeiro: tempo 0 (o navegador mostra o quadro 0 depois do seek);
 * - último: duração menos meio quadro a 30 fps (0,017 s), o último quadro
 *   inteiro que o decodificador entrega em todos os navegadores (seek para a
 *   duração exata devolve preto no Safari).
 * O quadro sai em PNG sem perda (vai de entrada para o motor) e sobe para
 * <cliente>/video/quadros/. A miniatura do vídeo (<vídeo>.mini.jpg, lado 640)
 * sai do primeiro quadro: nada de transformação do Storage.
 *
 * Safari 11: sem createImageBitmap, sem OffscreenCanvas; só <video> e <canvas>.
 */

export const MEIO_QUADRO_S = 0.017;
export const PASTA_DOS_QUADROS = (clientId: string) => `${clientId}/video/quadros`;

/** Tempo exato do quadro pedido (puro, testável). */
export function tempoDoQuadro(posicao: "primeiro" | "ultimo", duracao: number): number {
  if (posicao === "primeiro" || !isFinite(duracao) || duracao <= 0) return 0;
  return Math.max(0, Math.round((duracao - MEIO_QUADRO_S) * 1000) / 1000);
}

function esperar(el: HTMLVideoElement, evento: string, ms: number): Promise<void> {
  return new Promise((ok, falha) => {
    const t = window.setTimeout(() => {
      el.removeEventListener(evento, fim);
      falha(new Error("O vídeo demorou para responder."));
    }, ms);
    function fim() {
      window.clearTimeout(t);
      el.removeEventListener(evento, fim);
      ok();
    }
    el.addEventListener(evento, fim);
  });
}

function paraBlob(c: HTMLCanvasElement, tipo: string, qualidade?: number): Promise<Blob> {
  return new Promise((ok, falha) => {
    if (typeof c.toBlob === "function") {
      c.toBlob((b) => (b ? ok(b) : falha(new Error("Não foi possível gravar o quadro."))), tipo, qualidade);
      return;
    }
    try {
      const dados = c.toDataURL(tipo, qualidade);
      const bin = atob(dados.split(",")[1] || "");
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      ok(new Blob([bytes], { type: tipo }));
    } catch (e) {
      falha(e);
    }
  });
}

/**
 * Tira um quadro do vídeo (URL assinada ou objeto local). O vídeo precisa
 * permitir leitura (crossOrigin anonymous: URLs do Storage permitem).
 */
export async function extrairQuadro(fonte: string | Blob, posicao: "primeiro" | "ultimo", opcoes: { lado?: number; tipo?: "image/png" | "image/jpeg" } = {}): Promise<{ blob: Blob; largura: number; altura: number; tempo: number }> {
  const el = document.createElement("video");
  el.crossOrigin = "anonymous";
  el.muted = true;
  el.preload = "auto";
  el.setAttribute("playsinline", "");
  let url = "";
  if (typeof fonte === "string") el.src = fonte;
  else {
    url = URL.createObjectURL(fonte);
    el.src = url;
  }
  try {
    await esperar(el, "loadeddata", 20000);
    const tempo = tempoDoQuadro(posicao, el.duration);
    if (tempo > 0 || posicao === "ultimo") {
      el.currentTime = tempo;
      await esperar(el, "seeked", 15000);
    }
    const w = el.videoWidth;
    const h = el.videoHeight;
    if (!w || !h) throw new Error("O vídeo não tem imagem.");
    const lado = opcoes.lado || Math.max(w, h);
    const k = Math.min(1, lado / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("O navegador não desenhou o quadro.");
    ctx.drawImage(el, 0, 0, c.width, c.height);
    const tipo = opcoes.tipo || "image/png";
    const blob = await paraBlob(c, tipo, tipo === "image/jpeg" ? 0.86 : undefined);
    return { blob, largura: c.width, altura: c.height, tempo };
  } finally {
    el.removeAttribute("src");
    try {
      el.load();
    } catch {
      /* nada */
    }
    if (url) URL.revokeObjectURL(url);
  }
}

/** Sobe o quadro para a pasta de quadros do cliente e devolve o caminho. */
export async function subirQuadro(clientId: string, blob: Blob, nome: string): Promise<string> {
  const limpo = String(nome || "quadro").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 60) || "quadro";
  const caminho = `${PASTA_DOS_QUADROS(clientId)}/${limpo}-${Date.now().toString(36)}.png`;
  const r = await supabase.storage.from("mesa").upload(caminho, blob, { contentType: blob.type || "image/png", upsert: false });
  if (r.error) throw r.error;
  return caminho;
}

/** Último (ou primeiro) quadro de um vídeo do acervo, já no Storage. */
export async function quadroDoVideoNoStorage(clientId: string, bucket: string, caminhoDoVideo: string, posicao: "primeiro" | "ultimo"): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(caminhoDoVideo, 600);
  if (error || !data || !data.signedUrl) throw error || new Error("Vídeo indisponível.");
  const q = await extrairQuadro(data.signedUrl, posicao);
  return subirQuadro(clientId, q.blob, `${posicao}-${caminhoDoVideo.split("/").pop() || "video"}`);
}

/** Miniatura própria do vídeo (<vídeo>.mini.jpg), do primeiro quadro. Nunca falha para quem chamou. */
export async function gravarMiniaturaDoVideo(bucket: string, caminhoDoVideo: string): Promise<boolean> {
  try {
    const { data } = await supabase.storage.from(bucket).createSignedUrl(caminhoDoVideo, 600);
    if (!data || !data.signedUrl) return false;
    const q = await extrairQuadro(data.signedUrl, "primeiro", { lado: LADO_MINIATURA, tipo: "image/jpeg" });
    const r = await supabase.storage.from(bucket).upload(caminhoDaMiniatura(caminhoDoVideo), q.blob, { contentType: "image/jpeg", upsert: true, cacheControl: "86400" });
    return !r.error;
  } catch {
    return false;
  }
}
