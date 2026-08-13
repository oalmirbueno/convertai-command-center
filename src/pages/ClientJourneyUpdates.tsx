import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useClientIdentity } from "@/hooks/useClientIdentity";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Compass, FileCheck, CalendarDays, Inbox, ArrowUpRight,
  CheckCircle2, Clock, Sparkles, ExternalLink, AlertCircle,
} from "lucide-react";
import { buildJourneyNarrative } from "@/lib/clientJourneyNarrative";
import ProjectJournal from "@/components/shared/ProjectJournal";
import { buildProgressView, cycleFillPercent } from "@/lib/projectProgress";

/**
 * Onde Estamos: o retrato do trabalho em tempo real.
 *
 * A tela se monta sozinha com o que já existe no painel (frentes, entregas,
 * aprovações, publicações). As atualizações escritas pela Aceleriq entram como
 * uma camada extra na linha do tempo, nunca como pré-requisito: antes, sem
 * ritual publicado, o cliente clicava e caía numa página muda.
 */

const RITUAL_LABELS: Record<string, { label: string; cls: string }> = {
  rota_semana: { label: "Rota da Semana", cls: "bg-primary/10 text-primary" },
  meio_semana: { label: "Check do Meio da Semana", cls: "bg-sky-500/10 text-sky-500" },
  prova_movimento: { label: "Prova de Movimento", cls: "bg-emerald-500/10 text-emerald-500" },
  radar_aceleriq: { label: "Radar Aceleriq", cls: "bg-info/10 text-info" },
  marco_90: { label: "Marco 90", cls: "bg-amber-500/10 text-amber-500" },
};

const SIGNAL_TONE: Record<string, string> = {
  good: "text-emerald-500",
  attention: "text-amber-500",
  neutral: "text-foreground",
};

export default function ClientJourneyUpdates() {
  const navigate = useNavigate();
  const { clientId, isImpersonating } = useClientIdentity();
  const { profile } = useAuth();
  // Staff sem "Ver como Cliente" nao tem jornada propria: sem esta trava, o
  // admin via os dados do proprio cadastro achando que eram de um cliente.
  const isStaff =
    profile?.role === "admin" ||
    ["design", "traffic", "manager"].includes(profile?.role || "");
  if (isStaff && !isImpersonating) {
    return <Navigate to="/central" replace />;
  }

  // Um único retrato do momento, atualizado sozinho a cada 30 segundos.
  const { data: snapshot, isLoading, isError } = useQuery({
    queryKey: ["client-journey-live", clientId],
    queryFn: async () => {
      const [projects, tasks, milestones, approvals, publications, reports] =
        await Promise.all([
          supabase
            .from("projects")
            .select("id, name, status, billing_mode, deadline, objectives")
            .eq("client_id", clientId!)
            .is("deleted_at", null),
          supabase
            .from("tasks")
            .select("project_id, title, status, due_date, deleted_at")
            .is("deleted_at", null),
          supabase
            .from("milestones")
            .select("project_id, title, status, target_date")
            .is("deleted_at", null),
          supabase
            .from("files")
            .select("id, file_name, created_at")
            .eq("client_id", clientId!)
            .eq("visibility", "approval")
            .eq("approval_status", "pending")
            .eq("status", "ready")
            .is("archived_at", null)
            .is("parent_file_id", null),
          supabase
            .from("editorial_publications")
            .select("status, scheduled_at, published_at, permalink, platform")
            .eq("client_id", clientId!),
          supabase
            .from("reports")
            .select("id, title, summary, next_steps, metrics, created_at")
            .eq("client_id", clientId!)
            .eq("status", "published")
            .order("created_at", { ascending: false })
            .limit(40),
        ]);

      // Tarefas e marcos vem sem filtro de cliente no banco; recorta aqui
      // pelos projetos DESTE cliente. Sem isso, um admin abrindo a pagina
      // via o painel inteiro somado (609 entregas "em producao").
      const projectIds = new Set((projects.data || []).map((project) => project.id));
      return {
        projects: projects.data || [],
        tasks: (tasks.data || []).filter((task) => task.project_id && projectIds.has(task.project_id)),
        milestones: (milestones.data || []).filter(
          (milestone) => milestone.project_id && projectIds.has(milestone.project_id),
        ),
        approvals: approvals.data || [],
        publications: publications.data || [],
        reports: reports.data || [],
      };
    },
    enabled: !!clientId,
    refetchInterval: 30_000,
  });

  const narrative = useMemo(() => {
    if (!snapshot) return null;
    return buildJourneyNarrative({
      projects: snapshot.projects as any[],
      tasks: snapshot.tasks as any[],
      milestones: snapshot.milestones as any[],
      pendingApprovals: snapshot.approvals.length,
      publications: snapshot.publications as any[],
    });
  }, [snapshot]);

  const rituals = useMemo(
    () => (snapshot?.reports || []).filter((r: any) => Boolean((r.metrics as any)?.ritual_type)),
    [snapshot],
  );

  const published = useMemo(
    () =>
      (snapshot?.publications || [])
        .filter((p: any) => p.status === "published" && p.published_at)
        .sort((a: any, b: any) => (b.published_at > a.published_at ? 1 : -1))
        .slice(0, 5),
    [snapshot],
  );

  const activeProjects = useMemo(
    () => (snapshot?.projects || []).filter((p: any) => (p.status || "active") !== "done"),
    [snapshot],
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-56 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <p className="heading-page flex items-center gap-2">
          <Compass className="h-5 w-5 text-primary" /> Onde Estamos
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          O retrato do seu trabalho agora: o que já foi entregue, o que está em produção e qual é o próximo passo.
          Esta página se atualiza sozinha.
        </p>
      </div>

      {isError && (
        <div className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive/5 p-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Não conseguimos carregar as informações agora. Tente atualizar a página em instantes.
          </p>
        </div>
      )}

      {/* ── Retrato automático do momento ── */}
      {narrative && (
        <section className="overflow-hidden rounded-2xl border border-primary/25 bg-card">
          <div className="border-b border-border bg-primary/[0.04] px-5 py-4 sm:px-7 sm:py-5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary">
              <Sparkles className="h-3 w-3" /> {narrative.phase}
            </span>
            <h2 className="mt-2.5 text-base font-semibold leading-snug text-foreground sm:text-lg">
              {narrative.headline}
            </h2>
          </div>

          <div className="space-y-5 px-5 py-5 sm:px-7 sm:py-6">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {narrative.signals.map((signal) => (
                <div key={signal.label} className="rounded-xl border border-border bg-secondary/25 p-3">
                  <p className={`text-xl font-bold tabular-nums ${SIGNAL_TONE[signal.tone]}`}>
                    {signal.value}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{signal.label}</p>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              {narrative.paragraphs.map((paragraph) => (
                <p key={paragraph} className="text-[13px] leading-relaxed text-foreground">
                  {paragraph}
                </p>
              ))}
            </div>

            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-4">
              <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> Próximo passo
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-foreground">{narrative.nextStep}</p>
            </div>
          </div>
        </section>
      )}

      {/* ── Atalhos ── */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Aprovações", icon: FileCheck, to: "/aprovacoes" },
          { label: "Calendário", icon: CalendarDays, to: "/calendario" },
          { label: "Pedidos", icon: Inbox, to: "/pedidos" },
        ].map((shortcut) => (
          <button
            key={shortcut.to}
            type="button"
            onClick={() => navigate(shortcut.to)}
            className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-3 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
          >
            <shortcut.icon className="h-4 w-4" /> {shortcut.label}
          </button>
        ))}
      </div>

      {/* ── Frentes ativas ── */}
      {activeProjects.length > 0 && (
        <section className="space-y-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Suas frentes
          </p>
          {activeProjects.map((project: any) => {
            const view = buildProgressView(project, (snapshot?.tasks || []) as any[]);
            return (
              <div key={project.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-[13px] font-medium text-foreground">{project.name}</p>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {view.mode === "percent" ? `${view.percent}%` : view.label}
                  </span>
                </div>
                <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${cycleFillPercent(view)}%` }}
                  />
                </div>
                {view.mode === "cycle" && view.nextTitle && (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" /> A seguir: {view.nextTitle}
                  </p>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* ── O que já foi ao ar ── */}
      {published.length > 0 && (
        <section className="space-y-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Já publicado
          </p>
          {published.map((publication: any, index: number) => (
            <div
              key={`${publication.published_at}-${index}`}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              <p className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                Publicado em{" "}
                {new Date(publication.published_at).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "long",
                })}
              </p>
              {publication.permalink && (
                <a
                  href={publication.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="flex shrink-0 items-center gap-1 text-[11px] text-primary hover:opacity-80"
                >
                  Ver <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          ))}
        </section>
      )}

      {/* ── Diário do trabalho: cada movimento, na hora ── */}
      {clientId && <ProjectJournal clientId={clientId} canWrite={false} />}

      {/* ── Atualizações escritas pela Aceleriq ── */}
      {rituals.length > 0 && (
        <section className="space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Atualizações da Aceleriq
          </p>
          {rituals.map((update: any, index: number) => {
            const ritualType = (update.metrics as any)?.ritual_type as string;
            const badge = RITUAL_LABELS[ritualType] || {
              label: "Atualização",
              cls: "bg-secondary text-muted-foreground",
            };
            const isLatest = index === 0;
            return (
              <article
                key={update.id}
                className={`rounded-2xl border bg-card p-5 sm:p-6 ${isLatest ? "border-primary/40 shadow-sm" : "border-border"}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${badge.cls}`}>
                    {badge.label}
                  </span>
                  {isLatest && (
                    <span className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-medium text-primary-foreground">
                      Mais recente
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {new Date(update.created_at).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "long",
                    })}
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-foreground">{update.title}</h3>
                {update.summary && (
                  <div
                    className={`mt-3 whitespace-pre-line text-[13px] leading-relaxed text-muted-foreground ${isLatest ? "" : "line-clamp-6"}`}
                  >
                    {update.summary}
                  </div>
                )}
                {update.next_steps && (
                  <div className="mt-4 rounded-xl border border-primary/20 bg-primary/[0.04] p-3.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">
                      Próximo passo
                    </p>
                    <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-foreground">
                      {update.next_steps}
                    </p>
                  </div>
                )}
                {!isLatest && (
                  <button
                    type="button"
                    onClick={() => navigate(`/relatorios/${update.id}`)}
                    className="mt-3 flex items-center gap-1 text-[11px] text-primary hover:opacity-80"
                  >
                    Ver completa <ArrowUpRight className="h-3 w-3" />
                  </button>
                )}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
