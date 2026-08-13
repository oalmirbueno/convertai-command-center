import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
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

  useEffect(() => {
    setSelectedProject(null);
  }, [clientId]);

  if (selectedProject) {
    return <ProjectView project={selectedProject} onBack={() => setSelectedProject(null)} />;
  }

  return (
    <div className="space-y-6">
      <ClientJourneyDashboard
        clientId={clientId!}
        clientName={clientName}
        onSelectProject={setSelectedProject}
        isImpersonation={!!impersonateClientId}
      />
    </div>
  );
}
