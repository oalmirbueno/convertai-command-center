import { useState } from "react";
import { useClients } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserPlus, Link2 } from "lucide-react";
import CreateClientModal from "@/components/admin/CreateClientModal";
import EditClientDrawer from "@/components/admin/EditClientDrawer";
import BriefingLinkModal from "@/components/admin/BriefingLinkModal";

const STATUS_TABS = [
  { value: "active", label: "Ativos" },
  { value: "onboarding", label: "Em Andamento" },
  { value: "inactive", label: "Inativos" },
];

const statusDot: Record<string, string> = {
  active: "bg-success pulse-dot",
  onboarding: "bg-warning pulse-dot",
  inactive: "bg-muted-foreground",
};

const statusLabel: Record<string, string> = {
  active: "Ativo",
  onboarding: "Em Andamento",
  inactive: "Inativo",
};

export default function Clients() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const { data: clients, isLoading } = useClients();
  const [createOpen, setCreateOpen] = useState(false);
  const [editClient, setEditClient] = useState<any>(null);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [tab, setTab] = useState("active");

  const filtered = (clients || []).filter((c: any) => {
    const status = c.plan_status || "active";
    return status === tab;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="heading-page">Clientes</p>
        {isAdmin && (
          <div className="flex gap-2 flex-wrap">
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

      {/* Status Tabs */}
      <div className="flex gap-1 bg-secondary/50 border border-border rounded-lg p-1 w-fit">
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

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          Nenhum cliente {statusLabel[tab]?.toLowerCase()} encontrado.
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
                <p className="text-sm font-medium text-foreground">{c.company_name || c.full_name}</p>
                <p className="text-[11px] text-muted-foreground">{c.email}</p>
              </div>
              {(c as any).plan_name && isAdmin && (
                <span className="hidden sm:inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary border border-primary/20">
                  {(c as any).plan_name}
                </span>
              )}
              <div className="text-right hidden md:block">
                <p className="text-xs font-mono text-foreground">{c.projectCount}</p>
                <p className="text-[10px] text-muted-foreground">projetos</p>
              </div>
              <div className={`w-2 h-2 rounded-full shrink-0 ${statusDot[c.plan_status || "active"] || "bg-muted-foreground"}`} />
            </div>
          ))}
        </div>
      )}

      {isAdmin && <CreateClientModal open={createOpen} onClose={() => setCreateOpen(false)} />}
      <EditClientDrawer open={!!editClient} onClose={() => setEditClient(null)} client={editClient} />
      {isAdmin && <BriefingLinkModal open={briefingOpen} onClose={() => setBriefingOpen(false)} />}
    </div>
  );
}
