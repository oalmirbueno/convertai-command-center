import { useAuth } from "@/contexts/AuthContext";
import { projects, updates, updateDotColors, typeColors } from "@/data/mockData";
import { Badge } from "@/components/ui/badge";
import { FolderOpen, Clock as ClockIcon, CheckCircle, Clock, ChevronRight } from "lucide-react";

const sparkData = [[2,3,2,4,3,5,4], [1,1,2,1,1,1,1], [4,5,6,5,7,5,5]];

const MiniSparkline = ({ data, color }: { data: number[]; color: string }) => {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const h = 20;
  const w = 60;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(" ");
  return (
    <svg width={w} height={h} className="mt-1 opacity-40">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" className={color} />
    </svg>
  );
};

export default function ClientDashboard() {
  const { user } = useAuth();
  const clientProjects = projects.filter((p) => p.client === "Acerbi Associação");

  const statsData = [
    { label: "Projetos Ativos", value: "2", icon: FolderOpen, color: "text-primary" },
    { label: "Aguardando Aprovação", value: "1", icon: ClockIcon, color: "text-warning" },
    { label: "Concluídas", value: "5", icon: CheckCircle, color: "text-cyan" },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="heading-mc text-foreground">
          Olá, <span className="text-gradient">{user?.company || user?.name}</span> 👋
        </h1>
        <p className="text-[13px] text-muted-foreground opacity-40 mt-1">Acompanhe o andamento dos seus projetos.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-5 stagger-children">
        {statsData.map((s, i) => (
          <div key={s.label} className="glass-card rounded-2xl p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-mono font-light text-[32px] leading-none text-foreground">{s.value}</p>
                <p className="label-mc mt-2">{s.label}</p>
                <MiniSparkline data={sparkData[i]} color={s.color} />
              </div>
              <s.icon className={`w-5 h-5 ${s.color} opacity-50`} />
            </div>
          </div>
        ))}
      </div>

      {/* Projects */}
      <div>
        <h2 className="label-mc mb-4">Meus Projetos</h2>
        <div className="space-y-2 stagger-children">
          {clientProjects.map((p) => (
            <div key={p.id} className="glass-card rounded-xl px-5 py-4 cursor-pointer transition-all group">
              <div className="flex items-center gap-4">
                <div className="w-2 h-2 rounded-full bg-cyan pulse-dot shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{p.name}</span>
                    <Badge className={`${typeColors[p.type]} border-0 text-[10px] rounded-full px-2`}>{p.type}</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{p.description}</p>
                </div>
                <div className="w-24 hidden md:block">
                  <div className="h-1 rounded-full bg-border overflow-hidden">
                    <div className="h-full rounded-full shimmer-bar" style={{ width: `${p.progress}%` }} />
                  </div>
                  <p className="text-[10px] font-mono text-muted-foreground mt-1 text-right">{p.progress}%</p>
                </div>
                <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {p.deadline}
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Updates */}
      <div>
        <h2 className="label-mc mb-4">Atualizações Recentes</h2>
        <div className="space-y-4">
          {updates.map((u) => (
            <div key={u.id} className="flex items-start gap-3">
              <div className={`w-1.5 h-1.5 rounded-full mt-2 ${updateDotColors[u.type]}`} />
              <div>
                <p className="text-[13px] text-foreground">{u.message}</p>
                <p className="text-[11px] text-muted-foreground opacity-50">{u.time}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
