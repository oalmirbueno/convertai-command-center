import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, MessageSquareQuote, Wand2 } from "lucide-react";
import { toast } from "sonner";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { botao, juntar } from "@/components/sistema/estilos";
import { entenderPedidosDoCliente, marcarPedidoVisto, textoDoErro } from "@/lib/mesa/api";
import {
  ajustesDoCliente,
  comentarioDaAprovacaoPendente,
  laminaCitada,
  pedidoDeAjustePendente,
  type AjusteDoCliente,
} from "../../../supabase/functions/_shared/entrega-na-agenda";
import {
  ROTULO_DO_TIPO,
  formatoDoEstudio,
  lerEntendido,
  resumoDoPedido,
  type PedidoEntendido,
} from "../../../supabase/functions/_shared/pedido-do-cliente";
import type { FormatoDoPost } from "./estudioUtil";

/**
 * Pedido do cliente entendido, na peça do Estúdio (frente AP, 28/09).
 *
 * Pedido do dono: "quando o cliente comentar em outro formato, já tem que
 * atualizar automaticamente e entender". O que o cliente escreveu na aprovação
 * (pedido de ajuste, ou comentário junto da aprovação) aparece aqui com o que
 * o Jev entendeu: troca de formato (e qual), texto, foto, visual, aprovação
 * com ressalva. Nada é gerado sozinho:
 * - Aplicar: troca de proporção muda o formato do conjunto (sem gerar); texto,
 *   foto e visual abrem o ajuste livre da lâmina com o pedido no campo;
 *   carrossel, post único e reels vão para o diretor (precisa replanejar);
 * - Pedir ao diretor: deixa o pedido pronto no campo do diretor (sem enviar).
 * Comentário da aprovação: a peça já está entregue; "Visto" tira da pendência.
 */

export interface TrabalhoComPedido {
  id: string;
  status: string;
  entrega_status?: string | null;
  entrega_aviso?: string | null;
  ajustes_do_cliente?: unknown;
}

/** Qual pedido a peça mostra: o ajuste pendente (peça reaberta) ou o comentário da aprovação. */
export function pedidoParaMostrar(t: TrabalhoComPedido | null): { pedido: AjusteDoCliente; tipo: "ajuste" | "aprovado" } | null {
  if (!t) return null;
  if (t.entrega_status === "reprovado" && t.status !== "entregue") {
    const p = pedidoDeAjustePendente(t.ajustes_do_cliente);
    if (p) return { pedido: p, tipo: "ajuste" };
    if (t.entrega_aviso) return { pedido: { texto: t.entrega_aviso, lamina: laminaCitada(t.entrega_aviso), decisao: "ajuste" }, tipo: "ajuste" };
    return null;
  }
  const c = comentarioDaAprovacaoPendente(t.ajustes_do_cliente);
  return c ? { pedido: c, tipo: "aprovado" } : null;
}

export type AplicacaoDoPedido =
  | { tipo: "formato"; formato: FormatoDoPost }
  | { tipo: "lamina" }
  | { tipo: "diretor" }
  | null;

/** O que "Aplicar" faz para o pedido entendido (null: não há o que aplicar sozinho). */
export function aplicacaoDoPedido(e: PedidoEntendido | null, formatoAtual: FormatoDoPost, temLamina: boolean): AplicacaoDoPedido {
  if (!e) return null;
  if (e.tipo === "troca_de_formato") {
    const f = formatoDoEstudio(e.formato);
    if (f) return f === formatoAtual ? null : { tipo: "formato", formato: f };
    return { tipo: "diretor" };
  }
  if (e.tipo === "ajuste_de_texto" || e.tipo === "troca_de_foto" || e.tipo === "ajuste_visual") return temLamina ? { tipo: "lamina" } : { tipo: "diretor" };
  return null;
}

const ROTULO_DO_FORMATO: Record<FormatoDoPost, string> = { feed_4x5: "4:5", retrato_3x4: "3:4", quadrado_1x1: "1:1", stories_9x16: "9:16" };

export default function PedidoDoCliente({
  trabalho,
  lamina,
  formatoAtual,
  ocupado,
  onAplicarNaLamina,
  onPedirAoDiretor,
  onMudarFormato,
  onAbrirEntrega,
}: {
  trabalho: TrabalhoComPedido | null;
  /** Lâmina do pedido que existe na peça (a tela confere). */
  lamina: number | null;
  formatoAtual: FormatoDoPost;
  ocupado: boolean;
  onAplicarNaLamina: () => void;
  onPedirAoDiretor: (texto: string) => void;
  onMudarFormato: (f: FormatoDoPost) => void;
  onAbrirEntrega: () => void;
}) {
  const queryClient = useQueryClient();
  const mostrar = pedidoParaMostrar(trabalho);
  const [entendidos, setEntendidos] = useState<Record<string, PedidoEntendido>>({});
  const [entendendo, setEntendendo] = useState(false);
  const [marcando, setMarcando] = useState(false);
  const pedidoId = mostrar?.pedido.evento_id || "";
  const gravado = mostrar ? lerEntendido(mostrar.pedido.entendido) : null;
  const entendido = gravado || (pedidoId ? entendidos[pedidoId] || null : null);

  // Entende sozinho ao aparecer (uma vez por pedido): o Jev só lê, não gera.
  const pedidos = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!trabalho || !pedidoId || gravado || pedidos.current.has(pedidoId)) return;
    pedidos.current.add(pedidoId);
    setEntendendo(true);
    entenderPedidosDoCliente(trabalho.id)
      .then((r) => {
        const novos: Record<string, PedidoEntendido> = {};
        for (const p of ajustesDoCliente(r.pedidos)) {
          const e = lerEntendido(p.entendido);
          if (p.evento_id && e) novos[p.evento_id] = e;
        }
        setEntendidos((a) => ({ ...a, ...novos }));
        if (r.entendidos > 0) {
          void queryClient.invalidateQueries({ queryKey: ["mesa", "itens-do-mes"] });
          void queryClient.invalidateQueries({ queryKey: ["mesa", "item-avulso"] });
        }
      })
      .catch(() => null)
      .finally(() => setEntendendo(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trabalho?.id, pedidoId, !!gravado]);

  if (!trabalho || !mostrar) return null;
  const { pedido, tipo } = mostrar;
  const textoDoCliente = pedido.texto || "";
  const resumo = entendido ? (entendido.resumo || resumoDoPedido(entendido.tipo, entendido.formato, lamina)) : null;
  const aplicacao = tipo === "ajuste" ? aplicacaoDoPedido(entendido, formatoAtual, !!lamina) : null;
  const paraODiretor = `Pedido do cliente${resumo ? ` (${resumo.toLowerCase()})` : ""}: ${textoDoCliente}`;

  const aplicar = () => {
    if (!aplicacao) return;
    if (aplicacao.tipo === "formato") onMudarFormato(aplicacao.formato);
    else if (aplicacao.tipo === "lamina") onAplicarNaLamina();
    else onPedirAoDiretor(paraODiretor);
  };
  const rotuloDoAplicar = !aplicacao
    ? ""
    : aplicacao.tipo === "formato"
      ? `Trocar para ${ROTULO_DO_FORMATO[aplicacao.formato]}`
      : aplicacao.tipo === "lamina"
        ? `Ajustar a lâmina ${lamina}`
        : "Aplicar com o diretor";

  const visto = async () => {
    if (!pedido.evento_id) return;
    setMarcando(true);
    try {
      await marcarPedidoVisto(trabalho.id, pedido.evento_id);
      void queryClient.invalidateQueries({ queryKey: ["mesa", "itens-do-mes"] });
      void queryClient.invalidateQueries({ queryKey: ["mesa", "item-avulso"] });
    } catch (e) {
      toast.error("Não foi possível", { description: textoDoErro(e) });
    } finally {
      setMarcando(false);
    }
  };

  return (
    <div className="mb-3 min-w-0 border-l-2 border-warning pl-3" role="status" data-pedido-do-cliente={tipo} data-tipo-entendido={entendido?.tipo || ""}>
      <div className="flex min-w-0 items-center">
        <MessageSquareQuote className="mr-1.5 h-3.5 w-3.5 shrink-0 text-warning" />
        <span className="min-w-0 truncate text-[13px] font-semibold">
          {tipo === "ajuste" ? "Ajuste pedido pelo cliente" : "Comentário do cliente na aprovação"}
          {lamina && tipo === "ajuste" ? ` (lâmina ${lamina})` : ""}
        </span>
        {entendendo && !entendido && <Loader2 className="ml-2 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-label="Entendendo o pedido" />}
        {entendido && (
          <span className="ml-2 shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[11px]" title={`Entendido pelo Jev (confiança ${Math.round(entendido.confianca * 100)}%)`}>
            {ROTULO_DO_TIPO[entendido.tipo]}
          </span>
        )}
        <AjudaRecolhida className="ml-1 shrink-0" rotulo="Sobre o pedido do cliente">
          O Jev lê o que o cliente escreveu e diz o tipo do pedido. Nada é gerado sozinho: Aplicar só prepara (troca a proporção, ou abre o
          ajuste da lâmina com o pedido no campo, ou deixa o pedido pronto para o diretor). Você confere e manda gerar.
        </AjudaRecolhida>
      </div>
      {resumo && <p className="mt-0.5 text-[13px]">{resumo}</p>}
      <button
        type="button"
        onClick={onAbrirEntrega}
        className="mt-0.5 block w-full text-left text-[12px] leading-snug text-muted-foreground line-clamp-2 break-normal hover:text-foreground"
        title={textoDoCliente}
      >
        “{textoDoCliente}”
      </button>
      <div className="mt-1.5 flex flex-wrap items-center">
        {aplicacao && (
          <button type="button" className={juntar(botao.primario, "mb-1 mr-2 h-8")} onClick={aplicar} disabled={ocupado} data-aplicar-pedido={aplicacao.tipo}>
            <Wand2 className="mr-1.5 h-3.5 w-3.5" /> {rotuloDoAplicar}
          </button>
        )}
        {tipo === "ajuste" && (!aplicacao || aplicacao.tipo !== "diretor") && (
          <button type="button" className={juntar(botao.discreto, "mb-1 mr-2 h-8")} onClick={() => onPedirAoDiretor(paraODiretor)} disabled={ocupado}>
            Pedir ao diretor
          </button>
        )}
        {tipo === "aprovado" && (
          <button type="button" className={juntar(botao.discreto, "mb-1 mr-2 h-8")} onClick={() => void visto()} disabled={marcando}>
            {marcando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />} Visto
          </button>
        )}
      </div>
    </div>
  );
}
