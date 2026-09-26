import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import ProjectView from "@/components/client/ProjectView";
import ClientJourneyDashboard from "@/components/client/ClientJourneyDashboard";
import { useClientDashboardData } from "@/components/client/dashboardHelpers";
import { Carregando, useEstadoDaTela } from "@/components/sistema";

interface ClientDashboardProps {
  /** When set, renders as if viewing a specific client (admin impersonation) */
  impersonateClientId?: string;
  impersonateClientName?: string;
}

export default function ClientDashboard({ impersonateClientId, impersonateClientName }: ClientDashboardProps) {
  const { profile } = useAuth();

  const clientId = impersonateClientId || profile?.id;
  const clientName = impersonateClientName || profile?.company_name || profile?.full_name || "";

  // Projeto aberto fica lembrado por cliente: sair e voltar reabre o mesmo
  // projeto (docs/design/SISTEMA.md, "Estado que não se perde"). Trocar de
  // cliente troca a chave, então o projeto de um nunca abre no outro.
  const [projetoAberto, setProjetoAberto] = useEstadoDaTela<string>(`inicio:projeto:${clientId || ""}`, "");
  // Mesmas chaves de consulta do painel: vem do cache, sem ir ao banco de novo.
  const { loadingProjects, data } = useClientDashboardData(clientId || "");
  const selectedProject = projetoAberto ? (data.projects || []).find((p: any) => p.id === projetoAberto) || null : null;

  // Projeto guardado que não existe mais (apagado, de outro cliente): volta ao painel.
  useEffect(() => {
    if (projetoAberto && !loadingProjects && data.projects && !selectedProject) setProjetoAberto("");
  }, [projetoAberto, loadingProjects, data.projects, selectedProject, setProjetoAberto]);

  if (projetoAberto && loadingProjects) {
    return <Carregando forma="aba" rotulo="Carregando o projeto" />;
  }

  if (selectedProject) {
    return <ProjectView project={selectedProject} onBack={() => setProjetoAberto("")} />;
  }

  return (
    <ClientJourneyDashboard
      clientId={clientId!}
      clientName={clientName}
      onSelectProject={(project: any) => setProjetoAberto(project?.id || "")}
      isImpersonation={!!impersonateClientId}
    />
  );
}
