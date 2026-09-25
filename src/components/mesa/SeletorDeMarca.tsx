import { useEffect, useRef } from "react";
import {
  definirMarcaAtual,
  limparMarcaAtual,
  marcaEscolhida,
  useMarcasDoCliente,
  type MarcaDoCliente,
} from "@/lib/mesa/marcas";

/**
 * Marca aberta na casca das mesas (Mesa, Mesa Ads, Mesa Foto). Só existe no
 * cliente com 2 ou mais marcas (hoje, a Acerbi: Acerbi e CME); nos outros
 * volta lista vazia e null, e nada muda.
 *
 * A escolha vem do endereço (?marca=<id>); sem ela, a principal. Guarda a
 * marca para as chamadas às funções (chamarFuncao manda marca_id). Guarda
 * durante a pintura, e não num efeito: os efeitos dos filhos rodam antes dos
 * da casca e a primeira chamada de uma aba sairia sem a marca.
 */
export function useMarcaNaCasca(clientId: string, marcaDoEndereco: string | null): { marcas: MarcaDoCliente[]; marca: MarcaDoCliente | null } {
  const consulta = useMarcasDoCliente(clientId);
  const todas = consulta.data || [];
  const marca = clientId ? marcaEscolhida(todas, marcaDoEndereco) : null;
  const dono = useRef<object>({}).current;
  definirMarcaAtual(clientId, marca, dono);
  useEffect(() => () => limparMarcaAtual(dono), [dono]);
  return { marcas: marca ? todas : [], marca };
}

/**
 * Troca rápida de marca, ao lado do seletor de cliente (pedido do dono em
 * 25/09: "selecionar em cima, dentro da Acerbi, a Acerbi ou a CME"). Botões
 * lado a lado, um toque troca. Some quando o cliente tem uma marca só.
 */
export default function SeletorDeMarca({
  marcas,
  valor,
  onEscolher,
  className = "",
}: {
  marcas: MarcaDoCliente[];
  valor: string | null;
  onEscolher: (id: string) => void;
  className?: string;
}) {
  if (marcas.length < 2) return null;
  return (
    <div
      role="radiogroup"
      aria-label="Marca do cliente"
      title="Marca: logo, cores, referências e itens do mês só desta marca"
      className={`flex h-8 min-w-0 shrink-0 items-center rounded-lg bg-muted p-0.5 ${className}`}
    >
      {marcas.map((m) => {
        const ativa = m.id === valor;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={ativa}
            onClick={() => {
              if (!ativa) onEscolher(m.id);
            }}
            className={`h-7 min-w-0 max-w-[140px] truncate rounded-md px-2.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              ativa ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m.nome}
          </button>
        );
      })}
    </div>
  );
}
