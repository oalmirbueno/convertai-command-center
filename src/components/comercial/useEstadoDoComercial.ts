import type { Dispatch, SetStateAction } from "react";
import { useEstadoDaTela } from "@/components/sistema";

/**
 * O useEstadoDaTela do sistema com a rota fixa do Comercial (opção `rota`,
 * promovida ao sistema em 26/09 pela frente C a partir deste hook).
 *
 * O Comercial é uma página só com a aba no endereço (/comercial,
 * /comercial/crm, /comercial/agenda...), e a página não desmonta ao trocar de
 * aba: tudo fica sob "/comercial", separado só pela chave. Mesmo
 * armazenamento, mesmo formato e mesma validade (30 dias) de antes.
 */
const ROTA = "/comercial";

export function useEstadoDoComercial<T>(
  chave: string,
  inicial: T,
  opcoes: { validar?: (v: unknown) => boolean; esperaMs?: number } = {},
): [T, Dispatch<SetStateAction<T>>, () => void] {
  return useEstadoDaTela<T>(chave, inicial, { validar: opcoes.validar, esperaMs: opcoes.esperaMs, rota: ROTA });
}

/** Validação de opção fechada (aba, filtro): valor fora da lista cai no inicial. */
export const umaDe =
  (opcoes: readonly string[]) =>
  (v: unknown): boolean =>
    typeof v === "string" && opcoes.indexOf(v) >= 0;

export const ehTexto = (v: unknown): boolean => typeof v === "string";
