import { useState } from "react";
import { projects, updates, typeColors } from "@/data/mockData";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateDotColors } from "@/data/mockData";
import {
  FolderOpen, Users, ListTodo, Eye, Plus, UserPlus, Sparkles, Upload,
  Clock, AlertTriangle, ChevronRight
} from "lucide-react";

const stats = [
  { label: "Projetos Ativos", value: "4", icon: FolderOpen, color: "text-primary", glowColor: "hover:shadow-[0_0_20px_hsl(249_76%_64%/0.15)]" },
  { label: "Clientes", value: "2", icon: Users, color: "text-cyan", glowColor: "hover:shadow-[0_0_20px_hsl(195_100%_50%/0.15)]" },
  { label: "Tarefas Pendentes", value: "6", icon: ListTodo, color: "text-warning", glowColor: "hover:shadow-[0_0_20px_hsl(38_92%_55%/0.15)]" },
  { label: "Em Revisão", value: "2", icon: Eye, color: "text-accent", glowColor: "hover:shadow-[0_0_20px_hsl(195_100%_50%/0.15)]" },
];

// Fake sparkline data
const sparklines = [[3,5,4,7,6,8,7], [1,2,1,2,2,2,2], [8,7,6,7,5,6,6], [1,2,3,2,3,2,2]];

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

const quickActions = [
  { label: "Novo Projeto", icon: Plus },
  { label: "Novo Cliente", icon: UserPlus },
  { label: "Gerar Plano IA", icon: Sparkles },
  { label: "Upload", icon: Upload },
];

const urgentTasks = [
  { title: "Briefing evento cooperativo", project: "Evento Cresol", deadline: "20 Fev", priority: "alta" },
  { title: "Aprovação posts semana 8", project: "Social Media Acerbi", deadline: "22 Fev", priority: "alta" },
  { title: "Layout convite digital", project: "Evento Cresol", deadline: "22 Fev", priority: "média" },
];

const statusColors: Record<string, string> = {
  "Em andamento": "text-cyan",
  "Em revisão": "text-warning",
  "Backlog": "text-muted-foreground",
};

export default function AdminDashboard() {
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Page title */}
      <div>
        <h1 className="heading-mc text-foreground">Dashboard</h1>
        <p className="text-[13px] text-muted-foreground opacity-40 mt-1">Visão geral dos seus projetos e equipe.</p>
      </div>

      {/* Stats — transparent cards with border + sparkline */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 stagger-children">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className={`glass-card rounded-2xl p-5 transition-all ${s.glowColor}`}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="font-mono font-light text-[32px] leading-none text-foreground">{s.value}</p>
                <p className="label-mc mt-2">{s.label}</p>
                <MiniSparkline data={sparklines[i]} color={s.color} />
              </div>
              <s.icon className={`w-5 h-5 ${s.color} opacity-50`} />
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        {quickActions.map((a) => (
          <button
            key={a.label}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium text-muted-foreground border border-border/50 hover:border-primary/30 hover:text-foreground transition-all cursor-pointer bg-transparent"
          >
            <a.icon className="w-3.5 h-3.5" />
            {a.label}
          </button>
        ))}
      </div>

      {/* Projects — expandable rows */}
      <div>
        <h2 className="label-mc mb-4">Projetos Ativos</h2>
        <div className="space-y-1 stagger-children">
          {projects.map((p) => {
            const isHovered = hoveredProject === p.id;
            return (
              <div
                key={p.id}
                className="glass-card rounded-xl px-5 py-4 cursor-pointer transition-all"
                onMouseEnter={() => setHoveredProject(p.id)}
                onMouseLeave={() => setHoveredProject(null)}
              >
                <div className="flex items-center gap-4">
                  {/* Status dot */}
                  <div className={`w-2 h-2 rounded-full shrink-0 ${statusColors[p.status] === "text-cyan" ? "bg-cyan pulse-dot" : statusColors[p.status] === "text-warning" ? "bg-warning" : "bg-muted-foreground"}`} />

                  {/* Name + type */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{p.name}</span>
                      <Badge className={`${typeColors[p.type]} border-0 text-[10px] rounded-full px-2`}>
                        {p.type}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{p.client}</p>
                  </div>

                  {/* Progress bar */}
                  <div className="w-32 hidden md:block">
                    <div className="h-1 rounded-full bg-border overflow-hidden">
                      <div
                        className="h-full rounded-full shimmer-bar transition-all"
                        style={{ width: `${p.progress}%` }}
                      />
                    </div>
                    <p className="text-[10px] font-mono text-muted-foreground mt-1 text-right">{p.progress}%</p>
                  </div>

                  {/* Deadline */}
                  <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    {p.deadline}
                  </div>

                  <ChevronRight className={`w-4 h-4 text-muted-foreground transition-all ${isHovered ? "translate-x-0.5 text-primary" : ""}`} />
                </div>

                {/* Expanded info */}
                {isHovered && (
                  <div className="mt-3 pt-3 flex items-center justify-between animate-fade-in" style={{ borderTop: '1px solid rgba(108,92,231,0.08)' }}>
                    <p className="text-xs text-muted-foreground">{p.description}</p>
                    <Button variant="ghost" size="sm" className="text-xs text-primary hover:text-primary h-7 px-3">
                      Abrir
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Updates + Urgent Tasks */}
      <div className="grid lg:grid-cols-2 gap-6">
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

        <div>
          <h2 className="label-mc mb-4 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-warning" />
            Tarefas Urgentes
          </h2>
          <div className="space-y-2">
            {urgentTasks.map((t, i) => (
              <div key={i} className="glass-card rounded-xl px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-medium text-foreground">{t.title}</p>
                  <p className="text-[11px] text-muted-foreground">{t.project}</p>
                </div>
                <div className="text-right">
                  <Badge className={`${t.priority === "alta" ? "bg-destructive/10 text-destructive border-destructive/20" : "bg-warning/10 text-warning border-warning/20"} border text-[10px] rounded-full`}>
                    {t.priority}
                  </Badge>
                  <p className="text-[10px] text-muted-foreground mt-1">{t.deadline}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
