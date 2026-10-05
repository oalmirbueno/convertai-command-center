import { ehPostDeFotos } from "../../../supabase/functions/_shared/post-de-fotos";

export type ModoDaPauta = "arte" | "fotos" | "video";
export const FORMATOS_DE_VIDEO_NO_ESTUDIO = ["reel", "video", "short"];

/** Usa os dados já definidos pela pauta, sem adivinhar o formato pelo título. */
export function modoDaPauta(item: { delivery_type: string }, trabalho?: { direcao?: unknown } | null): ModoDaPauta {
  if (ehPostDeFotos(trabalho?.direcao)) return "fotos";
  if (FORMATOS_DE_VIDEO_NO_ESTUDIO.includes(item.delivery_type)) return "video";
  if (["photo", "photos", "photo_carousel"].includes(item.delivery_type)) return "fotos";
  return "arte";
}

export function chaveDoEstudioDaPauta(clientId: string, taskId: string, parte: string) {
  return `mesa:estudio:pauta:${clientId}:${taskId}:${parte}`;
}
