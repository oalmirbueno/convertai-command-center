import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { CanvasDoLab } from "@/lib/laboratorio/nos";
import type { ExecucaoDoLab } from "@/lib/laboratorio/api";
import { paginasDaPrevia, type PaginaDaPrevia } from "@/lib/laboratorio/previas";

const ContextoDasPrevias = createContext<PaginaDaPrevia[]>([]);

export default function ProvedorDasPrevias({ canvas, execucoes, children }: { canvas: CanvasDoLab; execucoes: ExecucaoDoLab[]; children: ReactNode }) {
  const paginas = useMemo(() => paginasDaPrevia(canvas, execucoes), [canvas, execucoes]);
  return <ContextoDasPrevias.Provider value={paginas}>{children}</ContextoDasPrevias.Provider>;
}

export const usePaginasDaPrevia = () => useContext(ContextoDasPrevias);
