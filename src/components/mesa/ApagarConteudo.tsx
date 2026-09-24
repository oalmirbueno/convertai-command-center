import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ErroDaMesa } from "@/lib/mesa/api";
import { useAvisarErro } from "./Custo";
import { useMesa } from "./MesaContexto";
import { atualizarAgenda, chaves, type ItemProposto } from "./mesaV4Api";
import { arquivarItemDaAgenda, reporItem, restaurarItemDaAgenda, tirarItem } from "./planoDoMes";

/**
 * Apagar o conteúdo que não serviu (pedido do dono em 24/09), com uma
 * confirmação curta no próprio lugar e "Desfazer" no aviso:
 * - na proposta, antes de gravar: tirar_item (desfazer: repor_item);
 * - na agenda, depois de gravar: arquivar_item_agenda (desfazer:
 *   restaurar_item_agenda). O servidor nunca tira o que foi aprovado,
 *   agendado ou publicado, e pede uma segunda confirmação quando o item já tem
 *   arte no Estúdio (a arte fica guardada; nenhum arquivo é apagado).
 */

export interface ResultadoDoApagar {
  ok: boolean;
  /** Pergunta extra do servidor (ex.: o item já tem arte no Estúdio). */
  confirmar?: string;
}

const DURACAO_DO_DESFAZER = 10000;

export function useApagarConteudo() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();

  const reler = (propostaId?: string) => {
    atualizarAgenda(queryClient, clientId);
    void queryClient.invalidateQueries({ queryKey: ["mesa", "artes-do-mes", clientId] });
    void queryClient.invalidateQueries({ queryKey: chaves.agente(clientId) });
    if (propostaId) void queryClient.invalidateQueries({ queryKey: chaves.proposta(propostaId) });
  };

  /** Tira o conteúdo da proposta (antes de gravar). */
  const daProposta = async (propostaId: string, item: ItemProposto, indice: number): Promise<ResultadoDoApagar> => {
    try {
      const data = await tirarItem(propostaId, String(item.tema_id || ""), indice);
      if (data && data.proposta) queryClient.setQueryData(chaves.proposta(propostaId), data.proposta);
      reler(propostaId);
      const removido = (data && data.removido) || { item, indice, tema_escolhido: null };
      toast.success("Conteúdo apagado da proposta", {
        description: item.tema || undefined,
        duration: DURACAO_DO_DESFAZER,
        action: {
          label: "Desfazer",
          onClick: () => {
            reporItem({
              propostaId,
              item: removido.item,
              indice: Number(removido.indice),
              temaEscolhido: removido.tema_escolhido,
              memoriaId: data ? data.memoria_id : null,
            })
              .then((r) => {
                if (r && r.proposta) queryClient.setQueryData(chaves.proposta(propostaId), r.proposta);
                reler(propostaId);
                toast.success("Conteúdo de volta na proposta");
              })
              .catch((e) => avisarErro(e, "Não foi possível desfazer"));
          },
        },
      });
      return { ok: true };
    } catch (e) {
      avisarErro(e, "Não foi possível apagar");
      return { ok: false };
    }
  };

  /** Tira o item da agenda (depois de gravado). */
  const daAgenda = async (taskId: string, titulo: string, confirmarArte = false): Promise<ResultadoDoApagar> => {
    try {
      const data = await arquivarItemDaAgenda(clientId, taskId, confirmarArte);
      reler();
      toast.success("Conteúdo apagado da agenda", {
        description: `${titulo}${data && data.arte ? ". A arte continua guardada no Estúdio." : ""}`,
        duration: DURACAO_DO_DESFAZER,
        action: {
          label: "Desfazer",
          onClick: () => {
            restaurarItemDaAgenda(clientId, taskId, data ? data.memoria_id : null)
              .then(() => {
                reler();
                toast.success("Conteúdo de volta na agenda");
              })
              .catch((e) => avisarErro(e, "Não foi possível desfazer"));
          },
        },
      });
      return { ok: true };
    } catch (e) {
      if (e instanceof ErroDaMesa && e.codigo === "item_com_arte" && !confirmarArte) return { ok: false, confirmar: e.message };
      avisarErro(e, "Não foi possível apagar");
      return { ok: false };
    }
  };

  return { daProposta, daAgenda };
}

/**
 * Lixeira com confirmação curta no lugar: o primeiro clique pergunta, o
 * segundo apaga. Se o servidor pedir mais uma confirmação (arte já feita), a
 * pergunta muda e o próximo clique confirma.
 */
export function BotaoDeApagar({
  onApagar,
  pergunta = "Apagar este conteúdo?",
  rotulo = "Apagar",
  className = "",
}: {
  onApagar: (confirmarExtra: boolean) => Promise<ResultadoDoApagar>;
  pergunta?: string;
  rotulo?: string;
  className?: string;
}) {
  const [etapa, setEtapa] = useState<"parado" | "perguntando" | "apagando">("parado");
  const [extra, setExtra] = useState<string | null>(null);

  const confirmar = async () => {
    setEtapa("apagando");
    const r = await onApagar(!!extra);
    if (r.confirmar) {
      setExtra(r.confirmar);
      setEtapa("perguntando");
      return;
    }
    setExtra(null);
    setEtapa("parado");
  };

  if (etapa === "parado") {
    return (
      <button
        type="button"
        onClick={() => setEtapa("perguntando")}
        className={`inline-flex items-center rounded-md px-1.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive ${className}`}
        aria-label={rotulo}
        title={rotulo}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <span className={`inline-flex min-w-0 flex-wrap items-center rounded-md bg-destructive/10 px-2 py-1 text-[11.5px] ${className}`} role="group" aria-label="Confirmar apagar">
      <span className="mr-2 min-w-0 text-foreground [overflow-wrap:anywhere]">{extra || pergunta}</span>
      <button
        type="button"
        onClick={() => void confirmar()}
        disabled={etapa === "apagando"}
        className="mr-1 inline-flex items-center rounded bg-destructive px-2 py-0.5 font-medium text-destructive-foreground disabled:opacity-60"
      >
        {etapa === "apagando" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        {extra ? "Apagar mesmo" : rotulo}
      </button>
      <button
        type="button"
        onClick={() => {
          setExtra(null);
          setEtapa("parado");
        }}
        disabled={etapa === "apagando"}
        className="rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
      >
        Cancelar
      </button>
    </span>
  );
}
