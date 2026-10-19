import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, CheckCircle2, Loader2 } from "lucide-react";
import { CabecalhoDeSecao } from "@/components/sistema/Secao";
import { botao, juntar, lista, texto } from "@/components/sistema/estilos";
import {
  concluirPedido,
  nomeDoAgente,
  useAcessosUsados,
  useNomesDosAgentes,
  usePedidosDeAcesso,
  usePrintDoPedido,
  type AcessoUsado,
  type PedidoDeAcesso,
} from "@/hooks/usePedidosDeAcesso";
import { IconeDoTipo, ROTULO_DO_TIPO, nomeDoSite, useAbrirPedidoDeAcesso } from "./JanelaDoPedidoDeAcesso";

/**
 * Pedidos de acesso abertos (17/10/2026): no topo de "Precisa de você", o que
 * os agentes esperam para logar (senha, código, conectar, outro). Tocar abre a
 * janela do pedido (`?acesso=<id>`). Sem pedido aberto, não desenha nada.
 *
 * 19/10/2026 (dono: "opção de concluir para ele sair dali"; "fique persistente e cuide para não
 * cair"): cada linha tem Concluir (tira da lista com um toque, sem abrir a janela) e, se o agente
 * já tinha entrado naquele site, a linha diz quando: o site pediu de novo, a sessão caiu.
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

/** Mesmo site do pedido (nome escrito igual ou mesmo endereço), do mesmo agente. */
function entradaAnterior(pedido: PedidoDeAcesso, usados: AcessoUsado[]): AcessoUsado | null {
  const site = (pedido.site || "").trim().toLowerCase();
  const host = (() => { try { return pedido.url ? new URL(pedido.url).hostname.replace(/^www\./, "") : ""; } catch { return ""; } })();
  return usados.find((u) => u.operador_slug === pedido.operador_slug && (
    (site && (u.site || "").trim().toLowerCase() === site)
    || (host && (() => { try { return u.url ? new URL(u.url).hostname.replace(/^www\./, "") === host : false; } catch { return false; } })())
  )) || null;
}

function LinhaDoPedido({ pedido, agente, abrir, anterior }: { pedido: PedidoDeAcesso; agente: string; abrir: (id: string) => void; anterior: AcessoUsado | null }) {
  const site = nomeDoSite(pedido);
  const qc = useQueryClient();
  const [concluindo, setConcluindo] = useState(false);
  const concluir = async () => {
    if (concluindo) return;
    setConcluindo(true);
    try {
      await concluirPedido(pedido.id);
      toast.success("Pedido concluído: saiu da lista");
      void qc.invalidateQueries({ queryKey: ["pedidos-de-acesso"] });
    } catch (e) {
      toast.error(e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "Não foi possível concluir.");
      setConcluindo(false);
    }
  };
  return (
    <li className="flex min-w-0 items-center">
      <button
        type="button"
        onClick={() => abrir(pedido.id)}
        className={juntar(lista.linha, "min-w-0 flex-1 text-left")}
        aria-label={`${agente} precisa de você em ${site}: ${ROTULO_DO_TIPO[pedido.tipo] || "pedido"}`}
      >
        <Miniatura caminho={pedido.print_path} />
        <span className="min-w-0 flex-1">
          <span className={juntar(texto.corpo, "block truncate font-medium")}>
            {agente} <span className="font-normal text-muted-foreground">em</span> {site}
          </span>
          <span className={juntar(texto.auxiliar, "block truncate")}>{pedido.mensagem || ROTULO_DO_TIPO[pedido.tipo]}</span>
          {anterior?.usado_em && (
            <span className="mt-0.5 block truncate text-[12px] text-warning">
              Já tinha entrado {quando(anterior.usado_em)}: o site pediu de novo (a sessão caiu).
            </span>
          )}
        </span>
        <span className="ml-3 flex shrink-0 flex-col items-end">
          <span className="text-primary" title={ROTULO_DO_TIPO[pedido.tipo]}>
            <IconeDoTipo tipo={pedido.tipo} />
          </span>
          <span className={juntar(texto.auxiliar, "mt-1 whitespace-nowrap")}>{quando(pedido.created_at)}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => void concluir()}
        disabled={concluindo}
        aria-label={`Concluir o pedido de ${site}`}
        title="Já resolvi: tira da lista e o agente para de esperar"
        className={juntar(botao.discreto, "ml-1 h-9 shrink-0 px-2.5 text-success")}
      >
        {concluindo ? <Loader2 className="h-4 w-4 animate-spin sm:mr-1.5" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />}
        <span className="hidden sm:inline">Concluir</span>
      </button>
    </li>
  );
}

export default function PedidosDeAcesso() {
  const { data: pedidos = [] } = usePedidosDeAcesso();
  const { data: nomes } = useNomesDosAgentes(pedidos.length > 0);
  const { data: usados = [] } = useAcessosUsados(pedidos.length > 0);
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
          <LinhaDoPedido key={p.id} pedido={p} agente={nomeDoAgente(p.operador_slug, nomes)} abrir={abrir} anterior={entradaAnterior(p, usados)} />
        ))}
      </ul>
    </section>
  );
}
