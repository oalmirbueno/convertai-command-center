import { useCallback, useEffect, useState } from "react";
import { FILTRO_VAZIO, lerFiltro, type FiltroDaBusca } from "@/lib/editor/busca";

/**
 * Filtro da busca do editor compartilhado (02/10): a Mídia, a linha do tempo e
 * o agente (inclusive o da lateral fixa, que mora fora do editor) leem e mudam
 * o MESMO filtro. "Mostre só os gerados" no agente filtra a Mídia na hora; o
 * que o agente mudou fica em destaque na linha do tempo. Um por cliente, só
 * nesta aba (não vai para o banco).
 */

interface EstadoDaBusca {
  filtro: FiltroDaBusca;
  /** Clipes em destaque (o que o agente mudou ou achou). */
  destaque: string[];
}

const estados: Record<string, EstadoDaBusca> = {};
const ouvintes: Array<(clientId: string) => void> = [];

const ler = (clientId: string): EstadoDaBusca => estados[clientId] || { filtro: FILTRO_VAZIO, destaque: [] };

function avisar(clientId: string) {
  ouvintes.slice().forEach((f) => f(clientId));
}

export function definirFiltro(clientId: string, filtro: Partial<FiltroDaBusca> | FiltroDaBusca) {
  if (!clientId) return;
  const atual = ler(clientId);
  estados[clientId] = { ...atual, filtro: lerFiltro({ ...atual.filtro, ...filtro }) };
  avisar(clientId);
}

export function limparFiltro(clientId: string) {
  if (!clientId) return;
  estados[clientId] = { ...ler(clientId), filtro: FILTRO_VAZIO };
  avisar(clientId);
}

export function destacar(clientId: string, ids: string[]) {
  if (!clientId) return;
  estados[clientId] = { ...ler(clientId), destaque: ids.slice(0, 200) };
  avisar(clientId);
}

export const lerBusca = (clientId: string) => ler(clientId);

/** Quem desenha a busca (Mídia, linha do tempo): redesenha só quando ela muda. */
export function useBuscaDoEditor(clientId: string): EstadoDaBusca & { mudar: (f: Partial<FiltroDaBusca>) => void; limpar: () => void } {
  const [estado, setEstado] = useState<EstadoDaBusca>(() => ler(clientId));
  useEffect(() => {
    setEstado(ler(clientId));
    const f = (id: string) => {
      if (id === clientId) setEstado(ler(clientId));
    };
    ouvintes.push(f);
    return () => {
      const i = ouvintes.indexOf(f);
      if (i >= 0) ouvintes.splice(i, 1);
    };
  }, [clientId]);
  const mudar = useCallback((f: Partial<FiltroDaBusca>) => definirFiltro(clientId, f), [clientId]);
  const limpar = useCallback(() => limparFiltro(clientId), [clientId]);
  return { ...estado, mudar, limpar };
}
