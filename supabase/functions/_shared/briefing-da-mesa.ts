/**
 * Qual modelo de briefing cada mesa oferece (frente BRF). Arquivo pequeno de
 * propósito: a casca de todas as mesas importa só isto, sem carregar os
 * modelos inteiros (briefing-modelos.ts reexporta).
 */
import type { SlugDoModelo } from "./briefing-modelos.ts";

/** null: a mesa não oferece briefing. */
export function modeloDaMesa(mesa: string): SlugDoModelo | null {
  const mapa: Record<string, SlugDoModelo> = {
    mesa: "redes",
    foto: "redes",
    publicidade: "redes",
    ads: "landing",
    videos: "video",
    roteiros: "video",
    edicao: "video",
    site: "site",
    landing: "landing",
    identidade: "identidade",
    naming: "naming",
    motion: "video",
  };
  return mapa[mesa] ?? null;
}

