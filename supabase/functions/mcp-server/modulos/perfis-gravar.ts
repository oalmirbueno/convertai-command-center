/**
 * O que gravar em Mesa > Contexto > Perfis do Instagram.
 * Puro: a função perfis-instagram e o MCP usam os mesmos limites e o mesmo @.
 */

import {
  LIMITE_POR_PAPEL,
  normalizarHandle,
  podeAdicionar,
  type PapelDoPerfil,
} from "../../perfis-instagram/modulos/perfis-instagram.ts";

export type PedidoDePerfil = { papel: PapelDoPerfil; bruto: string };
export type PerfilAtivo = { handle: string; papel: string };
export type HandlePronto = { papel: PapelDoPerfil; handle: string };

export type PlanoDePerfis =
  | { ok: false; erro: string }
  | { ok: true; criar: HandlePronto[]; ja: HandlePronto[] };

function rotulo(papel: string): string {
  return papel === "concorrente" ? "Concorrentes" : "Referências";
}

/** Valida tudo antes de qualquer insert. Repetir um @ que já está no papel não cria outro. */
export function planejarPerfis(existentes: PerfilAtivo[], pedidos: PedidoDePerfil[]): PlanoDePerfis {
  if (!pedidos.length) {
    return { ok: false, erro: "Informe ao menos um perfil em referências ou concorrentes." };
  }
  const vistos = new Set<string>();
  const criar: HandlePronto[] = [];
  const ja: HandlePronto[] = [];
  for (const pedido of pedidos) {
    const handle = normalizarHandle(pedido.bruto);
    if (!handle) {
      return { ok: false, erro: `Handle inválido (${String(pedido.bruto).slice(0, 80)}). Use o @ ou o link do perfil.` };
    }
    if (vistos.has(handle)) return { ok: false, erro: `@${handle} está repetido neste pedido.` };
    vistos.add(handle);
    const mesmo = existentes.find((item) => item.handle === handle);
    if (mesmo) {
      if (mesmo.papel !== pedido.papel) {
        return { ok: false, erro: `@${handle} já está em ${rotulo(mesmo.papel)}.` };
      }
      ja.push({ papel: pedido.papel, handle });
      continue;
    }
    criar.push({ papel: pedido.papel, handle });
  }
  for (const papel of ["referencia", "concorrente"] as const) {
    const ativos = existentes.filter((item) => item.papel === papel).length;
    const novos = criar.filter((item) => item.papel === papel).length;
    if (novos > 0 && !podeAdicionar(ativos + novos - 1)) {
      return {
        ok: false,
        erro: `O limite é ${LIMITE_POR_PAPEL} ${rotulo(papel).toLowerCase()} por cliente. Arquive um para trocar.`,
      };
    }
  }
  return { ok: true, criar, ja };
}
