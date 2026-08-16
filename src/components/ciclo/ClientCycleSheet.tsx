import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays, Check, CheckCheck, ClipboardCopy, Clock, ExternalLink,
  FileArchive, FileText, MessageCircle, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet, SheetContent, SheetDescription, SheetTitle,
} from "@/components/ui/sheet";
import {
  CYCLES, HISTORY_WEEKS, ONBOARDING_STEPS, SERVICE_LABELS, type CycleArea,
  stepLabel, weekSummaryText,
} from "@/lib/cycleDefs";
import { addDays, closedStreak, localIso } from "@/lib/cycleWeek";

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
  doneByNames?: Record<string, string>;
  currentUserId?: string;
  canWrite: boolean;
  pendingKey: string | null;
  onToggle: (client: any, step: number) => Promise<void> | void;
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
  doneByNames, currentUserId, canWrite, pendingKey, onToggle, onClose,
}: ClientCycleSheetProps) {
  const [bulkRunning, setBulkRunning] = useState(false);
  const cycle = CYCLES[area];
  const totalSteps = cycle.steps.length;
  const open = !!client;

  const onboarding = client?.onboarding_done === false;
  const clientTotal = totalSteps + (onboarding ? ONBOARDING_STEPS.length : 0);
  const clientName = client?.company_name || client?.full_name || "Cliente";

  const doneSteps = useMemo(() => {
    if (!client) return [] as number[];
    return Array.from({ length: clientTotal }, (_, index) => index + 1).filter((step) =>
      doneMap.has(`${client.id}:${area}:${step}`),
    );
  }, [client, clientTotal, doneMap, area]);

  const complete = doneSteps.length >= clientTotal;

  // Contexto vivo do cliente: o que já está armado e o que saiu esta semana.
  const { data: contexto } = useQuery({
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
    clientName, area, doneSteps, totalSteps: clientTotal,
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
      (step) => !doneMap.has(`${client.id}:${area}:${step}`),
    );
    if (faltando.length === 0) return;
    setBulkRunning(true);
    try {
      for (const step of faltando) await onToggle(client, step);
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
            <div className="shrink-0 border-b border-border px-4 pb-3 pt-[max(1.25rem,env(safe-area-inset-top))]">
              <SheetTitle className="pr-8 text-left text-[17px] font-bold leading-tight text-foreground">
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
                      doneMap.has(`${client.id}:${area}:${index + 1}`)
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

              {/* Etapas com nome inteiro */}
              <p className="mt-4 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Etapas da semana
              </p>
              <div className="mt-2 space-y-1.5">
                {Array.from({ length: clientTotal }, (_, index) => index + 1).map((step) => {
                  const key = `${client.id}:${area}:${step}`;
                  const row = doneMap.get(key);
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
                      onClick={() => void onToggle(client, step)}
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
                          {stepLabel(area, step)}
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
              {(contexto?.agendadas?.length || contexto?.arquivos?.length) ? (
                <>
                  <p className="mt-5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Contexto do cliente
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {(contexto?.agendadas || []).map((pub: any) => (
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
                    {(contexto?.arquivos || []).map((file: any, index: number) => (
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
