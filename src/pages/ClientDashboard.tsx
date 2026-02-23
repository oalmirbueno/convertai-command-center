import { useAuth } from "@/contexts/AuthContext";
import { projects, updates, updateDotColors, typeColors } from "@/data/mockData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { FolderOpen, Clock as ClockIcon, CheckCircle, Clock } from "lucide-react";

export default function ClientDashboard() {
  const { user } = useAuth();
  const clientProjects = projects.filter((p) => p.client === "Acerbi Associação");

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          Olá, <span className="text-gradient">{user?.company || user?.name}</span> 👋
        </h1>
        <p className="text-muted-foreground text-sm">Acompanhe o andamento dos seus projetos.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Projetos Ativos", value: "2", icon: FolderOpen, color: "text-primary" },
          { label: "Aguardando Aprovação", value: "1", icon: ClockIcon, color: "text-warning" },
          { label: "Concluídas", value: "5", icon: CheckCircle, color: "text-success" },
        ].map((s) => (
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

      {/* Projects */}
      <div>
        <h2 className="text-lg font-semibold mb-4 text-foreground">Meus Projetos</h2>
        <div className="grid gap-4">
          {clientProjects.map((p) => (
            <Card key={p.id} className="bg-card border-border/50 rounded-2xl hover:border-primary/30 transition-colors cursor-pointer">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <Badge className={`${typeColors[p.type]} border-0 text-[10px] font-semibold mb-2`}>{p.type}</Badge>
                    <h3 className="text-lg font-semibold text-foreground">{p.name}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{p.description}</p>
                  </div>
                  <Badge variant="outline" className="border-border/50 text-xs">{p.status}</Badge>
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Progresso</span>
                    <span className="font-mono">{p.progress}%</span>
                  </div>
                  <Progress value={p.progress} className="h-2 bg-secondary" />
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

      {/* Updates */}
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
    </div>
  );
}
