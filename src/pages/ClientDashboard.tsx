import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useProjects, useTasks } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import ProjectView from "@/components/client/ProjectView";
import ClientJourneyDashboard from "@/components/client/ClientJourneyDashboard";

interface ClientDashboardProps {
  /** When set, renders as if viewing a specific client (admin impersonation) */
  impersonateClientId?: string;
  impersonateClientName?: string;
}

export default function ClientDashboard({ impersonateClientId, impersonateClientName }: ClientDashboardProps) {
  const { profile } = useAuth();
  const [selectedProject, setSelectedProject] = useState<any>(null);

  const clientId = impersonateClientId || profile?.id;
  const clientName = impersonateClientName || profile?.company_name || profile?.full_name || "";

  if (selectedProject) {
    return <ProjectView project={selectedProject} onBack={() => setSelectedProject(null)} />;
  }

  return (
    <ClientJourneyDashboard
      clientId={clientId!}
      clientName={clientName}
      onSelectProject={setSelectedProject}
      isImpersonation={!!impersonateClientId}
    />
  );
}
