import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, ClipboardCopy, History, Lightbulb, ListChecks, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Entrar no agente: tudo o que ele fez, como está indo e o que melhorar.
 *
 * O "o que melhorar" não é opinião: cada sinal sai de um número que o
 * próprio quadro já tem (conclusão sem evidência, execuções que expiraram,
 * tarefas paradas, bloqueio sem próximo passo). Conselho sem número vira
 * horóscopo, e o agente não teria como agir sobre ele.
 *
 * O texto de acionamento também sai daqui pronto para colar no grupo, com
 * os números reais do agente — é o que faz o Hermes entender o estado sem
 * ninguém redigitar contexto.
 */

type Operador = {
  id: string;
  slug: string;
  display_name: string;
  role: string;
  scope: string;
  status: string;
  is_coordinator: boolean;
  last_run_at: string | null;
};

/* A ordem em que os estados pedem atenção: o que trava vem primeiro, o
   que já terminou por último. Lista ordenada por data deixaria o bloqueio
   no meio do monte. */
const ORDEM_DO_ESTADO = [
  "blocked", "awaiting_input", "review", "in_progress", "queued", "done",
];

const TOM_DO_ESTADO: Record<string, string> = {
  blocked: "bg-destructive",
  awaiting_input: "bg-warning",
  review: "bg-warning",
  in_progress: "bg-info",
  queued: "bg-muted-foreground",
  done: "bg-success",
};

const ROTULO_DO_ESTADO: Record<string, string> = {
  blocked: "bloqueada",
  awaiting_input: "aguardando insumo",
  review: "em revisão",
  in_progress: "em andamento",
  queued: "na fila",
  done: "concluída",
};

const quando = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

export default function PerfilDoAgente({
  operador,
  vinculos,
  tarefas,
  aoFechar,
}: {
  operador: Operador | null;
  vinculos: Array<Record<string, any>>;
  tarefas: Map<string, any>;
  aoFechar: () => void;
}) {
  const meus = useMemo(
    () => vinculos.filter((v) => v.operator_id === operador?.id),
    [vinculos, operador],
  );

  const { data: runs = [] } = useQuery({
    queryKey: ["agente-runs", operador?.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("operator_runs")
        .select("id, run_key, status, attempt, started_at, heartbeat_at, finished_at, error")
        .eq("operator_id", operador!.id)
        .order("started_at", { ascending: false })
        .limit(30);
      return (data || []) as Array<Record<string, any>>;
    },
    enabled: Boolean(operador?.id),
  });

  const { data: trilha = [] } = useQuery({
    queryKey: ["agente-trilha", operador?.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("operator_audit_log")
        .select("id, occurred_at, actor, action, old_status, new_status, evidence, from_cron")
        .eq("operator_id", operador!.id)
        .order("occurred_at", { ascending: false })
        .limit(40);
      return (data || []) as Array<Record<string, any>>;
    },
    enabled: Boolean(operador?.id),
  });

  const numeros = useMemo(() => {
    const feitas = meus.filter((v) => v.status === "done");
    const comEvidencia = feitas.filter((v) => v.last_evidence);
    const falhas = runs.filter((r) => ["failed", "timeout"].includes(String(r.status)));
    const paradas = meus.filter((v) => {
      if (!["in_progress", "awaiting_input"].includes(v.status)) return false;
      const dias = (Date.now() - new Date(v.updated_at).getTime()) / 86_400_000;
      return dias >= 2;
    });
    return {
      total: meus.length,
      andamento: meus.filter((v) => v.status === "in_progress").length,
      feitas: feitas.length,
      comEvidencia: comEvidencia.length,
      semEvidencia: feitas.length - comEvidencia.length,
      revisao: meus.filter((v) => v.status === "review").length,
      bloqueadas: meus.filter((v) => v.status === "blocked").length,
      falhas: falhas.length,
      paradas: paradas.length,
      // Sem tarefa concluída não existe taxa: mostrar 0% ou 100% aqui
      // seria inventar desempenho de quem ainda não começou.
      taxaEvidencia: feitas.length ? Math.round((comEvidencia.length / feitas.length) * 100) : null,
      semProximoPasso: meus.filter((v) => v.status === "blocked" && !v.next_step).length,
    };
  }, [meus, runs]);

  const melhorias = useMemo(() => {
    const lista: Array<{ texto: string; grave: boolean }> = [];
    if (numeros.semEvidencia > 0) {
      lista.push({
        grave: true,
        texto: `${numeros.semEvidencia} conclusão(ões) sem evidência foram rebaixadas para revisão. Anexe link ou descrição verificável no evento done.`,
      });
    }
    if (numeros.falhas > 0) {
      lista.push({
        grave: true,
        texto: `${numeros.falhas} execução(ões) falharam ou expiraram. Mande heartbeat em tarefas longas para a run não morrer por silêncio.`,
      });
    }
    if (numeros.semProximoPasso > 0) {
      lista.push({
        grave: true,
        texto: `${numeros.semProximoPasso} bloqueio(s) sem próximo passo. Bloqueio sem saída escrita vira tarefa parada que ninguém sabe destravar.`,
      });
    }
    if (numeros.paradas > 0) {
      lista.push({
        grave: false,
        texto: `${numeros.paradas} tarefa(s) sem atualização há 2 dias ou mais. Reporte progresso ou marque como bloqueada.`,
      });
    }
    if (numeros.total === 0) {
      lista.push({
        grave: false,
        texto: "Nenhuma execução ainda. Leia o quadro, escolha uma tarefa da lista de disponíveis e reporte started.",
      });
    }
    if (lista.length === 0) {
      lista.push({ grave: false, texto: "Nada a corrigir: evidência em dia, sem falhas e sem tarefa parada." });
    }
    return lista;
  }, [numeros]);

  const comandoDeAcionamento = useMemo(() => {
    if (!operador) return "";
    const abertas = meus
      .filter((v) => !["done"].includes(v.status))
      .slice(0, 6)
      .map((v) => {
        const t = v.kanban_task_id ? tarefas.get(String(v.kanban_task_id)) : null;
        return `- ${t?.title || v.last_action || "(tarefa)"} · ${v.status}${v.block_reason ? " · bloqueio: " + v.block_reason : ""}`;
      });
    return [
      `@${operador.slug} — retomada da execução.`,
      "",
      `Escopo: ${operador.scope}`,
      `Estado atual: ${numeros.andamento} em andamento, ${numeros.comEvidencia} feitas com evidência, `
        + `${numeros.revisao} em revisão, ${numeros.bloqueadas} bloqueadas.`,
      abertas.length ? "\nAbertas com você:\n" + abertas.join("\n") : "\nNada aberto com você agora.",
      "\nO que melhorar nesta rodada:",
      ...melhorias.map((m) => `- ${m.texto}`),
      "",
      "Antes de agir: leia aceleriq_operator_board (traz como_usar, resumo e tarefas_disponiveis).",
      "Reporte cada passo com aceleriq_operator_report. done SEM evidencia vira revisao.",
      "Limites de sempre: publicar, agendar, gastar, contratar e alterar financeiro ficam fora.",
    ].join("\n");
  }, [operador, meus, tarefas, numeros, melhorias]);

  const copiar = async (texto: string, rotulo: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success(`${rotulo} copiado.`);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  return (
    /* CENTRALIZADO, e nao mais gaveta lateral.
       A gaveta jogava o conteudo para a borda e, no telefone, cobria a
       tela inteira sem parecer uma janela. Centralizado, a pessoa ve onde
       o painel continua atras e entende que aquilo fecha. */
    <Dialog open={Boolean(operador)} onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="flex max-h-[88vh] w-[calc(100vw-1.5rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        {operador && (
          <>
            <div className="shrink-0 border-b border-border px-4 pb-3 pt-[max(1.5rem,calc(env(safe-area-inset-top)+0.75rem))]">
              <DialogTitle className="pr-12 text-left text-[17px] font-bold leading-tight text-foreground">
                {operador.display_name}
              </DialogTitle>
              <DialogDescription className="text-left text-[11.5px] text-muted-foreground">
                {operador.role} · {operador.scope}
              </DialogDescription>
              <p className="mt-1 text-[10.5px] text-muted-foreground">
                {operador.last_run_at ? `última execução ${quando(operador.last_run_at)}` : "sem execução ainda"}
              </p>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {/* O progresso em números, não em adjetivo. */}
              <div>
                <p className="mb-1.5 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <TrendingUp className="h-3 w-3" /> Progresso
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { r: "Em andamento", v: numeros.andamento },
                    { r: "Feitas com evidência", v: numeros.comEvidencia },
                    { r: "Em revisão", v: numeros.revisao },
                    { r: "Bloqueadas", v: numeros.bloqueadas },
                    { r: "Falhas de execução", v: numeros.falhas },
                    {
                      r: "Evidência nas conclusões",
                      v: numeros.taxaEvidencia === null ? "—" : `${numeros.taxaEvidencia}%`,
                    },
                  ].map((k) => (
                    <div key={k.r} className="rounded-lg border border-border bg-card px-2 py-1.5">
                      <p className="text-[15px] font-bold tabular-nums leading-none text-foreground">{k.v}</p>
                      <p className="mt-0.5 text-[9px] leading-tight text-muted-foreground">{k.r}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* AS TAREFAS, que era o que faltava.
                  O perfil sabia contar quantas eram e nao mostrava
                  nenhuma: quem abria para entender o que o agente fez
                  ficava com o numero e sem o assunto. Aqui vem o titulo, o
                  cliente, o estado, a evidencia clicavel e o caminho para
                  abrir a tarefa no Kanban. */}
              {meus.length > 0 && (
                <div>
                  <p className="mb-1.5 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    <ListChecks className="h-3 w-3" /> Tarefas deste agente
                    <span className="tabular-nums text-muted-foreground/70">{meus.length}</span>
                  </p>
                  <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                    {[...meus]
                      .sort((a, b) => ORDEM_DO_ESTADO.indexOf(a.status) - ORDEM_DO_ESTADO.indexOf(b.status))
                      .map((v) => {
                        const t = v.kanban_task_id ? tarefas.get(String(v.kanban_task_id)) : null;
                        const tarefaId = v.kanban_task_id || v.painel_task_id;
                        return (
                          <div key={v.id} className="rounded-lg border border-border bg-card p-2.5">
                            <div className="flex items-start gap-2">
                              <span className={cn(
                                "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                                TOM_DO_ESTADO[v.status] ?? "bg-muted-foreground",
                              )} />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[11.5px] font-semibold text-foreground">
                                  {t?.title || v.last_action || "(tarefa sem título)"}
                                </p>
                                <p className="mt-0.5 text-[9.5px] text-muted-foreground">
                                  {ROTULO_DO_ESTADO[v.status] ?? v.status}
                                  {t?.project?.client && ` · ${t.project.client.company_name || t.project.client.full_name}`}
                                  {v.updated_at && ` · ${quando(v.updated_at)}`}
                                </p>
                              </div>
                              {tarefaId && (
                                <a
                                  href={`/kanban?task=${tarefaId}`}
                                  className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[9.5px] font-semibold text-muted-foreground hover:text-foreground"
                                >
                                  abrir
                                </a>
                              )}
                            </div>

                            {v.last_evidence && (
                              <p className="mt-1.5 truncate text-[10px]">
                                {/^https?:\/\//.test(String(v.last_evidence).trim()) ? (
                                  <a
                                    href={String(v.last_evidence).trim()}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="text-info underline underline-offset-2"
                                  >
                                    evidência: {String(v.last_evidence).trim()}
                                  </a>
                                ) : (
                                  <span className="text-muted-foreground">
                                    evidência: {String(v.last_evidence)}
                                  </span>
                                )}
                              </p>
                            )}

                            {v.status === "done" && !v.last_evidence && (
                              <p className="mt-1.5 text-[10px] text-warning">
                                concluída sem evidência
                              </p>
                            )}
                            {v.block_reason && (
                              <p className="mt-1 text-[10px] text-destructive">
                                bloqueio: {v.block_reason}
                              </p>
                            )}
                            {v.next_step && (
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                próximo passo: {v.next_step}
                              </p>
                            )}
                            {v.approval_required && v.status !== "done" && (
                              <p className="mt-1 text-[10px] font-semibold text-warning">
                                precisa da sua aprovação
                              </p>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* O que melhorar: cada linha sai de um número acima. */}
              <div>
                <p className="mb-1.5 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Lightbulb className="h-3 w-3" /> O que melhorar
                </p>
                <div className="space-y-1">
                  {melhorias.map((m, i) => (
                    <p
                      key={i}
                      className={cn(
                        "rounded-lg border px-2.5 py-1.5 text-[11px] leading-relaxed",
                        m.grave
                          ? "border-warning/30 bg-warning/[0.06] text-warning"
                          : "border-border bg-card text-muted-foreground",
                      )}
                    >
                      {m.texto}
                    </p>
                  ))}
                </div>
              </div>

              {/* O comando pronto: o Hermes recebe o estado sem redigitar. */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Acionar no grupo
                  </p>
                  <button
                    type="button"
                    onClick={() => void copiar(comandoDeAcionamento, "Comando")}
                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[10.5px] font-semibold text-muted-foreground hover:text-foreground"
                  >
                    <ClipboardCopy className="h-3 w-3" /> Copiar
                  </button>
                </div>
                <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-card p-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
                  {comandoDeAcionamento}
                </pre>
              </div>

              {/* Execuções: onde a falha aparece com nome e tentativa. */}
              <div>
                <p className="mb-1.5 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <AlertTriangle className="h-3 w-3" /> Execuções recentes
                </p>
                {runs.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">Nenhuma execução registrada ainda.</p>
                ) : (
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {runs.map((r) => (
                      <div key={String(r.id)} className="flex items-baseline gap-2 text-[10.5px]">
                        <span className={cn(
                          "shrink-0 font-semibold",
                          r.status === "done" ? "text-success"
                            : ["failed", "timeout"].includes(String(r.status)) ? "text-destructive"
                            : "text-muted-foreground",
                        )}>
                          {String(r.status)}
                        </span>
                        <span className="min-w-0 truncate text-muted-foreground">
                          {String(r.run_key)}{r.attempt > 1 ? ` · tentativa ${r.attempt}` : ""}
                          {r.error ? ` · ${String(r.error)}` : ""}
                        </span>
                        <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                          {quando(r.finished_at || r.started_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* A trilha imutável: o histórico que ninguém conserta. */}
              <div>
                <p className="mb-1.5 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <History className="h-3 w-3" /> Tudo o que ele fez
                </p>
                {trilha.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">Sem histórico ainda.</p>
                ) : (
                  <div className="max-h-72 space-y-1 overflow-y-auto">
                    {trilha.map((a) => (
                      <div key={String(a.id)} className="rounded-lg border border-border bg-card px-2.5 py-1.5">
                        <p className="text-[11px] text-foreground/85">
                          {String(a.action)}
                          {a.old_status && a.new_status && a.old_status !== a.new_status && (
                            <span className="text-muted-foreground"> · {String(a.old_status)} para {String(a.new_status)}</span>
                          )}
                        </p>
                        <p className="mt-0.5 text-[9.5px] text-muted-foreground">
                          {quando(a.occurred_at)} · {String(a.actor)}
                          {a.from_cron ? " · via cron" : ""}
                          {a.evidence ? " · com evidência" : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
