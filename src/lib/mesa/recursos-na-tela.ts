/**
 * Leitura dos recursos do modelo na tela (frente MOD, 30/09/2026): selos ao lado do nome, "novo" e o
 * nível de raciocínio que vale. Os recursos vêm de supabase/functions/_shared/recursos-dos-modelos.ts.
 */

import { ORDEM_DO_RACIOCINIO, type RecursosDoModelo } from "../../../supabase/functions/_shared/recursos-dos-modelos";

export { ORDEM_DO_RACIOCINIO };

export type LinhaComRecursos = {
  tipo?: string;
  raciocinio?: string[] | null;
  modalidades?: { entrada?: string[]; saida?: string[] } | null;
  recursos?: Partial<RecursosDoModelo> | null;
  criado_em?: string | null;
};

export interface CapacidadesNaTela {
  visao: boolean;
  ferramentas: boolean;
  raciocinio: boolean;
  json: boolean;
}

/**
 * O que a tela mostra ao lado do nome. Linha antiga (sem recursos) cai no que
 * o catálogo já tinha: visão pelas modalidades, raciocínio pelos níveis; o
 * resto fica falso até a próxima sincronização.
 */
export function capacidadesNaTela(m: LinhaComRecursos): CapacidadesNaTela {
  const r = m.recursos || {};
  const entrada = (m.modalidades && m.modalidades.entrada) || [];
  return {
    visao: r.visao === true || entrada.indexOf("image") >= 0,
    ferramentas: r.ferramentas === true,
    raciocinio: (m.raciocinio || []).length > 0,
    json: r.json === true,
  };
}

/** Lançado (ou entrou no catálogo) há menos de `dias` dias. */
export function lancadoHaPouco(m: LinhaComRecursos, agora = Date.now(), dias = 30): boolean {
  const quando = (m.recursos && m.recursos.lancado_em) || m.criado_em || null;
  if (!quando) return false;
  const t = new Date(quando).getTime();
  return Number.isFinite(t) && agora - t >= 0 && agora - t < dias * 86400000;
}

/**
 * Nível de raciocínio que vale para o modelo: o pedido quando o modelo aceita;
 * senão o padrão do provedor; senão o mais perto acima do pedido; senão o
 * maior. Modelo sem níveis: "" (o pedido vai sem raciocínio).
 */
export function raciocinioQueVale(m: LinhaComRecursos | null | undefined, pedido: string | null | undefined): string {
  const niveis = (m && m.raciocinio) || [];
  if (!niveis.length) return "";
  const p = String(pedido || "");
  if (p && niveis.indexOf(p) >= 0) return p;
  const padrao = m && m.recursos && m.recursos.raciocinio_padrao;
  if (!p && padrao && niveis.indexOf(padrao) >= 0) return padrao;
  const alvo = ORDEM_DO_RACIOCINIO.indexOf(p || "medium");
  const acima = niveis.filter((n) => ORDEM_DO_RACIOCINIO.indexOf(n) >= alvo).sort((a, b) => ORDEM_DO_RACIOCINIO.indexOf(a) - ORDEM_DO_RACIOCINIO.indexOf(b));
  if (acima.length) return acima[0];
  return niveis.slice().sort((a, b) => ORDEM_DO_RACIOCINIO.indexOf(a) - ORDEM_DO_RACIOCINIO.indexOf(b))[niveis.length - 1];
}
