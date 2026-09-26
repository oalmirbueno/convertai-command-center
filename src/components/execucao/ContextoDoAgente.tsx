import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { precisaDecisao } from "@/lib/precisaDecisao";
import {
  Ban, Bot, CheckCircle2, Clock, ExternalLink, FileText, Loader2,
  PauseCircle, ShieldAlert, UserPlus, XCircle,
} from "lucide-react";
import { Carregando, botao, etiqueta, juntar, superficie, texto } from "@/components/sistema";

/**
 * Quem está trabalhando nesta tarefa, por quê, e o que já entregou.
 *
 * A queixa que originou isto: "vejo eles trabalhando mas não sei direito
 * o que é pra quem". O card do Kanban mostrava título, prazo e
 * responsável — e nada sobre o agente que estava mexendo nele. O trabalho
 * acontecia num lugar e o registro em outro.
 *
 * Aqui as duas pontas se encontram: o agente, o motivo, a linha do tempo
 * do que ele fez, e a entrega com o link clicável e a imagem de prova
 * quando existe. Nada de raciocínio interno — só o que dá para conferir.
 */

const ROTULO_ESTADO: Record<string, string> = {
  queued: "na fila",
  in_progress: "trabalhando agora",
  done: "entregue",
  review: "esperando sua revisão",
  awaiting_input: "esperando algo de você",
  blocked: "travado",
};

const TOM_ESTADO: Record<string, string> = {
  queued: "bg-secondary text-muted-foreground",
  in_progress: "bg-info/15 text-info",
  done: "bg-success/15 text-success",
  review: "bg-warning/15 text-warning",
  awaiting_input: "bg-warning/15 text-warning",
  blocked: "bg-destructive/15 text-destructive",
};

const ICONE_ESTADO: Record<string, typeof Bot> = {
  in_progress: Loader2,
  done: CheckCircle2,
  review: Clock,
  awaiting_input: PauseCircle,
  blocked: XCircle,
};

const quando = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }) : "";

const ehImagem = (url: string) => /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(url);
const ehLink = (t?: string | null) => Boolean(t && /^https?:\/\//i.test(t.trim()));

export default function ContextoDoAgente({ taskId }: { taskId: string }) {
  const qc = useQueryClient();

  /*
   * A proposta de responsável, decidida AQUI.
   *
   * Ela já existia, mas morava no painel de aprovações — longe do card
   * onde a pergunta nasce. Quem está olhando a tarefa é quem sabe de quem
   * ela é; obrigar a trocar de tela para responder isso é o que faz a
   * sugestão do agente envelhecer sem resposta.
   */
  const { data: propostas = [] } = useQuery({
    queryKey: ["proposta-da-tarefa", taskId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("assignment_proposals")
        .select("id, suggested_assignee, justificativa, confianca, operator_id, created_at")
        .eq("kanban_task_id", taskId)
        .eq("status", "pendente");
      if (error) throw new Error(error.message);
      const linhas = (data || []) as Array<Record<string, any>>;
      if (linhas.length === 0) return [];
      const { data: perfis } = await (supabase as any)
        .from("profiles").select("id, full_name")
        .in("id", linhas.map((l) => l.suggested_assignee));
      const nome = new Map(((perfis || []) as any[]).map((p) => [p.id, p.full_name]));
      return linhas.map((l) => ({ ...l, nome_sugerido: nome.get(l.suggested_assignee) || "pessoa" }));
    },
    enabled: Boolean(taskId),
  });

  const decidir = useMutation({
    mutationFn: async ({ id, decisao }: { id: string; decisao: string }) => {
      const { error } = await (supabase as any).rpc("assignment_proposal_decidir", {
        _proposal_id: id, _decisao: decisao, _nota: null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      for (const k of [["proposta-da-tarefa", taskId], ["contexto-do-agente", taskId],
                       ["propostas-responsavel"], ["tasks"], ["operador-tarefas"]]) {
        qc.invalidateQueries({ queryKey: k as any });
      }
      toast.success(vars.decisao === "aprovada"
        ? "Responsável definido e a pessoa foi avisada"
        : "Sugestão recusada. Nada mudou na tarefa.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["contexto-do-agente", taskId],
    queryFn: async () => {
      const { data: vinculos, error: erroVinculos } = await (supabase as any)
        .from("operator_task_links")
        .select("*")
        .or(`kanban_task_id.eq.${taskId},painel_task_id.eq.${taskId}`)
        .order("updated_at", { ascending: false });
      // Erro não pode virar "nenhum agente trabalhou nisto": são coisas
      // opostas, e a segunda é uma afirmação forte.
      if (erroVinculos) throw new Error(erroVinculos.message);
      const links = (vinculos || []) as Array<Record<string, any>>;
      if (links.length === 0) {
        return {
          links: [] as Array<Record<string, any>>,
          operadores: new Map<string, any>(),
          trilha: [] as Array<Record<string, any>>,
          diario: [] as Array<Record<string, any>>,
          memoria: [] as Array<Record<string, any>>,
        };
      }

      const ids = links.map((l) => l.id);
      const opIds = [...new Set(links.map((l) => l.operator_id))];

      const [ops, trilha, diario, memoria] = await Promise.all([
        (supabase as any).from("internal_operators")
          .select("id, slug, display_name, role, area, status").in("id", opIds),
        (supabase as any).from("operator_audit_log")
          .select("id, occurred_at, actor, action, old_status, new_status, evidence")
          .eq("kanban_task_id", taskId)
          .order("occurred_at", { ascending: false }).limit(40),
        (supabase as any).from("operator_participations")
          .select("id, entry_type, title, body, author_kind, created_at")
          .in("task_link_id", ids)
          .order("created_at", { ascending: false }).limit(20),
        // O que ficou registrado no histórico do cliente. Existe desde
        // sempre e ninguém via: uma entrega que não aparece em lugar
        // nenhum é indistinguível de uma que não aconteceu.
        (supabase as any).from("project_memory")
          .select("id, kind, title, content, created_at, metadata")
          .eq("source", "operador")
          .contains("metadata", { kanban_task_id: taskId })
          .order("created_at", { ascending: false }).limit(10),
      ]);

      return {
        links,
        operadores: new Map(((ops.data || []) as any[]).map((o) => [o.id, o])),
        trilha: (trilha.data || []) as Array<Record<string, any>>,
        diario: (diario.data || []) as Array<Record<string, any>>,
        memoria: (memoria.data || []) as Array<Record<string, any>>,
      };
    },
    enabled: Boolean(taskId),
    refetchInterval: 30_000,
  });

  const temTrabalho = useMemo(() => (data?.links?.length ?? 0) > 0, [data]);

  if (error) {
    return (
      <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[12px] leading-5 text-destructive">
        Não consegui ler o trabalho dos agentes nesta tarefa:{" "}
        {error instanceof Error ? error.message : String(error)}.
        Isso <strong>não</strong> quer dizer que nenhum agente trabalhou nela.
      </div>
    );
  }
  if (isLoading) {
    return <Carregando linhas={2} rotulo="Carregando o contexto do agente" />;
  }
  // A proposta pode existir SEM vínculo: o agente pode sugerir um dono
  // para uma tarefa que ele nem pegou. Sumir com ela aqui esconderia
  // justamente a pergunta que espera resposta.
  if ((!data || !temTrabalho) && propostas.length === 0) return null;

  return (
    <div className="min-w-0 space-y-4">
      {/* A sugestão do agente, respondível em um clique. */}
      {propostas.map((p: any) => (
        <div key={p.id} className="rounded-md bg-info/10 px-3 py-3">
          <p className="inline-flex items-center text-[12px] font-medium text-info">
            <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> O agente sugere um responsável
          </p>
          <p className="mt-1.5 text-[13px] text-foreground">
            <strong>{p.nome_sugerido}</strong> deveria responder por esta tarefa
            {typeof p.confianca === "number" && (
              <span className="text-muted-foreground"> · confiança {(p.confianca * 100).toFixed(0)}%</span>
            )}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground/85">
            {p.justificativa}
          </p>
          <div className="mt-2.5">
            <div className="-m-1 flex flex-wrap [&>*]:m-1">
              <button
                type="button"
                disabled={decidir.isPending}
                onClick={() => decidir.mutate({ id: p.id, decisao: "aprovada" })}
                className={juntar(botao.primario, "h-8 px-3 text-[12px]")}
              >
                {decidir.isPending ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="mr-1.5 h-3 w-3" aria-hidden="true" />}
                Aprovar e designar
              </button>
              <button
                type="button"
                disabled={decidir.isPending}
                onClick={() => decidir.mutate({ id: p.id, decisao: "rejeitada" })}
                className={juntar(botao.perigo, "h-8 px-3 text-[12px]")}
              >
                <Ban className="mr-1.5 h-3 w-3" aria-hidden="true" /> Recusar
              </button>
            </div>
          </div>
        </div>
      ))}

      {(data?.links?.length ?? 0) > 0 && (
        <ul className="divide-y divide-border">
          {(data?.links ?? []).map((l: any) => {
            const op = data?.operadores?.get(l.operator_id);
            const Icone = ICONE_ESTADO[l.status] || Bot;
            return (
              <li key={l.id} className="min-w-0 py-3 first:pt-0 last:pb-0">
                {/* Quem, de qual área, e em que pé está. */}
                <div className="flex min-w-0 items-center">
                  <span className="mr-2.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Bot className="h-4 w-4 text-primary" aria-hidden="true" />
                  </span>
                  <div className="mr-2 min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-foreground">
                      {op?.display_name || "operador"}
                    </p>
                    <p className="truncate text-[12px] text-muted-foreground">
                      {[op?.role, op?.area].filter(Boolean).join(" · ") || "agente do Hermes"}
                    </p>
                  </div>
                  <span className={juntar(
                    etiqueta,
                    "h-6 px-2",
                    TOM_ESTADO[l.status] || "bg-secondary text-muted-foreground",
                  )}>
                    <Icone className={juntar("mr-1 h-3 w-3", l.status === "in_progress" && "animate-spin")} aria-hidden="true" />
                    {ROTULO_ESTADO[l.status] || l.status}
                  </span>
                </div>

                {/* O PORQUÊ e o que vem depois: sem isso o card diz que algo
                    aconteceu, mas não o que fazer com isso. */}
                <div className="mt-2 space-y-1.5">
                  {l.last_action && (
                    <p className="text-[12.5px] leading-relaxed text-foreground/90">{l.last_action}</p>
                  )}
                  {l.next_step && (
                    <p className="text-[12px] text-muted-foreground">
                      <span className="font-medium">próximo passo: </span>
                      {l.next_step}
                    </p>
                  )}
                  {l.block_reason && (
                    <p className="text-[12px] text-destructive">
                      <span className="font-medium">travado: </span>{l.block_reason}
                    </p>
                  )}
                  {precisaDecisao(l) && (
                    <p className={juntar(etiqueta, "bg-warning/15 text-warning")}>
                      <ShieldAlert className="mr-1 h-3 w-3" aria-hidden="true" /> precisa da sua aprovação
                    </p>
                  )}
                </div>

                {/* A ENTREGA: link clicável e, se for imagem, a prova visível.
                    Uma URL em texto obriga a copiar e colar para conferir. */}
                {l.last_evidence && (
                  <div className={juntar(superficie.poco, "mt-2.5 p-2.5")}>
                    <p className="mb-1 inline-flex items-center text-[12px] font-medium text-success">
                      <FileText className="mr-1 h-3 w-3" aria-hidden="true" /> Entrega
                    </p>
                    {ehLink(l.last_evidence) ? (
                      <>
                        <a
                          href={String(l.last_evidence).trim()}
                          target="_blank" rel="noopener noreferrer"
                          className="block break-all text-[12px] text-primary underline"
                        >
                          {String(l.last_evidence).trim()}
                          <ExternalLink className="ml-1 inline h-3 w-3 align-[-2px]" aria-hidden="true" />
                        </a>
                        {ehImagem(String(l.last_evidence)) && (
                          <img
                            src={String(l.last_evidence).trim()}
                            alt="Comprovação da entrega"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="mt-2 max-h-56 w-auto rounded-md border border-border"
                          />
                        )}
                      </>
                    ) : (
                      <p className="break-words text-[12px] text-foreground/90">{l.last_evidence}</p>
                    )}
                  </div>
                )}

                <p className={juntar(texto.auxiliar, "mt-2")}>
                  começou {quando(l.created_at)} · última atualização {quando(l.updated_at)}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {/* O QUE FOI PARA O HISTÓRICO DO CLIENTE.
          A entrega já era gravada aqui, e ninguém via: registro invisível
          é indistinguível de registro inexistente. */}
      {(data?.memoria?.length ?? 0) > 0 && (
        <section className="border-t border-border pt-3">
          <h4 className="mb-1.5 inline-flex items-center text-[13px] font-semibold text-foreground">
            <FileText className="mr-1.5 h-3.5 w-3.5 text-info" aria-hidden="true" /> Registrado no histórico do cliente
            <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{data?.memoria?.length ?? 0}</span>
          </h4>
          <ul className="divide-y divide-border">
            {(data?.memoria ?? []).map((m: any) => (
              <li key={m.id} className="min-w-0 py-2">
                <p className={texto.auxiliar}>
                  {m.kind} · {quando(m.created_at)}
                </p>
                <p className="text-[12.5px] font-semibold text-foreground">{m.title}</p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px] text-foreground/85">
                  {m.content}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* O que você escreveu, junto do que o agente respondeu. */}
      {(data?.diario?.length ?? 0) > 0 && (
        <section className="border-t border-border pt-3">
          <h4 className="mb-1.5 text-[13px] font-semibold text-foreground">
            Conversa desta tarefa
            <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{data?.diario?.length ?? 0}</span>
          </h4>
          <div className="space-y-1.5">
            {(data?.diario ?? []).map((d: any) => (
              <div key={d.id} className={juntar(
                "rounded-md px-2.5 py-1.5",
                d.author_kind === "humano" ? "bg-primary/10" : "bg-muted/50",
              )}>
                <p className={texto.auxiliar}>
                  {d.author_kind === "humano" ? "você" : "o agente"} ·{" "}
                  {String(d.entry_type).replace(/_/g, " ")} · {quando(d.created_at)}
                </p>
                {d.title && <p className="text-[12.5px] font-semibold text-foreground">{d.title}</p>}
                <p className="whitespace-pre-wrap break-words text-[12.5px] text-foreground/90">{d.body}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* O histórico completo, recolhido: quem quer auditar abre. */}
      {(data?.trilha?.length ?? 0) > 0 && (
        <details className="border-t border-border pt-3">
          <summary className="cursor-pointer text-[13px] font-semibold text-foreground">
            Histórico completo
            <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{data?.trilha?.length ?? 0}</span>
          </summary>
          <ul className="mt-2 divide-y divide-border">
            {(data?.trilha ?? []).map((e: any) => (
              <li key={e.id} className="-mx-1 flex flex-wrap items-baseline py-1.5 [&>*]:mx-1">
                <span className="text-[11.5px] tabular-nums text-muted-foreground">{quando(e.occurred_at)}</span>
                <span className="text-[12px] text-foreground/90">{e.action}</span>
                {e.old_status && e.new_status && (
                  <span className="text-[11.5px] text-muted-foreground">
                    {e.old_status} → {e.new_status}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
