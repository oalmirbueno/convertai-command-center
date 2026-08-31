import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PROFILE_SAFE_SELECT } from "@/lib/profileFields";

const CLIENT_SAFE_FILE_SELECT = `
  id,
  client_id,
  project_id,
  uploaded_by,
  file_name,
  file_url,
  file_type,
  folder,
  description,
  caption,
  carousel_text,
  approval_status,
  feedback,
  client_decided_by,
  client_decided_at,
  approval_requested_at,
  visibility,
  requires_approval,
  status,
  archived_at,
  created_at,
  updated_at,
  parent_file_id,
  revision_of_file_id,
  locked_at,
  version,
  storage_bucket,
  storage_path,
  mime_type,
  extension,
  size_bytes,
  page_count,
  sheet_count,
  slide_count,
  uploader:profiles!files_uploaded_by_fkey(full_name),
  project:projects(name),
  client:profiles!files_client_id_fkey(full_name, company_name)
`;

const TASK_PAGE_SIZE = 1_000;

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

export function useTasks(
  projectId?: string,
  options: { enabled?: boolean; refetchInterval?: number | false } = {},
) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["tasks", user?.id, projectId],
    queryFn: async () => {
      const fetchTaskPage = async (afterId: string | null) => {
        let query = supabase
          .from("tasks")
          .select("*, project:projects(name), assignee:profiles!tasks_assigned_to_fkey(id, full_name), milestone:milestones!tasks_milestone_id_fkey(id, title)")
          .is("deleted_at", null)
          .order("id", { ascending: true })
          .limit(TASK_PAGE_SIZE);
        if (projectId) query = query.eq("project_id", projectId);
        if (afterId) query = query.gt("id", afterId);
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
      };

      const tasksById = new Map<
        string,
        Awaited<ReturnType<typeof fetchTaskPage>>[number]
      >();
      let afterId: string | null = null;

      while (true) {
        const page = await fetchTaskPage(afterId);
        for (const task of page) tasksById.set(task.id, task);
        if (page.length < TASK_PAGE_SIZE) break;

        const nextAfterId = page[page.length - 1]?.id || null;
        if (!nextAfterId || nextAfterId === afterId) break;
        afterId = nextAfterId;
      }

      return [...tasksById.values()].sort((left, right) => {
        const leftOrder = left.task_order ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = right.task_order ?? Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || left.id.localeCompare(right.id);
      });
    },
    enabled: (options.enabled ?? true) && !!user,
    refetchInterval: options.refetchInterval ?? 15000,
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
        // Team members: clients from assigned tasks OR direct client assignments
        const [{ data: myTasks }, { data: assigns }] = await Promise.all([
          supabase.from("tasks").select("project_id").eq("assigned_to", user!.id).is("deleted_at", null),
          supabase.from("team_client_assignments").select("client_id").eq("user_id", user!.id),
        ]);
        const projectIds = [...new Set((myTasks || []).map((t: any) => t.project_id))];
        const clientIds = new Set<string>((assigns || []).map((a: any) => a.client_id));

        if (projectIds.length > 0) {
          const { data: projects } = await supabase
            .from("projects")
            .select("id, client_id")
            .in("id", projectIds)
            .is("deleted_at", null);
          (projects || []).forEach((p: any) => p.client_id && clientIds.add(p.client_id));
        }
        if (clientIds.size === 0) return [];

        const idArr = Array.from(clientIds);
        const { data, error } = await supabase
          .from("profiles")
          .select(PROFILE_SAFE_SELECT)
          .in("id", idArr)
          .is("deleted_at", null);
        if (error) throw error;

        const { data: allProjects } = await supabase
          .from("projects")
          .select("client_id")
          .in("client_id", idArr)
          .is("deleted_at", null);

        return (data || []).map((p: any) => ({
          ...p,
          projectCount: (allProjects || []).filter((pr: any) => pr.client_id === p.id).length,
        }));
      }

      // Cliente: a "lista de clientes" e ele mesmo. O caminho de admin abaixo
      // consulta user_roles, que o RLS bloqueia para clientes - e o erro
      // derrubava a agenda inteira no lado do cliente.
      if (profile?.role === "client") {
        return profile ? [{ ...profile, projectCount: 0 }] : [];
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
        .select(PROFILE_SAFE_SELECT)
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
        .select(CLIENT_SAFE_FILE_SELECT)
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
      const { data, error } = await (supabase as any)
        .from("staff_files_secure")
        .select("*")
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
        .select("id, client_id, project_id, title, description, priority, status, created_at, updated_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    refetchInterval: 15_000,
  });
}

export function useTeamMembers(queryEnabled = true) {
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
        .select(PROFILE_SAFE_SELECT)
        .in("id", userIds)
        // Desativado sai da equipe ATIVA, mas continua no histórico: quem
        // participou da trilha não pode ser apagado sem tornar o registro
        // mentiroso, então some daqui em vez de sumir do passado.
        .is("deleted_at", null);
      if (error) throw error;

      return (data || []).map((p: any) => ({
        ...p,
        role: roles?.find((r: any) => r.user_id === p.id)?.role || "admin",
      }));
    },
    enabled: !!user && queryEnabled,
  });
}
