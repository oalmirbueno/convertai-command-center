import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Check, Loader2, Undo2, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { textoDoErro } from "@/lib/mesa/api";
import {
  acaoDoAnexo,
  estadoDaAcao,
  frasesDoResultado,
  type AcaoDoAgente,
  type ItemDaAcaoDoAgente,
  type PedidoDaAcao,
  type RespostaDaAcao,
} from "@/lib/agentes/acoesDoAgente";

/**
 * Cartão genérico da ação que um agente propôs (contrato comum em
 * supabase/functions/_shared/acoes-do-agente.ts): a lista exata, item por
 * item, com Confirmar e Cancelar. Só a confirmação executa. Depois, cada item
 * mostra o motivo quando não pôde, e o Desfazer aparece quando há reverso.
 * Não depende da Mesa: quem usa passa a chamada (onPedido).
 */
export default function CartaoDeAcao({
  acao,
  onPedido,
  onFeito,
  titulo,
  renderConfirmar,
  observacao,
}: {
  acao: AcaoDoAgente;
  onPedido: (pedido: PedidoDaAcao) => Promise<RespostaDaAcao>;
  /** Depois de confirmar ou desfazer (ex.: reler a lista da tela). */
  onFeito?: (pedido: PedidoDaAcao, resposta: RespostaDaAcao) => void;
  titulo?: string;
  /** Botão de confirmar com custo (ex.: BotaoComCusto da Mesa); sem ele, botão simples. */
  renderConfirmar?: (confirmar: () => Promise<RespostaDaAcao | null>, ocupado: boolean) => ReactNode;
  /** Linha pequena ao lado dos botões (ex.: "Sem custo."). */
  observacao?: string;
}) {
  const [atual, setAtual] = useState<AcaoDoAgente>(acao);
  const [fazendo, setFazendo] = useState<PedidoDaAcao | null>(null);
  useEffect(() => setAtual(acao), [acao]);
  const estado = estadoDaAcao(atual);
  const resultados = atual.resultados || [];
  const motivoDe = (i: ItemDaAcaoDoAgente) => {
    const r = resultados.find((x) => x.ref === i.ref && x.operacao === i.operacao);
    return r && !r.ok ? r.motivo || "Não foi possível." : null;
  };
  const falhas = resultados.filter((r) => !r.ok).length;
  const temReverso = !atual.sem_desfazer && resultados.some((r) => r.ok && r.desfazer);

  const agir = async (pedido: PedidoDaAcao): Promise<RespostaDaAcao | null> => {
    setFazendo(pedido);
    try {
      const r = await onPedido(pedido);
      const novo = r && acaoDoAnexo(r.anexo);
      if (novo) setAtual(novo);
      if (pedido === "confirmar") {
        const f = frasesDoResultado(novo ? novo.resultados : undefined);
        toast.success(f.titulo, { description: novo && novo.sem_desfazer && !novo.resultados?.some((x) => !x.ok) ? "Pronto." : f.descricao });
      } else if (pedido === "desfazer") {
        toast.success("Voltou como estava", { description: `${(r && r.voltaram) || 0} ${r && r.voltaram === 1 ? "item voltou" : "itens voltaram"}.` });
      }
      onFeito?.(pedido, r || {});
      return r || {};
    } catch (e) {
      toast.error(pedido === "desfazer" ? "Não foi possível desfazer" : pedido === "descartar" ? "Não foi possível cancelar" : "Não foi possível fazer", {
        description: textoDoErro(e),
        duration: 9000,
      });
      return null;
    } finally {
      setFazendo(null);
    }
  };

  const total = atual.itens.length;
  return (
    <section className="mr-6 min-w-0 rounded-2xl border border-primary/30 bg-card p-3.5" data-acao-agente={estado}>
      <p className="flex items-center text-[12px] font-semibold">
        <Wand2 className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 truncate">{titulo || "O agente vai fazer"} · {total} {total === 1 ? "item" : "itens"}</span>
      </p>
      {atual.resumo && <p className="mt-1 text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{atual.resumo}</p>}
      {total > 0 && (
        <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-background px-2.5 py-1">
          {atual.itens.map((i) => {
            const motivo = motivoDe(i);
            const para = i.para_rotulo || (i.para !== null && i.para !== undefined && i.para !== "" ? String(i.para) : "");
            return (
              <li key={`${i.operacao}-${i.ref}`} className="flex min-w-0 items-start py-1 text-[12px] leading-snug">
                <span className="mr-1.5 mt-px shrink-0 rounded bg-muted px-1.5 py-px text-[10.5px] font-medium">{i.rotulo}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="font-medium">{i.titulo}</span>
                  {i.detalhe && <span className="text-muted-foreground"> · {i.detalhe}</span>}
                  {para && (
                    <span className="text-muted-foreground">
                      {" "}
                      <ArrowRight className="inline h-3 w-3" /> {para}
                    </span>
                  )}
                  {motivo && <span className="block text-[11.5px] text-destructive">{motivo}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {atual.recusados.length > 0 && (
        <div className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
          <p className="font-medium">Fica de fora:</p>
          <ul>
            {atual.recusados.map((r) => (
              <li key={`r-${r.operacao}-${r.ref}`} className="[overflow-wrap:anywhere]">
                {r.titulo}: {r.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}
      {atual.ignorados.length > 0 && estado === "aberta" && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {atual.ignorados.length} {atual.ignorados.length === 1 ? "pedido não entrou" : "pedidos não entraram"}: item que não existe na lista.
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center">
        {estado === "aberta" && total > 0 && (
          <>
            {renderConfirmar ? (
              <span className="mb-1 mr-1.5">{renderConfirmar(() => agir("confirmar"), !!fazendo)}</span>
            ) : (
              <Button type="button" size="sm" className="mb-1 mr-1.5 h-8" onClick={() => void agir("confirmar")} disabled={!!fazendo}>
                {fazendo === "confirmar" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                Confirmar
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-muted-foreground" onClick={() => void agir("descartar")} disabled={!!fazendo}>
              {fazendo === "descartar" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Cancelar
            </Button>
            <span className="mb-1 ml-auto text-[11px] text-muted-foreground">
              {observacao || (atual.sem_desfazer ? "Nada muda até confirmar." : "Nada muda até confirmar, e dá para desfazer.")}
            </span>
          </>
        )}
        {estado === "feita" && (
          <>
            <span className="mb-1 mr-2 inline-flex items-center rounded-full bg-success/15 px-2.5 py-1 text-[11.5px] text-foreground">
              <Check className="mr-1 h-3 w-3" />
              Feito{falhas ? ` · ${falhas} não ${falhas === 1 ? "pôde" : "puderam"}` : ""}
            </span>
            {temReverso && (
              <Button type="button" size="sm" variant="outline" className="mb-1 h-8" onClick={() => void agir("desfazer")} disabled={!!fazendo}>
                {fazendo === "desfazer" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Undo2 className="mr-1.5 h-3.5 w-3.5" />}
                Desfazer
              </Button>
            )}
          </>
        )}
        {(estado === "descartada" || estado === "desfeita") && (
          <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-[11.5px] text-muted-foreground">
            <X className="mr-1 h-3 w-3" />
            {estado === "desfeita" ? "Desfeito: voltou como estava" : "Cancelado: nada mudou"}
          </span>
        )}
      </div>
    </section>
  );
}

/**
 * Linha curta do que o agente sabe fazer, com atalhos que preenchem o campo.
 * Sem poluir: uma linha e, no máximo, quatro atalhos.
 */
export function OQuePossoFazer({
  capacidades,
  atalhos = [],
  onAtalho,
  className = "",
}: {
  capacidades: string[];
  atalhos?: { rotulo: string; texto: string }[];
  onAtalho?: (texto: string) => void;
  className?: string;
}) {
  if (!capacidades.length) return null;
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="truncate text-[11px] text-muted-foreground" title={`Posso: ${capacidades.join(", ")}.`}>
        <span className="font-medium text-foreground">Posso:</span> {capacidades.join(", ")}. Confirmo com você antes.
      </p>
      {atalhos.length > 0 && onAtalho && (
        <div className="mt-1 flex flex-wrap" role="group" aria-label="Atalhos de ação">
          {atalhos.slice(0, 4).map((a) => (
            <button
              key={a.rotulo}
              type="button"
              onClick={() => onAtalho(a.texto)}
              className="mb-1 mr-1 max-w-full truncate rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              {a.rotulo}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
