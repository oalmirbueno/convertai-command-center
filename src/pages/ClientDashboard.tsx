import { useAuth } from "@/contexts/AuthContext";
import { projects, updates, updateDotColors } from "@/data/mockData";
import { FolderOpen, Clock as ClockIcon, CheckCircle, Clock, ChevronRight } from "lucide-react";

export default function ClientDashboard() {
  const { user } = useAuth();
  const clientProjects = projects.filter((p) => p.client === "Acerbi Associação");

  const statsData = [
    { label: "Projetos Ativos", value: "2", color: "bg-primary" },
    { label: "Aguardando Aprovação", value: "1", color: "bg-warning" },
    { label: "Concluídas", value: "5", color: "bg-info" },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          Olá, {user?.company || user?.name} 👋
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Acompanhe o andamento dos seus projetos.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 stagger-children">
        {statsData.map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-5 hover:border-muted-foreground/30 transition-colors">
            <p className="label-sm">{s.label}</p>
            <p className="font-mono font-light text-[28px] leading-none text-foreground mt-2">{s.value}</p>
            <div className={`h-0.5 w-8 ${s.color} rounded-full mt-3 opacity-60`} />
          </div>
        ))}
      </div>

      {/* Projects */}
      <div>
        <p className="label-sm mb-4">Meus Projetos</p>
        <div className="space-y-0.5 stagger-children">
          {clientProjects.map((p) => (
            <div key={p.id} className="bg-card border border-border rounded-xl px-5 py-4 cursor-pointer hover:border-muted-foreground/30 transition-colors group">
              <div className="flex items-center gap-4">
                <div className="w-2 h-2 rounded-full bg-info pulse-dot shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{p.name}</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">{p.type}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{p.description}</p>
                </div>
                <div className="w-24 hidden md:block">
                  <div className="h-[3px] rounded-full bg-secondary overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${p.progress}%` }} />
                  </div>
                  <p className="text-xs font-mono text-muted-foreground mt-1 text-right">{p.progress}%</p>
                </div>
                <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {p.deadline}
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Updates */}
      <div className="bg-card border border-border rounded-xl p-5">
        <p className="label-sm mb-4">Atualizações Recentes</p>
        <div className="space-y-0">
          {updates.map((u, i) => (
            <div key={u.id}>
              {i > 0 && <div className="border-t border-border" />}
              <div className="flex items-start gap-3 py-3">
                <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${updateDotColors[u.type]}`} />
                <div>
                  <p className="text-[13px] text-foreground">{u.message}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{u.time}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
