/**
 * Conversão HSL e escala de tons de uma cor (50 a 900). Mora em _shared porque
 * duas pastas usam: a paleta da marca da Identidade
 * (mesa-identidade/modulos/paleta-da-marca.ts, que reexporta daqui) e o apoio
 * da paleta da base UI UX Pro Max (uiux/apoio-da-paleta.ts, usado pela Mesa
 * Site, pelo motor de código, pela Identidade e pelo worker).
 *
 * Puro: sem Deno, sem banco. Sem lookbehind, sem \p{} (Safari 11).
 */

import { hexParaRgb, normalizarHex, rgbParaHex } from "./cores-da-marca.ts";

export type Hsl = { h: number; s: number; l: number };

export function hexParaHsl(hex: string): Hsl {
  const { r, g, b } = hexParaRgb(hex);
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h * 10) / 10, s: Math.round(s * 1000) / 10, l: Math.round(l * 1000) / 10 };
}

export function hslParaHex(c: Hsl): string {
  const h = (((c.h % 360) + 360) % 360) / 360;
  const s = Math.max(0, Math.min(100, c.s)) / 100;
  const l = Math.max(0, Math.min(100, c.l)) / 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return rgbParaHex({ r: v, g: v, b: v });
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const canal = (t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbParaHex({ r: Math.round(canal(h + 1 / 3) * 255), g: Math.round(canal(h) * 255), b: Math.round(canal(h - 1 / 3) * 255) });
}

/** Escala de apoio da cor (50 a 900): tons para fundo, borda, hover e texto. */
export function escalaDaCor(baseHex: string): Array<{ passo: number; hex: string }> {
  const hex = normalizarHex(baseHex);
  if (!hex) return [];
  const c = hexParaHsl(hex);
  const passos: Array<[number, number]> = [
    [50, 96],
    [100, 91],
    [200, 82],
    [300, 71],
    [400, 60],
    [500, 50],
    [600, 41],
    [700, 32],
    [800, 23],
    [900, 15],
  ];
  return passos.map(([passo, l]) => ({ passo, hex: hslParaHex({ h: c.h, s: l > 85 ? Math.min(c.s, 70) : c.s, l }) }));
}
