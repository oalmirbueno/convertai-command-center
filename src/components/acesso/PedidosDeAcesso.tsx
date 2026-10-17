import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Bot } from "lucide-react";
import { CabecalhoDeSecao } from "@/components/sistema/Secao";
import { juntar, lista, texto } from "@/components/sistema/estilos";
import {
  nomeDoAgente,
  useNomesDosAgentes,
  usePedidosDeAcesso,
  usePrintDoPedido,
  type PedidoDeAcesso,
} from "@/hooks/usePedidosDeAcesso";
import { IconeDoTipo, ROTULO_DO_TIPO, nomeDoSite, useAbrirPedidoDeAcesso } from "./JanelaDoPedidoDeAcesso";

/**
 * Pedidos de acesso abertos (17/10/2026): no topo de "Precisa de você", o que
 * os agentes esperam para logar (senha, código, conectar, outro). Tocar abre a
 * janela do pedido (`?acesso=<id>`). Sem pedido aberto, não desenha nada.
 */

function quando(iso: string) {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR });
  } catch {
    return "";
  }
}

function Miniatura({ caminho }: { caminho: string | null }) {
  const print = usePrintDoPedido(caminho);
  return (
    <span className="mr-3 flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
      {print.data ? (
        <img src={print.data} alt="" className="h-full w-full object-cover" />
      ) : (
        <Bot className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      )}
    </span>
  );
}

function LinhaDoPedido({ pedido, agente, abrir }: { pedido: PedidoDeAcesso; agente: string; abrir: (id: string) => void }) {
  const site = nomeDoSite(pedido);
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={() => abrir(pedido.id)}
        className={juntar(lista.linha, "w-full text-left")}
        aria-label={`${agente} precisa de você em ${site}: ${ROTULO_DO_TIPO[pedido.tipo] || "pedido"}`}
      >
        <Miniatura caminho={pedido.print_path} />
        <span className="min-w-0 flex-1">
          <span className={juntar(texto.corpo, "block truncate font-medium")}>
            {agente} <span className="font-normal text-muted-foreground">em</span> {site}
          </span>
          <span className={juntar(texto.auxiliar, "block truncate")}>{pedido.mensagem || ROTULO_DO_TIPO[pedido.tipo]}</span>
        </span>
        <span className="ml-3 flex shrink-0 flex-col items-end">
          <span className="text-primary" title={ROTULO_DO_TIPO[pedido.tipo]}>
            <IconeDoTipo tipo={pedido.tipo} />
          </span>
          <span className={juntar(texto.auxiliar, "mt-1 whitespace-nowrap")}>{quando(pedido.created_at)}</span>
        </span>
      </button>
    </li>
  );
}

export default function PedidosDeAcesso() {
  const { data: pedidos = [] } = usePedidosDeAcesso();
  const { data: nomes } = useNomesDosAgentes(pedidos.length > 0);
  const abrir = useAbrirPedidoDeAcesso();
  if (pedidos.length === 0) return null;
  return (
    <section className="min-w-0" aria-label="Acessos que os agentes pedem" data-pedidos-de-acesso="">
      <CabecalhoDeSecao
        nivel={3}
        className="mb-1"
        titulo={
          <>
            Acessos pedidos
            <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{pedidos.length}</span>
          </>
        }
      />
      <ul className={juntar(lista.aberta, lista.divisoria)}>
        {pedidos.map((p) => (
          <LinhaDoPedido key={p.id} pedido={p} agente={nomeDoAgente(p.operador_slug, nomes)} abrir={abrir} />
        ))}
      </ul>
    </section>
  );
}
