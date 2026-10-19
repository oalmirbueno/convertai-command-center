import { createContext, useContext } from "react";

/**
 * O que os nós e as ligações do quadro podem pedir (sem passar função em
 * `data`, que remontaria todos os nós a cada render do editor).
 */
export interface AcoesDoQuadro {
  projetoId: string;
  clienteId: string | null;
  /** Quadro travado: não move nem liga. */
  travado: boolean;
  mudarDados: (id: string, dados: Record<string, unknown>) => void;
  rodar: (id: string) => void;
  duplicar: (id: string) => void;
  sincronizar: ((id: string) => void) | null;
  abrirDetalhes: ((id: string) => void) | null;
  apagar: (id: string) => void;
  alternarExpandido: (id: string) => void;
  /** Menu rápido de tipos compatíveis, aberto num ponto da tela. */
  abrirMenu: (de: { no: string; lado: "saida" | "entrada" }, ponto: { x: number; y: number }) => void;
  escolherStoryboard: (noId: string, indice: number) => void;
  desligar: (ligacaoId: string) => void;
  /** Troca (ou tira, com null) o gatilho do funil no fio. */
  mudarGatilho: (ligacaoId: string, gatilho: string | null) => void;
}

const nada = () => undefined;

export const ContextoDoQuadro = createContext<AcoesDoQuadro>({
  projetoId: "",
  clienteId: null,
  travado: false,
  mudarDados: nada,
  rodar: nada,
  duplicar: nada,
  sincronizar: null,
  abrirDetalhes: null,
  apagar: nada,
  alternarExpandido: nada,
  abrirMenu: nada,
  escolherStoryboard: nada,
  desligar: nada,
  mudarGatilho: nada,
});

export const useAcoesDoQuadro = () => useContext(ContextoDoQuadro);
