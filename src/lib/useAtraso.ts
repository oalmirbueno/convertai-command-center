import { useEffect, useState } from "react";

/**
 * O valor com um respiro: só muda depois de `ms` sem mudar de novo (vários
 * cliques seguidos viram uma chamada só). Use com valor primitivo (texto,
 * número): objeto novo a cada render reinicia o relógio.
 *
 * Mora aqui, num arquivo pequeno, para peças leves (Preencher com IA,
 * Conselho) usarem sem puxar src/lib/mesa/referencias.ts, que reexporta.
 */
export function useAtraso<T>(valor: T, ms: number): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const id = window.setTimeout(() => setV(valor), ms);
    return () => window.clearTimeout(id);
  }, [valor, ms]);
  return v;
}
