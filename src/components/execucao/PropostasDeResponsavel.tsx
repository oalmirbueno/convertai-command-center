import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Ban, CheckCircle2, ChevronDown, HelpCircle, Loader2, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { buscarTodas } from "@/lib/buscaCompleta";

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
      // Todas as pendentes, sem teto escondido: com 30 de 300 na tela, o
      // dono decidia a vida inteira e a fila nunca zerava.
      const { linhas } = await buscarTodas<Proposta>((de, ate) =>
        (supabase as any)
          .from("assignment_proposals")
          .select("*")
          .eq("status", "pendente")
          .order("created_at", { ascending: false })
          .range(de, ate),
      );
      return linhas;
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

  // Titulo, cliente e prazo de cada tarefa proposta: a pagina so conhece as
  // tarefas que ja tem vinculo, e proposta sem nome nao decide nada.
  const idsDeTarefas = [...new Set(propostas.map((p) => p.kanban_task_id).filter(Boolean))];
  const { data: tarefasDasPropostas = new Map<string, { titulo: string; cliente: string | null; prazo: string | null }>() } = useQuery({
    queryKey: ["propostas-tarefas", idsDeTarefas.join(",")],
    queryFn: async () => {
      const m = new Map<string, { titulo: string; cliente: string | null; prazo: string | null }>();
      for (let i = 0; i < idsDeTarefas.length; i += 100) {
        const { data } = await (supabase as any)
          .from("tasks")
          .select("id, title, due_date, project:projects!tasks_project_id_fkey(name, client:profiles!projects_client_id_fkey(full_name, company_name))")
          .in("id", idsDeTarefas.slice(i, i + 100));
        for (const t of data || []) {
          const c = t.project?.client;
          m.set(String(t.id), { titulo: String(t.title || ""), cliente: c ? (c.company_name || c.full_name) : null, prazo: t.due_date ?? null });
        }
      }
      return m;
    },
    enabled: idsDeTarefas.length > 0,
  });
  const tituloDe = (id: string) => tarefasDasPropostas.get(id)?.titulo || titulosDeTarefas.get(id) || "a tarefa";

  // Agrupadas por pessoa sugerida: 126 propostas para a mesma pessoa se
  // decidem em um clique, nao em 126.
  const grupos = useMemo(() => {
    const m = new Map<string, Proposta[]>();
    for (const p of propostas) m.set(p.suggested_assignee, [...(m.get(p.suggested_assignee) ?? []), p]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [propostas]);
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [lote, setLote] = useState<string | null>(null);

  const decidirLote = async (ids: string[], decisao: "aprovada" | "rejeitada", rotulo: string) => {
    if (ids.length === 0 || lote) return;
    if (!window.confirm(`${decisao === "aprovada" ? "Aprovar e designar" : "Rejeitar"} ${ids.length} proposta${ids.length === 1 ? "" : "s"} para ${rotulo}?`)) return;
    setLote(rotulo);
    try {
      const { data, error } = await (supabase as any).rpc("assignment_proposal_decidir_lote", { _proposal_ids: ids, _decisao: decisao, _nota: null });
      if (error) throw new Error(error.message);
      const r = (data ?? {}) as { decididas?: number; erros?: unknown[] };
      queryClient.invalidateQueries({ queryKey: ["propostas-responsavel"] });
      queryClient.invalidateQueries({ queryKey: ["operador-tarefas"] });
      queryClient.invalidateQueries({ queryKey: ["operador-tarefas-disponiveis"] });
      const erros = Array.isArray(r.erros) ? r.erros.length : 0;
      if (erros > 0) toast.warning(`${r.decididas ?? 0} decidida${(r.decididas ?? 0) === 1 ? "" : "s"}, ${erros} com erro (ficaram pendentes).`);
      else toast.success(`${r.decididas ?? 0} proposta${(r.decididas ?? 0) === 1 ? "" : "s"} ${decisao === "aprovada" ? "aprovada(s) e designada(s)" : "rejeitada(s)"}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setLote(null); }
  };

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
      {grupos.map(([pessoaId, lista]) => {
        const nomePessoa = nomesDePessoas.get(pessoaId) || "pessoa";
        const aberto = abertos[pessoaId] ?? (grupos.length === 1 || lista.some((p) => p.id === destaqueId));
        const visiveis = aberto ? lista : [];
        return (
          <div key={pessoaId} className="rounded-xl border border-border bg-secondary/30 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setAbertos((s) => ({ ...s, [pessoaId]: !aberto }))} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
                <ChevronDown className={cn("h-4 w-4 transition-transform", aberto ? "rotate-180" : "")} />
                {nomePessoa} · {lista.length} proposta{lista.length === 1 ? "" : "s"}
              </button>
              <span className="ml-auto flex flex-wrap gap-1.5">
                <button type="button" disabled={lote !== null} onClick={() => void decidirLote(lista.map((p) => p.id), "aprovada", nomePessoa)} className="inline-flex h-7 items-center gap-1 rounded-lg bg-success px-2.5 text-[11px] font-semibold text-white disabled:opacity-50">
                  {lote === nomePessoa ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Aprovar todas
                </button>
                <button type="button" disabled={lote !== null} onClick={() => void decidirLote(lista.map((p) => p.id), "rejeitada", nomePessoa)} className="inline-flex h-7 items-center gap-1 rounded-lg border border-destructive/50 px-2.5 text-[11px] font-semibold text-destructive disabled:opacity-50">
                  <Ban className="h-3 w-3" /> Rejeitar todas
                </button>
              </span>
            </div>
            {!aberto && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {lista.slice(0, 3).map((p) => tituloDe(p.kanban_task_id)).join(" · ")}{lista.length > 3 ? ` · +${lista.length - 3}` : ""}
              </p>
            )}
            <div className={cn("space-y-2", aberto ? "mt-2" : "")}>
      {visiveis.map((p) => {
        const destacada = p.id === destaqueId;
        const tarefa = tarefasDasPropostas.get(p.kanban_task_id);
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
              <strong>{tituloDe(p.kanban_task_id)}</strong>
              {tarefa?.cliente ? <span className="text-muted-foreground"> · {tarefa.cliente}</span> : null}
              {tarefa?.prazo ? <span className="text-muted-foreground"> · prazo {tarefa.prazo.slice(8, 10)}/{tarefa.prazo.slice(5, 7)}</span> : null}
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
          </div>
        );
      })}
    </div>
  );
}
