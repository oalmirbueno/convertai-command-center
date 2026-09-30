import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkCheck, Check, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { textoDoErro } from "@/lib/mesa/api";
import { marcaAtual } from "@/lib/mesa/marcas";
import MetodoDoAgente, { metodoUsadoDosAnexos } from "./MetodoDoAgente";
import {
  aprendizadoDosAnexos,
  fraseDoAprendizado,
  regrasSeguidasDosAnexos,
} from "../../../supabase/functions/_shared/aprendizado-do-pedido";

/**
 * O que o agente aprendeu com o pedido e o que ele seguiu (dono, 29/09: "tem
 * que ter inteligência de aprendizado. Cada ação tem que devolver").
 *
 * - "Aprendi: ..." com o botão Esquecer: desliga a regra no cérebro do cliente
 *   (agente_memoria.ativa = false), com Desfazer no aviso. Reabrir a conversa
 *   mostra "Esquecido" quando a regra não está mais ativa.
 * - "Segui: ..." com as regras do dono que o agente disse ter usado.
 *
 * Linha pequena, sem caixa (padrão visual: sem encaixotar).
 */

export const chaveDasRegrasAtivas = (clientId: string) => ["agentes", "regras-ativas", clientId] as const;
/** A lista "O que o painel aprendeu" (ContextoAprendizados) usa esta chave: esquecer aqui atualiza lá. */
const chaveDaListaDeAprendizados = (clientId: string) => ["mesa", "aprendizados", clientId];

/** Ids das regras ativas do cliente (para saber se o "Aprendi" desta mensagem ainda vale). */
export function useRegrasAtivas(clientId: string, ligado: boolean) {
  return useQuery({
    queryKey: chaveDasRegrasAtivas(clientId),
    enabled: !!clientId && ligado,
    staleTime: 30_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await (supabase as any).from("agente_memoria").select("id").eq("client_id", clientId).eq("ativa", true).limit(500);
      if (error) throw error;
      return ((data || []) as Array<{ id: string }>).map((x) => String(x.id));
    },
  });
}

async function mudarRegra(clientId: string, id: string, ativa: boolean) {
  const { error } = await (supabase as any).from("agente_memoria").update({ ativa }).eq("id", id).eq("client_id", clientId);
  if (error) throw error;
}

export default function AprendizadoNaConversa({ anexos, clientId }: { anexos: unknown; clientId: string }) {
  const queryClient = useQueryClient();
  const aprendizado = aprendizadoDosAnexos(anexos);
  const seguidas = regrasSeguidasDosAnexos(anexos);
  const ativas = useRegrasAtivas(clientId, !!aprendizado);
  const [ocupado, setOcupado] = useState(false);
  // Frente SPP: a linha "Método:" também nas conversas da Mesa do cliente, do Mês, das Redes e dos Perfis.
  const metodo = metodoUsadoDosAnexos(anexos);
  if (!aprendizado && !seguidas.length && !metodo) return null;

  const atualizar = () => {
    void queryClient.invalidateQueries({ queryKey: chaveDasRegrasAtivas(clientId) });
    void queryClient.invalidateQueries({ queryKey: chaveDaListaDeAprendizados(clientId) });
  };
  const esquecida = !!aprendizado && !!ativas.data && ativas.data.indexOf(aprendizado.id) < 0;

  const esquecer = async () => {
    if (!aprendizado) return;
    setOcupado(true);
    try {
      await mudarRegra(clientId, aprendizado.id, false);
      toast.success("Esquecido", {
        description: "Os agentes não usam mais esta regra.",
        action: {
          label: "Desfazer",
          onClick: () => {
            mudarRegra(clientId, aprendizado.id, true)
              .then(atualizar)
              .catch((e) => toast.error("Não foi possível desfazer", { description: textoDoErro(e) }));
          },
        },
      });
    } catch (e) {
      toast.error("Não foi possível esquecer", { description: textoDoErro(e) });
    } finally {
      setOcupado(false);
      atualizar();
    }
  };

  return (
    <div className="min-w-0 space-y-1 px-1" data-aprendizado-da-mensagem="">
      {aprendizado && (
        <p className="flex min-w-0 items-start text-[12px] leading-snug text-muted-foreground" data-aprendi="">
          <BookmarkCheck className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span className={`min-w-0 flex-1 [overflow-wrap:anywhere] ${esquecida ? "line-through" : ""}`}>
            {fraseDoAprendizado(aprendizado)}
            {aprendizado.categoria === "evitar" ? " (não faço mais)" : ""}
          </span>
          {esquecida ? (
            <span className="ml-2 shrink-0 text-[11px]">Esquecido</span>
          ) : (
            <button
              type="button"
              className="ml-2 inline-flex shrink-0 items-center rounded px-1 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
              onClick={() => void esquecer()}
              disabled={ocupado}
              aria-label="Esquecer esta regra"
              data-esquecer=""
            >
              {ocupado ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" /> : <EyeOff className="mr-1 h-3 w-3" aria-hidden="true" />}
              Esquecer
            </button>
          )}
        </p>
      )}
      {seguidas.length > 0 && (
        <p className="flex min-w-0 items-start text-[12px] leading-snug text-muted-foreground" data-segui="">
          <Check className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
          <span className="min-w-0 [overflow-wrap:anywhere]">Segui: {seguidas.map((r) => r.texto).join("; ")}</span>
        </p>
      )}
      {metodo && <MetodoDoAgente anexos={anexos} />}
    </div>
  );
}

/**
 * A marca aberta (Acerbi ou CME, a principal também) vai com o pedido: a regra
 * aprendida numa marca vale só nela (o servidor guarda em referencia_id).
 */
export function marcaDaRegra(clientId: string): { marca_id: string } | Record<string, never> {
  const m = marcaAtual();
  return m && m.clientId === clientId ? { marca_id: m.marcaId } : {};
}

/** Frase do cartão de ação quando há custo de IA (senão, a de sempre). */
export function observacaoDoCusto(acao: { custo_estimado_usd?: number | null; sem_desfazer?: boolean }, semCusto: string): string {
  const c = typeof acao.custo_estimado_usd === "number" ? acao.custo_estimado_usd : 0;
  if (c > 0) return `Usa IA: cerca de US$ ${c.toFixed(c < 0.1 ? 3 : 2)}. Nada muda até confirmar${acao.sem_desfazer ? "" : ", e dá para desfazer"}.`;
  return semCusto;
}
