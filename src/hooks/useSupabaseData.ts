import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useProjects() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["projects", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, client:profiles!projects_client_id_fkey(full_name, company_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

export function useTasks(projectId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["tasks", user?.id, projectId],
    queryFn: async () => {
      let query = supabase
        .from("tasks")
        .select("*, project:projects(name), assignee:profiles!tasks_assigned_to_fkey(full_name)")
        .order("task_order", { ascending: true });
      if (projectId) query = query.eq("project_id", projectId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

export function useNotifications() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

export function useUpdates() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["updates", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("updates")
        .select("*, author:profiles!updates_author_id_fkey(full_name)")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

export function useClients() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["clients", user?.id],
    queryFn: async () => {
      const { data: clientRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "client");
      if (rolesError) throw rolesError;

      const clientIds = clientRoles?.map((r: any) => r.user_id) || [];
      if (clientIds.length === 0) return [];

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .in("id", clientIds);
      if (error) throw error;

      const { data: projects } = await supabase
        .from("projects")
        .select("client_id");

      return (data || []).map((profile: any) => ({
        ...profile,
        projectCount: (projects || []).filter((p: any) => p.client_id === profile.id).length,
      }));
    },
    enabled: !!user && user.role === "admin",
  });
}

export function useMilestones(projectId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["milestones", user?.id, projectId],
    queryFn: async () => {
      let query = supabase
        .from("milestones")
        .select("*")
        .order("milestone_order", { ascending: true });
      if (projectId) query = query.eq("project_id", projectId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!projectId,
  });
}

export function useFiles(projectId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["files", user?.id, projectId],
    queryFn: async () => {
      let query = supabase
        .from("files")
        .select("*, uploader:profiles!files_uploaded_by_fkey(full_name)")
        .order("created_at", { ascending: false });
      if (projectId) query = query.eq("project_id", projectId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!projectId,
  });
}

export function useProjectUpdates(projectId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["project-updates", user?.id, projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("updates")
        .select("*, author:profiles!updates_author_id_fkey(full_name)")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!projectId,
  });
}

export function useClientRequests() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["client-requests", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}
