import { createContext, useContext } from "react";
import type { ExecucaoDoLab, ImagemDoLab } from "@/lib/laboratorio/api";
import type { TipoDeNo } from "@/lib/laboratorio/nos";

/**
 * O que os nós e as ligações do quadro podem pedir (sem passar função em
 * `data`, que remontaria todos os nós a cada render do editor).
 */
export interface AcoesDoQuadro {
  projetoId: string;
  clienteId: string | null;
  /** Clientes da carteira (seletor do nó Cliente). */
  clientes: Array<{ id: string; nome: string }>;
  /** Salva o quadro antes de chamar a função (ela lê o canvas salvo). */
  antesDeChamar: () => Promise<void>;
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
  /** Ajustar ou variar uma imagem gerou uma execução nova (o vigia acompanha). */
  novaExecucao: (noId: string, ex: ExecucaoDoLab) => void;
  /** "+ Ligar Copy": cria o nó do tipo à esquerda de `destinoId` e já liga nele. */
  ligarNovo: (destinoId: string, tipo: TipoDeNo) => void;
  /** Usar como referência: nó Mídia com a imagem, já ligado no nó de onde ela saiu. */
  usarComoReferencia: (noId: string, imagem: ImagemDoLab) => void;
}

const nada = () => undefined;

export const ContextoDoQuadro = createContext<AcoesDoQuadro>({
  projetoId: "",
  clienteId: null,
  clientes: [],
  antesDeChamar: () => Promise.resolve(),
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
  novaExecucao: nada,
  ligarNovo: nada,
  usarComoReferencia: nada,
});

export const useAcoesDoQuadro = () => useContext(ContextoDoQuadro);
