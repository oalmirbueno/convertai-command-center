import { useState } from "react";
import { Box, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useClients } from "@/hooks/useSupabaseData";
import { TODOS_OS_CLIENTES, useEsteira, type ProdutoDaEsteira } from "../canvasApi";
import { FLUTUANTE, PAINEL, useRodaPresa } from "./comum";

/**
 * Esteira de produtos no topo do quadro (dono, 25/09: "em cima, uma esteira
 * de produtos, com produtos de vários clientes também, não só deste").
 *
 * Regra: a lista vem de foto_kits com o RLS de quem está logado (a equipe só
 * vê os clientes a que tem acesso). Ao salvar e ao gerar, a função confere
 * can_access_client do cliente do kit; a cobrança continua no cliente do
 * canvas, e a foto gerada entra no acervo deste cliente (com a etiqueta do
 * kit, sem apontar kit_id nem derivada_de de outro cliente).
 */

export const TIPO_ARRASTADO_DA_ESTEIRA = "application/mesa-foto-kit";

export function EsteiraDeProdutos({ onPor }: { onPor: (p: ProdutoDaEsteira) => void }) {
  const { clientId } = useMesa();
  const clientes = useClients();
  const [filtro, setFiltro] = useState<string>(clientId);
  const [aberta, setAberta] = useState(true);
  const esteira = useEsteira(filtro || clientId, aberta);
  // Roda na esteira anda a fila de produtos para o lado; nunca mexe no quadro nem na página.
  const roda = useRodaPresa<HTMLDivElement>(true);
  const lista = esteira.data || [];
  const nomeDoCliente = (id: string) => {
    const c = ((clientes.data || []) as any[]).find((x) => x && x.id === id);
    return c ? String(c.company_name || c.full_name || "cliente") : "outro cliente";
  };
  return (
    <div ref={roda} className={`${PAINEL} ${FLUTUANTE} flex min-w-0 items-center rounded-2xl px-2 py-1.5`} data-esteira-de-produtos="" data-rolagem-propria="" aria-label="Esteira de produtos">
      <div className="mr-2 flex shrink-0 flex-col">
        <span className="flex items-center text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">
          <Box className="mr-1 h-3 w-3 text-emerald-300" /> Produtos
        </span>
        <select
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          aria-label="Produtos de qual cliente"
          className="mt-0.5 h-7 w-28 rounded-md sm:w-36 border border-white/10 bg-zinc-900/70 px-1.5 text-[11.5px] text-zinc-100"
        >
          <option value={clientId}>Deste cliente</option>
          <option value={TODOS_OS_CLIENTES}>Todos os clientes</option>
          {((clientes.data || []) as any[])
            .filter((c) => c && c.id && c.id !== clientId)
            .slice(0, 80)
            .map((c) => (
              <option key={String(c.id)} value={String(c.id)}>
                {String(c.company_name || c.full_name || "Cliente")}
              </option>
            ))}
        </select>
      </div>
      {aberta && (
        <div className="flex min-w-0 flex-1 items-center overflow-x-auto overscroll-contain" data-fila-da-esteira="" style={{ WebkitOverflowScrolling: "touch" }}>
          {esteira.isLoading && <Loader2 className="mx-2 h-4 w-4 animate-spin text-zinc-400" />}
          {!esteira.isLoading && !lista.length && <p className="px-2 text-[11.5px] text-zinc-500">Nenhum produto confirmado {filtro === clientId ? "neste cliente" : "aqui"}.</p>}
          {lista.map((p) => {
            const deFora = p.client_id !== clientId;
            return (
              <button
                key={p.kit_id}
                type="button"
                draggable
                onDragStart={(e) => {
                  try {
                    e.dataTransfer.setData(TIPO_ARRASTADO_DA_ESTEIRA, JSON.stringify({ kit_id: p.kit_id }));
                    e.dataTransfer.effectAllowed = "copy";
                  } catch {
                    /* navegador sem arrastar: o toque põe no quadro */
                  }
                }}
                onClick={() => onPor(p)}
                title={`${p.nome}${deFora ? ` (${nomeDoCliente(p.client_id)})` : ""}. Toque ou arraste para o quadro.`}
                data-produto-da-esteira={p.kit_id}
                className="mr-1.5 flex w-[64px] shrink-0 flex-col items-center rounded-xl p-1 text-center transition-colors hover:bg-white/10"
              >
                <span className="relative block overflow-hidden rounded-lg border border-white/10 bg-zinc-900" style={{ width: 44, height: 44 }}>
                  {p.capa ? <MiniaturaDoStorage bucket={p.capa.bucket} caminho={p.capa.caminho} alt={p.nome} largura={120} className="h-full w-full" /> : <Box className="m-3 h-5 w-5 text-zinc-600" />}
                  {deFora && <span className="absolute bottom-0 left-0 right-0 bg-sky-500/80 text-[8.5px] font-semibold leading-tight text-white">outro</span>}
                </span>
                <span className="mt-0.5 block w-full truncate text-[10px] text-zinc-300">{p.nome}</span>
              </button>
            );
          })}
        </div>
      )}
      {!aberta && <span className="flex-1 text-[11px] text-zinc-500">Esteira recolhida</span>}
      <button type="button" onClick={() => setAberta(!aberta)} aria-label={aberta ? "Recolher a esteira" : "Abrir a esteira"} className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white">
        {aberta ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
    </div>
  );
}
