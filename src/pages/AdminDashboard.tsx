import { useState } from "react";
import { projects, updates, typeColors, updateDotColors } from "@/data/mockData";
import { Badge } from "@/components/ui/badge";
import {
  FolderOpen, Users, ListTodo, Eye, Plus, UserPlus, Sparkles, Upload,
  Clock, AlertTriangle, ChevronRight
} from "lucide-react";

const stats = [
  { label: "Projetos Ativos", value: "4", color: "bg-primary" },
  { label: "Clientes", value: "2", color: "bg-success" },
  { label: "Tarefas Pendentes", value: "6", color: "bg-warning" },
  { label: "Em Revisão", value: "2", color: "bg-info" },
];

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

const statusDotColors: Record<string, string> = {
  "Em andamento": "bg-info pulse-dot",
  "Em revisão": "bg-warning",
  "Backlog": "bg-muted-foreground",
};

export default function AdminDashboard() {
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);

  return (
    <div className="space-y-8 animate-fade-in">
      <p className="heading-page">Dashboard</p>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        {stats.map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-5 hover:border-muted-foreground/30 transition-colors">
            <p className="label-sm">{s.label}</p>
            <p className="font-mono font-light text-[28px] leading-none text-foreground mt-2">{s.value}</p>
            <div className={`h-0.5 w-8 ${s.color} rounded-full mt-3 opacity-60`} />
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        {quickActions.map((a) => (
          <button key={a.label} className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] text-muted-foreground border border-border hover:border-muted-foreground/50 hover:text-foreground transition-colors cursor-pointer bg-transparent">
            <a.icon className="w-3.5 h-3.5" />
            {a.label}
          </button>
        ))}
      </div>

      {/* Projects */}
      <div>
        <p className="label-sm mb-4">Projetos Ativos</p>
        <div className="space-y-0.5 stagger-children">
          {projects.map((p) => {
            const isHovered = hoveredProject === p.id;
            return (
              <div
                key={p.id}
                className="bg-card border border-border rounded-xl px-5 py-4 cursor-pointer hover:border-muted-foreground/30 transition-colors"
                onMouseEnter={() => setHoveredProject(p.id)}
                onMouseLeave={() => setHoveredProject(null)}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${statusDotColors[p.status] || "bg-muted-foreground"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{p.name}</span>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">{p.type}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{p.client}</p>
                  </div>
                  <div className="w-32 hidden md:block">
                    <div className="h-[3px] rounded-full bg-secondary overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${p.progress}%` }} />
                    </div>
                    <p className="text-xs font-mono text-muted-foreground mt-1 text-right">{p.progress}%</p>
                  </div>
                  <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    {p.deadline}
                  </div>
                  <ChevronRight className={`w-4 h-4 text-muted-foreground transition-all ${isHovered ? "translate-x-0.5 text-foreground" : ""}`} />
                </div>
                {isHovered && (
                  <div className="mt-3 pt-3 border-t border-border flex items-center justify-between animate-fade-in">
                    <p className="text-xs text-muted-foreground">{p.description}</p>
                    <button className="text-xs text-primary hover:underline">Abrir</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Updates + Urgent */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="label-sm mb-4">Atualizações Recentes</p>
          <div className="space-y-0">
            {updates.map((u, i) => (
              <div key={u.id}>
                {i > 0 && <div className="border-t border-border" />}
                <div className="flex items-start gap-3 py-3">
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${updateDotColors[u.type]}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-foreground">{u.message}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{u.time}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <p className="label-sm mb-4 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-warning" />
            Tarefas Urgentes
          </p>
          <div className="space-y-0">
            {urgentTasks.map((t, i) => (
              <div key={i}>
                {i > 0 && <div className="border-t border-border" />}
                <div className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-[13px] font-medium text-foreground">{t.title}</p>
                    <p className="text-[11px] text-muted-foreground">{t.project}</p>
                  </div>
                  <div className="text-right">
                    <span className={`text-[11px] font-medium ${t.priority === "alta" ? "text-destructive" : "text-warning"}`}>{t.priority}</span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{t.deadline}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
