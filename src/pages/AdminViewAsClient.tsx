import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useClients } from "@/hooks/useSupabaseData";
import ClientDashboard from "@/pages/ClientDashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Eye, ChevronDown } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export default function AdminViewAsClient() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const clientId = searchParams.get("client");
  const projectId = searchParams.get("project"); // legacy support
  const { data: clients, isLoading: loadingClients } = useClients();
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Legacy: if only project param, resolve client from project
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
      // No client selected - show selector
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
    setSearchParams({ client: c.id });
    setSelectorOpen(false);
    setLoading(false);
  };

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
            Selecione um cliente para visualizar o painel exatamente como ele vê.
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

  return (
    <div className="space-y-4">
      {/* Admin bar */}
      <div className="bg-info/10 border border-info/20 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/clientes")}
            className="flex items-center gap-1.5 text-xs text-info hover:text-info/80 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Voltar
          </button>
          <div className="w-px h-4 bg-info/20" />
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-info" />
            <span className="text-xs text-info font-medium">
              Visualizando como: {selectedClient?.company_name || selectedClient?.full_name}
            </span>
          </div>
        </div>

        {/* Client switcher */}
        <div className="relative">
          <button
            onClick={() => setSelectorOpen(!selectorOpen)}
            className="flex items-center gap-1.5 text-xs text-info/70 hover:text-info transition-colors bg-transparent border border-info/20 rounded-lg px-3 py-1.5"
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
                  className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] transition-colors bg-transparent ${
                    c.id === clientId ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  }`}
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

      {/* Client dashboard */}
      <ClientDashboard
        impersonateClientId={selectedClient?.id}
        impersonateClientName={selectedClient?.company_name || selectedClient?.full_name}
      />
    </div>
  );
}
