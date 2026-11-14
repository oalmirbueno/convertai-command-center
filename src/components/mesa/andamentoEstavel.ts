import { useRef } from "react";
import type { AndamentoDaLamina, EtapaDaLamina } from "./PranchetaDoEstudio";

/**
 * Progresso que só avança (14/11/2026).
 *
 * Relato do dono: o cronômetro da lâmina "voltava a zero" e a geração parecia
 * recomeçar. Duas causas na tela: a nova tentativa depois de um erro marcava a
 * lâmina com a hora do clique (Date.now()), e uma releitura atrasada do
 * trabalho podia mostrar menos lâminas com arte do que a tela já tinha visto.
 * Regras puras, fixadas em src/test/estudio-fila-de-geracao.test.tsx.
 */

/** Depois de um erro, a nova tentativa da mesma lâmina dentro deste tempo continua o cronômetro. */
export const RETOMADA_MS = 120_000;

export interface RetomadaDaLamina {
  /** Início da etapa que falhou. */
  desde: number;
  /** Quando falhou. */
  em: number;
}

/**
 * Início que a etapa nova da lâmina mostra. Nunca recomeça quando já existe um
 * início conhecido: o da etapa anterior (o cronômetro não recomeça entre
 * etapas), o do servidor (fila ou pedido em segundo plano) ou o da tentativa
 * que acabou de falhar. Só a "fila" (ainda não começou) e a primeira vez contam do agora.
 */
export function desdeDaEtapa(o: {
  antes?: AndamentoDaLamina;
  etapa: EtapaDaLamina;
  /** Início que o servidor conhece para esta lâmina (iniciado_em da fila ou `desde` do pedido). */
  servidor?: number | null;
  retomada?: RetomadaDaLamina | null;
  agora: number;
}): number {
  if (o.etapa === "fila") return o.agora;
  if (o.antes && o.antes.etapa !== "fila") return o.antes.desde;
  if (typeof o.servidor === "number" && isFinite(o.servidor) && o.servidor <= o.agora) return o.servidor;
  if (o.retomada && o.agora - o.retomada.em <= RETOMADA_MS && o.retomada.desde <= o.agora) return o.retomada.desde;
  return o.agora;
}

export interface ProgressoVisto {
  /** Trabalho e lâminas da direção: mudou, o progresso recomeça de verdade. */
  chave: string;
  feitas: number;
  /** atualizado_em do trabalho de onde a contagem saiu. */
  lidoEm: number;
}

/**
 * Lâminas com arte que a tela mostra. Uma leitura MAIS VELHA que a já vista
 * (releitura atrasada, resposta fora de ordem) não diminui a contagem; uma
 * leitura mais nova vale como veio, mesmo menor (versão desfeita de verdade).
 */
export function progressoQueSoAvanca(antes: ProgressoVisto | null, atual: { chave: string; feitas: number; total: number; lidoEm: number }): ProgressoVisto {
  const teto = Math.max(0, atual.total);
  const feitas = Math.max(0, Math.min(atual.feitas, teto));
  const lidoEm = isFinite(atual.lidoEm) ? atual.lidoEm : 0;
  if (!antes || antes.chave !== atual.chave) return { chave: atual.chave, feitas, lidoEm };
  if (lidoEm < antes.lidoEm) return { chave: antes.chave, feitas: Math.min(teto, Math.max(antes.feitas, feitas)), lidoEm: antes.lidoEm };
  return { chave: atual.chave, feitas, lidoEm };
}

/** A contagem de lâminas com arte para mostrar (barra e "N de M com arte"), sem recuar por releitura atrasada. */
export function useProgressoQueSoAvanca(chave: string, feitas: number, total: number, atualizadoEm: string | null | undefined): number {
  const visto = useRef<ProgressoVisto | null>(null);
  const lidoEm = atualizadoEm ? Date.parse(atualizadoEm) : NaN;
  visto.current = progressoQueSoAvanca(visto.current, { chave, feitas, total, lidoEm });
  return visto.current.feitas;
}
