import { useMemo, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { precisaDecisao } from "@/lib/precisaDecisao";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, ClipboardCopy, History, Lightbulb, ListChecks, TrendingUp } from "lucide-react";
import { botao, etiqueta, juntar, superficie, texto } from "@/components/sistema";

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

  const queryClient = useQueryClient();
  const pausar = useMutation({
    mutationFn: async ({ pausarAgora, motivo }: { pausarAgora: boolean; motivo: string }) => {
      const { data, error } = await (supabase as any).rpc("operator_pausar", {
        _slug: operador!.slug,
        _pausar: pausarAgora,
        _motivo: motivo || null,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["operadores-internos"] });
      toast.success(vars.pausarAgora
        ? `${operador?.display_name} pausado. O banco recusa trabalho dele até reativar.`
        : `${operador?.display_name} reativado.`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
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

  /** Título de bloco dentro da janela: ícone discreto e texto normal (sem caixa alta). */
  const Titulo = ({ icone: Icone, children, acao }: { icone: typeof TrendingUp; children: ReactNode; acao?: ReactNode }) => (
    <div className="mb-2 flex min-w-0 items-center">
      <Icone className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{children}</h3>
      {acao}
    </div>
  );

  return (
    /* CENTRALIZADO, e nao mais gaveta lateral.
       A gaveta jogava o conteudo para a borda e, no telefone, cobria a
       tela inteira sem parecer uma janela. Centralizado, a pessoa ve onde
       o painel continua atras e entende que aquilo fecha. */
    <Dialog open={Boolean(operador)} onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="flex max-h-[88vh] w-[calc(100vw-1.5rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        {operador && (
          <>
            <div className="shrink-0 border-b border-border px-5 pb-3 pt-[max(1.25rem,calc(env(safe-area-inset-top)+0.75rem))]">
              <DialogTitle className={juntar(texto.tituloPagina, "pr-12 text-left")}>
                {operador.display_name}
              </DialogTitle>
              <DialogDescription className={juntar(texto.auxiliar, "mt-0.5 text-left leading-5")}>
                {operador.role} · {operador.scope}
              </DialogDescription>
              <div className="mt-2 flex min-w-0 flex-wrap items-center [&>*]:mr-2">
                <p className={texto.auxiliar}>
                  {operador.last_run_at ? `última execução ${quando(operador.last_run_at)}` : "sem execução ainda"}
                </p>
                {operador.status !== "active" && (
                  <span className={juntar(etiqueta, "bg-warning/15 text-warning")}>
                    {operador.status === "paused" ? "pausado" : operador.status}
                  </span>
                )}
                {/* Pausa POR OPERADOR: ate aqui so existia a chave geral da
                    camada. Pausado, o banco recusa assign, report,
                    participacao e aprovacao dele — com erro que diz
                    "pausado", nao "nao existe". */}
                <button
                  type="button"
                  disabled={pausar.isPending}
                  onClick={() => {
                    const pausando = operador.status === "active";
                    const motivo = window.prompt(
                      pausando
                        ? `Pausar ${operador.display_name}? Motivo (fica na trilha):`
                        : `Reativar ${operador.display_name}? Motivo (opcional):`,
                    );
                    if (motivo === null) return; // cancelou
                    pausar.mutate({ pausarAgora: pausando, motivo });
                  }}
                  className={juntar(
                    botao.secundario,
                    "h-7 px-2.5 text-[12px]",
                    operador.status === "active"
                      ? "border-warning/50 text-warning hover:bg-warning/10"
                      : "border-success/50 text-success hover:bg-success/10",
                  )}
                >
                  {operador.status === "active" ? "pausar operador" : "reativar"}
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-4">
              {/* O progresso em números, não em adjetivo. */}
              <section>
                <Titulo icone={TrendingUp}>Progresso</Titulo>
                <dl className={juntar(superficie.poco, "grid grid-cols-2 gap-x-4 gap-y-3 p-3 sm:grid-cols-3")}>
                  {[
                    { r: "Em andamento", v: numeros.andamento },
                    { r: "Feitas com evidência", v: numeros.comEvidencia },
                    { r: "Em revisão", v: numeros.revisao },
                    { r: "Bloqueadas", v: numeros.bloqueadas },
                    { r: "Falhas de execução", v: numeros.falhas },
                    {
                      r: "Evidência nas conclusões",
                      v: numeros.taxaEvidencia === null ? "sem dado" : `${numeros.taxaEvidencia}%`,
                    },
                  ].map((k) => (
                    <div key={k.r} className="min-w-0">
                      <dt className={juntar(texto.auxiliar, "truncate")}>{k.r}</dt>
                      <dd className="mt-0.5 text-[16px] font-semibold tabular-nums leading-6 text-foreground">{k.v}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              {/* AS TAREFAS, que era o que faltava.
                  O perfil sabia contar quantas eram e nao mostrava
                  nenhuma: quem abria para entender o que o agente fez
                  ficava com o numero e sem o assunto. Aqui vem o titulo, o
                  cliente, o estado, a evidencia clicavel e o caminho para
                  abrir a tarefa no Kanban. */}
              {meus.length > 0 && (
                <section>
                  <Titulo icone={ListChecks}>
                    Tarefas deste agente <span className="ml-1 font-normal tabular-nums text-muted-foreground">{meus.length}</span>
                  </Titulo>
                  <ul className="divide-y divide-border border-y border-border">
                    {[...meus]
                      .sort((a, b) => ORDEM_DO_ESTADO.indexOf(a.status) - ORDEM_DO_ESTADO.indexOf(b.status))
                      .map((v) => {
                        const t = v.kanban_task_id ? tarefas.get(String(v.kanban_task_id)) : null;
                        const tarefaId = v.kanban_task_id || v.painel_task_id;
                        return (
                          <li key={v.id} className="min-w-0 py-2.5">
                            <div className="flex min-w-0 items-start">
                              <span className={juntar(
                                "mr-2 mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                                TOM_DO_ESTADO[v.status] ?? "bg-muted-foreground",
                              )} aria-hidden="true" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-medium text-foreground">
                                  {t?.title || v.last_action || "(tarefa sem título)"}
                                </p>
                                <p className={juntar(texto.auxiliar, "mt-0.5 truncate")}>
                                  {ROTULO_DO_ESTADO[v.status] ?? v.status}
                                  {t?.project?.client && ` · ${t.project.client.company_name || t.project.client.full_name}`}
                                  {v.updated_at && ` · ${quando(v.updated_at)}`}
                                </p>
                              </div>
                              {tarefaId && (
                                <a
                                  href={`/kanban?task=${tarefaId}`}
                                  className={juntar(botao.discreto, "ml-2 h-7 px-2 text-[12px]")}
                                >
                                  abrir
                                </a>
                              )}
                            </div>

                            <div className="pl-3.5">
                              {v.last_evidence && (
                                <p className="mt-1 truncate text-[12px]">
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
                                <p className="mt-1 text-[12px] text-warning">
                                  concluída sem evidência
                                </p>
                              )}
                              {v.block_reason && (
                                <p className="mt-1 text-[12px] text-destructive">
                                  bloqueio: {v.block_reason}
                                </p>
                              )}
                              {v.next_step && (
                                <p className="mt-1 text-[12px] text-muted-foreground">
                                  próximo passo: {v.next_step}
                                </p>
                              )}
                              {precisaDecisao(v) && (
                                <p className="mt-1 text-[12px] font-medium text-warning">
                                  precisa da sua aprovação
                                </p>
                              )}
                            </div>
                          </li>
                        );
                      })}
                  </ul>
                </section>
              )}

              {/* O que melhorar: cada linha sai de um número acima. */}
              <section>
                <Titulo icone={Lightbulb}>O que melhorar</Titulo>
                <ul className="space-y-1.5">
                  {melhorias.map((m, i) => (
                    <li
                      key={i}
                      className={juntar(
                        "flex items-start text-[12.5px] leading-5",
                        m.grave ? "text-warning" : "text-muted-foreground",
                      )}
                    >
                      <span className={juntar("mr-2 mt-2 h-1.5 w-1.5 shrink-0 rounded-full", m.grave ? "bg-warning" : "bg-muted-foreground")} aria-hidden="true" />
                      <span className="min-w-0">{m.texto}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {/* O comando pronto: o Hermes recebe o estado sem redigitar. */}
              <section>
                <Titulo
                  icone={ClipboardCopy}
                  acao={
                    <button
                      type="button"
                      onClick={() => void copiar(comandoDeAcionamento, "Comando")}
                      className={juntar(botao.discreto, "h-7 px-2 text-[12px]")}
                    >
                      <ClipboardCopy className="mr-1 h-3 w-3" aria-hidden="true" /> Copiar
                    </button>
                  }
                >
                  Acionar no grupo
                </Titulo>
                <pre className={juntar(superficie.poco, "whitespace-pre-wrap p-3 font-sans text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]")}>
                  {comandoDeAcionamento}
                </pre>
              </section>

              {/* Execuções: onde a falha aparece com nome e tentativa. */}
              <section>
                <Titulo icone={AlertTriangle}>Execuções recentes</Titulo>
                {runs.length === 0 ? (
                  <p className={texto.auxiliar}>Nenhuma execução registrada ainda.</p>
                ) : (
                  <ul className="divide-y divide-border border-y border-border">
                    {runs.map((r) => (
                      <li key={String(r.id)} className="flex min-w-0 items-baseline py-1.5 text-[12px]">
                        <span className={juntar(
                          "mr-2 shrink-0 font-medium",
                          r.status === "done" ? "text-success"
                            : ["failed", "timeout"].includes(String(r.status)) ? "text-destructive"
                            : "text-muted-foreground",
                        )}>
                          {({ started: "começou", progress: "em andamento", done: "concluída", review: "para revisar", awaiting_input: "esperando você", failed: "falhou", timeout: "parou sem sinal" } as Record<string, string>)[String(r.status)] ?? String(r.status)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={`execução ${String(r.run_key)}`}>
                          {r.error ? String(r.error) : r.status === "done" ? "sem ocorrências" : ""}
                          {r.attempt > 1 ? ` (${r.attempt}ª tentativa)` : ""}
                        </span>
                        <span className="ml-2 shrink-0 tabular-nums text-muted-foreground">
                          {quando(r.finished_at || r.started_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* A trilha imutável: o histórico que ninguém conserta. */}
              <section>
                <Titulo icone={History}>Tudo o que ele fez</Titulo>
                {trilha.length === 0 ? (
                  <p className={texto.auxiliar}>Sem histórico ainda.</p>
                ) : (
                  <ul className="divide-y divide-border border-y border-border">
                    {trilha.map((a) => (
                      <li key={String(a.id)} className="min-w-0 py-2">
                        <p className="text-[12.5px] text-foreground/85 [overflow-wrap:anywhere]">
                          {String(a.action)}
                          {a.old_status && a.new_status && a.old_status !== a.new_status && (
                            <span className="text-muted-foreground"> · {String(a.old_status)} para {String(a.new_status)}</span>
                          )}
                        </p>
                        <p className={juntar(texto.auxiliar, "mt-0.5")}>
                          {quando(a.occurred_at)} · {String(a.actor)}
                          {a.from_cron ? " · via cron" : ""}
                          {a.evidence ? " · com evidência" : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
