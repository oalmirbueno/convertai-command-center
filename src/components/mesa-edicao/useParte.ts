import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";

/**
 * Parte aberta dentro de uma etapa (ex.: Pacote ou Versões), lembrada por
 * cliente (useEstadoDaTela). O agente pode abrir uma parte pelo endereço
 * (?parte=versoes): ela entra no estado e o parâmetro sai do endereço.
 */
export function useParte<T extends string>(chave: string, valores: readonly T[], padrao: T): [T, (v: T) => void] {
  const [params, setParams] = useSearchParams();
  const [parte, setParte] = useEstadoDaTela<T>(chave, padrao, { validar: (v) => valores.indexOf(v as T) >= 0 });
  const pedida = params.get("parte");
  useEffect(() => {
    if (!pedida) return;
    if (valores.indexOf(pedida as T) >= 0) setParte(pedida as T);
    const next = new URLSearchParams(params);
    next.delete("parte");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedida]);
  return [parte, (v: T) => setParte(v)];
}
