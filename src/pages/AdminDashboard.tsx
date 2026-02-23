import { projects, updates, typeColors } from "@/data/mockData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { updateDotColors } from "@/data/mockData";
import {
  FolderOpen, Users, ListTodo, Eye, Plus, UserPlus, Sparkles, Upload,
  Clock, AlertTriangle
} from "lucide-react";

const stats = [
  { label: "Projetos Ativos", value: "4", icon: FolderOpen, color: "text-primary" },
  { label: "Clientes", value: "2", icon: Users, color: "text-success" },
  { label: "Tarefas Pendentes", value: "6", icon: ListTodo, color: "text-warning" },
  { label: "Em Revisão", value: "2", icon: Eye, color: "text-info" },
];

const quickActions = [
  { label: "Novo Projeto", icon: Plus },
  { label: "Novo Cliente", icon: UserPlus },
  { label: "Gerar Plano IA", icon: Sparkles },
  { label: "Upload Documento", icon: Upload },
];

const urgentTasks = [
  { title: "Briefing evento cooperativo", project: "Evento Cresol", deadline: "20 Fev", priority: "alta" },
  { title: "Aprovação posts semana 8", project: "Social Media Acerbi", deadline: "22 Fev", priority: "alta" },
  { title: "Layout convite digital", project: "Evento Cresol", deadline: "22 Fev", priority: "média" },
];

export default function AdminDashboard() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground text-sm">Visão geral dos seus projetos e equipe.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className="bg-card border-border/50 rounded-2xl">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <s.icon className={`w-5 h-5 ${s.color}`} />
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
              <p className="text-3xl font-bold font-mono text-foreground">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        {quickActions.map((a) => (
          <Button key={a.label} variant="outline" className="rounded-xl border-border/50 hover:bg-secondary/80 gap-2 h-10">
            <a.icon className="w-4 h-4" />
            {a.label}
          </Button>
        ))}
      </div>

      {/* Projects Grid */}
      <div>
        <h2 className="text-lg font-semibold mb-4 text-foreground">Projetos Ativos</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {projects.map((p, i) => (
            <Card key={p.id} className="bg-card border-border/50 rounded-2xl hover:border-primary/30 transition-colors" style={{ animationDelay: `${i * 100}ms` }}>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <Badge className={`${typeColors[p.type] || "bg-secondary text-secondary-foreground"} border-0 text-[10px] font-semibold mb-2`}>
                      {p.type}
                    </Badge>
                    <h3 className="font-semibold text-foreground">{p.name}</h3>
                    <p className="text-xs text-muted-foreground">{p.client}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] border-border/50">
                    {p.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{p.description}</p>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Progresso</span>
                    <span className="font-mono">{p.progress}%</span>
                  </div>
                  <Progress value={p.progress} className="h-1.5 bg-secondary" />
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  <span>Prazo: {p.deadline}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Updates + Urgent Tasks */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="bg-card border-border/50 rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Atualizações Recentes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {updates.map((u) => (
              <div key={u.id} className="flex items-start gap-3">
                <div className={`w-2 h-2 rounded-full mt-1.5 ${updateDotColors[u.type]}`} />
                <div>
                  <p className="text-sm text-foreground">{u.message}</p>
                  <p className="text-xs text-muted-foreground">{u.time}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50 rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warning" />
              Tarefas Urgentes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {urgentTasks.map((t, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-secondary/40">
                <div>
                  <p className="text-sm font-medium text-foreground">{t.title}</p>
                  <p className="text-xs text-muted-foreground">{t.project}</p>
                </div>
                <div className="text-right">
                  <Badge className={`${t.priority === "alta" ? "bg-destructive/20 text-destructive" : "bg-warning/20 text-warning"} border-0 text-[10px]`}>
                    {t.priority}
                  </Badge>
                  <p className="text-xs text-muted-foreground mt-1">{t.deadline}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
