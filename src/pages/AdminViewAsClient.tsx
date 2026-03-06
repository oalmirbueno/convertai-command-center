import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useClients } from "@/hooks/useSupabaseData";
import { ImpersonationProvider } from "@/contexts/ImpersonationContext";
import ClientDashboard from "@/pages/ClientDashboard";
import ClientApprovals from "@/pages/ClientApprovals";
import ClientDocuments from "@/pages/ClientDocuments";
import ClientReports from "@/pages/ClientReports";
import ClientFinanceiro from "@/pages/ClientFinanceiro";
import ClientRequests from "@/pages/ClientRequests";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Eye, ChevronDown, LayoutDashboard, CheckSquare,
  FileText, BarChart3, DollarSign, ShoppingBag,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { UserProfile } from "@/contexts/AuthContext";

const clientTabs = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "aprovacoes", label: "Aprovações", icon: CheckSquare },
  { id: "documentos", label: "Documentos", icon: FileText },
  { id: "relatorios", label: "Relatórios", icon: BarChart3 },
  { id: "pedidos", label: "Pedidos", icon: ShoppingBag },
  { id: "financeiro", label: "Financeiro", icon: DollarSign },
];

export default function AdminViewAsClient() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const clientId = searchParams.get("client");
  const projectId = searchParams.get("project");
  const tabParam = searchParams.get("tab") || "dashboard";
  const { data: clients, isLoading: loadingClients } = useClients();
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(tabParam);

  useEffect(() => {
    if (projectId && !clientId) {
      (async () => {
        const { data } = await supabase
          .from("projects")
          .select("client_id")
          .eq("id", projectId)
          .maybeSingle();
        if (data?.client_id) {
          setSearchParams({ client: data.client_id });
        } else {
          navigate("/clientes");
        }
      })();
      return;
    }

    if (!clientId && !projectId) {
      setLoading(false);
      return;
    }

    if (clientId) {
      (async () => {
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", clientId)
          .maybeSingle();
        if (!data) {
          navigate("/clientes");
          return;
        }
        setSelectedClient(data);
        setLoading(false);
      })();
    }
  }, [clientId, projectId]);

  const selectClient = (c: any) => {
    setSelectedClient(c);
    setSearchParams({ client: c.id, tab: activeTab });
    setSelectorOpen(false);
    setLoading(false);
  };

  const switchTab = (tabId: string) => {
    setActiveTab(tabId);
    if (clientId) {
      setSearchParams({ client: clientId, tab: tabId });
    }
  };

  // Build impersonated profile for context
  const impersonatedProfile: UserProfile | null = selectedClient
    ? {
        id: selectedClient.id,
        full_name: selectedClient.full_name,
        email: selectedClient.email,
        company_name: selectedClient.company_name,
        avatar_url: selectedClient.avatar_url,
        plan_renewal_date: selectedClient.plan_renewal_date,
        plan_status: selectedClient.plan_status,
        services_config: selectedClient.services_config,
        onboarding_done: selectedClient.onboarding_done,
        role: "client" as const,
      }
    : null;

  // No client selected - show client picker
  if (!clientId && !projectId && !loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <button
          onClick={() => navigate("/clientes")}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Voltar
        </button>

        <div className="text-center py-8">
          <Eye className="w-10 h-10 text-primary mx-auto mb-4 opacity-50" />
          <h1 className="text-xl font-semibold text-foreground mb-2">Ver como Cliente</h1>
          <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto">
            Selecione um cliente para navegar pelo painel completo como se fosse ele.
          </p>
        </div>

        {loadingClients ? (
          <div className="space-y-2 max-w-lg mx-auto">
            {[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          </div>
        ) : (
          <div className="space-y-2 max-w-lg mx-auto">
            {(clients || []).filter((c: any) => c.plan_status === "active").map((c: any) => (
              <div
                key={c.id}
                onClick={() => selectClient(c)}
                className="bg-card border border-border rounded-xl px-5 py-4 flex items-center gap-4 hover:border-primary/30 transition-colors cursor-pointer"
              >
                <Avatar className="w-10 h-10 shrink-0">
                  <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
                    {c.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{c.company_name || c.full_name}</p>
                  <p className="text-[11px] text-muted-foreground">{c.email}</p>
                </div>
                <Eye className="w-4 h-4 text-muted-foreground" />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case "aprovacoes":
        return <ClientApprovals />;
      case "documentos":
        return <ClientDocuments />;
      case "relatorios":
        return <ClientReports />;
      case "pedidos":
        return <ClientRequests />;
      case "financeiro":
        return <ClientFinanceiro />;
      default:
        return (
          <ClientDashboard
            impersonateClientId={selectedClient?.id}
            impersonateClientName={selectedClient?.company_name || selectedClient?.full_name}
          />
        );
    }
  };

  return (
    <ImpersonationProvider profile={impersonatedProfile} clientId={selectedClient?.id}>
      <div className="space-y-0">
        {/* Admin impersonation bar */}
        <div className="bg-sky-500/[0.06] border border-sky-500/15 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/clientes")}
              className="flex items-center gap-1.5 text-xs text-sky-500 hover:text-sky-400 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Voltar
            </button>
            <div className="w-px h-4 bg-sky-500/20" />
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-sky-500" />
              <span className="text-xs text-sky-500 font-medium">
                Visualizando como: {selectedClient?.company_name || selectedClient?.full_name}
              </span>
            </div>
          </div>

          {/* Client switcher */}
          <div className="relative">
            <button
              onClick={() => setSelectorOpen(!selectorOpen)}
              className="flex items-center gap-1.5 text-xs text-sky-500/70 hover:text-sky-500 transition-colors bg-transparent border border-sky-500/20 rounded-lg px-3 py-1.5"
            >
              Trocar cliente
              <ChevronDown className="w-3 h-3" />
            </button>
            {selectorOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-popover border border-border rounded-xl shadow-lg p-2 z-50 max-h-64 overflow-y-auto animate-fade-in">
                {(clients || []).filter((c: any) => c.plan_status === "active").map((c: any) => (
                  <button
                    key={c.id}
                    onClick={() => selectClient(c)}
                    className={cn(
                      "w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] transition-colors bg-transparent",
                      c.id === clientId ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                    )}
                  >
                    <Avatar className="w-6 h-6 shrink-0">
                      <AvatarFallback className="bg-primary/15 text-primary text-[9px] font-semibold">
                        {c.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    {c.company_name || c.full_name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Client navigation tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 mb-6 border-b border-border scrollbar-hide">
          {clientTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium whitespace-nowrap transition-all relative rounded-t-lg",
                activeTab === tab.id
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground/80"
              )}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-primary" />
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="animate-fade-in">
          {renderTabContent()}
        </div>
      </div>
    </ImpersonationProvider>
  );
}
