import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays, Check, CheckCheck, ClipboardCopy, Clock, ExternalLink,
  FileArchive, FileText, MessageCircle, Sparkles, X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet, SheetContent, SheetDescription, SheetTitle,
} from "@/components/ui/sheet";
import {
  CYCLES, HISTORY_WEEKS, ONBOARDING_STEPS, SERVICE_LABELS, type CycleArea,
  weekSummaryText,
} from "@/lib/cycleDefs";
import {
  PHASE_LABELS, PHASE_PURPOSE, phaseForClient, stepLabelForWeek,
  type StepsOptions,
} from "@/lib/cycleTasks";
import { addDays, closedStreak, localIso } from "@/lib/cycleWeek";
import {
  MEMORY_LABELS, readMemory, recordMemory, type MemoryEntry,
} from "@/lib/clientMemory";
import {
  checklistProgress, createChecklist, deleteChecklist, listChecklists,
  splitRequestIntoItems, toggleChecklistItem, type Checklist,
} from "@/lib/clientChecklist";

/**
 * O cliente por dentro, a partir do Ciclo.
 *
 * Tocar no nome abre esta folha: além de marcar etapa por etapa lendo o nome
 * inteiro, ela reúne o que a equipe precisa saber antes de agir (o que já
 * está agendado, o que foi entregue, quanto tempo de casa, quais serviços) e
 * as ferramentas do momento (fechar a semana de uma vez, mandar o resumo no
 * WhatsApp, pular para a agenda ou os arquivos daquele cliente).
 *
 * A folha controla as próprias margens: o componente base traz espaçamento
 * genérico que, em tela de celular, joga o conteúdo para cima e aperta o
 * cabeçalho.
 */

export interface ClientCycleSheetProps {
  client: any | null;
  area: CycleArea;
  weekStart: Date;
  realMonday: Date;
  historyWeekKeys: string[];
  historySets: Map<string, Set<number>>;
  doneMap: Map<string, { id: string; step: number; done_at?: string | null; done_by?: string | null }>;
  /** Marcações da semana anterior, para corrigir o que já foi feito lá. */
  pastRows?: Array<{ id: string; client_id: string; area: string; step: number; done_at?: string | null; done_by?: string | null }>;
  pastWeekKey?: string;
  doneByNames?: Record<string, string>;
  currentUserId?: string;
  canWrite: boolean;
  pendingKey: string | null;
  onToggle: (client: any, step: number, semana?: string) => Promise<void> | void;
  onClose: () => void;
}

const hourOf = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";

function monthsSince(iso?: string | null): string | null {
  if (!iso) return null;
  const months = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / (30 * 86400000)),
  );
  if (months < 1) return "entrou este mês";
  if (months === 1) return "1 mês de casa";
  if (months < 12) return `${months} meses de casa`;
  const years = Math.floor(months / 12);
  return years === 1 ? "1 ano de casa" : `${years} anos de casa`;
}

export default function ClientCycleSheet({
  client, area, weekStart, realMonday, historyWeekKeys, historySets, doneMap,
  pastRows = [], pastWeekKey, doneByNames, currentUserId, canWrite, pendingKey,
  onToggle, onClose,
}: ClientCycleSheetProps) {
  const [bulkRunning, setBulkRunning] = useState(false);
  // Qual semana está sendo editada aqui dentro. A tela continua na semana
  // atual; só esta folha volta uma semana para acertar o que ficou faltando.
  const [editandoAnterior, setEditandoAnterior] = useState(false);
  const [novaNota, setNovaNota] = useState("");
  const [salvandoNota, setSalvandoNota] = useState(false);
  const [pedidoChecklist, setPedidoChecklist] = useState("");
  const [gerandoChecklist, setGerandoChecklist] = useState(false);
  const [listas, setListas] = useState<Checklist[]>([]);
  const cycle = CYCLES[area];
  const totalSteps = cycle.steps.length;
  const open = !!client;

  const onboarding = client?.onboarding_done === false;
  const clientTotal = totalSteps + (onboarding ? ONBOARDING_STEPS.length : 0);
  const clientName = client?.company_name || client?.full_name || "Cliente";

  // Marcações da semana que está sendo editada nesta folha.
  const marcacaoDe = (step: number) => {
    if (!client) return undefined;
    if (!editandoAnterior) return doneMap.get(`${client.id}:${area}:${step}`);
    return pastRows.find(
      (row) => row.client_id === client.id && row.area === area && row.step === step,
    );
  };

  const doneSteps = useMemo(() => {
    if (!client) return [] as number[];
    return Array.from({ length: clientTotal }, (_, index) => index + 1).filter((step) =>
      editandoAnterior
        ? pastRows.some((r) => r.client_id === client.id && r.area === area && r.step === step)
        : doneMap.has(`${client.id}:${area}:${step}`),
    );
  }, [client, clientTotal, doneMap, area, editandoAnterior, pastRows]);

  const complete = doneSteps.length >= clientTotal;

  // Contexto vivo do cliente: o que já está armado e o que saiu esta semana.
  const { data: contexto0 } = useQuery({
    queryKey: ["ciclo-cliente-contexto", client?.id],
    queryFn: async () => {
      const agora = new Date().toISOString();
      const [agendadas, arquivos] = await Promise.all([
        supabase
          .from("editorial_publications")
          .select("id, scheduled_at, status")
          .eq("client_id", client.id)
          .eq("status", "scheduled")
          .gte("scheduled_at", agora)
          .order("scheduled_at", { ascending: true })
          .limit(3),
        supabase
          .from("files")
          .select("file_name, created_at, approval_status")
          .eq("client_id", client.id)
          .is("archived_at", null)
          .is("parent_file_id", null)
          .order("created_at", { ascending: false })
          .limit(3),
      ]);
      return {
        agendadas: (agendadas.data || []) as any[],
        arquivos: (arquivos.data || []) as any[],
      };
    },
    enabled: open && !!client?.id,
    staleTime: 60_000,
  });

  const { data: historia = [], refetch: recarregarHistoria } = useQuery({
    queryKey: ["memoria-cliente", client?.id],
    queryFn: () => readMemory(client.id, { limit: 12 }),
    enabled: open && !!client?.id,
    staleTime: 60_000,
  });

  // Checklists do momento: o combinado que não cabe no ciclo semanal.
  const { refetch: recarregarListas } = useQuery({
    queryKey: ["checklists-cliente", client?.id],
    queryFn: async () => {
      const dados = await listChecklists(client.id);
      setListas(dados);
      return dados;
    },
    enabled: open && !!client?.id,
    staleTime: 30_000,
  });

  const gerarChecklist = async () => {
    const pedido = pedidoChecklist.trim();
    if (!client || pedido.length < 3 || gerandoChecklist) return;
    setGerandoChecklist(true);
    try {
      // O contexto do cliente vai junto: assim os itens saem específicos,
      // não uma lista genérica que serviria para qualquer um.
      const contexto = [
        `Serviços: ${servicos.join(", ") || "não informado"}`,
        contexto0?.agendadas?.length ? `${contexto0.agendadas.length} publicação(ões) agendada(s)` : "",
        contexto0?.arquivos?.length
          ? `Entregas recentes: ${contexto0.arquivos.map((f: any) => f.file_name).slice(0, 3).join(", ")}`
          : "",
      ].filter(Boolean).join("\n");

      // O motor com IA deixa a lista melhor, mas não é condição para ela
      // existir: fora do ar, o próprio texto do pedido vira a lista.
      let itens: string[] = [];
      let comIa = false;
      try {
        const { data } = await supabase.functions.invoke("client-checklist", {
          body: { request: pedido, client_name: clientName, context: contexto },
        });
        if (Array.isArray(data?.items) && data.items.length > 0) {
          itens = data.items;
          comIa = data.source === "ai";
        }
      } catch {
        /* sem motor agora: segue com a divisão local */
      }
      if (itens.length === 0) itens = splitRequestIntoItems(pedido);
      if (itens.length === 0) {
        toast.error("Não consegui entender o pedido. Escreva uma tarefa por linha.");
        return;
      }
      const tituloSugerido = comIa ? undefined : pedido.slice(0, 50);
      const criado = await createChecklist({
        clientId: client.id,
        title: tituloSugerido || pedido.slice(0, 50),
        items: itens,
        request: pedido,
        tags: [area],
      });
      if (!criado) {
        toast.error("A lista foi montada, mas não consegui guardar.");
        return;
      }
      setPedidoChecklist("");
      setListas((atual) => [criado, ...atual]);
      toast.success(`${itens.length} itens criados${comIa ? "" : " (sem IA agora)"}.`);
      void recarregarHistoria();
    } finally {
      setGerandoChecklist(false);
    }
  };

  const marcarItem = async (lista: Checklist, itemId: string) => {
    const atualizado = await toggleChecklistItem(lista, itemId);
    if (!atualizado) {
      toast.error("Não foi possível marcar agora.");
      return;
    }
    setListas((atual) => atual.map((l) => (l.id === atualizado.id ? atualizado : l)));

    // Lista inteira concluída vira marco na história do cliente.
    const { done, total } = checklistProgress(atualizado);
    if (done === total && total > 0) {
      await recordMemory({
        clientId: client!.id,
        kind: "marco",
        title: `Concluído: ${atualizado.title}`,
        content:
          `Todos os ${total} itens foram concluídos: ` +
          atualizado.items.map((i) => i.text).join("; ") + ".",
        source: "ciclo",
        tags: [area, "checklist"],
      });
      toast.success("Lista concluída e registrada na história.");
      void recarregarHistoria();
    }
  };

  const removerLista = async (lista: Checklist) => {
    if (!(await deleteChecklist(lista.id))) {
      toast.error("Não foi possível remover.");
      return;
    }
    setListas((atual) => atual.filter((l) => l.id !== lista.id));
    void recarregarHistoria();
  };

  const salvarNota = async () => {
    const texto = novaNota.trim();
    if (!client || !texto || salvandoNota) return;
    setSalvandoNota(true);
    const ok = await recordMemory({
      clientId: client.id,
      kind: "nota",
      title: "Anotação da equipe",
      content: texto,
      source: "ciclo",
      tags: [area],
    });
    setSalvandoNota(false);
    if (ok) {
      setNovaNota("");
      toast.success("Anotação guardada na história do cliente.");
      void recarregarHistoria();
    } else {
      toast.error("Não foi possível guardar a anotação.");
    }
  };

  const opcoesEtapa: StepsOptions = useMemo(() => ({
    services: client?.services_config || {},
    phaseInput: {
      onboardingDone: client?.onboarding_done !== false,
      daysAsClient: client?.created_at
        ? Math.floor((Date.now() - new Date(client.created_at).getTime()) / 86400000)
        : 0,
      closedStreak: client
        ? closedStreak(
            historyWeekKeys.slice(0, HISTORY_WEEKS - 1),
            (key) => (historySets.get(`${client.id}:${key}`)?.size || 0) >= totalSteps,
          )
        : 0,
    },
  }), [client, historyWeekKeys, historySets, totalSteps]);

  const fase = useMemo(
    () => phaseForClient(opcoesEtapa.phaseInput!),
    [opcoesEtapa],
  );

  const streak = useMemo(() => {
    if (!client) return 0;
    return closedStreak(
      historyWeekKeys.slice(0, HISTORY_WEEKS - 1),
      (key) => (historySets.get(`${client.id}:${key}`)?.size || 0) >= totalSteps,
    );
  }, [client, historyWeekKeys, historySets, totalSteps]);

  const prevKey = localIso(addDays(weekStart, -7));
  const prevSet = client ? historySets.get(`${client.id}:${prevKey}`) : undefined;
  const heranca =
    addDays(weekStart, -7) < realMonday && (prevSet?.size || 0) > 0 && (prevSet?.size || 0) < totalSteps
      ? prevSet!.size
      : null;

  const servicos = Object.entries(client?.services_config || {})
    .filter(([key, value]) => value === true && SERVICE_LABELS[key])
    .map(([key]) => SERVICE_LABELS[key]);

  const resumo = weekSummaryText({
    clientName,
    area,
    doneSteps,
    totalSteps: clientTotal,
    stepNames: client
      ? Array.from({ length: totalSteps }, (_, i) =>
          stepLabelForWeek(area, client.id, localIso(weekStart), i + 1, opcoesEtapa),
        )
      : undefined,
  });

  const copiarResumo = async () => {
    try {
      await navigator.clipboard.writeText(resumo);
      toast.success("Resumo copiado.");
    } catch {
      toast.error("Não foi possível copiar neste navegador.");
    }
  };

  const abrirWhatsApp = () => {
    const numero = String(client?.phone || "").replace(/\D/g, "");
    const texto = encodeURIComponent(resumo);
    window.open(
      numero ? `https://wa.me/${numero}?text=${texto}` : `https://wa.me/?text=${texto}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  // Fechar a semana de uma vez: marca só o que falta, uma etapa por vez, para
  // cada marcação continuar tendo a própria hora no histórico do dia.
  const fecharSemana = async () => {
    if (!client || bulkRunning) return;
    const faltando = Array.from({ length: clientTotal }, (_, index) => index + 1).filter(
      (step) => !marcacaoDe(step),
    );
    if (faltando.length === 0) return;
    setBulkRunning(true);
    try {
      for (const step of faltando) {
        await onToggle(client, step, editandoAnterior ? pastWeekKey : undefined);
      }
      toast.success(`Semana de ${clientName} fechada.`);
    } finally {
      setBulkRunning(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        {client && (
          <>
            {/* Cabeçalho fixo, com respiro para a barra de status do aparelho */}
            <div className="shrink-0 border-b border-border px-4 pb-3 pt-[max(1.5rem,calc(env(safe-area-inset-top)+0.75rem))]">
              <SheetTitle className="pr-12 text-left text-[17px] font-bold leading-tight text-foreground">
                {clientName}
              </SheetTitle>
              <SheetDescription className="sr-only">
                Etapas da semana, contexto e ferramentas de {clientName}.
              </SheetDescription>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {doneSteps.length}/{clientTotal} etapas
                </span>
                <span>·</span>
                <span>{cycle.label}</span>
                {monthsSince(client.created_at) && (
                  <>
                    <span>·</span>
                    <span>{monthsSince(client.created_at)}</span>
                  </>
                )}
                <span>·</span>
                <span title={PHASE_PURPOSE[fase]} className="font-semibold text-primary">
                  {PHASE_LABELS[fase]}
                </span>
                {client.plan_name && (
                  <>
                    <span>·</span>
                    <span>{client.plan_name}</span>
                  </>
                )}
              </div>
              <div className="mt-2 flex h-1.5 gap-[3px]">
                {Array.from({ length: clientTotal }, (_, index) => (
                  <span
                    key={index}
                    className={`flex-1 rounded-full ${
                      marcacaoDe(index + 1)
                        ? index + 1 > totalSteps ? "bg-info" : "bg-primary"
                        : "bg-secondary"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Corpo rolável */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {/* Ferramentas do momento */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => void fecharSemana()}
                  disabled={!canWrite || complete || bulkRunning}
                  className="flex flex-col items-center gap-1 rounded-xl border border-border bg-card px-2 py-2.5 text-[10.5px] font-semibold text-foreground disabled:opacity-40"
                >
                  <CheckCheck className={`h-4 w-4 text-primary ${bulkRunning ? "animate-pulse" : ""}`} />
                  {complete ? "Semana fechada" : "Fechar semana"}
                </button>
                <button
                  type="button"
                  onClick={abrirWhatsApp}
                  className="flex flex-col items-center gap-1 rounded-xl border border-border bg-card px-2 py-2.5 text-[10.5px] font-semibold text-foreground"
                >
                  <MessageCircle className="h-4 w-4 text-primary" />
                  WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => void copiarResumo()}
                  className="flex flex-col items-center gap-1 rounded-xl border border-border bg-card px-2 py-2.5 text-[10.5px] font-semibold text-foreground"
                >
                  <ClipboardCopy className="h-4 w-4 text-primary" />
                  Copiar resumo
                </button>
              </div>

              {heranca !== null && (
                <p className="mt-3 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11.5px] font-medium text-amber-600 dark:text-amber-400">
                  Semana passada fechou {heranca}/{totalSteps}. O que ficou para trás continua valendo aqui.
                </p>
              )}

              {/* Etapas com nome inteiro, na semana escolhida aqui dentro */}
              <div className="mt-4 flex items-center justify-between gap-2">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Etapas {editandoAnterior ? "da semana passada" : "desta semana"}
                </p>
                {pastWeekKey && (
                  <div className="flex items-center gap-0.5 rounded-lg bg-secondary/60 p-0.5">
                    {[
                      { valor: false, texto: "Esta semana" },
                      { valor: true, texto: "Anterior" },
                    ].map((opcao) => (
                      <button
                        key={opcao.texto}
                        type="button"
                        onClick={() => setEditandoAnterior(opcao.valor)}
                        className={`rounded-md px-2 py-1 text-[10.5px] font-semibold transition-colors ${
                          editandoAnterior === opcao.valor
                            ? "bg-card text-foreground shadow-sm"
                            : "text-muted-foreground"
                        }`}
                      >
                        {opcao.texto}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {editandoAnterior && (
                <p className="mt-1.5 rounded-lg bg-secondary/50 px-2.5 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  Você está corrigindo a semana de{" "}
                  {new Date(`${pastWeekKey}T12:00:00`).toLocaleDateString("pt-BR", {
                    day: "2-digit", month: "2-digit",
                  })}
                  . Serve para registrar o que já tinha sido feito e ficou sem marcar.
                </p>
              )}
              <div className="mt-2 space-y-1.5">
                {Array.from({ length: clientTotal }, (_, index) => index + 1).map((step) => {
                  const key = `${client.id}:${area}:${step}${editandoAnterior ? ":anterior" : ""}`;
                  const row = marcacaoDe(step);
                  const done = !!row;
                  const onboardingTrack = step > totalSteps;
                  const who = row?.done_by
                    ? row.done_by === currentUserId ? "você" : doneByNames?.[row.done_by] || "equipe"
                    : null;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={!canWrite || pendingKey === key || bulkRunning}
                      onClick={() => void onToggle(client, step, editandoAnterior ? pastWeekKey : undefined)}
                      className={`flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-left transition-colors ${
                        done ? "border-primary/30 bg-primary/[0.06]" : "border-border bg-card"
                      } ${pendingKey === key ? "opacity-50" : ""}`}
                    >
                      <span
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold tabular-nums ${
                          done
                            ? onboardingTrack ? "bg-info text-white" : "bg-primary text-primary-foreground"
                            : "bg-secondary text-muted-foreground"
                        }`}
                      >
                        {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : step}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[12.5px] leading-snug ${done ? "text-foreground" : "text-muted-foreground"}`}>
                          {step <= totalSteps
                            ? stepLabelForWeek(
                                area,
                                client.id,
                                editandoAnterior && pastWeekKey ? pastWeekKey : localIso(weekStart),
                                step,
                                opcoesEtapa,
                              )
                            : ONBOARDING_STEPS[step - totalSteps - 1]}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">
                          {done && row?.done_at
                            ? `feito ${new Date(row.done_at).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit" })} às ${hourOf(row.done_at)}${who ? ` por ${who}` : ""}`
                            : onboardingTrack ? "onboarding" : "pendente"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* O que já está armado e o que saiu */}
              {(contexto0?.agendadas?.length || contexto0?.arquivos?.length) ? (
                <>
                  <p className="mt-5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Contexto do cliente
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {(contexto0?.agendadas || []).map((pub: any) => (
                      <div key={pub.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2">
                        <Clock className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground">
                          Publicação agendada
                        </span>
                        <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                          {new Date(pub.scheduled_at).toLocaleDateString("pt-BR", {
                            day: "2-digit", month: "2-digit",
                          })}
                        </span>
                      </div>
                    ))}
                    {(contexto0?.arquivos || []).map((file: any, index: number) => (
                      <div key={`${file.file_name}-${index}`} className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground">
                          {file.file_name}
                        </span>
                        {file.approval_status === "approved" && (
                          <span className="shrink-0 text-[9.5px] font-semibold uppercase text-success">
                            aprovado
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              {/* Checklist do momento: o que não cabe no ciclo semanal */}
              <p className="mt-5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Lista rápida
              </p>
              <div className="mt-2">
                <textarea
                  value={pedidoChecklist}
                  onChange={(event) => setPedidoChecklist(event.target.value)}
                  placeholder="Descreva o que precisa ser feito para este cliente. Ex: gravar depoimento na loja, refazer a arte do cardápio e pedir as fotos novas."
                  rows={2}
                  className="w-full resize-none rounded-xl border border-border bg-card px-3 py-2 text-[12.5px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:border-primary/50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void gerarChecklist()}
                  disabled={pedidoChecklist.trim().length < 3 || gerandoChecklist}
                  className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-[11.5px] font-bold text-primary-foreground disabled:opacity-40"
                >
                  <Sparkles className={`h-3.5 w-3.5 ${gerandoChecklist ? "animate-pulse" : ""}`} />
                  {gerandoChecklist ? "Montando a lista..." : "Montar checklist"}
                </button>
              </div>

              {listas.length > 0 && (
                <div className="mt-3 space-y-2.5">
                  {listas.map((lista) => {
                    const { done, total } = checklistProgress(lista);
                    const completa = done === total;
                    return (
                      <div
                        key={lista.id}
                        className={`rounded-xl border p-2.5 ${
                          completa ? "border-success/40 bg-success/[0.06]" : "border-border bg-card"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 flex-1 text-[12.5px] font-semibold leading-snug text-foreground">
                            {lista.title}
                          </p>
                          <span className="shrink-0 text-[11px] font-bold tabular-nums text-muted-foreground">
                            {done}/{total}
                          </span>
                          <button
                            type="button"
                            onClick={() => void removerLista(lista)}
                            className="shrink-0 text-muted-foreground/60 hover:text-destructive"
                            aria-label="Remover lista"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="mt-1.5 space-y-1">
                          {lista.items.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              disabled={!canWrite}
                              onClick={() => void marcarItem(lista, item.id)}
                              className="flex w-full items-start gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-secondary/40"
                            >
                              <span
                                className={`mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                  item.done
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border"
                                }`}
                              >
                                {item.done && <Check className="h-3 w-3" strokeWidth={3} />}
                              </span>
                              <span
                                className={`text-[12px] leading-snug ${
                                  item.done
                                    ? "text-muted-foreground line-through"
                                    : "text-foreground"
                                }`}
                              >
                                {item.text}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* A história do cliente: cada passo, na ordem em que aconteceu */}
              <p className="mt-5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                História deste cliente
              </p>
              <div className="mt-2">
                <textarea
                  value={novaNota}
                  onChange={(event) => setNovaNota(event.target.value)}
                  placeholder="Anote uma decisão, um combinado, algo que mudou de rumo..."
                  rows={2}
                  className="w-full resize-none rounded-xl border border-border bg-card px-3 py-2 text-[12.5px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:border-primary/50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void salvarNota()}
                  disabled={!novaNota.trim() || salvandoNota}
                  className="mt-1.5 w-full rounded-xl bg-primary/10 py-2 text-[11.5px] font-semibold text-primary disabled:opacity-40"
                >
                  {salvandoNota ? "Guardando..." : "Guardar na história"}
                </button>
              </div>

              {historia.length > 0 ? (
                <div className="mt-3 space-y-2 border-l border-border pl-3">
                  {historia.map((entrada: MemoryEntry) => (
                    <div key={entrada.id} className="relative">
                      <span className="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full bg-primary/60" />
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {new Date(entrada.created_at).toLocaleDateString("pt-BR", {
                          day: "2-digit", month: "2-digit", year: "2-digit",
                        })}{" "}
                        · {MEMORY_LABELS[entrada.kind] || entrada.kind}
                      </p>
                      {entrada.title && (
                        <p className="text-[12.5px] font-semibold leading-snug text-foreground">
                          {entrada.title}
                        </p>
                      )}
                      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                        {entrada.content.length > 220
                          ? `${entrada.content.slice(0, 220)}...`
                          : entrada.content}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
                  Ainda não há história registrada. Cada mensagem publicada, semana
                  fechada e anotação passa a aparecer aqui, em ordem.
                </p>
              )}

              {/* Evolução */}
              <p className="mt-5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Evolução · {HISTORY_WEEKS} semanas
                {streak > 0 && (
                  <span className="ml-2 font-bold normal-case tracking-normal text-success">
                    {streak} {streak === 1 ? "semana 100%" : "semanas 100%"}
                  </span>
                )}
              </p>
              <div className="mt-2 flex items-end gap-1.5">
                {historyWeekKeys.map((key, index) => {
                  const fill = (historySets.get(`${client.id}:${key}`)?.size || 0) / totalSteps;
                  const start = addDays(realMonday, (index - (HISTORY_WEEKS - 1)) * 7);
                  return (
                    <div key={key} className="flex flex-1 flex-col items-center gap-1">
                      <span className="flex h-14 w-full items-end overflow-hidden rounded bg-secondary/40">
                        <span
                          className={`block w-full rounded ${fill >= 1 ? "bg-success/70" : "bg-primary/50"}`}
                          style={{ height: `${Math.max(fill * 100, fill > 0 ? 8 : 3)}%` }}
                        />
                      </span>
                      <span className="text-[8.5px] tabular-nums text-muted-foreground">
                        {start.getDate()}
                      </span>
                    </div>
                  );
                })}
              </div>

              {servicos.length > 0 && (
                <>
                  <p className="mt-5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Serviços contratados
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {servicos.map((servico) => (
                      <span
                        key={servico}
                        className="rounded-md bg-secondary px-2 py-1 text-[10.5px] font-medium text-muted-foreground"
                      >
                        {servico}
                      </span>
                    ))}
                  </div>
                </>
              )}

              {/* Atalhos para o resto do painel, já pensando naquele cliente */}
              <p className="mt-5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Abrir no painel
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {[
                  { to: "/calendario", label: "Agenda", icon: CalendarDays },
                  { to: "/arquivos", label: "Arquivos", icon: FileArchive },
                  { to: "/central", label: "Experiência", icon: Sparkles },
                  { to: "/clientes", label: "Cadastro", icon: ExternalLink },
                ].map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    onClick={onClose}
                    className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground"
                  >
                    <link.icon className="h-3.5 w-3.5" /> {link.label}
                  </Link>
                ))}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
