import { useMemo, useState } from "react";
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
  Instagram, TrendingDown, TrendingUp,
} from "lucide-react";
import { buildJourneyNarrative } from "@/lib/clientJourneyNarrative";
import { readMemory } from "@/lib/clientMemory";
import {
  formatMetricNumber,
  useSocialMetricsWeekly,
  weekDeltaPct,
} from "@/hooks/useSocialMetrics";

/**
 * O narrador do mês: a IA escreve 3 a 5 frases contando o mês do cliente a
 * partir da linha do tempo real do painel. Cache local de 24 horas por
 * cliente e mês, para a página abrir na hora e a IA não rodar a cada visita.
 * Sem movimento no mês ou com o narrador indisponível, o card simplesmente
 * não aparece: nunca um erro na cara do cliente.
 */
function MonthNarrative({ clientId }: { clientId: string }) {
  const monthKey = new Date().toISOString().slice(0, 7);
  const cacheKey = `aceleriq-narrative-${clientId}-${monthKey}`;

  const { data } = useQuery({
    queryKey: ["journey-narrative", clientId, monthKey],
    queryFn: async (): Promise<{ narrative: string | null; month?: string }> => {
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Date.now() - (parsed.at || 0) < 24 * 3600_000) return parsed.value;
        }
      } catch { /* cache corrompido: gera de novo */ }

      const { data: result, error } = await supabase.functions.invoke("journey-narrative", {
        body: { client_id: clientId },
      });
      if (error || result?.error) return { narrative: null };
      const value = { narrative: result?.narrative ?? null, month: result?.month };
      // Só uma resposta com texto entra no cache de 24h. Falha ou mês sem
      // movimento não ficam gravados: na próxima visita tenta de novo.
      if (value.narrative) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), value }));
        } catch { /* armazenamento cheio: segue sem cache */ }
      }
      return value;
    },
    staleTime: 24 * 3600_000,
    retry: 1,
  });

  if (!data?.narrative) return null;
  return (
    <section className="rounded-xl border border-primary/25 bg-primary/[0.04] p-5 sm:p-6">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
        O seu mês{data.month ? ` de ${data.month}` : ""}, contado pela Aceleriq
      </p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-foreground/90">{data.narrative}</p>
    </section>
  );
}
/**
 * Bastidores da semana: o trabalho que acontece antes de qualquer post ir ao
 * ar. Vem do checklist que a equipe fecha toda semana, traduzido para a
 * linguagem do cliente. Sem movimento na semana, o bloco não aparece: o
 * cliente nunca vê uma caixa vazia dizendo que nada foi feito.
 */
function WeekBackstage({ clientId }: { clientId: string }) {
  const { data } = useQuery({
    queryKey: ["cycle-client-pulse", clientId],
    queryFn: async () => {
      const { data: result, error } = await supabase.functions.invoke("cycle-client-pulse", {
        body: { client_id: clientId },
      });
      if (error || result?.error) return null;
      return result as {
        fronts: Array<{ area: string; label: string; done: number; total: number; highlights: string[]; last_at: string | null }>;
        total: number;
      };
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (!data?.fronts?.length) return null;

  return (
    <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Bastidores desta semana
        </p>
        <span className="text-[10px] text-muted-foreground">
          {data.total} {data.total === 1 ? "etapa concluída" : "etapas concluídas"}
        </span>
      </div>
      <div className="mt-3 space-y-3">
        {data.fronts.map((front) => (
          <div key={front.area}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12.5px] font-semibold text-foreground">{front.label}</p>
              <p className="text-[11px] tabular-nums text-muted-foreground">
                {front.done} de {front.total}
              </p>
            </div>
            <div className="mt-1.5 flex h-1.5 gap-[3px]">
              {Array.from({ length: front.total }, (_, index) => (
                <span
                  key={index}
                  className={`flex-1 rounded-full ${index < front.done ? "bg-primary" : "bg-secondary"}`}
                />
              ))}
            </div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
              {front.highlights.join(", ")}.
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground">
        Este é o trabalho de bastidor da semana, atualizado conforme a equipe
        avança. O que chega até você, como conteúdo e publicações, nasce daqui.
      </p>
    </section>
  );
}

/**
 * A história da parceria, contada em ordem.
 *
 * O cliente via o estado de agora (entregas, publicações) mas não a linha do
 * tempo do que foi construído. Aqui aparecem os capítulos que já foram
 * escritos para ele, então a relação tem memória e ele consegue ver de onde
 * veio o que está acontecendo hoje.
 */
function ClientHistory({ clientId }: { clientId: string }) {
  const { data: entries } = useQuery({
    queryKey: ["client-memory-timeline", clientId],
    queryFn: () => readMemory(clientId, { limit: 8, onlyClientVisible: true }),
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (!entries?.length) return null;

  return (
    <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        A nossa história até aqui
      </p>
      <div className="mt-4 space-y-4 border-l border-border pl-4">
        {entries.map((entry) => (
          <div key={entry.id} className="relative">
            <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
            <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
              {new Date(entry.created_at).toLocaleDateString("pt-BR", {
                day: "2-digit", month: "long", year: "numeric",
              })}
            </p>
            {entry.title && (
              <p className="mt-0.5 text-[13.5px] font-semibold leading-snug text-foreground">
                {entry.title}
              </p>
            )}
            <p className="mt-1 whitespace-pre-line text-[12.5px] leading-relaxed text-muted-foreground">
              {entry.content.length > 320 ? `${entry.content.slice(0, 320)}...` : entry.content}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[10.5px] leading-relaxed text-muted-foreground">
        Cada capítulo fica guardado aqui: o que foi combinado, o que foi feito e
        o porquê. Assim nada se perde entre uma conversa e outra.
      </p>
    </section>
  );
}

import ProjectJournal from "@/components/shared/ProjectJournal";
import { buildProgressView, cycleFillPercent } from "@/lib/projectProgress";
import { buildGrowthSeries } from "@/lib/reportGrowth";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

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

/**
 * Instagram em números reais: a última semana fechada coletada da Meta, com a
 * variação contra a semana anterior e o histórico de alcance. Sem dados (conta
 * ainda não conectada ou primeira coleta pendente), o bloco não aparece.
 */
function InstagramRealBlock({ clientId }: { clientId: string }) {
  const { data: rows } = useSocialMetricsWeekly(clientId, 12);
  if (!rows || rows.length === 0) return null;
  const latest = rows[0];
  const weekLabel = (value: string) => {
    const [, month, day] = value.split("-");
    return `${day}/${month}`;
  };
  const cards = [
    { label: "Seguidores", value: latest.followers, delta: weekDeltaPct(rows, "followers") },
    { label: "Alcance na semana", value: latest.reach, delta: weekDeltaPct(rows, "reach") },
    { label: "Interações", value: latest.total_interactions, delta: weekDeltaPct(rows, "total_interactions") },
    { label: "Visitas ao perfil", value: latest.profile_views, delta: weekDeltaPct(rows, "profile_views") },
  ].filter((card) => card.value != null);
  if (cards.length === 0) return null;
  const maxReach = Math.max(...rows.map((row) => row.reach || 0), 1);
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4 sm:px-7">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary">
          <Instagram className="h-3 w-3" /> Instagram em números reais
        </span>
        <p className="mt-2 text-xs text-muted-foreground">
          Semana de {weekLabel(latest.week_start)} a {weekLabel(latest.week_end)},
          direto da sua conta. Atualiza sozinho toda semana.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-4 sm:px-7">
        {cards.map((card) => {
          const up = card.delta != null && card.delta >= 0;
          return (
            <div key={card.label} className="rounded-xl border border-border bg-secondary/25 p-3">
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {card.label}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <p className="font-mono text-sm font-semibold text-foreground">
                  {formatMetricNumber(card.value)}
                </p>
                {card.delta != null && (
                  <span
                    className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                      up ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                    }`}
                  >
                    {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {`${up ? "+" : ""}${card.delta.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {rows.length > 1 && (
        <div className="border-t border-border px-5 py-4 sm:px-7">
          <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Alcance semana a semana
          </p>
          <div className="mt-2 space-y-1.5">
            {rows.slice(0, 8).map((row) => (
              <div key={row.id} className="flex items-center gap-2">
                <span className="w-24 shrink-0 font-mono text-[10px] text-muted-foreground">
                  {weekLabel(row.week_start)} a {weekLabel(row.week_end)}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${Math.max(((row.reach || 0) / maxReach) * 100, 2)}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right font-mono text-[10px] text-foreground">
                  {formatMetricNumber(row.reach)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default function ClientJourneyUpdates() {
  const navigate = useNavigate();
  const { clientId, isImpersonating } = useClientIdentity();
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
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
      const [projects, tasks, milestones, approvals, allFiles, publications, reports] =
        await Promise.all([
          supabase
            .from("projects")
            .select("id, name, status, billing_mode, deadline, objectives, project_type, created_at")
            .eq("client_id", clientId!)
            .is("deleted_at", null),
          supabase
            .from("tasks")
            .select("project_id, title, status, due_date, deleted_at")
            .is("deleted_at", null),
          supabase
            .from("milestones")
            .select("project_id, title, status, target_date, updated_at")
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
            .from("files")
            .select("id, created_at, approval_status, visibility")
            .eq("client_id", clientId!)
            .in("visibility", ["client_shared", "approval"])
            .eq("status", "ready")
            .is("archived_at", null)
            .is("parent_file_id", null)
            .limit(500),
          supabase
            .from("editorial_publications")
            .select("status, scheduled_at, published_at, permalink, platform")
            .eq("client_id", clientId!),
          supabase
            .from("reports")
            .select("id, title, summary, next_steps, metrics, created_at, period_start, period_end")
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
        allFiles: allFiles.data || [],
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
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="heading-page flex items-center gap-2">
          <Compass className="h-5 w-5 text-primary" /> Onde Estamos
        </h1>
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

      {/* ── O narrador do mês: a IA conta o mês com os fatos reais ── */}
      {clientId && <MonthNarrative clientId={clientId} />}
      {clientId && <WeekBackstage clientId={clientId} />}
      {clientId && <ClientHistory clientId={clientId} />}

      {/* ── Instagram em números REAIS, coletados da Meta toda semana ── */}
      {clientId && <InstagramRealBlock clientId={clientId} />}

      {/* ── Retrato automático do momento ── */}
      {narrative && (
        <section className="overflow-hidden rounded-xl border border-primary/25 bg-card">
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
              {narrative.signals.map((signal) => {
                const signalTarget: Record<string, string> = {
                  "Entregas concluídas no mês": "/documentos",
                  "Em produção agora": "/projetos",
                  "Publicações no ar": "/calendario",
                  "Esperando você": "/aprovacoes",
                };
                const target = signalTarget[signal.label];
                return (
                  <button
                    key={signal.label}
                    type="button"
                    onClick={() => target && navigate(target)}
                    className="rounded-xl border border-border bg-secondary/25 p-3 text-left transition-colors hover:border-primary/40 hover:bg-secondary/40"
                  >
                    <p className={`text-xl font-bold tabular-nums ${SIGNAL_TONE[signal.tone]}`}>
                      {signal.value}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{signal.label}</p>
                  </button>
                );
              })}
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
                  <p className="flex min-w-0 items-baseline gap-2 truncate text-[13px] font-medium text-foreground">
                    <span className="truncate">{project.name}</span>
                    <span className="shrink-0 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                      {({ social_media: "Social", trafego: "Tráfego", site: "Site", automacao: "Automação", design: "Design", video: "Vídeo", seo: "SEO" } as Record<string, string>)[(project as any).project_type] || "Projeto"}
                    </span>
                  </p>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {view.mode === "percent" ? (view.percent > 0 ? `${view.percent}%` : "Em andamento") : view.label}
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
                {(() => {
                  // Contexto real: o que esta em producao nesta frente agora
                  const doing = (snapshot?.tasks || [])
                    .filter((task: any) => task.project_id === project.id &&
                      !["done", "completed", "concluido", "concluída"].includes((task.status || "").toLowerCase()))
                    .slice(0, 3);
                  if (doing.length === 0) return null;
                  return (
                    <ul className="mt-2 space-y-1">
                      {doing.map((task: any, index: number) => (
                        <li key={index} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                          <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-primary/60" />
                          <span className="truncate">{task.title}</span>
                        </li>
                      ))}
                    </ul>
                  );
                })()}
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

      {/* ── O case vivo: de onde saímos para onde chegamos ── */}
      {(() => {
        const projects = (snapshot?.projects || []) as any[];
        if (projects.length === 0) return null;
        const startDates = projects
          .map((project) => project.created_at)
          .filter(Boolean)
          .sort();
        const startedAt = startDates[0];
        if (!startedAt) return null;
        const started = new Date(startedAt);
        const monthsTogether = Math.max(
          1,
          Math.round((Date.now() - started.getTime()) / (30 * 24 * 60 * 60 * 1000)),
        );
        const materials = (snapshot?.allFiles || []).length;
        const postsLive = (snapshot?.publications || []).filter((p: any) => p.status === "published").length;
        const reportsCount = (snapshot?.reports || []).length;
        const series = buildGrowthSeries((snapshot?.reports || []) as any[]);
        const firstPoint = series[0];
        const lastPoint = series[series.length - 1];
        const contactsGrowth =
          firstPoint && lastPoint && firstPoint !== lastPoint && firstPoint.contacts > 0
            ? Math.round(((lastPoint.contacts - firstPoint.contacts) / firstPoint.contacts) * 100)
            : null;
        if (materials === 0 && postsLive === 0 && reportsCount === 0) return null;
        return (
          <section className="overflow-hidden rounded-xl border border-primary/25 bg-card">
            <div className="border-b border-border bg-primary/[0.04] px-5 py-4 sm:px-7">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                A sua história com a Aceleriq
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {monthsTogether === 1 ? "No primeiro mês" : `Em ${monthsTogether} meses`} de trabalho, isto foi construído:
              </p>
            </div>
            <div className="grid grid-cols-1 gap-0 sm:grid-cols-[1fr,auto,1fr]">
              <div className="p-5 sm:p-6">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Quando começou · {started.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
                </p>
                <ul className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  <li>Nenhum material produzido por aqui</li>
                  <li>Nenhuma publicação registrada</li>
                  <li>Sem medição de resultados</li>
                </ul>
              </div>
              <div className="hidden items-center justify-center px-2 sm:flex" aria-hidden="true">
                <ArrowUpRight className="h-6 w-6 text-primary" />
              </div>
              <div className="border-t border-border p-5 sm:border-l sm:border-t-0 sm:p-6">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Hoje</p>
                <ul className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-foreground">
                  {materials > 0 && (
                    <li><span className="font-semibold text-primary">{materials}</span> materia(is) produzidos e entregues</li>
                  )}
                  {postsLive > 0 && (
                    <li><span className="font-semibold text-sky-500">{postsLive}</span> publicação(ões) no ar</li>
                  )}
                  {reportsCount > 0 && (
                    <li><span className="font-semibold text-amber-500">{reportsCount}</span> relatório(s) de resultado medidos</li>
                  )}
                  {contactsGrowth !== null && contactsGrowth > 0 && (
                    <li>Contatos crescendo <span className="font-semibold text-emerald-500">{contactsGrowth}%</span> entre o primeiro e o último período medido</li>
                  )}
                </ul>
              </div>
            </div>
          </section>
        );
      })()}

      {/* ── Crescimento do negócio: contatos e alcance dos relatórios reais ── */}
      {(() => {
        const series = buildGrowthSeries((snapshot?.reports || []) as any[]);
        if (series.length < 2) return null;
        const totalSpend = series.reduce((sum, point) => sum + point.spend, 0);
        const totalContacts = series.reduce((sum, point) => sum + point.contacts, 0);
        const totalRevenue = series.reduce((sum, point) => sum + point.revenue, 0);
        const money = (value: number) =>
          new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
        return (
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-4 sm:px-7">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Crescimento do seu negócio
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {totalContacts > 0
                  ? `${totalContacts.toLocaleString("pt-BR")} pessoa(s) chegaram até vocês nos períodos medidos`
                  : "A resposta do público ao longo do tempo"}
                {totalSpend > 0 && ` · ${money(totalSpend)} investidos`}
                {totalRevenue > 0 && ` · ${money(totalRevenue)} em retorno`}
              </p>
            </div>
            <div className="px-2 py-4 sm:px-4">
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={series} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="contacts" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis yAxisId="reach" orientation="right" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12, color: "hsl(var(--foreground))" }}
                    itemStyle={{ color: "hsl(var(--foreground))" }}
                    labelStyle={{ color: "hsl(var(--primary))", fontSize: 10 }}
                    formatter={(value: any, name: string) => [Number(value).toLocaleString("pt-BR"), name === "contacts" ? "Contatos" : "Alcance"]}
                  />
                  <Bar yAxisId="contacts" dataKey="contacts" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Line yAxisId="reach" type="monotone" dataKey="reach" stroke="#0EA5E9" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3 px-3 pt-1 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-primary" /> Pessoas que chamaram vocês</span>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-sky-500" /> Pessoas alcançadas</span>
              </div>
            </div>
          </section>
        );
      })()}

      {/* ── Linha de evolução: do ponto A até hoje, mês a mês ── */}
      {(() => {
        const monthKey = (value: string) => value.slice(0, 7);
        const monthLabel = (key: string) =>
          new Date(`${key}-15T12:00:00`).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
        const buckets = new Map<string, { entregas: number; publicacoes: number; relatorios: number }>();
        const bump = (at: string | null | undefined, field: "entregas" | "publicacoes" | "relatorios") => {
          if (!at) return;
          const key = monthKey(at);
          const bucket = buckets.get(key) || { entregas: 0, publicacoes: 0, relatorios: 0 };
          bucket[field] += 1;
          buckets.set(key, bucket);
        };
        for (const file of (snapshot?.allFiles || []) as any[]) bump(file.created_at, "entregas");
        for (const publication of (snapshot?.publications || []) as any[]) {
          if (publication.status === "published") bump(publication.published_at, "publicacoes");
        }
        for (const report of (snapshot?.reports || []) as any[]) bump(report.created_at, "relatorios");
        const keys = Array.from(buckets.keys()).sort();
        if (keys.length === 0) return null;
        let running = 0;
        const rows = keys.map((key) => {
          const bucket = buckets.get(key)!;
          const total = bucket.entregas + bucket.publicacoes + bucket.relatorios;
          running += total;
          return { key, ...bucket, total, running };
        });
        const peak = Math.max(...rows.map((row) => row.total), 1);
        return (
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-4 sm:px-7">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Sua evolução desde o início
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                Do ponto de partida até hoje: {rows[rows.length - 1].running} movimento(s) de trabalho registrados.
              </p>
            </div>
            <div className="space-y-2.5 px-5 py-5 sm:px-7">
              {rows.map((row) => {
                const isOpen = expandedMonth === row.key;
                return (
                <div key={row.key}>
                  <button
                    type="button"
                    onClick={() => setExpandedMonth(isOpen ? null : row.key)}
                    className={`flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left transition-colors ${isOpen ? "bg-secondary/40" : "hover:bg-secondary/25"}`}
                  >
                    <span className="w-14 shrink-0 text-[10px] font-semibold uppercase text-muted-foreground">
                      {monthLabel(row.key)}
                    </span>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-secondary/50">
                      <div
                        className="flex h-full overflow-hidden rounded-full"
                        style={{ width: `${Math.max(6, (row.total / peak) * 100)}%` }}
                      >
                        {row.entregas > 0 && <span className="h-full bg-primary" style={{ flex: row.entregas }} />}
                        {row.publicacoes > 0 && <span className="h-full bg-sky-500" style={{ flex: row.publicacoes }} />}
                        {row.relatorios > 0 && <span className="h-full bg-amber-500" style={{ flex: row.relatorios }} />}
                      </div>
                    </div>
                    <span className="w-20 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                      {row.total} · total {row.running}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="ml-16 mt-1.5 space-y-1 border-l border-border pl-3 pb-1">
                      {/* Entregas com nome: o mês deixa de ser só um número. */}
                      {(snapshot?.allFiles || [])
                        .filter((file: any) => file.created_at?.startsWith(row.key))
                        .slice(0, 5)
                        .map((file: any) => (
                          <p key={file.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                            <span className="truncate">{file.file_name}</span>
                          </p>
                        ))}
                      {row.entregas > 5 && (
                        <p className="text-[11px] text-muted-foreground/70">e mais {row.entregas - 5} material(is) neste mês</p>
                      )}
                      {/* Etapas do plano vencidas no mês. */}
                      {((snapshot?.milestones || []) as any[])
                        .filter((m: any) => m.status === "completed" && (m.updated_at || m.target_date || "").startsWith(row.key))
                        .slice(0, 4)
                        .map((m: any, index: number) => (
                          <p key={`ms-${index}`} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                            <span className="truncate">Etapa concluída: {m.title}</span>
                          </p>
                        ))}
                      {(snapshot?.publications || [])
                        .filter((pub: any) => pub.status === "published" && pub.published_at && pub.published_at.startsWith(row.key))
                        .map((pub: any, index: number) => (
                          <p key={index} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                            Publicação no ar em {new Date(pub.published_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                            {pub.permalink && (
                              <a href={pub.permalink} target="_blank" rel="noreferrer" className="text-primary hover:opacity-80">ver</a>
                            )}
                          </p>
                        ))}
                      {(snapshot?.reports || [])
                        .filter((report: any) => report.created_at?.startsWith(row.key))
                        .map((report: any) => (
                          <button
                            key={report.id}
                            type="button"
                            onClick={() => navigate(`/relatorios/${report.id}`)}
                            className="flex items-center gap-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                            <span className="truncate">{report.title}</span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                );
              })}
              <div className="flex flex-wrap gap-3 pt-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" /> Entregas</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-500" /> Publicações</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" /> Relatórios</span>
              </div>
            </div>
          </section>
        );
      })()}

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
                className={`rounded-xl border bg-card p-5 sm:p-6 ${isLatest ? "border-primary/40 shadow-sm" : "border-border"}`}
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
