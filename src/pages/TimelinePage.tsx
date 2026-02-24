import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useProjects } from "@/hooks/useSupabaseData";
import { toast } from "sonner";
import { Check, Plus, GitBranch, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const statusLabels: Record<string, string> = {
  completed: "Concluído",
  in_progress: "Em andamento",
  pending: "Pendente",
};

function formatDateShort(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export default function TimelinePage() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = profile?.role === "admin";
  const { data: projects, isLoading: loadingProjects } = useProjects();
  const [filterProject, setFilterProject] = useState("all");
  const [addModal, setAddModal] = useState<string | null>(null); // project id
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newStatus, setNewStatus] = useState("pending");
  const [saving, setSaving] = useState(false);

  const filteredProjects = filterProject === "all"
    ? (projects || [])
    : (projects || []).filter((p: any) => p.id === filterProject);

  const { data: allMilestones, isLoading: loadingMilestones } = useQuery({
    queryKey: ["milestones-all"],
    queryFn: async () => {
      const { data } = await supabase
        .from("milestones")
        .select("*")
        .order("milestone_order", { ascending: true });
      return data || [];
    },
    enabled: !!user,
  });

  const handleStatusChange = async (milestoneId: string, newStatus: string) => {
    await supabase.from("milestones").update({ status: newStatus }).eq("id", milestoneId);
    queryClient.invalidateQueries({ queryKey: ["milestones-all"] });
    toast.success("Status atualizado!");
  };

  const handleAddMilestone = async () => {
    if (!newTitle || !newDate || !addModal) return;
    setSaving(true);
    try {
      const projectMilestones = (allMilestones || []).filter((m: any) => m.project_id === addModal);
      const maxOrder = projectMilestones.reduce((max: number, m: any) => Math.max(max, m.milestone_order || 0), 0);
      await supabase.from("milestones").insert({
        project_id: addModal,
        title: newTitle,
        target_date: newDate,
        status: newStatus,
        milestone_order: maxOrder + 1,
      });
      queryClient.invalidateQueries({ queryKey: ["milestones-all"] });
      setAddModal(null);
      setNewTitle("");
      setNewDate("");
      setNewStatus("pending");
      toast.success("Milestone adicionado!");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loadingProjects || loadingMilestones) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        {[1, 2].map(i => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-foreground">Timeline</h1>
        <Select value={filterProject} onValueChange={setFilterProject}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Todos os projetos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os projetos</SelectItem>
            {(projects || []).map((p: any) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filteredProjects.length === 0 && (
        <div className="text-center py-16">
          <GitBranch className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum projeto encontrado</p>
        </div>
      )}

      {filteredProjects.map((project: any) => {
        const milestones = (allMilestones || []).filter((m: any) => m.project_id === project.id);
        const lastCompletedIdx = milestones.reduce((acc: number, m: any, i: number) => m.status === "completed" ? i : acc, -1);

        return (
          <div key={project.id} className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <p className="text-sm font-medium text-foreground">{project.name}</p>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">{project.project_type}</span>
            </div>

            {milestones.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum milestone cadastrado</p>
            ) : (
              <>
                {/* Desktop horizontal */}
                <div className="hidden md:block overflow-x-auto pb-2">
                  <div className="flex items-start gap-0 min-w-max px-2 py-4" style={{ scrollSnapType: "x mandatory" }}>
                    {milestones.map((m: any, i: number) => (
                      <div key={m.id} className="flex items-start" style={{ scrollSnapAlign: "start" }}>
                        <div className="flex flex-col items-center" style={{ minWidth: 140 }}>
                          <Popover>
                            <PopoverTrigger asChild>
                              <button className="relative z-10 focus:outline-none cursor-pointer">
                                {m.status === "completed" ? (
                                  <div className="w-3.5 h-3.5 rounded-full bg-primary flex items-center justify-center">
                                    <Check className="w-2 h-2 text-primary-foreground" />
                                  </div>
                                ) : m.status === "in_progress" ? (
                                  <div className="w-3.5 h-3.5 rounded-full border-2 border-primary bg-transparent animate-pulse" />
                                ) : (
                                  <div className="w-3.5 h-3.5 rounded-full bg-secondary" />
                                )}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-56 p-4" sideOffset={12}>
                              <p className="text-sm font-medium text-foreground">{m.title}</p>
                              {m.description && <p className="text-xs text-muted-foreground mt-1">{m.description}</p>}
                              <p className="text-xs text-muted-foreground mt-2">{formatDateShort(m.target_date)}</p>
                              <p className="text-[10px] mt-1">{statusLabels[m.status]}</p>
                              {isAdmin && (
                                <div className="flex gap-1 mt-3">
                                  {["completed", "in_progress", "pending"].map(s => (
                                    <button
                                      key={s}
                                      onClick={() => handleStatusChange(m.id, s)}
                                      className={`text-[10px] px-2 py-1 rounded-full border cursor-pointer transition-colors ${m.status === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                                    >
                                      {statusLabels[s]}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </PopoverContent>
                          </Popover>
                          <div className="mt-2 text-center">
                            <p className="text-xs font-medium text-foreground">{m.title}</p>
                            <p className="text-[11px] text-muted-foreground">{formatDateShort(m.target_date)}</p>
                          </div>
                        </div>
                        {i < milestones.length - 1 && (
                          <div className="flex items-center mt-1.5" style={{ width: 60 }}>
                            <div className={`h-[2px] w-full transition-colors ${i <= lastCompletedIdx ? "bg-primary" : "bg-secondary"}`} />
                          </div>
                        )}
                      </div>
                    ))}
                    {isAdmin && (
                      <div className="flex flex-col items-center" style={{ minWidth: 60 }}>
                        <button
                          onClick={() => setAddModal(project.id)}
                          className="w-3.5 h-3.5 rounded-full bg-secondary hover:bg-primary/20 flex items-center justify-center transition-colors cursor-pointer"
                        >
                          <Plus className="w-2.5 h-2.5 text-muted-foreground" />
                        </button>
                        <p className="text-[10px] text-muted-foreground mt-2">Adicionar</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Mobile vertical */}
                <div className="md:hidden space-y-3 mt-2">
                  {milestones.map((m: any, i: number) => (
                    <Popover key={m.id}>
                      <PopoverTrigger asChild>
                        <button className="flex gap-3 w-full text-left cursor-pointer">
                          <div className="flex flex-col items-center">
                            {m.status === "completed" ? (
                              <div className="w-3 h-3 rounded-full bg-primary flex items-center justify-center shrink-0">
                                <Check className="w-2 h-2 text-primary-foreground" />
                              </div>
                            ) : m.status === "in_progress" ? (
                              <div className="w-3 h-3 rounded-full border-2 border-primary bg-transparent animate-pulse shrink-0" />
                            ) : (
                              <div className="w-3 h-3 rounded-full bg-secondary shrink-0" />
                            )}
                            {i < milestones.length - 1 && (
                              <div className={`w-[2px] flex-1 mt-1 ${i <= lastCompletedIdx ? "bg-primary" : "bg-secondary"}`} />
                            )}
                          </div>
                          <div className="pb-2">
                            <p className="text-xs font-medium text-foreground">{m.title}</p>
                            <p className="text-[11px] text-muted-foreground">{formatDateShort(m.target_date)}</p>
                          </div>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-4" sideOffset={8}>
                        <p className="text-sm font-medium">{m.title}</p>
                        <p className="text-xs text-muted-foreground mt-1">{formatDateShort(m.target_date)} • {statusLabels[m.status]}</p>
                        {isAdmin && (
                          <div className="flex gap-1 mt-3 flex-wrap">
                            {["completed", "in_progress", "pending"].map(s => (
                              <button
                                key={s}
                                onClick={() => handleStatusChange(m.id, s)}
                                className={`text-[10px] px-2 py-1 rounded-full border cursor-pointer transition-colors ${m.status === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                              >
                                {statusLabels[s]}
                              </button>
                            ))}
                          </div>
                        )}
                      </PopoverContent>
                    </Popover>
                  ))}
                </div>
              </>
            )}

            {isAdmin && milestones.length > 0 && (
              <button
                onClick={() => setAddModal(project.id)}
                className="md:hidden mt-3 text-[12px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Adicionar milestone
              </button>
            )}
          </div>
        );
      })}

      {/* Add Milestone Modal */}
      <Dialog open={!!addModal} onOpenChange={() => setAddModal(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo Milestone</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-[11px] uppercase tracking-wider">Título</Label>
              <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Ex: Entrega Final" />
            </div>
            <div>
              <Label className="text-[11px] uppercase tracking-wider">Data Alvo</Label>
              <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-[11px] uppercase tracking-wider">Status</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value="in_progress">Em andamento</SelectItem>
                  <SelectItem value="completed">Concluído</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <button
              onClick={handleAddMilestone}
              disabled={saving || !newTitle || !newDate}
              className="w-full px-4 py-2.5 rounded-xl text-[13px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none font-medium disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Adicionar"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
