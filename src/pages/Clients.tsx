import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useClients } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserPlus, Link2, CalendarClock, AlertTriangle, Eye } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import CreateClientModal from "@/components/admin/CreateClientModal";
import EditClientDrawer from "@/components/admin/EditClientDrawer";
import BriefingLinkModal from "@/components/admin/BriefingLinkModal";

function getRenewalStatus(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const renewal = new Date(dateStr + "T00:00:00");
  const diffMs = renewal.getTime() - today.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { level: "expired", label: `Vencido há ${Math.abs(diffDays)} dia(s)`, color: "text-destructive", bg: "bg-destructive/10 border-destructive/30", icon: true };
  if (diffDays <= 7) return { level: "urgent", label: `Vence em ${diffDays} dia(s)`, color: "text-warning", bg: "bg-warning/10 border-warning/30", icon: true };
  if (diffDays <= 15) return { level: "soon", label: `Vence em ${diffDays} dias`, color: "text-muted-foreground", bg: "", icon: false };
  return { level: "ok", label: "", color: "text-muted-foreground", bg: "", icon: false };
}

const STATUS_TABS = [
  { value: "active", label: "Ativos" },
  { value: "onboarding", label: "Em Andamento" },
  { value: "standby", label: "Standby" },
  { value: "inactive", label: "Inativos" },
];

const statusDot: Record<string, string> = {
  active: "bg-success pulse-dot",
  onboarding: "bg-warning pulse-dot",
  standby: "bg-accent",
  inactive: "bg-muted-foreground",
};

const statusLabel: Record<string, string> = {
  active: "Ativo",
  onboarding: "Em Andamento",
  standby: "Standby",
  inactive: "Inativo",
};

const TYPE_TABS = [
  { value: "all", label: "Todos" },
  { value: "recurring", label: "Recorrentes" },
  { value: "one_off", label: "Avulsos" },
  { value: "hybrid", label: "Híbridos" },
];

const typeBadge: Record<string, { label: string; cls: string }> = {
  recurring: { label: "Recorrente", cls: "bg-primary/10 text-primary border-primary/30" },
  one_off: { label: "Avulso", cls: "bg-warning/10 text-warning border-warning/30" },
  hybrid: { label: "Híbrido", cls: "bg-accent/10 text-accent-foreground border-accent/30" },
};

export default function Clients() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.role === "admin";
  const { data: clients, isLoading } = useClients();
  const [createOpen, setCreateOpen] = useState(false);
  const [editClient, setEditClient] = useState<any>(null);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [tab, setTab] = useState("active");
  const [typeFilter, setTypeFilter] = useState("all");

  const filtered = (clients || []).filter((c: any) => {
    const status = c.plan_status || "active";
    if (status !== tab) return false;
    if (typeFilter !== "all" && (c.client_type || "recurring") !== typeFilter) return false;
    return true;
  });

  return (
    <div className="-mx-4 flex h-[calc(100dvh-140px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col animate-fade-in md:mx-0 md:block md:h-auto md:space-y-6">
      <div className="shrink-0 border-b border-border/60 bg-background/95 px-4 pb-3 backdrop-blur-sm md:border-b-0 md:bg-transparent md:px-0 md:pb-0 md:backdrop-blur-none">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="heading-page">Clientes</p>
        {isAdmin && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => navigate("/ver-como-cliente")}
              className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full text-[12px] sm:text-[13px] text-muted-foreground border border-border hover:border-muted-foreground/50 hover:text-foreground transition-colors cursor-pointer bg-transparent">
              <Eye className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Ver como</span> Cliente
            </button>
            <button onClick={() => setBriefingOpen(true)}
              data-tour="clients-briefing-btn"
              className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full text-[12px] sm:text-[13px] text-muted-foreground border border-border hover:border-muted-foreground/50 hover:text-foreground transition-colors cursor-pointer bg-transparent">
              <Link2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Link</span> Briefing
            </button>
            <button
              onClick={() => setCreateOpen(true)}
              data-tour="clients-create-btn"
              className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full text-[12px] sm:text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Novo</span> Cliente
            </button>
          </div>
        )}
      </div>

      {/* Status + Type Filters */}
      <div className="mt-3 flex flex-nowrap items-center gap-2 overflow-x-auto scrollbar-hidden pb-1 md:flex-wrap md:overflow-visible md:pb-0">
        <div className="flex shrink-0 gap-1 bg-secondary/50 border border-border rounded-lg p-1 w-fit">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`px-3 py-1.5 rounded-md text-[13px] transition-colors cursor-pointer border-none ${
                tab === t.value
                  ? "bg-background text-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground bg-transparent"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex shrink-0 gap-1 bg-secondary/50 border border-border rounded-lg p-1 w-fit">
          {TYPE_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTypeFilter(t.value)}
              className={`px-3 py-1.5 rounded-md text-[12px] transition-colors cursor-pointer border-none ${
                typeFilter === t.value
                  ? "bg-background text-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground bg-transparent"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-4 md:overflow-visible md:px-0 md:pt-0 md:pb-0">
      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          Nenhum cliente encontrado com os filtros aplicados.
        </div>
      ) : (
        <div className="space-y-1 stagger-children">
          {filtered.map((c: any) => (
            <div
              key={c.id}
              onClick={() => setEditClient(c)}
              className="bg-card border border-border rounded-xl px-5 py-4 flex items-center gap-4 hover:border-muted-foreground/30 transition-colors cursor-pointer"
            >
              <Avatar className="w-10 h-10 shrink-0">
                {c.avatar_url && <AvatarImage src={c.avatar_url} alt={c.full_name} />}
                <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
                  {c.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-foreground truncate">{c.company_name || c.full_name}</p>
                  {(() => {
                    const t = typeBadge[(c as any).client_type || "recurring"];
                    return t ? (
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-semibold uppercase tracking-wider border ${t.cls}`}>
                        {t.label}
                      </span>
                    ) : null;
                  })()}
                  {(c as any).brand && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-semibold uppercase tracking-wider bg-foreground/5 text-muted-foreground border border-border">
                      {(c as any).brand === "aceleriq" ? "AcelerIQ" : "SiteBolt"}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">{c.email}</p>
              </div>
              {isAdmin && ((c as any).plan_name || (c as any).plan_value) && (
                <span className="hidden sm:inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary border border-primary/20">
                  {(c as any).plan_name || ""}{(c as any).plan_value ? ` • R$ ${Number((c as any).plan_value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : ""}
                </span>
              )}
              {(c as any).plan_renewal_date && (() => {
                const status = getRenewalStatus((c as any).plan_renewal_date);
                const isAlert = status?.level === "expired" || status?.level === "urgent";
                return (
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className={`text-right hidden md:flex items-center gap-1.5 px-2 py-1 rounded-lg border border-transparent ${isAlert ? status.bg : ""} ${status?.color || "text-muted-foreground"}`}>
                          {status?.icon ? (
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          ) : (
                            <CalendarClock className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <div>
                            <p className={`text-xs font-mono ${isAlert ? status.color : "text-foreground"}`}>
                              {new Date((c as any).plan_renewal_date).toLocaleDateString("pt-BR")}
                            </p>
                            <p className="text-[10px]">vencimento</p>
                          </div>
                        </div>
                      </TooltipTrigger>
                      {status?.label && (
                        <TooltipContent side="top">
                          <p className="text-xs">{status.label}</p>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                );
              })()}
              <div className="text-right hidden md:block">
                <p className="text-xs font-mono text-foreground">{c.projectCount}</p>
                <p className="text-[10px] text-muted-foreground">projetos</p>
              </div>
              <div className={`w-2 h-2 rounded-full shrink-0 ${statusDot[c.plan_status || "active"] || "bg-muted-foreground"}`} />
            </div>
          ))}
        </div>
      )}
      </div>

      {isAdmin && <CreateClientModal open={createOpen} onClose={() => setCreateOpen(false)} />}
      <EditClientDrawer open={!!editClient} onClose={() => setEditClient(null)} client={editClient} />
      {isAdmin && <BriefingLinkModal open={briefingOpen} onClose={() => setBriefingOpen(false)} />}
    </div>
  );
}
