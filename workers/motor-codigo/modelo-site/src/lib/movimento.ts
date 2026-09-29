import { useEffect, useState } from "react";

/** Tokens de movimento da casa: durações (s), curvas e molas. Use estes, não números soltos. */
export const DURACAO = { rapida: 0.25, media: 0.6, lenta: 1.1 } as const;
export const CURVA = { saida: [0.22, 1, 0.36, 1] as [number, number, number, number], suave: [0.45, 0, 0.55, 1] as [number, number, number, number] };
export const MOLA = { firme: { type: "spring", stiffness: 380, damping: 32 }, macia: { type: "spring", stiffness: 140, damping: 20 } } as const;
export const ATRASO_EM_CASCATA = 0.08;

/**
 * Movimento reduzido sem quebrar a hidratação: começa false (igual ao HTML
 * pré-renderizado) e lê a preferência só no navegador, depois de montar.
 */
export function useMovimentoReduzido(): boolean {
  const [reduzido, setReduzido] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const ler = () => setReduzido(m.matches);
    ler();
    m.addEventListener("change", ler);
    return () => m.removeEventListener("change", ler);
  }, []);
  return reduzido;
}
