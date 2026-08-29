import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle, Ban, CheckCircle2, ChevronDown, Clock, HandCoins,
  Loader2, PencilLine, ShieldAlert, Timer, UserCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A aprovação explicada: o selo genérico vira um dossiê de decisão.
 *
 * "Aprovação necessária" sem contexto obriga o dono a caçar em três
 * lugares o que exatamente vai acontecer se ele disser sim. Aqui cada
 * pedido chega com o QUE, o PORQUÊ, os dados, o destino, o risco, o
 * custo e o payload congelado — e os botões decidem chamando um RPC que
 * audita e trava a redecisão.
 *
 * A regra de ouro está no banco, não na tela: o payload é imutável por
 * trigger, e o que for executado depois do sim tem que ser exatamente o
 * que está aqui. Mudou o plano? Nasce outra versão.
 */

type Aprovacao = {
  id: string;
  operator_id: string;
  task_link_id: string | null;
  kanban_task_id: string | null;
  action_kind: string;
  o_que: string;
  por_que: string;
  dados_usados: string | null;
  destino: string | null;
  impacto: string | null;
  risco: string | null;
  custo_previsto: number | null;
  prazo: string | null;
  reversivel: boolean;
  payload: Record<string, unknown>;
  payload_version: number;
  evidencia: string | null;
  status: string;
  valid_until: string | null;
  decision_note: string | null;
  created_at: string;
};

const ROTULO_ACAO: Record<string, string> = {
  publicar: "Publicar",
  agendar: "Agendar",
  enviar_mensagem: "Enviar mensagem",
  contatar_cliente: "Contatar cliente",
  criar_proposta: "Criar proposta",
  enviar_contrato: "Enviar contrato",
  ativar_campanha: "Ativar campanha",
  alterar_orcamento: "Alterar orçamento",
  gastar: "Gastar",
  alterar_financeiro: "Alterar financeiro",
  alterar_permissoes: "Alterar permissões",
  exportar_dados: "Exportar dados",
  excluir_dados: "Excluir dados",
  mudar_estrategia: "Mudar estratégia",
  alterar_responsavel: "Alterar responsável",
  promover_autonomia: "Promover autonomia",
};

const quando = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

/** Um campo do dossiê; só aparece se tiver conteúdo — linha vazia é ruído. */
function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="text-[11px]">
      <span className="font-semibold uppercase tracking-wide text-muted-foreground">{rotulo}: </span>
      <span className="text-foreground/90">{children}</span>
    </div>
  );
}

export default function AprovacoesExplicadas({
  nomesDeAgentes,
  titulosDeTarefas,
  destaqueId,
  aoAbrirDiario,
}: {
  nomesDeAgentes: Map<string, string>;
  titulosDeTarefas: Map<string, string>;
  destaqueId: string | null;
  aoAbrirDiario: (linkId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [notaPor, setNotaPor] = useState<Record<string, string>>({});
  const [payloadAberto, setPayloadAberto] = useState<Record<string, boolean>>({});

  const { data: aprovacoes = [], error, isLoading } = useQuery({
    queryKey: ["aprovacoes-explicadas"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operator_approvals")
        .select("*")
        .in("status", ["pendente", "adiado"])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data || []) as Aprovacao[];
    },
    refetchInterval: 30_000,
  });

  const decidir = useMutation({
    mutationFn: async ({ id, decisao }: { id: string; decisao: string }) => {
      const { data, error } = await (supabase as any).rpc("operator_approval_decidir", {
        _approval_id: id,
        _decisao: decisao,
        _nota: notaPor[id]?.trim() || null,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["aprovacoes-explicadas"] });
      queryClient.invalidateQueries({ queryKey: ["operador-vinculos"] });
      toast.success(
        vars.decisao === "aprovado"
          ? "Aprovado. O agente só pode executar exatamente este payload."
          : vars.decisao === "rejeitado"
            ? "Rejeitado. O agente não executa e fica registrado o porquê."
            : vars.decisao === "alteracoes_pedidas"
              ? "Alterações pedidas. O agente cria uma nova versão do pedido."
              : "Adiado. Volta à fila até você decidir.",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  if (error) {
    // Falha de leitura NÃO é fila vazia: fila vazia diz "nada esperando
    // você", e isso seria mentira aqui.
    return (
      <p className="rounded-xl border border-destructive/30 bg-secondary p-3 text-[11.5px] text-destructive">
        Não consegui ler as aprovações: {error instanceof Error ? error.message : String(error)}.
        A lista NÃO está vazia — está ilegível.
      </p>
    );
  }
  if (isLoading) {
    return <p className="py-4 text-center text-[11px] text-muted-foreground">carregando aprovações…</p>;
  }
  if (aprovacoes.length === 0) return null;

  return (
    <div className="space-y-2.5">
      {aprovacoes.map((a) => {
        const destacada = a.id === destaqueId;
        const temPayload = a.payload && Object.keys(a.payload).length > 0;
        return (
          <div
            key={a.id}
            className={cn(
              "rounded-xl border bg-card p-3.5",
              destacada ? "border-primary ring-2 ring-primary/40" : "border-warning/40",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2 py-0.5 text-[10.5px] font-bold text-warning">
                <ShieldAlert className="h-3 w-3" />
                {ROTULO_ACAO[a.action_kind] || a.action_kind} · v{a.payload_version}
              </span>
              <span className="text-[11px] text-muted-foreground">
                pedido por <strong className="text-foreground/90">{nomesDeAgentes.get(a.operator_id) || "operador"}</strong>
                {" · "}{quando(a.created_at)}
              </span>
              {a.status === "adiado" && (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">adiada</span>
              )}
              {!a.reversivel && (
                <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-bold text-destructive">
                  <AlertTriangle className="h-3 w-3" /> irreversível
                </span>
              )}
            </div>

            <p className="mt-2 text-[13px] font-semibold leading-snug text-foreground">{a.o_que}</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-foreground/85">{a.por_que}</p>

            <div className="mt-2 space-y-1 rounded-lg bg-secondary/60 p-2.5">
              <Campo rotulo="Tarefa">{a.kanban_task_id ? titulosDeTarefas.get(a.kanban_task_id) : null}</Campo>
              <Campo rotulo="Dados usados">{a.dados_usados}</Campo>
              <Campo rotulo="Para onde vai">{a.destino}</Campo>
              <Campo rotulo="Impacto">{a.impacto}</Campo>
              <Campo rotulo="Risco">{a.risco}</Campo>
              <Campo rotulo="Evidência">
                {a.evidencia
                  ? (/^https?:\/\//.test(a.evidencia)
                    ? <a className="text-primary underline" href={a.evidencia} target="_blank" rel="noopener noreferrer">{a.evidencia}</a>
                    : a.evidencia)
                  : null}
              </Campo>
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
                {typeof a.custo_previsto === "number" && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-foreground">
                    <HandCoins className="h-3 w-3 text-warning" />
                    {a.custo_previsto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  </span>
                )}
                {a.prazo && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" /> prazo {a.prazo}
                  </span>
                )}
                {a.valid_until && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Timer className="h-3 w-3" /> válida até {quando(a.valid_until)}
                  </span>
                )}
              </div>
            </div>

            {temPayload && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setPayloadAberto((s) => ({ ...s, [a.id]: !s[a.id] }))}
                  className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown className={cn("h-3 w-3 transition-transform", payloadAberto[a.id] && "rotate-180")} />
                  payload exato da ação (o que será executado se você aprovar)
                </button>
                {payloadAberto[a.id] && (
                  <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-secondary p-2 text-[10px] leading-relaxed text-foreground/90">
                    {JSON.stringify(a.payload, null, 2)}
                  </pre>
                )}
              </div>
            )}

            <input
              value={notaPor[a.id] || ""}
              onChange={(e) => setNotaPor((s) => ({ ...s, [a.id]: e.target.value }))}
              placeholder="Nota da decisão (opcional; obrigatória em pedido de alterações)"
              className="mt-2.5 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11.5px] text-foreground placeholder:text-muted-foreground/60"
            />

            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={decidir.isPending}
                onClick={() => decidir.mutate({ id: a.id, decisao: "aprovado" })}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-success px-3 text-[11.5px] font-semibold text-white disabled:opacity-50"
              >
                {decidir.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Aprovar
              </button>
              <button
                type="button"
                disabled={decidir.isPending}
                onClick={() => decidir.mutate({ id: a.id, decisao: "rejeitado" })}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-destructive/50 px-3 text-[11.5px] font-semibold text-destructive disabled:opacity-50"
              >
                <Ban className="h-3.5 w-3.5" /> Rejeitar
              </button>
              <button
                type="button"
                disabled={decidir.isPending}
                onClick={() => {
                  if (!notaPor[a.id]?.trim()) {
                    toast.error("Diga O QUE alterar na nota — pedido de alterações sem direção só devolve o problema.");
                    return;
                  }
                  decidir.mutate({ id: a.id, decisao: "alteracoes_pedidas" });
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <PencilLine className="h-3.5 w-3.5" /> Pedir alterações
              </button>
              {a.status !== "adiado" && (
                <button
                  type="button"
                  disabled={decidir.isPending}
                  onClick={() => decidir.mutate({ id: a.id, decisao: "adiado" })}
                  className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  Adiar
                </button>
              )}
              {a.task_link_id && (
                <button
                  type="button"
                  onClick={() => aoAbrirDiario(a.task_link_id!)}
                  className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground"
                >
                  <UserCheck className="h-3.5 w-3.5" /> Responder no diário
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
