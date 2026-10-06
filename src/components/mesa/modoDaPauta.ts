import { ehPostDeFotos } from "../../../supabase/functions/_shared/post-de-fotos";

export type ModoDaPauta = "arte" | "fotos" | "video";
export const ROTULO_DO_MODO = { arte: "Arte e carrossel", fotos: "Fotos", video: "Vídeo rápido" };
export const FORMATOS_DE_VIDEO_NO_ESTUDIO = ["reel", "video", "short"];

/** Usa os dados já definidos pela pauta, sem adivinhar o formato pelo título. */
export function modoDaPauta(item: { delivery_type: string; title?: string; modo_estudio?: ModoDaPauta }, trabalho?: { direcao?: unknown } | null): ModoDaPauta {
  if (ehPostDeFotos(trabalho?.direcao)) return "fotos";
  if ((trabalho?.direcao as { mesa?: string } | null)?.mesa === "video") return "video";
  // Um trabalho de arte existente nunca é convertido por uma mudança do plano.
  if (trabalho) return "arte";
  if (item.modo_estudio) return item.modo_estudio;
  if (FORMATOS_DE_VIDEO_NO_ESTUDIO.includes(item.delivery_type)) return "video";
  if (["photo", "photos", "photo_carousel"].includes(item.delivery_type)) return "fotos";
  // Prefixo formal gravado pelo agente-calendario para o enum legado static/carousel.
  if (item.title?.startsWith("Peça de foto: ")) return "fotos";
  return "arte";
}

export function chaveDoEstudioDaPauta(clientId: string, taskId: string, parte: string) {
  return `mesa:estudio:pauta:${clientId}:${taskId}:${parte}`;
}
