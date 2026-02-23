import { useClients } from "@/hooks/useSupabaseData";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { UserPlus, Link2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export default function Clients() {
  const { data: clients, isLoading } = useClients();

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <p className="heading-page">Clientes</p>
        <div className="flex gap-2">
          <button className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] text-muted-foreground border border-border hover:border-muted-foreground/50 hover:text-foreground transition-colors cursor-pointer bg-transparent">
            <Link2 className="w-3.5 h-3.5" />
            Link Briefing
          </button>
          <button className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer">
            <UserPlus className="w-3.5 h-3.5" />
            Novo Cliente
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Carregando...</div>
      ) : (clients || []).length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Nenhum cliente encontrado. Use a página Seed para popular dados demo.</div>
      ) : (
        <div className="space-y-1 stagger-children">
          {(clients || []).map((c: any) => (
            <div
              key={c.id}
              className="bg-card border border-border rounded-xl px-5 py-4 flex items-center gap-4 hover:border-muted-foreground/30 transition-colors cursor-pointer"
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
              <div className="text-right hidden md:block">
                <p className="text-xs font-mono text-foreground">{c.projectCount}</p>
                <p className="text-[10px] text-muted-foreground">projetos</p>
              </div>
              <div className={`w-2 h-2 rounded-full shrink-0 ${c.plan_status === "active" ? "bg-success pulse-dot" : "bg-muted-foreground"}`} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
