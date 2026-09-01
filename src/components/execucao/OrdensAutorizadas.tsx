import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Clock, ExternalLink, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * O que já foi AUTORIZADO e ainda espera o agente fazer.
 *
 * Este estado não existia. O painel tinha "esperando você" e "feito", e
 * entre os dois havia um vão: a ordem autorizada, de pé, que ninguém
 * executou ainda. Sem mostrá-lo, autorizar parecia concluir — e um post
 * que você liberou há dois dias e nunca foi ao ar ficaria invisível
 * exatamente como se tivesse ido.
 *
 * A leitura aqui é curta de propósito: quem olha quer saber se a coisa
 * que ele liberou aconteceu. Isso é uma linha por ordem, não um dossiê.
 */

const quando = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }) : "";

/** Quantos dias uma ordem está de pé sem ninguém cumprir. */
export function diasParada(aprovadaEm?: string | null, agora = new Date()): number {
  if (!aprovadaEm) return 0;
  const t = new Date(aprovadaEm).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((agora.getTime() - t) / 86_400_000));
}

export default function OrdensAutorizadas() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["ordens-autorizadas"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operator_approvals")
        .select("id, action_kind, o_que, destino, prazo, decided_at, executed_at, "
          + "execution_evidence, operator_id, kanban_task_id")
        .eq("status", "aprovado")
        .order("decided_at", { ascending: false })
        .limit(40);
      if (error) throw new Error(error.message);
      const linhas = (data || []) as any[];
      if (linhas.length === 0) return { pendentes: [], cumpridas: [] };

      const { data: ops } = await (supabase as any)
        .from("internal_operators").select("id, display_name")
        .in("id", [...new Set(linhas.map((l) => l.operator_id))]);
      const nome = new Map(((ops || []) as any[]).map((o) => [o.id, o.display_name]));
      const com = linhas.map((l) => ({ ...l, agente: nome.get(l.operator_id) || "agente" }));

      return {
        pendentes: com.filter((l) => !l.executed_at),
        cumpridas: com.filter((l) => l.executed_at).slice(0, 6),
      };
    },
    refetchInterval: 120_000,
  });

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-secondary p-3 text-[12px] text-destructive">
        Não consegui ler as ordens: {error instanceof Error ? error.message : String(error)}.
        Nada está sendo dado como cumprido nem como pendente — a leitura falhou.
      </div>
    );
  }
  if (isLoading) return null;

  const pendentes = data?.pendentes ?? [];
  const cumpridas = data?.cumpridas ?? [];
  if (pendentes.length === 0 && cumpridas.length === 0) return null;

  return (
    <div className="space-y-3">
      {pendentes.length > 0 && (
        <div className="rounded-xl border border-info/40 bg-info/[0.05] p-3.5">
          <p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-info">
            <Zap className="h-3.5 w-3.5" />
            Autorizado · esperando o agente fazer
            <span className="rounded-full bg-info/15 px-2 py-0.5 text-[10px] normal-case">
              {pendentes.length}
            </span>
          </p>
          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {pendentes.map((o: any) => {
              const dias = diasParada(o.decided_at);
              return (
                <div key={o.id} className="rounded-lg border border-border bg-card px-2.5 py-1.5">
                  <p className="text-[12px] text-foreground">{o.o_que}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                    <span className="font-medium text-foreground/80">{o.agente}</span>
                    <span>· {String(o.action_kind).replace(/_/g, " ")}</span>
                    {o.destino && <span>· para {o.destino}</span>}
                    <span className={cn(
                      "inline-flex items-center gap-1",
                      // Três dias parada é o ponto em que "vai sair" deixa de
                      // ser verdade sozinho e vira uma pergunta.
                      dias >= 3 && "font-semibold text-warning",
                    )}>
                      <Clock className="h-2.5 w-2.5" />
                      autorizado há {dias === 0 ? "menos de um dia" : `${dias} dia${dias > 1 ? "s" : ""}`}
                    </span>
                  </p>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
            Você liberou; o agente ainda não executou. Autorizar não é o mesmo que
            estar feito, e sem esta lista as duas coisas pareceriam iguais.
          </p>
        </div>
      )}

      {cumpridas.length > 0 && (
        <div className="rounded-xl border border-success/30 bg-success/[0.04] p-3.5">
          <p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> Feito no mundo, com prova
          </p>
          <div className="space-y-1.5">
            {cumpridas.map((o: any) => (
              <div key={o.id} className="rounded-lg border border-border bg-card px-2.5 py-1.5">
                <p className="text-[12px] text-foreground">{o.o_que}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {o.agente} · {quando(o.executed_at)}
                </p>
                {o.execution_evidence && (
                  /* A prova é o ponto: ação externa não pode ser afirmada sem
                     ela, porque ninguém consegue desfazer depois. */
                  <p className="mt-0.5 break-all text-[10.5px]">
                    {/^https?:\/\//i.test(o.execution_evidence) ? (
                      <a
                        href={o.execution_evidence}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary underline"
                      >
                        <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                        {o.execution_evidence}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">{o.execution_evidence}</span>
                    )}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
