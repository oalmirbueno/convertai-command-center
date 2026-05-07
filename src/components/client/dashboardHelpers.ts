import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMemo } from "react";

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
  onSelectProject: (p: any) => void;
}

export const typeLabels: Record<string, string> = {
  social_media: "Social Media", traffic: "Tráfego", automation: "Automação",
  site: "Site", landing_page: "Landing Page", event: "Evento", other: "Outro",
};

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
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

export function formatDate(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateShort(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

/* ───────── Hook: useClientDashboardData ───────── */

export function useClientDashboardData(clientId: string) {
  const { user } = useAuth();

  const { data: projects, isLoading: loadingProjects } = useQuery({
    queryKey: ["client-projects", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*").eq("client_id", clientId).is("deleted_at", null).order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && !!clientId,
    refetchInterval: 15000,
  });

  const projectIds = (projects || []).map((p: any) => p.id);

  const { data: recentUpdates } = useQuery({
    queryKey: ["client-updates-all", clientId, projectIds.join(",")],
    queryFn: async () => {
      if (!projectIds.length) return [];
      const { data } = await supabase.from("updates")
        .select("*, author:profiles!updates_author_id_fkey(full_name), project:projects!updates_project_id_fkey(name)")
        .in("project_id", projectIds).order("created_at", { ascending: false }).limit(12);
      return data || [];
    },
    enabled: !!user && projectIds.length > 0,
    refetchInterval: 15000,
  });

  const { data: milestones } = useQuery({
    queryKey: ["client-milestones-all", clientId, projectIds.join(",")],
    queryFn: async () => {
      if (!projectIds.length) return [];
      const { data } = await supabase.from("milestones")
        .select("*, project:projects!milestones_project_id_fkey(name)")
        .in("project_id", projectIds).is("deleted_at", null).order("target_date", { ascending: true }).limit(10);
      return data || [];
    },
    enabled: !!user && projectIds.length > 0,
  });

  const { data: completedMilestones } = useQuery({
    queryKey: ["client-done-milestones", clientId, projectIds.join(",")],
    queryFn: async () => {
      if (!projectIds.length) return [];
      const { data } = await supabase.from("milestones").select("id").in("project_id", projectIds).eq("status", "completed").is("deleted_at", null);
      return data || [];
    },
    enabled: !!user && projectIds.length > 0,
  });

  const { data: pendingFiles } = useQuery({
    queryKey: ["client-pending-approvals", clientId],
    queryFn: async () => {
      const { data } = await supabase.from("files")
        .select("id, file_name, created_at, project:projects!files_project_id_fkey(name)")
        .eq("client_id", clientId).eq("approval_status", "pending")
        .order("created_at", { ascending: false }).limit(5);
      return data || [];
    },
    enabled: !!user && !!clientId,
  });

  const { data: allTasks } = useQuery({
    queryKey: ["client-all-tasks-detail", clientId, projectIds.join(",")],
    queryFn: async () => {
      if (!projectIds.length) return [];
      const { data } = await supabase.from("tasks")
        .select("id, title, status, due_date, priority, project_id, updated_at, assigned_to, assignee:profiles!tasks_assigned_to_fkey(full_name), project:projects!tasks_project_id_fkey(name)")
        .in("project_id", projectIds).order("updated_at", { ascending: false });
      return data || [];
    },
    enabled: !!user && projectIds.length > 0,
    refetchInterval: 15000,
  });

  const { data: deliveredFiles } = useQuery({
    queryKey: ["client-delivered-files", clientId],
    queryFn: async () => {
      const { data } = await supabase.from("files").select("id, approval_status").eq("client_id", clientId);
      return data || [];
    },
    enabled: !!user && !!clientId,
  });

  const allProjects = projects || [];
  const activeProjects = allProjects.filter((p: any) => p.status !== "done");
  const doneProjects = allProjects.filter((p: any) => p.status === "done");
  const avgProgress = activeProjects.length > 0
    ? Math.round(activeProjects.reduce((s: number, p: any) => s + (p.progress || 0), 0) / activeProjects.length) : 0;

  const tasks = allTasks || [];
  const doingTasks = tasks.filter((t: any) => t.status === "doing");
  const reviewTasks = tasks.filter((t: any) => t.status === "review");
  const doneTasks = tasks.filter((t: any) => t.status === "done");
  const totalTasks = tasks.length;

  const totalFiles = (deliveredFiles || []).length;
  const approvedFiles = (deliveredFiles || []).filter((f: any) => f.approval_status === "approved").length;
  const totalMilestones = (milestones || []).length + (completedMilestones || []).length;
  const completedMilestonesCount = (completedMilestones || []).length;

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
      recentUpdates: recentUpdates || [],
    },
  };
}
