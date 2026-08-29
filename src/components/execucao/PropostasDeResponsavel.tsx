import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Ban, CheckCircle2, HelpCircle, Loader2, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Propostas de responsável: o agente sugere, o humano decide.
 *
 * O `assigned_to` é território de gente — o agente nunca escreve nele.
 * O que ele pode é perceber que a tarefa está órfã e propor um dono, com
 * justificativa e confiança. A ÚNICA escrita no responsável acontece no
 * RPC de decisão, atrás do clique de um admin — e a trilha registra o
 * antes e o depois.
 */

type Proposta = {
  id: string;
  kanban_task_id: string;
  current_assignee: string | null;
  suggested_assignee: string;
  operator_id: string;
  justificativa: string;
  confianca: number | null;
  prazo: string | null;
  impacto: string | null;
  status: string;
  created_at: string;
};

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function PropostasDeResponsavel({
  nomesDeAgentes,
  titulosDeTarefas,
  destaqueId,
}: {
  nomesDeAgentes: Map<string, string>;
  titulosDeTarefas: Map<string, string>;
  destaqueId: string | null;
}) {
  const queryClient = useQueryClient();
  const [notaPor, setNotaPor] = useState<Record<string, string>>({});

  const { data: propostas = [], error } = useQuery({
    queryKey: ["propostas-responsavel"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("assignment_proposals")
        .select("*")
        .eq("status", "pendente")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw new Error(error.message);
      return (data || []) as Proposta[];
    },
    refetchInterval: 30_000,
  });

  // Os nomes das pessoas resolvidos AQUI: o sugerido pode nao aparecer em
  // nenhuma outra lista da pagina, e proposta exibindo UUID nao decide nada.
  const idsDePessoas = [...new Set(
    propostas.flatMap((p) => [p.suggested_assignee, p.current_assignee]).filter(Boolean),
  )] as string[];
  const { data: nomesDePessoas = new Map<string, string>() } = useQuery({
    queryKey: ["propostas-pessoas", idsDePessoas.join(",")],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("profiles").select("id, full_name").in("id", idsDePessoas);
      if (error) throw new Error(error.message);
      const m = new Map<string, string>();
      for (const p of data || []) m.set(String(p.id), p.full_name || "pessoa");
      return m;
    },
    enabled: idsDePessoas.length > 0,
  });

  const decidir = useMutation({
    mutationFn: async ({ id, decisao }: { id: string; decisao: string }) => {
      const { error } = await (supabase as any).rpc("assignment_proposal_decidir", {
        _proposal_id: id,
        _decisao: decisao,
        _nota: notaPor[id]?.trim() || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["propostas-responsavel"] });
      queryClient.invalidateQueries({ queryKey: ["operador-tarefas"] });
      queryClient.invalidateQueries({ queryKey: ["operador-tarefas-disponiveis"] });
      toast.success(
        vars.decisao === "aprovada"
          ? "Aprovada: o responsável foi atualizado e a pessoa foi avisada."
          : vars.decisao === "rejeitada"
            ? "Rejeitada. Nada mudou na tarefa."
            : "Pedido de esclarecimento registrado.",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  if (error) {
    return (
      <p className="rounded-xl border border-destructive/30 bg-secondary p-3 text-[11.5px] text-destructive">
        Não consegui ler as propostas de responsável: {error instanceof Error ? error.message : String(error)}.
      </p>
    );
  }
  if (propostas.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        Responsáveis sugeridos · {propostas.length}
      </p>
      {propostas.map((p) => {
        const destacada = p.id === destaqueId;
        return (
          <div
            key={p.id}
            className={cn(
              "rounded-xl border bg-card p-3.5",
              destacada ? "border-primary ring-2 ring-primary/40" : "border-border",
            )}
          >
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-info/15 px-2 py-0.5 text-[10.5px] font-bold text-info">
                <UserPlus className="h-3 w-3" /> responsável sugerido
              </span>
              <span className="text-muted-foreground">
                por <strong className="text-foreground/90">{nomesDeAgentes.get(p.operator_id) || "operador"}</strong>
                {" · "}{quando(p.created_at)}
              </span>
              {typeof p.confianca === "number" && (
                <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                  confiança {(p.confianca * 100).toFixed(0)}%
                </span>
              )}
            </div>

            <p className="mt-2 text-[12.5px] text-foreground">
              <strong>{nomesDePessoas.get(p.suggested_assignee) || "pessoa"}</strong>
              {" para "}
              <strong>{titulosDeTarefas.get(p.kanban_task_id) || "a tarefa"}</strong>
              {p.current_assignee
                ? <span className="text-muted-foreground"> (hoje com {nomesDePessoas.get(p.current_assignee) || "outra pessoa"})</span>
                : <span className="text-muted-foreground"> (hoje sem responsável)</span>}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-foreground/85">{p.justificativa}</p>
            {p.impacto && (
              <p className="mt-1 text-[11px] text-muted-foreground">se ninguém assumir: {p.impacto}</p>
            )}
            {p.prazo && <p className="mt-0.5 text-[11px] text-muted-foreground">prazo relevante: {p.prazo}</p>}

            <input
              value={notaPor[p.id] || ""}
              onChange={(e) => setNotaPor((s) => ({ ...s, [p.id]: e.target.value }))}
              placeholder="Nota (opcional)"
              className="mt-2 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11.5px] text-foreground placeholder:text-muted-foreground/60"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={decidir.isPending}
                onClick={() => decidir.mutate({ id: p.id, decisao: "aprovada" })}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-success px-3 text-[11.5px] font-semibold text-white disabled:opacity-50"
              >
                {decidir.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Aprovar e designar
              </button>
              <button
                type="button"
                disabled={decidir.isPending}
                onClick={() => decidir.mutate({ id: p.id, decisao: "rejeitada" })}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-destructive/50 px-3 text-[11.5px] font-semibold text-destructive disabled:opacity-50"
              >
                <Ban className="h-3.5 w-3.5" /> Rejeitar
              </button>
              <button
                type="button"
                disabled={decidir.isPending}
                onClick={() => decidir.mutate({ id: p.id, decisao: "esclarecimento" })}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <HelpCircle className="h-3.5 w-3.5" /> Pedir esclarecimento
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
