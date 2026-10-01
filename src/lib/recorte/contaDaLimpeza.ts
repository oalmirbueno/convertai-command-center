/**
 * A conta do recorte limpo de uma logo (revisão IDR, 01/10), igual no worker
 * (limpeza.worker.ts) e no fio principal (navegador sem worker e testes).
 * Pura: pixels entram, pixels saem.
 *
 * - "limpar" (janela "Limpar fundo"): fundo liso sai (vãos conforme a
 *   escolha) ou o anel de franja sai; a equipe vê antes e depois.
 * - "diagnosticar": só o que a logo precisa (aviso depois do envio).
 * - "mockup": logo com fundo liso e CLARO perde o fundo para não virar caixa
 *   branca no mockup; o branco cercado pelo desenho fica (contrato de 25/09).
 *   Franja de PNG transparente nunca sai aqui (sem prévia: a logo não muda).
 */

import { fundoPelaBorda, type PixelsRGBA, recortarFundoSolido, toleranciaDoFundo } from "../../../supabase/functions/_shared/recorte-limpo";
import { diagnosticarRecorte, type Diagnostico, medirHalo, tirarFranja } from "./franja";

export type OperacaoDaLimpeza = "limpar" | "diagnosticar" | "mockup";

export interface PedidoDaLimpeza {
  op: OperacaoDaLimpeza;
  data: Uint8ClampedArray;
  largura: number;
  altura: number;
  furos?: "tirar" | "manter";
}

export interface ResultadoDaLimpeza {
  /** Os pixels limpos; null quando não há o que fazer (a logo fica como veio). */
  data: Uint8ClampedArray | null;
  diagnostico: Diagnostico | null;
  haloAntes: number;
  haloDepois: number;
}

/** Fração mínima e máxima do quadro que o fundo do mockup pode ocupar (fora disso a logo fica como veio). */
const FUNDO_DO_MOCKUP = { minimo: 0.005, maximo: 0.97 };

export function contaDaLimpeza(p: PedidoDaLimpeza): ResultadoDaLimpeza {
  const img: PixelsRGBA = { data: p.data, largura: p.largura, altura: p.altura };
  if (p.op === "mockup") {
    const fundo = fundoPelaBorda(img);
    if (fundo.tipo !== "solido" || !fundo.claro || !fundo.cor) return { data: null, diagnostico: null, haloAntes: 0, haloDepois: 0 };
    const r = recortarFundoSolido(img, { cor: fundo.cor, tolerancia: toleranciaDoFundo(fundo.ruido), furos: "manter" });
    const parte = r.info.fundo_px / Math.max(1, p.largura * p.altura);
    if (parte < FUNDO_DO_MOCKUP.minimo || parte > FUNDO_DO_MOCKUP.maximo) return { data: null, diagnostico: null, haloAntes: 0, haloDepois: 0 };
    return { data: r.data, diagnostico: null, haloAntes: 0, haloDepois: 0 };
  }
  const dg = diagnosticarRecorte(img);
  if (p.op === "diagnosticar") {
    const halo = dg.halo ? dg.halo.claro : 0;
    return { data: null, diagnostico: dg, haloAntes: halo, haloDepois: halo };
  }
  const antes = medirHalo(img).claro;
  let data: Uint8ClampedArray | null = null;
  if (dg.precisa === "fundo_solido" && dg.fundo.cor) {
    data = recortarFundoSolido(img, { cor: dg.fundo.cor, tolerancia: toleranciaDoFundo(dg.fundo.ruido), furos: p.furos === "manter" ? "manter" : "tirar" }).data;
  } else if (dg.precisa === "franja") {
    data = tirarFranja(img).data;
  }
  if (!data) return { data: null, diagnostico: dg, haloAntes: antes, haloDepois: antes };
  return { data, diagnostico: dg, haloAntes: antes, haloDepois: medirHalo({ data, largura: p.largura, altura: p.altura }).claro };
}
