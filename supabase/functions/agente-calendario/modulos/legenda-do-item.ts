/**
 * Frente CPY: a legenda de um item do Mês ou da Campanha pelo motor de copy
 * da casa. Puro (sem Deno e sem rede), para o vitest ler o mesmo arquivo.
 * Mora aqui, e não em _shared, porque só o agente-calendario usa.
 */

import { conferirCopy, limparCopy } from "../../_shared/motor-de-copy.ts";

/**
 * Legenda de um item do Mês ou da Campanha (vários posts por chamada, sem
 * variações): limpeza da casa no teto do Instagram e os avisos que importam
 * ali (clichê de IA, promessa proibida, tamanho, gancho longo; falta de CTA
 * só quando o item não traz um CTA próprio). Aviso, nunca reescrita.
 */
export function legendaDoItem(copy: unknown, temCta: boolean): { texto: string; avisos: string[] } {
  const limpa = limparCopy(copy, "legenda");
  if (!limpa.texto) return { texto: "", avisos: [] };
  const avisos = conferirCopy(limpa.texto, "legenda").problemas
    .filter((p) => p.tipo !== "vazia" && !(p.tipo === "sem_cta" && temCta))
    .map((p) => `Legenda: ${p.texto}`);
  return { texto: limpa.texto, avisos };
}
