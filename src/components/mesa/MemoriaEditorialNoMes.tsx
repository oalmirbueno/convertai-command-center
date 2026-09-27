import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AjudaRecolhida, botao, juntar, texto } from "@/components/sistema";
import { chamarFuncao } from "@/lib/mesa/api";
import { useAvisarErro } from "./Custo";
import {
  dataCurtaBr,
  type EvolucaoDaPauta,
  linhasDeEvolucao,
  nosDasPropostas,
  normalizarEvolucao,
  seloDaEvolucao,
} from "../../../supabase/functions/_shared/memoria-editorial";

/**
 * Memória editorial na tela do Mês (frente AP, 27/09/2026):
 * - SeloDaPauta: selo discreto no cartão ("novo ângulo de 12/09", "tema novo"
 *   ou "repete 12/09") e, na repetição, "Trocar ângulo" (refaz só aquela
 *   pauta, uma chamada, sem laço). Pauta sem checagem: nada aparece.
 * - LinhaDeEvolucaoDoMes: as pautas ligadas por pilar (quem continua quem),
 *   lista simples. Sem pauta ligada: a seção não aparece.
 */

const COR_DO_TOM: Record<"neutro" | "novo" | "aviso", string> = {
  neutro: "bg-muted text-muted-foreground",
  novo: "bg-primary/10 text-primary",
  aviso: "bg-warning/15 text-foreground",
};

/** Troca o ângulo de uma pauta da proposta (agente-calendario, trocar_angulo). */
export function trocarAnguloDaPauta(propostaId: string, temaId: string) {
  return chamarFuncao<any>("agente-calendario", { acao: "trocar_angulo", proposta_id: propostaId, tema_id: temaId });
}

/** O aviso da pauta repetida, em uma linha (outras pautas: null). */
export function avisoDaPauta(evolucao: unknown): string | null {
  const e = normalizarEvolucao(evolucao);
  return e && e.tipo === "repeticao" ? e.aviso || e.frase : null;
}

/** "Trocar ângulo": só na pauta marcada como repetição (fora dela, nada aparece). */
export function BotaoDeTrocarAngulo({ evolucao, onTrocarAngulo, className = "" }: { evolucao: unknown; onTrocarAngulo: () => Promise<void>; className?: string }) {
  const [trocando, setTrocando] = useState(false);
  const e: EvolucaoDaPauta | null = normalizarEvolucao(evolucao);
  if (!e || e.tipo !== "repeticao") return null;
  return (
    <button
      type="button"
      className={juntar(botao.barra, "h-6 px-1.5 text-[11px] text-primary", className)}
      disabled={trocando}
      onClick={async () => {
        setTrocando(true);
        try {
          await onTrocarAngulo();
        } finally {
          setTrocando(false);
        }
      }}
    >
      {trocando ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" /> : <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />}
      Trocar ângulo
    </button>
  );
}

export function SeloDaPauta({
  evolucao,
  onTrocarAngulo,
  className = "",
}: {
  evolucao: unknown;
  /** Só na pauta repetida que ainda não está na agenda. */
  onTrocarAngulo?: () => Promise<void>;
  className?: string;
}) {
  const e: EvolucaoDaPauta | null = normalizarEvolucao(evolucao);
  const selo = seloDaEvolucao(e);
  if (!selo) return null;
  return (
    <span className={juntar("inline-flex min-w-0 max-w-full flex-wrap items-center", className)}>
      <span className={juntar("mr-1.5 inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[10.5px] font-medium", COR_DO_TOM[selo.tom])} title={selo.dica}>
        {selo.tom === "neutro" && <GitBranch className="mr-1 h-3 w-3 shrink-0" aria-hidden="true" />}
        <span className="truncate">{selo.rotulo}</span>
      </span>
      {onTrocarAngulo ? <BotaoDeTrocarAngulo evolucao={evolucao} onTrocarAngulo={onTrocarAngulo} /> : null}
    </span>
  );
}

/** A ação "Trocar ângulo" de um cartão: chama, atualiza a proposta e avisa. */
export function useTrocarAngulo(chavesParaAtualizar: ReadonlyArray<readonly unknown[]>, aoTrocar?: (resposta: any) => void) {
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  return async (propostaId: string, temaId: string) => {
    try {
      const r = await trocarAnguloDaPauta(propostaId, temaId);
      if (aoTrocar) aoTrocar(r);
      toast.success("Ângulo trocado", { description: r && typeof r.resposta === "string" ? r.resposta : "A pauta foi refeita com outro ângulo." });
    } catch (e) {
      avisarErro(e, "Não foi possível trocar o ângulo");
    } finally {
      for (const k of chavesParaAtualizar) void queryClient.invalidateQueries({ queryKey: k });
    }
  };
}

export const chaveDaLinhaDeEvolucao = (clientId: string) => ["mesa", "linha-de-evolucao", clientId];

/** As pautas ligadas do cliente, por pilar (das propostas mais recentes). */
export default function LinhaDeEvolucaoDoMes({ clientId }: { clientId: string }) {
  const consulta = useQuery({
    queryKey: chaveDaLinhaDeEvolucao(clientId),
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("calendario_propostas")
        .select("id, status, itens")
        .eq("client_id", clientId)
        .neq("status", "descartada")
        .order("criado_em", { ascending: false })
        .limit(40);
      if (error) throw error;
      return linhasDeEvolucao(nosDasPropostas(data || []));
    },
  });
  const linhas = consulta.data || [];
  if (!linhas.length) return null;
  return (
    <section className="min-w-0 space-y-2 border-t border-border pt-6" aria-label="Linha de evolução">
      <h2 className={juntar(texto.tituloSecao, "flex items-center")}>
        Linha de evolução
        <AjudaRecolhida titulo="Linha de evolução">Os temas que voltaram com um ângulo novo, por pilar: do básico ao avançado, do problema à solução, da dúvida à prova.</AjudaRecolhida>
      </h2>
      <ul className="divide-y divide-border">
        {linhas.map((l, i) => (
          <li key={`${l.pilar}-${i}`} className="min-w-0 py-2.5">
            <p className="text-[12px] font-medium text-muted-foreground">{l.pilar}</p>
            <ol className="mt-1 space-y-0.5">
              {l.passos.map((p, k) => (
                <li key={k} className="flex min-w-0 items-baseline text-[12.5px] leading-snug">
                  <span className="mr-2 w-11 shrink-0 tabular-nums text-muted-foreground">{dataCurtaBr(p.data) || "sem data"}</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {p.tema}
                    {k > 0 && p.angulo ? <span className="text-muted-foreground"> · {p.angulo}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </section>
  );
}
