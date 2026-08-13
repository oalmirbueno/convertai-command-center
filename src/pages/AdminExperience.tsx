import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import ProjectJournal from "@/components/shared/ProjectJournal";
import { useAuth } from "@/contexts/AuthContext";
import { useClients, useProjects } from "@/hooks/useSupabaseData";
import { useBilling } from "@/hooks/useFinancialData";
import { isInternalClient } from "@/lib/clientFlags";
import {
  buildRadarIdeas,
  radarIdeaForClient,
  RADAR_LENSES,
  type RadarClientContext,
  type RadarIdea,
} from "@/lib/radarIdeas";
import { notifyUser } from "@/lib/notifyHelpers";
import { toast } from "sonner";
import {
  HeartPulse, AlertTriangle, Sparkles, FileText, Send, CheckCircle2,
  Clock, ArrowUpRight, ShieldAlert, Radar, Star, UserCircle, Trash2,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

const daysSince = (value?: string | null): number | null => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
};

const RITUALS = [
  { value: "rota_semana", label: "Rota da Semana (abertura)", cadence: "Semanal · segunda", why: "Abre a semana com foco e a única ação necessária do cliente" },
  { value: "meio_semana", label: "Check do Meio da Semana", cadence: "Semanal · quarta", why: "Mantém o cliente por dentro do andamento no meio do ciclo" },
  { value: "prova_movimento", label: "Prova de Movimento (fechamento)", cadence: "Semanal · sexta", why: "Fecha a semana provando o que avançou e o próximo passo" },
  { value: "radar_aceleriq", label: "Radar Aceleriq", cadence: "Mensal", why: "Leva uma ideia de diferenciação antes de o cliente pedir" },
  { value: "marco_90", label: "Marco 90", cadence: "Trimestral", why: "Mostra o antes e depois do trimestre com evidências" },
] as const;

const ritualMeta = (value?: string | null) => RITUALS.find((r) => r.value === value) || null;

/** Ritual sugerido pelo dia da semana: segunda abre, quarta checa, sexta fecha. */
const ritualForToday = (): string => {
  const day = new Date().getDay();
  if (day === 1 || day === 0) return "rota_semana";
  if (day >= 2 && day <= 4) return "meio_semana";
  return "prova_movimento";
};

/** Última avaliação do Pulso guardada no cadastro do próprio cliente. */
const latestPulse = (client: any): { score: number; date: string; comment?: string } | null => {
  const history = client?.services_config?.pulse_history;
  if (!Array.isArray(history) || history.length === 0) return null;
  const last = history[history.length - 1];
  if (!last || !Number.isFinite(Number(last.score))) return null;
  return { score: Number(last.score), date: String(last.date || ""), comment: last.comment };
};

interface HealthFactor {
  label: string;
  weight: number;
  earned: number | null;
  note: string;
}

interface ClientHealth {
  client: any;
  score: number | null;
  level: "healthy" | "attention" | "risk";
  factors: HealthFactor[];
  alerts: { kind: string; label: string }[];
  pulse: { score: number; date: string; comment?: string } | null;
}

interface DraftPreview {
  clientId: string;
  clientName: string;
  draft: any;
}

export default function AdminExperience() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const { data: clients } = useClients();
  const { data: projects } = useProjects();
  const { data: billing } = useBilling();
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [genClientId, setGenClientId] = useState("__all__");
  const [genRitual, setGenRitual] = useState<string>(ritualForToday());
  const [genPreviews, setGenPreviews] = useState<DraftPreview[] | null>(null);
  /** Ideia do Radar escolhida pela equipe para virar mensagem do cliente. */
  const [genIdeaId, setGenIdeaId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [expandedHealth, setExpandedHealth] = useState<string | null>(null);
  const [profileClientId, setProfileClientId] = useState("");
  const [activeTab, setActiveTab] = useState("carteira");
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null);
  const [draftEdits, setDraftEdits] = useState<Record<string, { summary: string; next_steps: string }>>({});

  // Tudo com atualização automática: a Central reflete a movimentação em tempo real.
  const LIVE = 20000;

  const { data: pendingApprovalFiles = [] } = useQuery({
    queryKey: ["exp-pending-approvals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("files")
        .select("id, client_id, project_id, file_name, created_at")
        .eq("visibility", "approval")
        .eq("requires_approval", true)
        .eq("approval_status", "pending")
        .eq("status", "ready")
        .is("archived_at", null)
        .is("parent_file_id", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: LIVE,
  });

  const { data: releasedFiles = [] } = useQuery({
    queryKey: ["exp-released-files"],
    queryFn: async () => {
      const { data, error } = await supabase.from("files")
        .select("id, client_id, file_name, created_at")
        .in("visibility", ["client_shared", "approval"])
        .eq("status", "ready")
        .is("archived_at", null)
        .is("parent_file_id", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: LIVE,
  });

  const { data: allMilestones = [] } = useQuery({
    queryKey: ["exp-milestones"],
    queryFn: async () => {
      const { data, error } = await supabase.from("milestones")
        .select("id, project_id, title, status, target_date")
        .is("deleted_at", null)
        .order("target_date", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: LIVE,
  });

  const { data: allPublications = [] } = useQuery({
    queryKey: ["exp-publications"],
    queryFn: async () => {
      const { data, error } = await supabase.from("editorial_publications")
        .select("id, client_id, status, platform, scheduled_at, published_at")
        .in("status", ["scheduled", "published"])
        .order("scheduled_at", { ascending: true });
      if (error) return [];
      return data || [];
    },
    refetchInterval: LIVE,
  });

  const { data: reports = [] } = useQuery({
    queryKey: ["exp-reports"],
    queryFn: async () => {
      const { data, error } = await supabase.from("reports")
        .select("id, client_id, project_id, title, status, metrics, summary, next_steps, highlights, created_at, period_start, period_end, client:profiles!reports_client_id_fkey(full_name, company_name)")
        .order("created_at", { ascending: false })
        .limit(150);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: LIVE,
  });

  // Carteira recorrente completa: ativos E em onboarding entram nos rituais.
  const portfolioClients = useMemo(
    () =>
      (clients || []).filter(
        (c: any) =>
          ["active", "onboarding"].includes(c.plan_status || "active") &&
          (c.client_type || "recurring") !== "one_off" &&
          !isInternalClient(c)
      ),
    [clients]
  );

  const oneOffClients = useMemo(
    () => (clients || []).filter((c: any) => (c.client_type || "recurring") === "one_off" && !isInternalClient(c)),
    [clients]
  );

  // ───────── Saúde da carteira: nota explicável, sem inventar dado ─────────
  const healthRows = useMemo<ClientHealth[]>(() => {
    const today = new Date();
    const lastReleaseByClient = new Map<string, string>();
    (releasedFiles || []).forEach((f: any) => {
      if (f.client_id && !lastReleaseByClient.has(f.client_id)) lastReleaseByClient.set(f.client_id, f.created_at);
    });
    const lastPublishedReportByClient = new Map<string, string>();
    (reports || []).forEach((r: any) => {
      if (r.status === "published" && r.client_id && !lastPublishedReportByClient.has(r.client_id)) {
        lastPublishedReportByClient.set(r.client_id, r.created_at);
      }
    });

    return portfolioClients.map((client: any) => {
      const factors: HealthFactor[] = [];
      const alerts: { kind: string; label: string }[] = [];

      const overdue = (billing || []).filter((b: any) => {
        if (b.client_id !== client.id || b.status !== "pending" || b.type === "ads_recharge") return false;
        const due = new Date(`${b.due_date}T12:00:00`);
        return due < today;
      });
      const overdueTotal = overdue.reduce((s: number, b: any) => s + Number(b.amount || 0), 0);
      factors.push({
        label: "Situação financeira",
        weight: 20,
        earned: overdue.length > 0 ? 0 : 20,
        note: overdue.length > 0 ? `${fmt(overdueTotal)} em atraso` : "Sem atrasos",
      });
      if (overdue.length > 0) alerts.push({ kind: "financeiro", label: `${fmt(overdueTotal)} vencidos` });

      const clientPending = (pendingApprovalFiles || []).filter((f: any) => f.client_id === client.id);
      const oldestPendingDays = clientPending.length
        ? Math.max(...clientPending.map((f: any) => daysSince(f.created_at) || 0))
        : null;
      factors.push({
        label: "Respostas e aprovações",
        weight: 15,
        earned: oldestPendingDays === null ? 15 : oldestPendingDays > 7 ? 0 : oldestPendingDays > 3 ? 7 : 12,
        note: oldestPendingDays === null ? "Nada pendente" : `Aprovação parada há ${oldestPendingDays}d`,
      });
      if (oldestPendingDays !== null && oldestPendingDays > 4) {
        alerts.push({ kind: "aprovacao", label: `Material parado há ${oldestPendingDays} dias` });
      }

      const lastRelease = lastReleaseByClient.get(client.id) || null;
      const releaseDays = daysSince(lastRelease);
      factors.push({
        label: "Avanço percebido (entregas)",
        weight: 25,
        earned: releaseDays === null ? 0 : releaseDays <= 14 ? 25 : releaseDays <= 45 ? 13 : 0,
        note: releaseDays === null ? "Nenhuma entrega liberada" : `Última entrega há ${releaseDays}d`,
      });
      if (releaseDays === null || releaseDays > 45) {
        alerts.push({ kind: "risco", label: "45+ dias sem avanço percebido" });
      }

      const clientProjects = (projects || []).filter((p: any) => p.client_id === client.id && p.status !== "done" && !p.deleted_at);
      const stalled = clientProjects.filter((p: any) => (daysSince(p.updated_at || p.created_at) || 0) >= 14 && (p.progress || 0) < 100);
      factors.push({
        label: "Ritmo dos projetos",
        weight: 15,
        earned: clientProjects.length === 0 ? null : stalled.length === 0 ? 15 : stalled.length < clientProjects.length ? 7 : 0,
        note: clientProjects.length === 0 ? "Sem projeto ativo (sem dado)" : stalled.length === 0 ? "Tudo em movimento" : `${stalled.length} projeto(s) parados 14d+`,
      });

      const lastReport = lastPublishedReportByClient.get(client.id) || null;
      const reportDays = daysSince(lastReport);
      factors.push({
        label: "Comunicação publicada",
        weight: 10,
        earned: reportDays === null ? 0 : reportDays <= 35 ? 10 : 4,
        note: reportDays === null ? "Nenhum relatório publicado" : `Último há ${reportDays}d`,
      });

      // Percepção de valor: agora com fonte real, o Pulso respondido pelo cliente.
      const pulse = latestPulse(client);
      const pulseAge = pulse ? daysSince(pulse.date) : null;
      const pulseFresh = pulse && pulseAge !== null && pulseAge <= 60;
      factors.push({
        label: "Percepção de valor (Pulso)",
        weight: 15,
        earned: pulseFresh ? [0, 0, 3, 7, 12, 15][pulse!.score] ?? 7 : null,
        note: pulseFresh
          ? `Nota ${pulse!.score}/5 há ${pulseAge}d`
          : pulse
            ? `Nota antiga (${pulseAge}d) · pedir novo Pulso`
            : "Cliente ainda não avaliou",
      });
      if (pulseFresh && pulse!.score <= 2) {
        alerts.push({ kind: "pulso", label: `Pulso crítico: nota ${pulse!.score}/5, retornar em 24h` });
      }

      const available = factors.filter((f) => f.earned !== null);
      const availableWeight = available.reduce((s, f) => s + f.weight, 0);
      const earned = available.reduce((s, f) => s + (f.earned || 0), 0);
      const score = availableWeight > 0 ? Math.round((earned / availableWeight) * 100) : null;
      const level: ClientHealth["level"] =
        alerts.some((a) => a.kind === "risco" || a.kind === "pulso") || (score !== null && score < 60)
          ? "risk"
          : score !== null && score < 80
            ? "attention"
            : "healthy";

      return { client, score, level, factors, alerts, pulse };
    }).sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  }, [portfolioClients, billing, pendingApprovalFiles, releasedFiles, projects, reports]);

  const healthy = healthRows.filter((r) => r.level === "healthy").length;
  const attention = healthRows.filter((r) => r.level === "attention").length;
  const risk = healthRows.filter((r) => r.level === "risk").length;
  const pulseAnswers = healthRows.filter((r) => r.pulse).length;

  const draftReports = (reports || []).filter((r: any) => r.status !== "published");
  const publishedReports = (reports || []).filter((r: any) => r.status === "published");

  // ───────── Radar do mês: oportunidades com foco em retenção e expansão ─────────
  /**
   * O Radar do mês: ideias de diferenciação por cliente, montadas do contexto
   * real dele. A leitura é a do marketing de diferenciação (Fator X): a ideia
   * nasce do que o cliente JÁ tem, e a agência chega com ela pronta antes de
   * ele pedir. A leitura comercial de cada ideia fica só para a equipe.
   */
  const opportunities = useMemo<RadarIdea[]>(() => {
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 86400000);

    const buildContext = (client: any, isOneOff: boolean): RadarClientContext => {
      const clientProjects = (projects || []).filter(
        (p: any) => p.client_id === client.id && !p.deleted_at,
      );
      const activeProjects = clientProjects.filter((p: any) => p.status !== "done");
      const services = [
        ...new Set(
          (activeProjects.length > 0 ? activeProjects : clientProjects)
            .map((p: any) => p.project_type)
            .filter(Boolean),
        ),
      ] as string[];

      const clientPubs = (allPublications || []).filter(
        (p: any) => p.client_id === client.id && p.status === "published",
      );
      const publishedLast30 = clientPubs.filter(
        (p: any) => p.published_at && new Date(p.published_at) >= d30,
      ).length;

      const releasedLast30 = (releasedFiles || []).filter(
        (f: any) => f.client_id === client.id && new Date(f.created_at) >= d30,
      ).length;

      const firstProject = clientProjects
        .map((p: any) => p.created_at)
        .filter(Boolean)
        .sort()[0];
      const startedDays = daysSince(firstProject);
      const monthsTogether = startedDays !== null ? Math.max(1, Math.round(startedDays / 30)) : 1;

      const doneProjects = clientProjects.filter((p: any) => p.status === "done");
      const lastDone = doneProjects
        .map((p: any) => p.updated_at || p.created_at)
        .sort()
        .reverse()[0];
      const idleDays =
        isOneOff && doneProjects.length > 0 && clientProjects.every((p: any) => p.status === "done")
          ? daysSince(lastDone)
          : null;

      const health = healthRows.find((row) => row.client.id === client.id);

      return {
        clientId: client.id,
        clientName: client.company_name || client.full_name,
        services,
        pulseScore: health?.pulse?.score ?? null,
        pulseAgeDays: health?.pulse ? daysSince(health.pulse.date) : null,
        releasedLast30,
        publishedLast30,
        publishedTotal: clientPubs.length,
        hasPublishedReport: (reports || []).some(
          (r: any) => r.client_id === client.id && r.status === "published",
        ),
        monthsTogether,
        isOneOff,
        idleDays,
        month: now.getMonth(),
      };
    };

    const out: RadarIdea[] = [];
    healthRows.forEach((row) => {
      out.push(...buildRadarIdeas(buildContext(row.client, false), 3));
    });
    oneOffClients.forEach((client: any) => {
      out.push(...buildRadarIdeas(buildContext(client, true), 2));
    });
    return out.sort((a, b) => b.score - a.score);
  }, [healthRows, oneOffClients, projects, releasedFiles, allPublications, reports]);

  // ───────── Rascunhos: montagem com dados reais e processo explicado ─────────
  // Estrutura oficial de cada mensagem: o que fizemos, por que fizemos,
  // qual sinal vamos observar e quando revisamos.
  const FRONT_SIGNALS: Record<string, string> = {
    social_media: "alcance qualificado, salvamentos e contatos chegando pelo perfil",
    traffic: "custo por contato e volume de orçamentos gerados pelas campanhas",
    site: "visitas e pedidos de orçamento chegando pelo site",
    landing_page: "conversões da página (cadastros e chamadas)",
    automation: "tempo economizado e atendimentos respondidos automaticamente",
    event: "confirmações e participação no evento",
    other: "o indicador principal combinado para esta frente",
  };
  const FRONT_LABELS: Record<string, string> = {
    social_media: "Social Media", traffic: "Tráfego Pago", automation: "Automação",
    site: "Site", landing_page: "Landing Page", event: "Evento", other: "Projeto",
  };

  const buildDraft = (client: any, ritual: string) => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const clientProjects = (projects || []).filter((p: any) => p.client_id === client.id && !p.deleted_at);
    const activeProjects = clientProjects.filter((p: any) => p.status !== "done");
    const activeProject = activeProjects[0] || clientProjects[0] || null;
    const releasedWeek = (releasedFiles || []).filter(
      (f: any) => f.client_id === client.id && new Date(f.created_at) >= weekAgo
    );
    const released7d = releasedWeek.length;
    const releasedNames = releasedWeek.slice(0, 3).map((f: any) => f.file_name).join(", ");
    const pendingFiles = (pendingApprovalFiles || []).filter((f: any) => f.client_id === client.id);
    const pending = pendingFiles.length;
    const pendingNames = pendingFiles.slice(0, 2).map((f: any) => f.file_name).join(", ");
    const name = client.company_name || client.full_name;
    const dateLabel = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

    // Frentes descritas com o sinal que cada uma deve mover
    const frontsText = activeProjects
      .map((p: any) => `• ${FRONT_LABELS[p.project_type] || "Projeto"} (${p.name}): sinal observado: ${FRONT_SIGNALS[p.project_type] || FRONT_SIGNALS.other}`)
      .join("\n");

    // Próximas etapas com data (marcos dos projetos do cliente)
    const projectIds = new Set(clientProjects.map((p: any) => p.id));
    const nextMilestones = (allMilestones || [])
      .filter((m: any) => projectIds.has(m.project_id) && m.status !== "completed" && m.target_date)
      .slice(0, 2)
      .map((m: any) => `${m.title} (previsão ${new Date(`${m.target_date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })})`)
      .join("; ");

    // Publicações confirmadas
    const clientPubs = (allPublications || []).filter((p: any) => p.client_id === client.id);
    const scheduledPubs = clientPubs.filter((p: any) => p.status === "scheduled" && p.scheduled_at && new Date(p.scheduled_at) >= now);
    const publishedWeek = clientPubs.filter((p: any) => p.status === "published" && p.published_at && new Date(p.published_at) >= weekAgo);
    const nextPubText = scheduledPubs[0]
      ? new Date(scheduledPubs[0].scheduled_at).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })
      : null;

    const fridayReview = "Na sexta-feira voltamos com a Prova de Movimento mostrando o que avançou e o que aprendemos.";
    const mondayReview = "Na segunda-feira abrimos o próximo ciclo com a nova Rota da Semana.";

    // Foco da semana derivado do que realmente está acontecendo, com variação
    const seed = client.id + ritual;
    const focus = pending > 0
      ? pickVariant([
          `Destravar as aprovações pendentes e colocar as publicações no ar na data certa.`,
          `Fechar o ciclo de aprovações e garantir o calendário rodando sem atraso.`,
          `Aprovações em dia e conteúdo no ar: essa é a virada da semana.`,
        ], seed)
      : nextMilestones
        ? pickVariant([
            `Avançar nas etapas com data marcada: ${nextMilestones}.`,
            `Semana de execução: colocar ${nextMilestones} de pé.`,
            `Foco total em entregar as próximas etapas: ${nextMilestones}.`,
          ], seed)
        : scheduledPubs.length > 0
          ? pickVariant([
              `Manter a cadência de publicações e acompanhar os sinais de cada frente.`,
              `Conteúdo rodando no calendário e olho nos sinais que importam.`,
              `Consistência: publicar no ritmo planejado e medir o que volta.`,
            ], seed)
          : pickVariant([
              `Produzir as próximas entregas e manter a operação em movimento.`,
              `Semana de construção: preparar as entregas que sustentam o próximo ciclo.`,
              `Avançar a produção para chegar na próxima semana com material pronto.`,
            ], seed);

    // Observação/aprendizado derivado do movimento real da semana
    const observation = publishedWeek.length > 0
      ? `Com ${publishedWeek.length} publicação(ões) no ar nesta semana, os próximos dias mostram a resposta do público. Vamos acompanhar os sinais de cada frente e trazer a leitura pronta: o que mudou, o que isso indica e a decisão que tomamos a partir disso.`
      : released7d > 0
        ? `Com as entregas desta semana liberadas, o próximo movimento é colocá-las para trabalhar. Acompanhamos os sinais de cada frente e trazemos a leitura interpretada na próxima atualização.`
        : `Semana de construção interna. Na próxima atualização mostramos o material pronto e o sinal que ele deve mover.`;

    // A ideia do Radar. Se a equipe escolheu uma na aba, é ela; senão vale a
    // mais forte detectada para este cliente. `radarIdeaForClient` devolve só a
    // parte que o cliente pode ler: a leitura comercial nunca chega aqui.
    const chosenIdea =
      opportunities.find((idea) => idea.id === genIdeaId && idea.id.startsWith(`${client.id}:`)) ||
      opportunities.find((idea) => idea.id.startsWith(`${client.id}:`)) ||
      null;
    const radarText = chosenIdea ? radarIdeaForClient(chosenIdea) : null;

    const base = {
      client_id: client.id,
      project_id: activeProject?.id || null,
      status: "draft",
      created_by: user?.id || null,
      period_start: weekAgo.toISOString().slice(0, 10),
      period_end: now.toISOString().slice(0, 10),
      metrics: { ritual_type: ritual } as any,
      internal_notes:
        "Rascunho gerado pela Central de Experiência com dados reais do painel (entregas, aprovações e projetos). Revise, complete e publique.",
    };

    if (ritual === "meio_semana") {
      return {
        ...base,
        title: `Check do Meio da Semana · ${dateLabel}`,
        summary: [
          `Passando no meio da semana para manter você por dentro de tudo, ${name}.`,
          ``,
          `O QUE JÁ ANDOU DESDE SEGUNDA`,
          released7d > 0
            ? `Liberamos ${released7d} entrega(s) no painel${releasedNames ? `: ${releasedNames}` : ""}. Cada uma já passou pela nossa revisão interna de qualidade antes de chegar até você.`
            : `A semana está em fase de produção: os materiais estão sendo construídos e passam pela nossa revisão interna antes de aparecerem no painel.`,
          ``,
          `O QUE ESTÁ EM PRODUÇÃO AGORA`,
          activeProjects.length > 0 ? frontsText : `Preparação das próximas entregas do seu ciclo, com revisão interna de qualidade antes de qualquer material chegar até você.`,
          nextMilestones ? `Próximas etapas no radar: ${nextMilestones}.` : ``,
          ``,
          pending > 0
            ? `O QUE DEPENDE DE VOCÊS\n${pending} material(is) aguardando aprovação (${pendingNames}). Sua aprovação libera o agendamento na data planejada. Sem ela, o cronograma da semana trava.`
            : `Nenhuma pendência do lado de vocês. Seguimos no planejado.`,
          ``,
          `QUANDO REVISAMOS: ${fridayReview}`,
        ].filter(Boolean).join("\n"),
        next_steps: pending > 0
          ? `Aprovar os materiais pendentes ainda hoje (${pendingNames}). Leva 2 minutos na área de Aprovações.`
          : "Nenhuma ação necessária agora. A próxima parada é a Prova de Movimento na sexta.",
        highlights: "Check de meio de semana: andamento, produção e o que depende de vocês",
      };
    }
    if (ritual === "prova_movimento") {
      return {
        ...base,
        title: `Prova de Movimento · ${dateLabel}`,
        summary: [
          `Fechamento da semana de ${name}, com o processo aberto para você ver.`,
          ``,
          `O QUE FIZEMOS`,
          released7d > 0
            ? `${released7d} entrega(s) concluídas e liberadas no painel${releasedNames ? `: ${releasedNames}` : ""}.`
            : `Semana de construção interna: produção e preparação das próximas entregas (bastidores que aparecem no painel assim que liberados).`,
          publishedWeek.length > 0 ? `${publishedWeek.length} publicação(ões) foram ao ar nesta semana, conforme o calendário aprovado por vocês.` : ``,
          ``,
          `POR QUE FIZEMOS`,
          activeProjects.length > 0
            ? `Cada frente tem um papel no seu crescimento:\n${frontsText}`
            : `Cada entrega desta fase constrói a base que sustenta o próximo ciclo de resultados.`,
          ``,
          `O QUE VAMOS OBSERVAR`,
          observation,
          ``,
          pending > 0 ? `PENDÊNCIA: ${pending} material(is) aguardando sua aprovação (${pendingNames}).` : `PENDÊNCIA: nenhuma. Tudo em dia do seu lado.`,
          ``,
          `QUANDO REVISAMOS: ${mondayReview}`,
        ].filter(Boolean).join("\n"),
        next_steps: pending > 0
          ? `Aprovar ${pendingNames} para liberarmos o agendamento. Depois disso, o próximo passo é nosso: abrir o ciclo de segunda com a nova Rota.`
          : nextMilestones
            ? `O próximo passo é nosso: avançar em ${nextMilestones}. Você acompanha tudo pelo painel e a nova Rota chega segunda.`
            : `O próximo passo é nosso: preparar o ciclo da próxima semana. A nova Rota chega segunda-feira com o plano completo.`,
        highlights: `${released7d} entrega(s) na semana · processo aberto do que, por quê e qual sinal`,
      };
    }
    if (ritual === "radar_aceleriq") {
      return {
        ...base,
        title: `Radar Aceleriq · ${now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`,
        summary: [
          `${name}, o Radar é o nosso ritual de antecipação: uma vez por mês trazemos uma ideia que enxergamos antes de você precisar pedir.`,
          ``,
          `A IDEIA DESTE MÊS`,
          radarText
            ? radarText.opportunity
            : `Dar um passo de diferenciação: sair do que todo mundo do seu setor faz e usar o que só a sua empresa tem.`,
          ``,
          `POR QUE AGORA`,
          radarText
            ? radarText.whyNow
            : `Cruzamos a movimentação do seu painel (entregas, publicações e sinais das frentes) e este é o momento com melhor relação esforço x retorno.`,
          ``,
          `COMO A GENTE FAZ`,
          radarText
            ? radarText.recommendation
            : `1. Leitura do que já existe e funciona hoje\n2. Produção da peça central da ideia\n3. Acompanhamento do sinal para decidir o próximo passo`,
          ``,
          `O QUE VAMOS OLHAR DEPOIS`,
          radarText
            ? radarText.signal
            : `O sinal principal da frente que essa ideia move.`,
          ``,
          `COMO RESPONDER (basta dizer no grupo):`,
          `1. Pode seguir  ·  2. Deixar para o próximo ciclo  ·  3. Quero entender melhor`,
        ].filter(Boolean).join("\n"),
        next_steps: "Escolher uma das três opções acima. Se aprovado, entra na próxima janela de produção e você acompanha tudo pelo painel.",
        highlights: "1 ideia de diferenciação do mês, com o motivo e o sinal que vamos acompanhar",
      };
    }
    if (ritual === "marco_90") {
      const clientFiles = (releasedFiles || []).filter((f: any) => f.client_id === client.id);
      const d90 = new Date(now.getTime() - 90 * 86400000);
      const released90 = clientFiles.filter((f: any) => new Date(f.created_at) >= d90).length;
      const before90 = clientFiles.length - released90;
      const totalReleased = clientFiles.length;
      const doneProjects = clientProjects.filter((p: any) => p.status === "done").length;
      const totalPublished = clientPubs.filter((p: any) => p.status === "published").length;
      const clientHealthRow = healthRows.find((h) => h.client.id === client.id);
      const blockers = clientHealthRow?.alerts || [];
      return {
        ...base,
        period_start: d90.toISOString().slice(0, 10),
        title: `Marco 90 · ${name}`,
        summary: [
          `${name}, a cada 90 dias paramos para olhar o caminho inteiro: de onde saímos, o que foi construído e para onde vamos. É fácil esquecer como as coisas estavam antes; este registro existe para isso.`,
          ``,
          `ONDE ESTÁVAMOS`,
          before90 > 0
            ? `Há 90 dias o painel registrava ${before90} entrega(s) construídas. De lá para cá, somamos mais ${released90}: o acervo de ativos da sua operação não parou de crescer.`
            : `Há 90 dias esta operação estava começando do zero no painel. Tudo o que existe abaixo foi construído neste período.`,
          ``,
          `O QUE FOI CONSTRUÍDO (registrado no painel)`,
          `• ${totalReleased} entrega(s) liberadas no total${released90 > 0 ? ` (${released90} neste trimestre)` : ""}${totalPublished > 0 ? `\n• ${totalPublished} publicação(ões) no ar` : ""}${doneProjects > 0 ? `\n• ${doneProjects} projeto(s) concluídos` : ""}${activeProjects.length > 0 ? `\n• ${activeProjects.length} frente(s) ativas em operação` : ""}`,
          ``,
          `O QUE MELHOROU`,
          activeProjects.length > 0
            ? `As frentes ativas seguem movendo os sinais certos:\n${frontsText}`
            : `A base construída no período está pronta para sustentar o próximo ciclo de operação.`,
          ``,
          `O QUE AINDA TRAVA`,
          blockers.length > 0
            ? `Com transparência: ${blockers.map((b) => b.label.toLowerCase()).join("; ")}. Já estão no nosso plano de ação e acompanhamos de perto.`
            : `Nenhuma trava crítica registrada no período. O desafio agora é subir o nível, não corrigir rota.`,
          ``,
          `O PRÓXIMO NÍVEL`,
          nextMilestones
            ? `O trimestre que começa tem etapas com data marcada: ${nextMilestones}. É isso que destrava o próximo estágio da operação.`
            : `${focus} Esse é o movimento que abre o próximo estágio da operação.`,
        ].join("\n"),
        next_steps: nextMilestones
          ? `Primeira ação do trimestre: ${nextMilestones}. Próxima revisão completa em 90 dias, com os ritmos semanais continuando normalmente.`
          : `Seguimos com os ritmos semanais (Rota, Check e Prova) e a próxima revisão completa acontece em 90 dias.`,
        highlights: "Marco trimestral: antes, agora, evidências e o próximo nível",
      };
    }
    return {
      ...base,
      title: `Rota da Semana · ${dateLabel}`,
      summary: [
        `Bom dia, ${name}! Abrindo a semana com o plano claro, do nosso jeito: você nunca fica sem saber o que está acontecendo.`,
        ``,
        `FOCO DESTA SEMANA`,
        focus,
        ``,
        `O QUE VAMOS FAZER E POR QUÊ`,
        activeProjects.length > 0
          ? frontsText
          : `Produção das próximas entregas do seu ciclo, cada uma com papel definido no seu resultado e revisão interna antes de chegar até você.`,
        nextMilestones ? `Etapas com data no radar: ${nextMilestones}.` : ``,
        nextPubText ? `Próxima publicação confirmada: ${nextPubText}.` : ``,
        released7d > 0 ? `Da semana passada, ${released7d} entrega(s) já estão liberadas no painel${releasedNames ? ` (${releasedNames})` : ""}.` : ``,
        ``,
        pending > 0
          ? `A ÚNICA AÇÃO DE VOCÊS\nAprovar ${pendingNames} até quarta-feira. É o que libera o agendamento das publicações na data certa.`
          : `A ÚNICA AÇÃO DE VOCÊS\nNenhuma por enquanto. Se algo surgir, avisamos aqui e no painel.`,
        ``,
        `QUANDO REVISAMOS: ${fridayReview}`,
      ].filter(Boolean).join("\n"),
      next_steps: pending > 0
        ? `Aprovar os materiais pendentes (${pendingNames}) até quarta. O painel mostra tudo na área de Aprovações.`
        : `Nenhuma ação necessária de vocês nesta semana. O movimento é nosso: ${focus.charAt(0).toLowerCase()}${focus.slice(1)}`,
      highlights: "Rota da semana: foco, o que vamos fazer, por quê e a única ação de vocês",
    };
  };

  const hasRecentDraft = (clientId: string, ritual: string) =>
    (reports || []).some((r: any) => {
      if (r.client_id !== clientId) return false;
      if ((r.metrics as any)?.ritual_type !== ritual) return false;
      const age = daysSince(r.created_at);
      return age !== null && age <= 3;
    });

  // Passo 1: pré-visualizar. Nada é criado antes de você ver.
  const previewDrafts = () => {
    const targets = genClientId === "__all__"
      ? portfolioClients
      : portfolioClients.filter((c: any) => c.id === genClientId);
    if (targets.length === 0) { toast.error("Selecione um cliente"); return; }
    // O banco exige projeto no registro: cliente sem projeto não entra no lote.
    const withProject = targets.filter((c: any) =>
      (projects || []).some((p: any) => p.client_id === c.id && !p.deleted_at)
    );
    const skippedNoProject = targets.length - withProject.length;
    const previews: DraftPreview[] = withProject
      .filter((c: any) => !hasRecentDraft(c.id, genRitual))
      .map((c: any) => ({
        clientId: c.id,
        clientName: c.company_name || c.full_name,
        draft: buildDraft(c, genRitual),
      }));
    if (skippedNoProject > 0) {
      toast.info(`${skippedNoProject} cliente(s) sem projeto cadastrado ficaram fora. Crie um projeto para eles entrarem nos rituais.`);
    }
    if (previews.length === 0) {
      if (skippedNoProject === 0) toast.info("Todos os clientes selecionados já têm rascunho recente deste ritual.");
      return;
    }
    setGenPreviews(previews);
  };

  // Passo 2: confirmar e criar os rascunhos revisados.
  const confirmDrafts = async () => {
    if (!genPreviews || genPreviews.length === 0) return;
    setGenerating(true);
    let created = 0;
    let failed = 0;
    for (const preview of genPreviews) {
      const { error } = await supabase.from("reports").insert(preview.draft as any);
      if (error) failed += 1;
      else created += 1;
    }
    setGenerating(false);
    if (created > 0) {
      toast.success(`${created} rascunho(s) criados na fila de revisão${failed > 0 ? ` · ${failed} falharam` : ""}.`);
      queryClient.invalidateQueries({ queryKey: ["exp-reports"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      setGeneratorOpen(false);
      setGenPreviews(null);
    } else {
      toast.error("Não foi possível criar os rascunhos.");
    }
  };

  const saveDraftEdits = async (report: any) => {
    const edits = draftEdits[report.id];
    if (!edits) return;
    try {
      const { error } = await supabase.from("reports")
        .update({ summary: edits.summary, next_steps: edits.next_steps })
        .eq("id", report.id);
      if (error) throw error;
      toast.success("Rascunho atualizado");
      queryClient.invalidateQueries({ queryKey: ["exp-reports"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar");
    }
  };

  const publishDraft = async (report: any) => {
    try {
      const edits = draftEdits[report.id];
      const payload: any = { status: "published" };
      if (edits) { payload.summary = edits.summary; payload.next_steps = edits.next_steps; }
      const { error } = await supabase.from("reports").update(payload).eq("id", report.id);
      if (error) throw error;
      await notifyUser(report.client_id, `Nova atualização disponível: ${report.title}`, "report", "/onde-estamos");
      toast.success("Publicado no portal do cliente e notificado.");
      queryClient.invalidateQueries({ queryKey: ["exp-reports"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao publicar");
    }
  };

  const deleteDraft = async (report: any) => {
    try {
      const { error } = await supabase.from("reports").delete().eq("id", report.id).eq("status", "draft");
      if (error) throw error;
      toast.success("Rascunho removido");
      queryClient.invalidateQueries({ queryKey: ["exp-reports"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao remover");
    }
  };

  // Variação semanal: a mesma mensagem nunca se repete igual duas semanas seguidas.
  const isoWeek = () => {
    const d = new Date();
    const start = new Date(d.getFullYear(), 0, 1);
    return Math.ceil(((d.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
  };
  const pickVariant = (options: string[], seed: string) => {
    const hash = seed.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
    return options[(hash + isoWeek()) % options.length];
  };

  // Mensagem pronta para o grupo, montada na hora com a movimentação real.
  const buildGroupMessage = (client: any, moment: "abertura" | "meio" | "fechamento" = "abertura") => {
    const name = client.company_name || client.full_name || "time";
    const released7 = (releasedFiles || []).filter(
      (f: any) => f.client_id === client.id && (daysSince(f.created_at) ?? 99) <= 7
    ).length;
    const pending = (pendingApprovalFiles || []).filter((f: any) => f.client_id === client.id);
    const activeProjs = (projects || []).filter(
      (p: any) => p.client_id === client.id && p.status !== "done" && !p.deleted_at
    );
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

    const openings: Record<string, string[]> = {
      abertura: [
        `${greeting}, time ${name}! 👋 Semana começando com o plano na mesa:`,
        `${greeting}, ${name}! 🚀 Abrindo a semana com o foco alinhado:`,
        `${greeting}, pessoal da ${name}! Nova semana, novo movimento:`,
      ],
      meio: [
        `${greeting}, time ${name}! Passando no meio da semana para manter vocês por dentro:`,
        `${greeting}, ${name}! 👋 Check rápido de quarta para ninguém ficar no escuro:`,
        `${greeting}, pessoal! Meio de semana e o trabalho seguindo:`,
      ],
      fechamento: [
        `${greeting}, time ${name}! Fechando a semana com o que avançou de verdade:`,
        `${greeting}, ${name}! 👋 Sexta é dia de prova de movimento:`,
        `${greeting}, pessoal da ${name}! Resumo do que construímos nesta semana:`,
      ],
    };
    const closings = [
      "Tudo detalhado no painel: aceleriq.online",
      "Qualquer dúvida é só chamar. Painel sempre atualizado: aceleriq.online",
      "Seguimos juntos! Acompanhe tudo em aceleriq.online",
    ];

    const lines: string[] = [];
    lines.push(pickVariant(openings[moment], client.id + moment));
    lines.push("");
    if (released7 > 0) lines.push(`✅ ${released7} entrega(s) nova(s) liberadas no painel nesta semana`);
    if (activeProjs.length > 0) lines.push(`🚀 Em movimento: ${activeProjs.map((p: any) => p.name).slice(0, 3).join(", ")}`);
    if (pending.length > 0) {
      lines.push("");
      lines.push(`⏳ Dependendo de vocês: ${pending.length} material(is) aguardando aprovação (${pending.slice(0, 2).map((f: any) => f.file_name).join(", ")}${pending.length > 2 ? "…" : ""}).`);
      lines.push("Consegue dar o ok hoje? Aprovou, a gente já agenda a publicação. 😉");
    } else if (released7 === 0 && activeProjs.length > 0) {
      lines.push(moment === "fechamento" ? "Semana de bastidores: preparação rodando para as próximas entregas." : "Produção seguindo no ritmo planejado, sem pendências do lado de vocês.");
    }
    lines.push("");
    lines.push(pickVariant(closings, client.id + moment + "x"));
    return lines.join("\n");
  };

  const copyText = async (text: string, okMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(okMessage);
    } catch {
      toast.error("Não consegui copiar automaticamente.");
    }
  };

  const levelMeta: Record<ClientHealth["level"], { label: string; cls: string; dot: string }> = {
    healthy: { label: "Saudável", cls: "text-success", dot: "bg-success" },
    attention: { label: "Atenção", cls: "text-warning", dot: "bg-warning" },
    risk: { label: "Risco", cls: "text-destructive", dot: "bg-destructive" },
  };

  const openClientProfile = (clientId: string) => navigate(`/clientes?client=${clientId}`);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="heading-page">Central de Experiência</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Aqui você cuida da relação com cada cliente: gera as mensagens, revisa, publica e age nos alertas. Nada desta tela aparece ao cliente.
          </p>
        </div>
        <button
          onClick={() => { setGenClientId("__all__"); setGenRitual(ritualForToday()); setGenPreviews(null); setGeneratorOpen(true); }}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none"
        >
          <Sparkles className="w-4 h-4" /> Gerar mensagens de hoje
        </button>
      </div>

      {/* Missões de hoje: a Central puxa você para a ação certa do dia */}
      {(() => {
        const todayRitual = ritualMeta(ritualForToday())!;
        const stuckApprovals = healthRows.filter((r) => r.alerts.some((a) => a.kind === "aprovacao")).length;
        const financialAlerts = healthRows.filter((r) => r.alerts.some((a) => a.kind === "financeiro")).length;
        const greeting = new Date().getHours() < 12 ? "Bom dia" : new Date().getHours() < 18 ? "Boa tarde" : "Boa noite";
        const weekday = new Date().toLocaleDateString("pt-BR", { weekday: "long" });
        return (
          <div className="relative overflow-hidden rounded-2xl border border-primary/25 bg-card p-5">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.08] via-transparent to-success/[0.05]" />
            <div className="relative z-10">
              <p className="text-sm font-semibold text-foreground">
                {greeting}, Almir! Hoje é {weekday}: dia de <span className="text-primary">{todayRitual.label}</span>.
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{todayRitual.why}. Gere, revise cliente por cliente e publique.</p>
              <div className="mt-3 grid grid-cols-1 sm:flex sm:flex-wrap gap-2">
                <button
                  onClick={() => { setGenClientId("__all__"); setGenRitual(ritualForToday()); setGenPreviews(null); setGeneratorOpen(true); }}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none"
                >
                  <Sparkles className="w-3.5 h-3.5 shrink-0" /> Gerar {todayRitual.label} para {portfolioClients.length} cliente(s)
                </button>
                {stuckApprovals > 0 && (
                  <button
                    onClick={() => setActiveTab("carteira")}
                    className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-[12px] bg-warning/10 text-warning hover:bg-warning/20 transition-colors cursor-pointer border-none text-left"
                  >
                    <Clock className="w-3.5 h-3.5 shrink-0" /> {stuckApprovals} aprovação(ões) paradas: toque para ver quem cobrar
                  </button>
                )}
                {financialAlerts > 0 && (
                  <button
                    onClick={() => setActiveTab("carteira")}
                    className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-[12px] bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors cursor-pointer border-none text-left"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {financialAlerts} pagamento(s) vencidos: toque para ver
                  </button>
                )}
                {opportunities.length > 0 && (
                  <button
                    onClick={() => setActiveTab("radar")}
                    className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-[12px] bg-info/10 text-info hover:bg-info/20 transition-colors cursor-pointer border-none text-left"
                  >
                    <Radar className="w-3.5 h-3.5 shrink-0" /> {opportunities.length} oportunidade(s) para vender mais: toque para abrir
                  </button>
                )}
                {draftReports.length > 0 && (
                  <button
                    onClick={() => setActiveTab("fila")}
                    className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-[12px] bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border text-left"
                  >
                    <FileText className="w-3.5 h-3.5 shrink-0" /> {draftReports.length} rascunho(s) esperando sua revisão
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Resumo vivo: cada cartao e um atalho para a aba onde se age */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
        {[
          { label: "Saudáveis", value: healthy, color: "text-success", icon: HeartPulse, tab: "carteira" },
          { label: "Em atenção", value: attention, color: "text-warning", icon: Clock, tab: "carteira" },
          { label: "Risco alto", value: risk, color: "text-destructive", icon: ShieldAlert, tab: "carteira" },
          { label: "Rascunhos na fila", value: draftReports.length, color: "text-primary", icon: FileText, tab: "fila" },
          { label: "Pulsos respondidos", value: pulseAnswers, color: "text-info", icon: Star, tab: "radar" },
        ].map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => setActiveTab(s.tab)}
            className="bg-card border border-border rounded-xl p-4 text-left transition-colors hover:border-primary/40 cursor-pointer"
          >
            <div className="flex items-center justify-between mb-1">
              <s.icon className={`w-4 h-4 ${s.color}`} />
              <span className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">{s.label}</p>
          </button>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-secondary/50 border border-border rounded-lg p-1 flex overflow-x-auto md:flex-wrap h-auto scrollbar-hidden w-full justify-start">
          <TabsTrigger value="carteira" className="text-[13px] rounded-md shrink-0">Carteira ({healthRows.length})</TabsTrigger>
          <TabsTrigger value="perfis" className="text-[13px] rounded-md shrink-0">Perfis</TabsTrigger>
          <TabsTrigger value="avulsos" className="text-[13px] rounded-md shrink-0">Avulsos ({oneOffClients.length})</TabsTrigger>
          <TabsTrigger value="radar" className="text-[13px] rounded-md shrink-0">Radar de ideias ({opportunities.length})</TabsTrigger>
          <TabsTrigger value="fila" className="text-[13px] rounded-md shrink-0">Fila de revisão ({draftReports.length})</TabsTrigger>
          <TabsTrigger value="historico" className="text-[13px] rounded-md shrink-0">Histórico ({publishedReports.length})</TabsTrigger>
        </TabsList>

        {/* O que esta aba faz, em uma linha: guia sem precisar aprender */}
        <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
          {({
            carteira: "A saúde de cada cliente recorrente e o porquê da nota. Toque em um cliente para agir.",
            perfis: "Tudo de um cliente em um só lugar: o que enviar na semana, a mensagem pronta do grupo e o Diário do Trabalho.",
            avulsos: "Os clientes de projeto fechado: entrega, prazo e a próxima oferta natural.",
            radar: "As ideias de diferenciação do mês, uma por cliente, montadas do contexto real dele.",
            fila: "O que foi gerado e espera a sua revisão. Revise, edite e publique: o cliente vê na hora.",
            historico: "A linha do tempo completa do que já aconteceu e foi enviado.",
          } as Record<string, string>)[activeTab]}
        </p>

        {/* ── Carteira recorrente ── */}
        <TabsContent value="carteira">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 sm:px-5 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <HeartPulse className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Saúde da carteira recorrente</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Cada cliente recebe uma nota de 0 a 100 calculada dos dados reais (financeiro, aprovações, entregas, Pulso). Toque em um cliente para ver o porquê da nota e as ações prontas: mensagem do grupo, ritual e cadastro.
              </p>
            </div>
            <div className="divide-y divide-border max-h-[560px] overflow-y-auto">
              {healthRows.length === 0 && (
                <p className="p-8 text-center text-sm text-muted-foreground">Nenhum cliente ativo na carteira.</p>
              )}
              {healthRows.map((row) => {
                const meta = levelMeta[row.level];
                const open = expandedHealth === row.client.id;
                return (
                  <div key={row.client.id}>
                    <button
                      onClick={() => setExpandedHealth(open ? null : row.client.id)}
                      className="w-full flex items-center gap-3 px-5 py-3 text-left bg-transparent border-none cursor-pointer hover:bg-secondary/30 transition-colors"
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
                      <span className="text-[13px] text-foreground flex-1 truncate">
                        {row.client.company_name || row.client.full_name}
                        {row.pulse && (
                          <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-info/10 text-info align-middle">
                            Pulso {row.pulse.score}/5
                          </span>
                        )}
                      </span>
                      {row.alerts.slice(0, 1).map((a) => (
                        <span key={a.label} className="hidden sm:inline text-[9px] px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
                          {a.label}
                        </span>
                      ))}
                      <span className={`text-sm font-mono font-semibold ${meta.cls}`}>
                        {row.score === null ? "s/ dado" : row.score}
                      </span>
                      <span className="text-[10px] text-muted-foreground w-4">{open ? "▾" : "▸"}</span>
                    </button>
                    {open && (
                      <div className="px-5 pb-3 space-y-1.5 bg-secondary/20">
                        {row.factors.map((f) => (
                          <div key={f.label} className="flex items-center gap-2 text-[11px]">
                            <span className="text-muted-foreground flex-1">{f.label}</span>
                            <span className="text-muted-foreground">{f.note}</span>
                            <span className={`font-mono w-14 text-right ${f.earned === null ? "text-muted-foreground/60" : f.earned >= f.weight ? "text-success" : f.earned === 0 ? "text-destructive" : "text-warning"}`}>
                              {f.earned === null ? "s/ dado" : `${f.earned}/${f.weight}`}
                            </span>
                          </div>
                        ))}
                        {row.alerts.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {row.alerts.map((a) => (
                              <span key={a.label} className="text-[9px] px-2 py-0.5 rounded-full bg-destructive/10 text-destructive flex items-center gap-1">
                                <AlertTriangle className="w-2.5 h-2.5" /> {a.label}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2 pt-2">
                          <button
                            onClick={() => copyText(buildGroupMessage(row.client), "Mensagem do grupo copiada! É só colar no WhatsApp.")}
                            className="inline-flex items-center justify-center gap-1.5 text-[11px] px-3 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer border-none"
                          >
                            <Send className="w-3 h-3 shrink-0" /> Copiar mensagem do grupo
                          </button>
                          <button
                            onClick={() => { setProfileClientId(row.client.id); setActiveTab("perfis"); }}
                            className="inline-flex items-center justify-center gap-1.5 text-[11px] px-3 py-2 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border"
                          >
                            <UserCircle className="w-3 h-3 shrink-0" /> Ver perfil completo
                          </button>
                          <button
                            onClick={() => { setGenClientId(row.client.id); setGenRitual(ritualForToday()); setGenPreviews(null); setGeneratorOpen(true); }}
                            className="inline-flex items-center justify-center gap-1.5 text-[11px] px-3 py-2 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border"
                          >
                            <Sparkles className="w-3 h-3 shrink-0" /> Gerar ritual deste cliente
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>

        {/* ── Perfis: o plano de comunicação de cada cliente ── */}
        <TabsContent value="perfis">
          {(() => {
            const selected = healthRows.find((r) => r.client.id === profileClientId) || healthRows[0] || null;
            if (!selected) {
              return <div className="bg-card border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">Nenhum cliente na carteira ainda.</div>;
            }
            const client = selected.client;
            const clientProjs = (projects || []).filter((p: any) => p.client_id === client.id && p.status !== "done" && !p.deleted_at);
            const meta = levelMeta[selected.level];
            const ritualStatus = (ritual: string) => {
              const rows = (reports || []).filter((r: any) => r.client_id === client.id && (r.metrics as any)?.ritual_type === ritual);
              const latest = rows[0];
              if (!latest) return { label: "Ainda não gerado", cls: "bg-secondary text-muted-foreground" };
              const age = daysSince(latest.created_at) ?? 0;
              if (latest.status !== "published") return { label: `Rascunho na fila (${age}d)`, cls: "bg-warning/10 text-warning" };
              return { label: `Publicado há ${age}d`, cls: "bg-success/10 text-success" };
            };
            return (
              <div className="space-y-4">
                <p className="text-[11px] text-muted-foreground">
                  Escolha o cliente e veja tudo dele em um lugar: o que enviar em cada momento da semana, a mensagem do grupo pronta e o contexto que explica a nota.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={client.id}
                    onChange={(e) => setProfileClientId(e.target.value)}
                    className="w-full sm:w-auto bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground"
                  >
                    {healthRows.map((r) => (
                      <option key={r.client.id} value={r.client.id}>{r.client.company_name || r.client.full_name}</option>
                    ))}
                  </select>
                  <span className={`text-[11px] px-2.5 py-1 rounded-full ${meta.cls} bg-secondary/60`}>
                    {meta.label} · nota {selected.score ?? "s/ dado"}
                  </span>
                  {selected.pulse && (
                    <span className="text-[11px] px-2.5 py-1 rounded-full bg-info/10 text-info">Pulso {selected.pulse.score}/5</span>
                  )}
                  <button
                    onClick={() => openClientProfile(client.id)}
                    className="sm:ml-auto text-[11px] px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground border border-border cursor-pointer"
                  >
                    Abrir cadastro
                  </button>
                </div>

                <div className="grid lg:grid-cols-2 gap-4 auto-rows-fr">
                  {/* Plano de mensagens do período */}
                  <div className="bg-card border border-border rounded-xl overflow-hidden h-full flex flex-col">
                    <div className="px-5 py-3 border-b border-border">
                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">O que enviar e quando · com o contexto deste cliente</span>
                    </div>
                    <div className="divide-y divide-border">
                      {RITUALS.map((r) => {
                        const status = ritualStatus(r.value);
                        return (
                          <div key={r.value} className="flex items-center gap-3 px-5 py-3 flex-wrap">
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] text-foreground">{r.label}</p>
                              <p className="text-[10px] text-muted-foreground">{r.cadence} · {r.why}</p>
                            </div>
                            <span className={`text-[9px] px-2 py-0.5 rounded-full ${status.cls}`}>{status.label}</span>
                            <button
                              onClick={() => { setGenClientId(client.id); setGenRitual(r.value); setGenPreviews(null); setGeneratorOpen(true); }}
                              className="text-[11px] px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer border-none"
                            >
                              Gerar agora
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-auto text-[10px] text-muted-foreground px-5 py-2.5 border-t border-border">
                      Cada geração usa a movimentação real deste cliente e varia o texto semana a semana. Você revisa e edita antes de qualquer coisa chegar nele.
                    </p>
                  </div>

                  {/* Mensagens do grupo por momento + contexto */}
                  <div className="space-y-4">
                    <div className="bg-card border border-border rounded-xl p-5 space-y-2.5">
                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Mensagem do grupo · escolha o momento</span>
                      {[
                        { moment: "abertura" as const, label: "Abertura da semana (segunda)" },
                        { moment: "meio" as const, label: "Meio da semana (quarta)" },
                        { moment: "fechamento" as const, label: "Fechamento (sexta)" },
                      ].map((m) => (
                        <button
                          key={m.moment}
                          onClick={() => copyText(buildGroupMessage(client, m.moment), `Mensagem de ${m.label.toLowerCase()} copiada!`)}
                          className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border border-border bg-secondary/30 text-left cursor-pointer hover:border-primary/40 transition-colors"
                        >
                          <span className="text-[12px] text-foreground">{m.label}</span>
                          <span className="text-[10px] text-primary flex items-center gap-1"><Send className="w-3 h-3" /> Copiar</span>
                        </button>
                      ))}
                      <p className="text-[10px] text-muted-foreground">Montada na hora com entregas, frentes e pendências reais. O texto varia a cada semana para nunca soar repetido.</p>
                    </div>

                    {(() => {
                      const lastRitual = (reports || []).find(
                        (r: any) => r.client_id === client.id && r.status === "published" && (r.metrics as any)?.ritual_type
                      );
                      return lastRitual ? (
                        <div className="bg-card border border-primary/25 rounded-xl p-5 space-y-1.5">
                          <span className="text-[11px] uppercase tracking-wider text-primary font-medium">Onde estamos com este cliente</span>
                          <p className="text-[12px] font-medium text-foreground">{lastRitual.title}</p>
                          <p className="text-[11px] text-muted-foreground whitespace-pre-line line-clamp-6 leading-relaxed">{lastRitual.summary}</p>
                          <button
                            onClick={() => navigate(`/relatorios/${lastRitual.id}`)}
                            className="text-[10px] text-primary flex items-center gap-1 bg-transparent border-none cursor-pointer p-0 hover:opacity-80"
                          >
                            Ver a última atualização completa <ArrowUpRight className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="bg-card border border-border rounded-xl p-5">
                          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Onde estamos com este cliente</span>
                          <p className="text-[11px] text-muted-foreground mt-1">Nenhuma atualização publicada ainda. Gere a Rota da Semana ao lado para abrir o primeiro ciclo.</p>
                        </div>
                      );
                    })()}

                    <div className="bg-card border border-border rounded-xl p-5">
                      <ProjectJournal clientId={client.id} canWrite />
                    </div>

                    <div className="bg-card border border-border rounded-xl p-5 space-y-1.5">
                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Contexto agora</span>
                      <p className="text-[12px] text-muted-foreground">Plano: <span className="text-foreground">{client.plan_name || "Sem plano"}{client.plan_value ? ` · ${fmt(Number(client.plan_value))}/mês` : ""}</span></p>
                      <p className="text-[12px] text-muted-foreground">Frentes ativas: <span className="text-foreground">{clientProjs.length > 0 ? clientProjs.map((p: any) => p.name).join(", ") : "nenhuma"}</span></p>
                      {selected.factors.map((f) => (
                        <p key={f.label} className="text-[11px] text-muted-foreground">{f.label}: <span className="text-foreground">{f.note}</span></p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </TabsContent>

        {/* ── Avulsos: experiência e reativação ── */}
        <TabsContent value="avulsos">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-info" />
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Clientes avulsos · pós-entrega e reativação</span>
              <span className="text-[10px] text-muted-foreground ml-auto">Cada avulso bem atendido é um recorrente em potencial</span>
            </div>
            <div className="divide-y divide-border max-h-[560px] overflow-y-auto">
              {oneOffClients.length === 0 && (
                <p className="p-8 text-center text-sm text-muted-foreground">Nenhum cliente avulso cadastrado.</p>
              )}
              {oneOffClients.map((client: any) => {
                const clientProjects = (projects || []).filter((p: any) => p.client_id === client.id && !p.deleted_at);
                const activeCount = clientProjects.filter((p: any) => p.status !== "done").length;
                const doneCount = clientProjects.filter((p: any) => p.status === "done").length;
                const lastActivity = clientProjects
                  .map((p: any) => p.updated_at || p.created_at)
                  .sort()
                  .reverse()[0];
                const age = daysSince(lastActivity);
                const idle = activeCount === 0 && doneCount > 0 && age !== null && age >= 21;
                return (
                  <div key={client.id} className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 flex-wrap">
                    <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                      <p className="text-[13px] text-foreground truncate">{client.company_name || client.full_name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {activeCount > 0
                          ? `${activeCount} projeto(s) em andamento`
                          : doneCount > 0
                            ? `${doneCount} projeto(s) entregues · última movimentação há ${age ?? "?"}d`
                            : "Sem projetos registrados"}
                      </p>
                    </div>
                    {idle && (
                      <span className="text-[9px] px-2 py-0.5 rounded-full bg-warning/10 text-warning">Pronto para reativação</span>
                    )}
                    {activeCount > 0 && (
                      <span className="text-[9px] px-2 py-0.5 rounded-full bg-success/10 text-success">Em atendimento</span>
                    )}
                    <button
                      onClick={() =>
                        copyText(
                          `Oi, ${client.full_name?.split(" ")[0] || "tudo bem"}! Aqui é da Aceleriq. 😊\n\nSeu projeto com a gente foi entregue e queremos saber: como estão os resultados por aí?\n\nSe fizer sentido, temos duas formas de continuar te ajudando:\n1) Acompanhamento mensal para manter tudo evoluindo\n2) Um diagnóstico express (R$ 497) para mapear o próximo passo de maior impacto\n\nTopa conversar esta semana?`,
                          "Mensagem de reativação copiada!"
                        )
                      }
                      className="text-[11px] px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer border-none"
                    >
                      Copiar mensagem
                    </button>
                    <button
                      onClick={() => openClientProfile(client.id)}
                      className="text-[11px] px-2.5 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border"
                    >
                      <UserCircle className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>

        {/* ── Radar do mês ── */}
        <TabsContent value="radar">
          <div className="space-y-2">
            {opportunities.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  O Radar é o ritual de antecipação: uma vez por mês a Aceleriq chega com uma ideia
                  de diferenciação que o cliente até já pensou em fazer e nunca executou. Cada ideia
                  nasce do que ele já tem (frentes contratadas, material produzido, Pulso e tempo de
                  casa), na leitura do marketing de diferenciação: o que torna a marca desejada já
                  existe dentro do negócio.
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-warning">
                  A faixa de valor e o serviço avulso aparecem só para a equipe. Isso nunca entra na
                  mensagem que o cliente recebe: para ele é ideia, não proposta comercial.
                </p>
              </div>
            )}
            {opportunities.length === 0 && (
              <div className="bg-card border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
                Nenhuma ideia no radar agora. Assim que houver material produzido, publicações no ar
                ou Pulso respondido, as ideias do mês aparecem aqui por cliente.
              </div>
            )}
            {opportunities.map((idea) => {
              const lens = RADAR_LENSES[idea.lens];
              const [low, high] = idea.internal.range;
              return (
                <div key={idea.id} className="bg-card border border-border rounded-xl p-4 flex gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
                    <Radar className="w-4 h-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                        {lens.label}
                      </span>
                      <p className="text-[13px] font-medium text-foreground">{idea.title}</p>
                    </div>
                    <p className="text-[12px] text-foreground/80 mt-1.5">{idea.pitch}</p>

                    <p className="text-[11px] text-muted-foreground mt-2">
                      <span className="text-foreground/70">Por que agora: </span>
                      {idea.whyNow}
                    </p>

                    <ul className="mt-2 space-y-0.5">
                      {idea.moves.map((move) => (
                        <li key={move} className="text-[11px] text-muted-foreground">
                          · {move}
                        </li>
                      ))}
                    </ul>

                    <p className="text-[11px] text-muted-foreground mt-2">
                      <span className="text-foreground/70">Sinal que vamos olhar: </span>
                      {idea.signal}
                    </p>

                    {/* Leitura da equipe. Nunca vai para o cliente. */}
                    <div className="mt-2.5 rounded-lg border border-warning/25 bg-warning/[0.06] px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wider text-warning">
                        Só a equipe vê
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Se aprovada, vira: <span className="text-foreground/80">{idea.internal.offer}</span>
                        {high > 0 && ` · faixa ${fmt(low)} a ${fmt(high)}`} · esforço {idea.internal.effort}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2 mt-2.5">
                      <button
                        onClick={() => {
                          setGenClientId(idea.id.split(":")[0]);
                          setGenRitual("radar_aceleriq");
                          setGenIdeaId(idea.id);
                          setGenPreviews(null);
                          setGeneratorOpen(true);
                        }}
                        className="text-[11px] px-3 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer border-none"
                      >
                        Levar esta ideia ao cliente
                      </button>
                      <button
                        onClick={() => { setProfileClientId(idea.id.split(":")[0]); setActiveTab("perfis"); }}
                        className="text-[11px] px-3 py-2 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border"
                      >
                        Ver perfil do cliente
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* ── Fila de revisão ── */}
        <TabsContent value="fila">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 sm:px-5 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-warning shrink-0" />
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Fila de revisão</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Nada daqui chegou ao cliente ainda. Toque em um rascunho para ler o texto completo, ajustar do seu jeito e publicar quando aprovar.
              </p>
            </div>
            <div className="divide-y divide-border max-h-[560px] overflow-y-auto">
              {draftReports.length === 0 && (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  Fila vazia. Use "Gerar mensagens de hoje" para criar os rituais do dia com os dados de cada cliente.
                </p>
              )}
              {draftReports.map((r: any) => {
                const meta = ritualMeta(r.metrics?.ritual_type);
                const open = expandedDraft === r.id;
                const edits = draftEdits[r.id] || { summary: r.summary || "", next_steps: r.next_steps || "" };
                return (
                  <div key={r.id}>
                    <button
                      onClick={() => setExpandedDraft(open ? null : r.id)}
                      className="w-full flex items-center gap-3 px-5 py-3 text-left bg-transparent border-none cursor-pointer hover:bg-secondary/30 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-foreground truncate">
                          {r.title}
                          {meta && (
                            <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary align-middle">{meta.label}</span>
                          )}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {r.client?.company_name || r.client?.full_name} · {new Date(r.created_at).toLocaleDateString("pt-BR")}
                          {meta ? ` · ${meta.why}` : ""}
                        </p>
                      </div>
                      <span className="text-[10px] text-muted-foreground">{open ? "▾ fechar" : "▸ revisar"}</span>
                    </button>
                    {open && (
                      <div className="px-5 pb-4 space-y-3 bg-secondary/20">
                        {meta && (
                          <p className="text-[10px] text-muted-foreground pt-2">
                            Por que este rascunho existe: {meta.why}. Cadência: {meta.cadence}. Gerado com os dados reais do painel deste cliente.
                          </p>
                        )}
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Mensagem ao cliente (resultado explicado)</label>
                          <textarea
                            value={edits.summary}
                            onChange={(e) => setDraftEdits((prev) => ({ ...prev, [r.id]: { ...edits, summary: e.target.value } }))}
                            rows={4}
                            className="w-full mt-1 bg-card border border-border rounded-lg px-3 py-2 text-[12px] text-foreground resize-y leading-relaxed"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Próxima etapa</label>
                          <textarea
                            value={edits.next_steps}
                            onChange={(e) => setDraftEdits((prev) => ({ ...prev, [r.id]: { ...edits, next_steps: e.target.value } }))}
                            rows={2}
                            className="w-full mt-1 bg-card border border-border rounded-lg px-3 py-2 text-[12px] text-foreground resize-y leading-relaxed"
                          />
                        </div>
                        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
                          {isAdmin && (
                            <button
                              onClick={() => publishDraft(r)}
                              className="inline-flex items-center justify-center gap-1 text-[11px] px-3 py-2 rounded-lg bg-success/10 text-success hover:bg-success/20 transition-colors cursor-pointer border-none"
                            >
                              <Send className="w-3 h-3 shrink-0" /> Publicar
                            </button>
                          )}
                          <button
                            onClick={() => saveDraftEdits(r)}
                            className="text-[11px] px-3 py-2 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border"
                          >
                            Salvar edição
                          </button>
                          <button
                            onClick={() => navigate(`/relatorios/${r.id}`)}
                            className="text-[11px] px-3 py-2 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border"
                          >
                            Abrir completo
                          </button>
                          {isAdmin && (
                            <button
                              onClick={() => deleteDraft(r)}
                              className="inline-flex items-center justify-center gap-1 text-[11px] px-3 py-2 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors cursor-pointer border-none sm:ml-auto"
                            >
                              <Trash2 className="w-3 h-3 shrink-0" /> Descartar
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>

        {/* ── Histórico: linha do tempo com o contexto inteiro do painel ── */}
        <TabsContent value="historico">
          {(() => {
            const nameOf = (clientId: string) => {
              const client = portfolioClients.find((c: any) => c.id === clientId);
              return client ? (client.company_name || client.full_name) : "Cliente";
            };
            type TimelineEvent = { at: string; icon: "report" | "publication" | "approval" | "file"; text: string; clientId: string };
            const timeline: TimelineEvent[] = [
              ...publishedReports.map((r: any) => ({
                at: r.created_at,
                icon: "report" as const,
                text: `Atualização publicada: ${r.title}`,
                clientId: r.client_id,
              })),
              ...allPublications
                .filter((p: any) => p.status === "published" && p.published_at)
                .map((p: any) => ({
                  at: p.published_at,
                  icon: "publication" as const,
                  text: `Publicação no ar (${p.platform === "instagram" ? "Instagram" : p.platform})`,
                  clientId: p.client_id,
                })),
              ...allPublications
                .filter((p: any) => p.status === "scheduled" && p.scheduled_at)
                .map((p: any) => ({
                  at: p.scheduled_at,
                  icon: "publication" as const,
                  text: `Publicação programada (${p.platform === "instagram" ? "Instagram" : p.platform})`,
                  clientId: p.client_id,
                })),
              ...pendingApprovalFiles.map((f: any) => ({
                at: f.created_at,
                icon: "approval" as const,
                text: `Enviado para aprovação: ${f.file_name}`,
                clientId: f.client_id,
              })),
              ...releasedFiles.map((f: any) => ({
                at: f.created_at,
                icon: "file" as const,
                text: `Material liberado: ${f.file_name}`,
                clientId: f.client_id,
              })),
            ]
              .filter((event) => event.at)
              .sort((a, b) => (a.at < b.at ? 1 : -1))
              .slice(0, 120);
            const iconMap = { report: CheckCircle2, publication: ArrowUpRight, approval: HeartPulse, file: CheckCircle2 } as const;
            return (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-success" />
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                Linha do tempo completa: atualizações, publicações, aprovações e materiais ({timeline.length})
              </span>
            </div>
            <div className="divide-y divide-border max-h-[560px] overflow-y-auto">
              {timeline.length === 0 && (
                <p className="p-8 text-center text-sm text-muted-foreground">Nenhum movimento registrado ainda.</p>
              )}
              {timeline.map((event, index) => {
                const EventIcon = iconMap[event.icon];
                return (
                  <div key={`${event.at}-${index}`} className="flex items-center gap-3 px-5 py-2.5">
                    <EventIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] text-foreground">{event.text}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {nameOf(event.clientId)} · {new Date(event.at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
            );
          })()}

          <div className="mt-4 bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-success" />
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Atualizações enviadas aos clientes</span>
            </div>
            <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
              {publishedReports.length === 0 && (
                <p className="p-8 text-center text-sm text-muted-foreground">Nada publicado ainda.</p>
              )}
              {publishedReports.map((r: any) => {
                const meta = ritualMeta(r.metrics?.ritual_type);
                return (
                  <button
                    key={r.id}
                    onClick={() => navigate(`/relatorios/${r.id}`)}
                    className="w-full flex items-center gap-3 px-5 py-2.5 text-left bg-transparent border-none cursor-pointer hover:bg-secondary/30 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] text-foreground truncate">
                        {r.title}
                        {meta && (
                          <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-success/10 text-success align-middle">{meta.label}</span>
                        )}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {r.client?.company_name || r.client?.full_name} · {new Date(r.created_at).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                    <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Modal gerador: selecionar, PRÉ-VISUALIZAR e só então criar */}
      <Dialog open={generatorOpen} onOpenChange={(v) => { setGeneratorOpen(v); if (!v) { setGenPreviews(null); setGenIdeaId(null); } }}>
        <DialogContent className="bg-card border-border max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {genPreviews ? `Pré-visualização (${genPreviews.length})` : "Gerar mensagens com dados reais"}
            </DialogTitle>
          </DialogHeader>

          {!genPreviews ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Para quem</label>
                <select
                  value={genClientId}
                  onChange={(e) => setGenClientId(e.target.value)}
                  className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                >
                  <option value="__all__">Todos os clientes da carteira ({portfolioClients.length})</option>
                  {portfolioClients.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Ritual</label>
                <div className="mt-1 space-y-1.5">
                  {RITUALS.map((r) => (
                    <button
                      key={r.value}
                      onClick={() => setGenRitual(r.value)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-left cursor-pointer transition-colors ${
                        genRitual === r.value ? "border-primary bg-primary/10 text-foreground" : "border-border bg-secondary/30 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span className="text-[13px]">{r.label}</span>
                      <span className="text-[10px]">{r.cadence}</span>
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={previewDrafts}
                className="w-full py-2.5 rounded-xl text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none"
              >
                Ver antes de criar
              </button>
              <p className="text-[11px] text-muted-foreground">
                Nada é criado nesta etapa. Você verá a mensagem de cada cliente antes de confirmar, e mesmo depois tudo fica na fila de revisão até você publicar.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[11px] text-muted-foreground">
                Revise e edite a mensagem de cada cliente aqui mesmo. Só depois de confirmar os rascunhos são criados, e mesmo assim nada vai ao cliente antes de você publicar na fila.
              </p>
              {genPreviews.map((preview, index) => (
                <div key={preview.clientId} className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
                  <p className="text-[12px] font-medium text-foreground">{preview.clientName}</p>
                  <p className="text-[11px] font-medium text-primary">{preview.draft.title}</p>
                  <div>
                    <label className="text-[9px] uppercase tracking-wider text-muted-foreground">Mensagem</label>
                    <textarea
                      value={preview.draft.summary}
                      onChange={(e) =>
                        setGenPreviews((prev) =>
                          prev
                            ? prev.map((p, i) => (i === index ? { ...p, draft: { ...p.draft, summary: e.target.value } } : p))
                            : prev
                        )
                      }
                      rows={4}
                      className="w-full mt-0.5 bg-card border border-border rounded-lg px-3 py-2 text-[11px] text-foreground resize-y leading-relaxed"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] uppercase tracking-wider text-muted-foreground">Próxima etapa</label>
                    <textarea
                      value={preview.draft.next_steps}
                      onChange={(e) =>
                        setGenPreviews((prev) =>
                          prev
                            ? prev.map((p, i) => (i === index ? { ...p, draft: { ...p.draft, next_steps: e.target.value } } : p))
                            : prev
                        )
                      }
                      rows={2}
                      className="w-full mt-0.5 bg-card border border-border rounded-lg px-3 py-2 text-[11px] text-foreground resize-y leading-relaxed"
                    />
                  </div>
                </div>
              ))}
              <div className="flex gap-2">
                <button
                  onClick={() => setGenPreviews(null)}
                  className="flex-1 py-2.5 rounded-xl text-[13px] bg-secondary text-muted-foreground border border-border cursor-pointer"
                >
                  Voltar
                </button>
                <button
                  onClick={confirmDrafts}
                  disabled={generating}
                  className="flex-1 py-2.5 rounded-xl text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none disabled:opacity-50"
                >
                  {generating ? "Criando…" : `Criar ${genPreviews.length} rascunho(s)`}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
