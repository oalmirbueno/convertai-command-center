import { clients } from "@/data/mockData";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { UserPlus, Link2 } from "lucide-react";

const serviceColors: Record<string, string> = {
  "Social Media": "bg-info",
  "Automação": "bg-success",
  "Site": "bg-primary",
  "Evento": "bg-warning",
};

export default function Clients() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="heading-mc text-foreground">Clientes</h1>
          <p className="text-[13px] text-muted-foreground opacity-40 mt-1">Gerencie sua base de clientes.</p>
        </div>
        <div className="flex gap-2">
          <button className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium text-muted-foreground border border-border/50 hover:border-primary/30 hover:text-foreground transition-all cursor-pointer bg-transparent">
            <Link2 className="w-3.5 h-3.5" />
            Link Briefing
          </button>
          <button className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all cursor-pointer">
            <UserPlus className="w-3.5 h-3.5" />
            Novo Cliente
          </button>
        </div>
      </div>

      {/* Client cards — horizontal list */}
      <div className="space-y-2 stagger-children">
        {clients.map((c) => (
          <div
            key={c.id}
            className="glass-card rounded-xl px-5 py-4 flex items-center gap-4 hover:translate-x-1 transition-all cursor-pointer"
          >
            {/* Avatar with gradient border */}
            <div className="p-[2px] rounded-full bg-gradient-to-br from-primary to-accent shrink-0">
              <Avatar className="w-11 h-11 border-2 border-background">
                <AvatarFallback className="bg-card text-foreground text-sm font-semibold">
                  {c.avatar}
                </AvatarFallback>
              </Avatar>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{c.name}</p>
              <p className="text-[11px] text-muted-foreground">{c.email}</p>
            </div>

            {/* Service dots */}
            <div className="hidden sm:flex items-center gap-1.5">
              {c.services.map((s) => (
                <div
                  key={s}
                  className={`w-2.5 h-2.5 rounded-full ${serviceColors[s] || "bg-muted-foreground"}`}
                  title={s}
                />
              ))}
            </div>

            {/* Projects count */}
            <div className="text-right hidden md:block">
              <p className="text-xs font-mono text-foreground">{c.projects}</p>
              <p className="text-[10px] text-muted-foreground">projetos</p>
            </div>

            {/* Status */}
            <div className={`w-2 h-2 rounded-full shrink-0 ${c.status === "ativo" ? "bg-cyan pulse-dot" : "bg-muted-foreground"}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
