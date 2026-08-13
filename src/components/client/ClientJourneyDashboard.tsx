import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { notifyAdmin } from "@/lib/notifyHelpers";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Briefcase,
  CalendarDays,
  CalendarCheck,
  CheckCircle2,
  FileCheck,
  FileText,
  FolderOpen,
  Inbox,
  PackageCheck,
  Repeat,
  Send,
  ShieldCheck,
  Target,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import CircularProgress from "./CircularProgress";
import { FadeUp, StaggerContainer } from "./motion";
import ProjectJournal from "@/components/shared/ProjectJournal";
import {
  daysUntil,
  formatDateShort,
  isRecurringProject,
  typeLabels,
  useClientDashboardData,
} from "./dashboardHelpers";

interface Props {
  clientId: string;
  clientName: string;
  onSelectProject: (project: any) => void;
  isImpersonation?: boolean;
}

const projectStatusLabel: Record<string, string> = {
  active: "Em andamento",
  review: "Em revisão",
  planning: "Planejamento",
  done: "Concluído",
  paused: "Pausado",
};

const platformLabel: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  google_business: "Google",
};

const isSameMonth = (value: string | null | undefined, ref: Date) => {
  if (!value) return false;
  const d = new Date(value);
  return d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear();
};

export default function ClientJourneyDashboard({
  clientId,
  clientName,
  onSelectProject,
  isImpersonation,
}: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pulseScore, setPulseScore] = useState<number | null>(null);
  const [pulseComment, setPulseComment] = useState("");
  const [pulseSending, setPulseSending] = useState(false);
  const { loadingProjects, data } = useClientDashboardData(clientId);
  const {
    activeProjects,
    doneProjects,
    milestones,
    completedMilestonesCount,
    totalMilestones,
    pendingFiles,
    deliveredFiles,
    approvedFiles,
    totalFiles,
    contentPublications,
    latestReport,
    clientProfile,
    clientPendingBilling,
  } = data as any;
  const firstName = clientName.split(" ")[0] || "cliente";

  // Avisos grandes: renovação chegando (7 dias) e pagamento em atraso.
  const renewalDays = clientProfile?.plan_renewal_date ? daysUntil(clientProfile.plan_renewal_date) : null;
  const renewalSoon = renewalDays !== null && renewalDays >= 0 && renewalDays <= 7 && clientProfile?.plan_status === "active";
  const overdueBills = (clientPendingBilling || []).filter((b: any) => {
    const due = new Date(`${b.due_date}T12:00:00`);
    return due.getTime() < Date.now();
  });
  const overdueAmount = overdueBills.reduce((s: number, b: any) => s + Number(b.amount || 0), 0);

  // Pulso Aceleriq: avaliação rápida do cliente (guardada no próprio cadastro).
  const pulseHistory: any[] = Array.isArray(clientProfile?.services_config?.pulse_history)
    ? clientProfile.services_config.pulse_history
    : [];
  const lastPulse = pulseHistory[pulseHistory.length - 1] || null;
  const lastPulseDays = lastPulse?.date
    ? Math.floor((Date.now() - new Date(lastPulse.date).getTime()) / 86400000)
    : null;
  const showPulse = !isImpersonation && (lastPulseDays === null || lastPulseDays >= 30);

  const submitPulse = async () => {
    if (pulseScore === null || pulseSending) return;
    setPulseSending(true);
    try {
      const { data: fresh } = await supabase
        .from("profiles")
        .select("services_config")
        .eq("id", clientId)
        .maybeSingle();
      const current = (fresh?.services_config as any) || {};
      const history = Array.isArray(current.pulse_history) ? current.pulse_history : [];
      const entry = {
        date: new Date().toISOString(),
        score: pulseScore,
        comment: pulseComment.trim() || undefined,
      };
      const { error } = await supabase
        .from("profiles")
        .update({ services_config: { ...current, pulse_history: [...history, entry] } as any })
        .eq("id", clientId);
      if (error) throw error;
      void notifyAdmin(
        `Pulso respondido: ${clientName} avaliou a experiência com nota ${pulseScore}/5${pulseComment.trim() ? ` · "${pulseComment.trim().slice(0, 120)}"` : ""}`,
        "pulse",
        "/central"
      );
      toast.success("Obrigado pela avaliação! Ela nos ajuda a melhorar sempre.");
      queryClient.invalidateQueries({ queryKey: ["client-profile-lite", clientId] });
      setPulseScore(null);
      setPulseComment("");
    } catch {
      toast.error("Não foi possível enviar agora. Tente novamente em instantes.");
    } finally {
      setPulseSending(false);
    }
  };

  // Frentes: recorrente (ciclo mensal) x projeto com começo e fim (marcos + %).
  const recurringFronts = activeProjects.filter((p: any) => isRecurringProject(p));
  const closedProjects = activeProjects.filter((p: any) => !isRecurringProject(p));
  const closedAvgProgress = closedProjects.length > 0
    ? Math.round(closedProjects.reduce((s: number, p: any) => s + (p.progress || 0), 0) / closedProjects.length)
    : 0;

  const now = new Date();
  const monthDelivered = (deliveredFiles || []).filter((f: any) => isSameMonth(f.created_at, now));
  const publications = contentPublications || [];
  const scheduled = publications.filter((p: any) => p.status === "scheduled");
  const published = publications.filter((p: any) => p.status === "published");
  const publishedThisMonth = published.filter((p: any) => isSameMonth(p.published_at || p.scheduled_at, now));
  // Relatorio velho nao e "agora": depois de 21 dias o card passa a mostrar o
  // retrato vivo (dados reais do proprio painel) em vez de texto antigo.
  const reportIsFresh = Boolean(
    latestReport &&
      Date.now() - new Date(latestReport.created_at || latestReport.period_end || 0).getTime() <
        21 * 24 * 60 * 60 * 1000,
  );
  const nextPublication = scheduled
    .filter((p: any) => p.scheduled_at && new Date(p.scheduled_at) >= now)
    .sort((a: any, b: any) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0] || null;
  const hasContentFront = recurringFronts.length > 0 || publications.length > 0;

  const upcomingMilestones = (milestones || [])
    .filter((m: any) => m.status !== "completed" && m.target_date)
    .slice(0, 4);

  if (loadingProjects) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-36 w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <StaggerContainer className="space-y-8">
      {/* 1 · Boas-vindas e contexto */}
      <FadeUp>
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-8">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-transparent to-primary/[0.02]" />
          <div className="relative z-10 flex items-start justify-between gap-4">
            <div>
              <p className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
                <CalendarDays className="h-3 w-3" />
                {new Date().toLocaleDateString("pt-BR", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </p>
              <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
                Bem-vindo de volta, {firstName}
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
                Acompanhe suas frentes, entregas e publicações liberadas pela Aceleriq.
              </p>
              {isImpersonation && (
                <p className="mt-3 text-xs text-sky-600">
                  Visualização administrativa em modo somente leitura.
                </p>
              )}
            </div>
            {closedProjects.length > 0 && (
              <div className="hidden shrink-0 flex-col items-center gap-1.5 sm:flex">
                <CircularProgress progress={closedAvgProgress} size={80} strokeWidth={5} />
                <span className="text-[10px] text-muted-foreground">Projetos com prazo</span>
              </div>
            )}
          </div>
        </div>
      </FadeUp>

      {/* 2 · Avisos importantes: atraso e renovação chegando */}
      {overdueBills.length > 0 && (
        <FadeUp>
          <button
            type="button"
            onClick={() => navigate("/financeiro")}
            className="flex w-full items-center gap-4 rounded-2xl border-2 border-red-500/50 bg-red-500/10 p-5 text-left transition-colors hover:border-red-500/70"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-500/20">
              <CalendarDays className="h-6 w-6 text-red-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold text-foreground">
                Pagamento em atraso: {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(overdueAmount)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Regularize para manter as entregas e publicações sem pausa. Toque para ver os detalhes.
              </p>
            </div>
            <ArrowUpRight className="h-5 w-5 shrink-0 text-red-500" />
          </button>
        </FadeUp>
      )}

      {renewalSoon && overdueBills.length === 0 && (
        <FadeUp>
          <button
            type="button"
            onClick={() => navigate("/financeiro")}
            className="flex w-full items-center gap-4 rounded-2xl border-2 border-sky-500/40 bg-sky-500/10 p-5 text-left transition-colors hover:border-sky-500/60"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sky-500/20">
              <Repeat className="h-6 w-6 text-sky-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold text-foreground">
                {renewalDays === 0
                  ? "Sua renovação vence hoje"
                  : `Sua renovação vence em ${renewalDays} dia${renewalDays === 1 ? "" : "s"}`}
                {clientProfile?.plan_value ? ` · ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(clientProfile.plan_value))}` : ""}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Garanta a continuidade dos resultados sem interrupção. Toque para ver os detalhes.
              </p>
            </div>
            <ArrowUpRight className="h-5 w-5 shrink-0 text-sky-500" />
          </button>
        </FadeUp>
      )}

      {/* 3 · Ação necessária: o que precisa aprovar e quando será postado */}
      {pendingFiles.length > 0 && (
        <FadeUp>
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5">
            <button
              type="button"
              onClick={() => navigate("/aprovacoes")}
              className="flex w-full items-center gap-4 text-left"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15">
                <FileCheck className="h-5 w-5 text-amber-500" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {pendingFiles.length === 1
                    ? "1 entrega aguarda a sua aprovação"
                    : `${pendingFiles.length} entregas aguardam a sua aprovação`}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Sua aprovação libera o agendamento da publicação. Aprovou, a Aceleriq programa na data planejada.
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-amber-500 px-3 py-1.5 text-[11px] font-semibold text-white">
                Aprovar agora
              </span>
            </button>
            <div className="mt-3 space-y-1.5 border-t border-amber-500/20 pt-3">
              {pendingFiles.slice(0, 3).map((file: any) => (
                <p key={file.id} className="truncate text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{file.file_name}</span>
                  {file.project?.name ? ` · ${file.project.name}` : ""}
                </p>
              ))}
              {pendingFiles.length > 3 && (
                <p className="text-[11px] text-muted-foreground">e mais {pendingFiles.length - 3} na área de Aprovações</p>
              )}
            </div>
          </div>
        </FadeUp>
      )}

      {/* 3 · Métricas gerais */}
      <FadeUp>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {[
            {
              label: "Frentes ativas",
              value: activeProjects.length,
              detail: doneProjects.length ? `${doneProjects.length} concluída(s)` : "Nenhuma concluída",
              icon: Briefcase,
              color: "text-primary",
              bg: "bg-primary/10",
            },
            {
              label: "Etapas concluídas",
              value: completedMilestonesCount,
              detail: `${totalMilestones} etapa(s) no total`,
              icon: Target,
              color: "text-sky-500",
              bg: "bg-sky-500/10",
            },
            {
              label: "Entregas liberadas",
              value: totalFiles,
              detail: approvedFiles ? `${approvedFiles} aprovada(s)` : "Aguardando decisões",
              icon: PackageCheck,
              color: "text-emerald-500",
              bg: "bg-emerald-500/10",
            },
            {
              label: "Aprovações pendentes",
              value: pendingFiles.length,
              detail: pendingFiles.length ? "Ação necessária" : "Nenhuma pendência",
              icon: FileCheck,
              color: "text-amber-500",
              bg: "bg-amber-500/10",
            },
          ].map((metric) => (
            <div key={metric.label} className="rounded-xl border border-border bg-card p-4 sm:p-5">
              <div className="mb-2 flex items-center justify-between">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${metric.bg}`}>
                  <metric.icon className={`h-4 w-4 ${metric.color}`} />
                </div>
                <span className="text-2xl font-bold tabular-nums text-foreground">{metric.value}</span>
              </div>
              <p className="text-xs text-muted-foreground">{metric.label}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground/70">{metric.detail}</p>
            </div>
          ))}
        </div>
      </FadeUp>

      {/* Atalhos principais: sempre a um toque, nunca escondidos no rodape */}
      <FadeUp>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {[
            { label: "Projetos", icon: Briefcase, to: "/projetos" },
            { label: "Aprovações", icon: FileCheck, to: "/aprovacoes" },
            { label: "Calendário", icon: CalendarDays, to: "/calendario" },
            { label: "Relatórios", icon: FileText, to: "/relatorios" },
            { label: "Cofre", icon: FolderOpen, to: "/cofre" },
            { label: "Pedidos", icon: Inbox, to: "/pedidos" },
          ].map((shortcut) => (
            <button
              key={shortcut.to}
              type="button"
              onClick={() => navigate(shortcut.to)}
              className="flex min-h-[64px] touch-manipulation flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-2 py-3 text-[11px] text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground active:scale-[0.97]"
            >
              <shortcut.icon className="h-[18px] w-[18px]" />
              {shortcut.label}
            </button>
          ))}
        </div>
      </FadeUp>

      {/* 4 · Conteúdos deste ciclo (só para quem tem frente de conteúdo) */}
      {hasContentFront && (
        <FadeUp>
          <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <CalendarCheck className="h-4 w-4 text-primary" />
                Conteúdos deste ciclo
              </h2>
              <button
                type="button"
                onClick={() => navigate("/calendario")}
                className="flex items-center gap-1 text-xs font-medium text-primary transition-opacity hover:opacity-80"
              >
                Ver calendário completo
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                {
                  label: "Aguardando aprovação",
                  value: pendingFiles.length,
                  tone: pendingFiles.length > 0 ? "text-amber-500" : "text-muted-foreground",
                },
                { label: "Programados", value: scheduled.length, tone: "text-sky-500" },
                { label: "Publicados no mês", value: publishedThisMonth.length, tone: "text-emerald-500" },
                { label: "Publicados no total", value: published.length, tone: "text-foreground" },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-border/70 bg-secondary/30 p-3">
                  <p className={`text-xl font-bold tabular-nums ${item.tone}`}>{item.value}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{item.label}</p>
                </div>
              ))}
            </div>
            {nextPublication && (
              <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <Send className="h-3.5 w-3.5 text-sky-500" />
                Próxima publicação:
                <span className="font-medium text-foreground">
                  {new Date(nextPublication.scheduled_at).toLocaleDateString("pt-BR", {
                    weekday: "short",
                    day: "2-digit",
                    month: "short",
                  })}
                  {" às "}
                  {new Date(nextPublication.scheduled_at).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {nextPublication.platform && (
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px]">
                    {platformLabel[nextPublication.platform] || nextPublication.platform}
                  </span>
                )}
              </p>
            )}
          </section>
        </FadeUp>
      )}

      {/* Linha de etapas: em que ponto do processo o trabalho esta agora */}
      <FadeUp>
        {(() => {
          // Etapas genericas de growth: valem para qualquer servico (social,
          // trafego, site, avulso, hibrido). A etapa e lida dos dados reais.
          const stages = ["Planejamento", "Produção", "Sua aprovação", "Entrega", "Acompanhamento"];
          const hasDeliveries = deliveredFiles.length > 0;
          const currentStage =
            published.length > 0 || latestReport ? 4 :
            hasDeliveries || scheduled.length > 0 ? 3 :
            pendingFiles.length > 0 ? 2 :
            activeProjects.length > 0 ? 1 : 0;
          const stageHints = [
            "Estamos organizando a base do trabalho.",
            "As entregas estão sendo produzidas agora.",
            "Tem material esperando o seu OK.",
            "Entregas liberadas e trabalho rodando.",
            "No ar e medindo resultado para otimizar.",
          ];
          return (
            <div className="rounded-2xl border border-border bg-card px-4 py-4 sm:px-6">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Etapa do processo
              </p>
              <ol className="mt-3 flex items-center gap-0" aria-label="Etapas do trabalho">
                {stages.map((stage, index) => {
                  const done = index < currentStage;
                  const current = index === currentStage;
                  return (
                    <li key={stage} className="flex min-w-0 flex-1 items-center">
                      <div className="flex min-w-0 flex-col items-center gap-1.5 text-center flex-1">
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold transition-colors ${
                            current
                              ? "border-primary bg-primary text-primary-foreground shadow-[0_0_12px_hsl(var(--primary)/0.45)]"
                              : done
                                ? "border-primary/40 bg-primary/15 text-primary"
                                : "border-border bg-secondary/40 text-muted-foreground"
                          }`}
                        >
                          {done ? "✓" : index + 1}
                        </span>
                        <span className={`truncate text-[9px] leading-tight sm:text-[10px] ${current ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                          {stage}
                        </span>
                      </div>
                      {index < stages.length - 1 && (
                        <span className={`mx-0.5 mb-4 h-px flex-1 ${done ? "bg-primary/50" : "bg-border"}`} aria-hidden="true" />
                      )}
                    </li>
                  );
                })}
              </ol>
              <p className="mt-3 text-center text-[11px] text-muted-foreground">
                {stageHints[currentStage]}
              </p>
            </div>
          );
        })()}
      </FadeUp>

      {/* 8 · O que estamos fazendo, onde estamos e o próximo passo */}
      <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Onde estamos agora</h2>
          {!(latestReport && reportIsFresh) && (
            <button
              type="button"
              onClick={() => navigate("/onde-estamos")}
              className="group w-full rounded-xl border border-primary/25 bg-gradient-to-br from-primary/[0.07] to-transparent p-4 text-left transition-colors hover:border-primary/40"
            >
              <p className="text-[13px] font-medium leading-relaxed text-foreground">
                {deliveredFiles.length > 0
                  ? `Trabalho em movimento: ${deliveredFiles.length} entrega(s) já liberada(s).`
                  : "Estamos organizando o seu ciclo de trabalho."}
                {nextPublication?.scheduled_at &&
                  ` Próxima publicação em ${new Date(nextPublication.scheduled_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}.`}
              </p>
              <p className="mt-2 flex items-center gap-1 text-[11px] text-primary">
                Ver o retrato completo em tempo real
                <ArrowUpRight className="h-3 w-3" />
              </p>
            </button>
          )}
      {latestReport && reportIsFresh && (
        <div>
          <button
            type="button"
            onClick={() => navigate("/onde-estamos")}
            className="group w-full rounded-xl border border-primary/25 bg-primary/[0.04] p-4 text-left transition-colors hover:border-primary/40"
          >
            <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <FileText className="h-3.5 w-3.5 text-primary" />
              {latestReport.title}
            </p>
            {latestReport.highlights && (
              <div className="mt-3">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-primary">O que estamos fazendo</p>
                <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-foreground">{latestReport.highlights}</p>
              </div>
            )}
            {latestReport.summary && (
              <div className="mt-3">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-primary">Resultado explicado</p>
                <p className="mt-1 line-clamp-4 whitespace-pre-line text-[11px] leading-relaxed text-muted-foreground">{latestReport.summary}</p>
              </div>
            )}
            {latestReport.next_steps && (
              <div className="mt-3">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-primary">Próxima etapa</p>
                <p className="mt-1 line-clamp-2 whitespace-pre-line text-[11px] leading-relaxed text-muted-foreground">{latestReport.next_steps}</p>
              </div>
            )}
            <p className="mt-3 flex items-center gap-1 text-[10px] text-primary">
              Abrir Onde Estamos (todas as atualizações)
              <ArrowUpRight className="h-3 w-3" />
            </p>
          </button>
        </div>
      )}
        </section>


      {/* Projetos com prazo e Entregas recentes lado a lado, cada um com o proprio scroll */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 items-start">
        <div className="max-h-[420px] overflow-y-auto pr-1 rounded-2xl">
            {/* 6 · Projetos com começo e fim: porcentagem + marcos */}
            {(closedProjects.length > 0 || doneProjects.length > 0) && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-foreground">Projetos com prazo</h2>
                  <span className="text-xs text-muted-foreground">
                    {closedProjects.length} ativo(s)
                    {doneProjects.length > 0 ? ` · ${doneProjects.length} concluído(s)` : ""}
                  </span>
                </div>
                {[...closedProjects, ...doneProjects].map((project: any) => {
                  const projectMilestones = milestones.filter((milestone: any) => milestone.project_id === project.id);
                  const completed = projectMilestones.filter((milestone: any) => milestone.status === "completed").length;
                  const deadlineDistance = project.deadline ? daysUntil(project.deadline) : null;
                  return (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => onSelectProject(project)}
                      className="group w-full rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/30"
                    >
                      <div className="flex items-start gap-4">
                        <CircularProgress progress={project.progress || 0} size={56} strokeWidth={4} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                                {typeLabels[project.project_type] || "Projeto"} · {projectStatusLabel[project.status] || project.status}
                              </p>
                              <p className="mt-1 truncate text-sm font-semibold text-foreground">{project.name}</p>
                            </div>
                            <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                          </div>
                          <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                              {completed}/{projectMilestones.length} etapas
                            </span>
                            {project.deadline && (
                              <span>
                                {deadlineDistance !== null && deadlineDistance < 0
                                  ? "Prazo em atualização"
                                  : `Previsão ${formatDateShort(project.deadline)}`}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </section>
            )}
        </div>
        <div className="max-h-[420px] overflow-y-auto pr-1 rounded-2xl">
            {/* 9 · Entregas recentes (histórico de valor) */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground">Entregas recentes</h2>
              <div className="rounded-xl border border-border bg-card p-4">
                {deliveredFiles.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    Nenhuma entrega liberada ainda.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {deliveredFiles.slice(0, 6).map((file: any) => (
                      <div key={file.id} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
                        <p className="truncate text-xs font-medium text-foreground">{file.file_name}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {file.project?.name || "Entrega"} · v{file.version || 1}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <FadeUp className="lg:col-span-2">
          <div className="space-y-6">
            {/* 5 · Frentes recorrentes: ciclo mensal, sem porcentagem eterna */}
            {recurringFronts.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Repeat className="h-4 w-4 text-primary" />
                    Frentes recorrentes
                  </h2>
                  <span className="text-xs text-muted-foreground">Ciclo mensal</span>
                </div>
                {recurringFronts.map((project: any) => {
                  const projectDeliveredMonth = monthDelivered.filter((f: any) => f.project_id === project.id).length;
                  const projectPending = pendingFiles.filter((f: any) => f.project?.name === project.name).length;
                  return (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => onSelectProject(project)}
                      className="group w-full rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/30"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                            {typeLabels[project.project_type] || "Recorrente"} · {projectStatusLabel[project.status] || project.status}
                          </p>
                          <p className="mt-1 truncate text-sm font-semibold text-foreground">{project.name}</p>
                        </div>
                        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <PackageCheck className="h-3 w-3 text-emerald-500" />
                          {projectDeliveredMonth} entrega(s) liberada(s) neste mês
                        </span>
                        {projectPending > 0 && (
                          <span className="flex items-center gap-1 text-amber-500">
                            <FileCheck className="h-3 w-3" />
                            {projectPending} aguardando sua aprovação
                          </span>
                        )}
                        {nextPublication && (
                          <span className="flex items-center gap-1">
                            <Send className="h-3 w-3 text-sky-500" />
                            Próxima publicação {formatDateShort(nextPublication.scheduled_at)}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </section>
            )}

            {clientId && (
              <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
                <ProjectJournal clientId={clientId} canWrite={false} />
              </div>
            )}

            {activeProjects.length === 0 && doneProjects.length === 0 && (
              <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                Novos projetos aparecerão aqui quando forem iniciados.
              </div>
            )}
          </div>
        </FadeUp>

        <FadeUp>
          <div className="space-y-6">
            {/* 7 · Quando será postado: agenda das publicações confirmadas */}
            {(scheduled.length > 0 || published.length > 0) && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-foreground">Quando será postado</h2>
                  <button
                    type="button"
                    onClick={() => navigate("/calendario")}
                    className="text-[11px] font-medium text-primary hover:opacity-80"
                  >
                    Ver calendário
                  </button>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  {scheduled.length === 0 ? (
                    <p className="py-4 text-center text-xs text-muted-foreground">
                      Nenhuma publicação programada no momento.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {scheduled
                        .filter((p: any) => p.scheduled_at)
                        .slice(0, 5)
                        .map((publication: any) => (
                          <div key={publication.id} className="flex items-center gap-3 border-b border-border/60 pb-3 last:border-0 last:pb-0">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/10">
                              <Send className="h-3.5 w-3.5 text-sky-500" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-foreground">
                                {new Date(publication.scheduled_at).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" })}
                                {" às "}
                                {new Date(publication.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                              </p>
                              <p className="mt-0.5 text-[10px] text-muted-foreground">
                                {platformLabel[publication.platform] || publication.platform || "Rede social"} · Programado
                              </p>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                  {published.slice(0, 2).some((p: any) => p.permalink) && (
                    <div className="mt-3 border-t border-border/60 pt-3 space-y-1.5">
                      {published
                        .filter((p: any) => p.permalink)
                        .slice(0, 2)
                        .map((publication: any) => (
                          <a
                            key={publication.id}
                            href={publication.permalink}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 text-[11px] text-emerald-500 no-underline hover:opacity-80"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            Publicado · ver no {platformLabel[publication.platform] || "perfil"}
                            <ArrowUpRight className="h-3 w-3" />
                          </a>
                        ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Próximas entregas (etapas com data) */}
            {upcomingMilestones.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-foreground">Próximas entregas</h2>
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="space-y-3">
                    {upcomingMilestones.map((milestone: any) => (
                      <div key={milestone.id} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
                        <p className="truncate text-xs font-medium text-foreground">{milestone.title}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {milestone.project?.name || "Projeto"} · previsão {formatDateShort(milestone.target_date)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

          </div>
        </FadeUp>
      </div>

      {/* Pulso Aceleriq: avaliação rápida da experiência */}
      {showPulse && (
        <FadeUp>
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <p className="text-sm font-semibold text-foreground">Como está sendo a experiência com a Aceleriq?</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Leva 5 segundos e vai direto para o nosso time. Sua opinião guia o próximo ciclo.
            </p>
            <div className="mt-4 flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((score) => (
                <button
                  key={score}
                  type="button"
                  onClick={() => setPulseScore(score)}
                  aria-label={`Nota ${score}`}
                  className={`flex h-11 w-11 items-center justify-center rounded-xl border text-base font-semibold transition-colors ${
                    pulseScore === score
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-secondary/30 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {score}
                </button>
              ))}
              <span className="ml-1 text-[10px] text-muted-foreground hidden sm:inline">1 = precisa melhorar · 5 = excelente</span>
            </div>
            {pulseScore !== null && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={pulseComment}
                  onChange={(e) => setPulseComment(e.target.value)}
                  rows={2}
                  placeholder="Quer contar algo para a gente? (opcional)"
                  className="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs text-foreground resize-none"
                />
                <button
                  type="button"
                  onClick={submitPulse}
                  disabled={pulseSending}
                  className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {pulseSending ? "Enviando…" : "Enviar avaliação"}
                </button>
              </div>
            )}
          </div>
        </FadeUp>
      )}

      {/* 10 · Evolução acumulada + atalhos */}
      <FadeUp>
        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
              Evolução acumulada:
            </span>
            <span><span className="font-semibold text-foreground">{totalFiles}</span> entregas liberadas</span>
            <span><span className="font-semibold text-foreground">{approvedFiles}</span> aprovadas</span>
            {published.length > 0 && (
              <span><span className="font-semibold text-foreground">{published.length}</span> publicações realizadas</span>
            )}
            {doneProjects.length > 0 && (
              <span><span className="font-semibold text-foreground">{doneProjects.length}</span> projetos concluídos</span>
            )}
          </div>
        </div>
      </FadeUp>
    </StaggerContainer>
  );
}
