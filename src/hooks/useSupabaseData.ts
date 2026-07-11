import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useProjects() {
  const { user, profile } = useAuth();
  const isClient = profile?.role === "client";
  const isAdmin = profile?.role === "admin";
  const isTeam = ["design", "traffic", "manager"].includes(profile?.role || "");
  return useQuery({
    queryKey: ["projects", user?.id, profile?.role],
    queryFn: async () => {
      if (isTeam) {
        // Team members: projects from assigned tasks OR from assigned clients
        const [{ data: myTasks }, { data: assigns }] = await Promise.all([
          supabase.from("tasks").select("project_id").eq("assigned_to", user!.id).is("deleted_at", null),
          supabase.from("team_client_assignments").select("client_id").eq("user_id", user!.id),
        ]);
        const projectIds = new Set<string>((myTasks || []).map((t: any) => t.project_id).filter(Boolean));
        const assignedClientIds = (assigns || []).map((a: any) => a.client_id);

        if (assignedClientIds.length > 0) {
          const { data: cliProjects } = await supabase
            .from("projects")
            .select("id")
            .in("client_id", assignedClientIds)
            .is("deleted_at", null);
          (cliProjects || []).forEach((p: any) => projectIds.add(p.id));
        }
        if (projectIds.size === 0) return [];
        const { data, error } = await supabase
          .from("projects")
          .select("*, client:profiles!projects_client_id_fkey(full_name, company_name)")
          .in("id", Array.from(projectIds))
          .is("deleted_at", null)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase
        .from("projects")
        .select("*, client:profiles!projects_client_id_fkey(full_name, company_name)")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    refetchInterval: isClient ? 15000 : undefined,
  });
}

export function useTasks(projectId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["tasks", user?.id, projectId],
    queryFn: async () => {
      let query = supabase
        .from("tasks")
        .select("*, project:projects(name), assignee:profiles!tasks_assigned_to_fkey(id, full_name), milestone:milestones!tasks_milestone_id_fkey(id, title)")
        .is("deleted_at", null)
        .order("task_order", { ascending: true });
      if (projectId) query = query.eq("project_id", projectId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    refetchInterval: 15000,
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
        .limit(30);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    refetchInterval: 10000,
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
    refetchInterval: 15000,
  });
}

export function useClients() {
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const isTeam = ["design", "traffic", "manager"].includes(profile?.role || "");
  const isTeamOrAdmin = isAdmin || isTeam;
  return useQuery({
    queryKey: ["clients", user?.id, profile?.role],
    queryFn: async () => {
      if (isTeam) {
        // Team members: only clients from projects where they have assigned tasks
        const { data: myTasks } = await supabase
          .from("tasks")
          .select("project_id")
          .eq("assigned_to", user!.id)
          .is("deleted_at", null);
        const projectIds = [...new Set((myTasks || []).map((t: any) => t.project_id))];
        if (projectIds.length === 0) return [];

        const { data: projects } = await supabase
          .from("projects")
          .select("id, client_id")
          .in("id", projectIds)
          .is("deleted_at", null);
        const clientIds = [...new Set((projects || []).map((p: any) => p.client_id))];
        if (clientIds.length === 0) return [];

        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .in("id", clientIds)
          .is("deleted_at", null);
        if (error) throw error;

        return (data || []).map((p: any) => ({
          ...p,
          projectCount: (projects || []).filter((pr: any) => pr.client_id === p.id).length,
        }));
      }

      // Admin: all clients
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
        .in("id", clientIds)
        .is("deleted_at", null);
      if (error) throw error;

      const { data: projects } = await supabase
        .from("projects")
        .select("client_id")
        .is("deleted_at", null);

      return (data || []).map((profile: any) => ({
        ...profile,
        projectCount: (projects || []).filter((p: any) => p.client_id === profile.id).length,
      }));
    },
    enabled: !!user && isTeamOrAdmin,
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
        .is("deleted_at", null)
        .order("milestone_order", { ascending: true });
      if (projectId) query = query.eq("project_id", projectId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!projectId,
  });
}

export function useFiles(projectId?: string, clientId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["files", user?.id, projectId, clientId],
    queryFn: async () => {
      let query = supabase
        .from("files")
        .select("*, uploader:profiles!files_uploaded_by_fkey(full_name), project:projects(name), client:profiles!files_client_id_fkey(full_name, company_name)")
        .order("created_at", { ascending: false });
      if (projectId) query = query.eq("project_id", projectId);
      if (clientId) query = query.eq("client_id", clientId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    refetchInterval: 20000,
  });
}

export function useAllFiles() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["all-files", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("files")
        .select("*, uploader:profiles!files_uploaded_by_fkey(full_name), project:projects(name), client:profiles!files_client_id_fkey(full_name, company_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    refetchInterval: 15000,
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

export function useTeamMembers() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["team-members", user?.id],
    queryFn: async () => {
      // Get non-client roles
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .neq("role", "client");
      if (rolesError) throw rolesError;

      const userIds = roles?.map((r: any) => r.user_id) || [];
      if (userIds.length === 0) return [];

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .in("id", userIds);
      if (error) throw error;

      return (data || []).map((p: any) => ({
        ...p,
        role: roles?.find((r: any) => r.user_id === p.id)?.role || "admin",
      }));
    },
    enabled: !!user,
  });
}
