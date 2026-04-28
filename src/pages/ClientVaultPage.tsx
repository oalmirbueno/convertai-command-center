import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import ClientVault from "@/components/vault/ClientVault";
import { KeyRound, Link2, Server, Search, Users, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";

interface ClientOption {
  id: string;
  full_name: string;
  company_name: string | null;
  avatar_url: string | null;
}

export default function ClientVaultPage() {
  const { profile, user } = useAuth();
  const { impersonatedId } = useImpersonation();
  const role = profile?.role || "client";
  const isAdminOrTeam = role === "admin" || ["design", "traffic", "manager"].includes(role);
  // Hub mode = admin/team browsing all clients (only when NOT impersonating)
  const isHubMode = isAdminOrTeam && !impersonatedId;

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Load all clients (hub mode only)
  const { data: clients } = useQuery({
    queryKey: ["vault-clients-list"],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "client");
      const ids = (roles || []).map((r: any) => r.user_id);
      if (ids.length === 0) return [];
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, company_name, avatar_url")
        .in("id", ids)
        .order("full_name", { ascending: true });
      return (data || []) as ClientOption[];
    },
    enabled: isHubMode,
  });

  // Effective client id being viewed
  const effectiveClientId = isHubMode
    ? (selectedClientId || clients?.[0]?.id || null)
    : (impersonatedId || user?.id || null);

  // Counts per category for the selected client
  const { data: counts } = useQuery({
    queryKey: ["vault-counts", effectiveClientId],
    queryFn: async () => {
      if (!effectiveClientId) return { password: 0, link: 0, system: 0, total: 0 };
      const { data } = await supabase
        .from("client_vault")
        .select("category")
        .eq("client_id", effectiveClientId);
      const list = (data || []) as { category: string }[];
      return {
        password: list.filter((i) => i.category === "password").length,
        link: list.filter((i) => i.category === "link").length,
        system: list.filter((i) => i.category === "system").length,
        total: list.length,
      };
    },
    enabled: !!effectiveClientId,
  });

  const filteredClients = useMemo(() => {
    if (!clients) return [];
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.full_name?.toLowerCase().includes(q) ||
        c.company_name?.toLowerCase().includes(q)
    );
  }, [clients, search]);

  const selectedClient = clients?.find((c) => c.id === effectiveClientId);

  if (!effectiveClientId && !isAdminOrTeam) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
            <KeyRound className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">
              Cofre de Acessos
            </h1>
            <p className="text-[13px] text-muted-foreground mt-1 max-w-xl">
              Centralize senhas, links úteis e sistemas em um único lugar — protegido,
              organizado e acessível em segundos.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-secondary/50 border border-border px-3 py-2 rounded-xl">
          <ShieldCheck className="w-3.5 h-3.5 text-primary" />
          Senhas mascaradas por padrão
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Total" value={counts?.total ?? 0} icon={KeyRound} accent="text-foreground" />
        <MetricCard label="Senhas" value={counts?.password ?? 0} icon={KeyRound} accent="text-primary" />
        <MetricCard label="Links Úteis" value={counts?.link ?? 0} icon={Link2} accent="text-sky-400" />
        <MetricCard label="Sistemas" value={counts?.system ?? 0} icon={Server} accent="text-amber-400" />
      </div>

      <div className={isHubMode ? "grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5" : ""}>
        {/* Client selector — hub mode only (admin/team not impersonating) */}
        {isHubMode && (
          <aside className="space-y-3">
            <div className="bg-card border border-border rounded-2xl p-3">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-3.5 h-3.5 text-muted-foreground" />
                <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                  Clientes ({clients?.length || 0})
                </h2>
              </div>

              <div className="relative mb-2">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar cliente..."
                  className="w-full bg-secondary border border-border rounded-lg pl-8 pr-3 py-2 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50"
                />
              </div>

              <div className="max-h-[480px] overflow-y-auto -mx-1 px-1 space-y-1">
                {filteredClients.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground text-center py-6">
                    Nenhum cliente encontrado
                  </p>
                ) : (
                  filteredClients.map((c) => {
                    const active = c.id === effectiveClientId;
                    const initials = (c.full_name || "?")
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase();
                    return (
                      <button
                        key={c.id}
                        onClick={() => setSelectedClientId(c.id)}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors cursor-pointer border ${
                          active
                            ? "bg-primary/10 border-primary/40 text-foreground"
                            : "bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                        }`}
                      >
                        <div className="w-7 h-7 rounded-lg bg-secondary border border-border flex items-center justify-center overflow-hidden shrink-0">
                          {c.avatar_url ? (
                            <img src={c.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-[10px] font-semibold text-primary">{initials}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium truncate">{c.full_name}</p>
                          {c.company_name && (
                            <p className="text-[10px] opacity-70 truncate">{c.company_name}</p>
                          )}
                        </div>
                        {active && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </aside>
        )}

        {/* Vault content */}
        <div>
          {isAdminOrTeam && selectedClient && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-secondary/40 border border-border flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
                <KeyRound className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Cofre de
                </p>
                <p className="text-[14px] font-medium text-foreground truncate">
                  {selectedClient.full_name}
                  {selectedClient.company_name && (
                    <span className="text-muted-foreground"> · {selectedClient.company_name}</span>
                  )}
                </p>
              </div>
            </div>
          )}

          {effectiveClientId ? (
            <ClientVault clientId={effectiveClientId} canManage={isAdminOrTeam} />
          ) : (
            <div className="text-center py-16 bg-card border border-border rounded-2xl">
              <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
              <p className="text-[13px] text-muted-foreground">
                Selecione um cliente ao lado para visualizar o cofre.
              </p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: any;
  accent: string;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          {label}
        </span>
        <Icon className={`w-3.5 h-3.5 ${accent}`} />
      </div>
      <p className={`text-2xl font-mono font-semibold ${accent}`}>{value}</p>
    </div>
  );
}
