/**
 * Diversidade no plano do Mês (02/10/2026; dono: "os meses têm que ser
 * melhores com composição, sem repetir"). O conteúdo já não repete pela
 * memória editorial; aqui entra a forma: o formato das últimas pautas vira o
 * "o que variar agora" (regras em _shared/diversidade-visual.ts) e o bloco
 * fixo do estrategista pede tipo de peça, cenário e estilo variados.
 *
 * Puro (sem Deno, sem banco, sem IA): o Vitest testa direto.
 */

import { blocoDaDiversidadeVisual, oQueVariarAgora } from "../../_shared/diversidade-visual.ts";
import type { MemoriaEditorial } from "./memoria-editorial.ts";

/** Bloco fixo das regras de saída do estrategista (mês, campanha, temas). */
export const DIVERSIDADE_NO_PLANO = blocoDaDiversidadeVisual("mes");

/** O "o que variar agora" do plano pelas últimas pautas (E1 a mais recente); sem memória, vazio. */
export function variarAgoraNoMes(memoria: MemoriaEditorial | null | undefined): string {
  const temas = memoria && Array.isArray(memoria.temas) ? memoria.temas : [];
  if (!temas.length) return "";
  return oQueVariarAgora(temas.slice(0, 16).map((t) => ({ formato: t.formato || null })), { teto: 600 });
}
