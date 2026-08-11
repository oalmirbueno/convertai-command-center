import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMemo } from "react";
import { formatBRDate, parseAppDate, todayBR } from "@/lib/dateBR";

/* ───────── Types & helpers shared across sub-components ───────── */

export interface DashboardData {
  clientId: string;
  clientName: string;
  projects: any[];
  activeProjects: any[];
  doneProjects: any[];
  avgProgress: number;
  tasks: any[];
  doingTasks: any[];
  reviewTasks: any[];
  doneTasks: any[];
  totalTasks: number;
  milestones: any[];
  completedMilestonesCount: number;
  totalMilestones: number;
  pendingFiles: any[];
  deliveredFiles: any[];
  approvedFiles: number;
  totalFiles: number;
  recentUpdates: any[];
  contentPublications: any[];
  latestReport: any | null;
  onSelectProject: (p: any) => void;
}

export const typeLabels: Record<string, string> = {
  social_media: "Social Media", traffic: "Tráfego", automation: "Automação",
  site: "Site", landing_page: "Landing Page", event: "Evento", other: "Outro",
};

/**
 * Frentes recorrentes (ciclo mensal) x projetos com começo e fim (marcos + %).
 * Um cliente híbrido mostra os dois modelos ao mesmo tempo, cada um na sua frente.
 */
export const RECURRING_PROJECT_TYPES = ["social_media", "traffic"];
export const isRecurringProject = (p: any) => RECURRING_PROJECT_TYPES.includes(p?.project_type);

export function relativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMinutes < 1) return "agora";
  if (diffMinutes < 60) return `${diffMinutes}min atrás`;
  if (diffHours < 24) return `${diffHours}h atrás`;
  if (diffDays < 7) return `${diffDays}d atrás`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function daysUntil(dateStr: string): number {
  const target = parseAppDate(dateStr);
  const today = parseAppDate(todayBR());
  if (!target || !today) return 0;
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function formatDate(d: string) {
  if (!d) return "";
  return formatBRDate(d);
}

export function formatDateShort(d: string) {
  if (!d) return "";
  const parsed = parseAppDate(d);
  if (!parsed) return "";
  return parsed.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

/* ───────── Hook: useClientDashboardData ───────── */

export function useClientDashboardData(clientId: string) {
  const { user } = useAuth();

  const { data: projects, isLoading: loadingProjects } = useQuery({
    queryKey: ["client-projects", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects")
        .select("id, client_id, name, description, objectives, scope, project_type, status, progress, start_date, deadline, created_at")
        .eq("client_id", clientId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && !!clientId,
    refetchInterval: 15000,
  });

  const projectIds = (projects || []).map((p: any) => p.id);

  const { data: milestones } = useQuery({
    queryKey: ["client-milestones-all", clientId, projectIds.join(",")],
    queryFn: async () => {
      if (!projectIds.length) return [];
      const { data } = await supabase.from("milestones")
        .select("id, project_id, title, status, target_date, project:projects!milestones_project_id_fkey(name)")
        .in("project_id", projectIds).is("deleted_at", null).order("target_date", { ascending: true });
      return data || [];
    },
    enabled: !!user && projectIds.length > 0,
  });

  const { data: pendingFiles } = useQuery({
    queryKey: ["client-pending-approvals", clientId],
    queryFn: async () => {
      const { data } = await supabase.from("files")
        .select("id, file_name, created_at, version, project:projects!files_project_id_fkey(name)")
        .eq("client_id", clientId)
        .eq("visibility", "approval")
        .eq("requires_approval", true)
        .eq("approval_status", "pending")
        .eq("status", "ready")
        .is("archived_at", null)
        .is("parent_file_id", null)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!user && !!clientId,
  });

  const { data: deliveredFiles } = useQuery({
    queryKey: ["client-delivered-files", clientId],
    queryFn: async () => {
      const { data } = await supabase.from("files")
        .select("id, file_name, created_at, version, approval_status, visibility, project_id, project:projects!files_project_id_fkey(name)")
        .eq("client_id", clientId)
        .in("visibility", ["client_shared", "approval"])
        .eq("status", "ready")
        .is("archived_at", null)
        .is("parent_file_id", null)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!user && !!clientId,
  });

  // Publicações de conteúdo visíveis ao cliente (RLS libera apenas o que está
  // programado/publicado com aprovação completa — nada interno vaza).
  const { data: contentPublications } = useQuery({
    queryKey: ["client-content-publications", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("editorial_publications")
        .select("id, post_id, project_id, platform, status, scheduled_at, scheduled_timezone, published_at, permalink")
        .eq("client_id", clientId)
        .in("status", ["scheduled", "published"])
        .order("scheduled_at", { ascending: true });
      if (error) return [];
      return data || [];
    },
    enabled: !!user && !!clientId,
  });

  // Dados do próprio contrato (renovação e cobranças pendentes do cliente).
  const { data: clientProfile } = useQuery({
    queryKey: ["client-profile-lite", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles")
        .select("id, plan_name, plan_value, plan_status, plan_renewal_date, client_type")
        .eq("id", clientId)
        .maybeSingle();
      if (error) return null;
      return data || null;
    },
    enabled: !!user && !!clientId,
  });

  const { data: clientPendingBilling } = useQuery({
    queryKey: ["client-own-pending-billing", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("billing")
        .select("id, amount, due_date, status, type, description")
        .eq("client_id", clientId)
        .eq("status", "pending")
        .order("due_date", { ascending: true });
      if (error) return [];
      return data || [];
    },
    enabled: !!user && !!clientId,
  });

  // Última atualização publicada pela Aceleriq (relatórios/rituais publicados).
  const { data: latestReport } = useQuery({
    queryKey: ["client-latest-report", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("reports")
        .select("id, title, summary, highlights, next_steps, period_start, period_end, created_at, status")
        .eq("client_id", clientId)
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data || null;
    },
    enabled: !!user && !!clientId,
  });

  const allProjects = projects || [];
  const activeProjects = allProjects.filter((p: any) => p.status !== "done");
  const doneProjects = allProjects.filter((p: any) => p.status === "done");
  const avgProgress = activeProjects.length > 0
    ? Math.round(activeProjects.reduce((s: number, p: any) => s + (p.progress || 0), 0) / activeProjects.length) : 0;

  // Tarefas e atualizações são bastidores da equipe e não são consultadas no painel do cliente.
  const tasks: any[] = [];
  const doingTasks: any[] = [];
  const reviewTasks: any[] = [];
  const doneTasks: any[] = [];
  const totalTasks = 0;

  const totalFiles = (deliveredFiles || []).length;
  const approvedFiles = (deliveredFiles || []).filter((f: any) => f.approval_status === "approved").length;
  const totalMilestones = (milestones || []).length;
  const completedMilestonesCount = (milestones || []).filter((milestone: any) => milestone.status === "completed").length;

  return {
    loadingProjects,
    data: {
      projects: allProjects,
      activeProjects,
      doneProjects,
      avgProgress,
      tasks,
      doingTasks,
      reviewTasks,
      doneTasks,
      totalTasks,
      milestones: milestones || [],
      completedMilestonesCount,
      totalMilestones,
      pendingFiles: pendingFiles || [],
      deliveredFiles: deliveredFiles || [],
      approvedFiles,
      totalFiles,
      recentUpdates: [],
      contentPublications: contentPublications || [],
      latestReport: latestReport || null,
      clientProfile: clientProfile || null,
      clientPendingBilling: clientPendingBilling || [],
    },
  };
}
