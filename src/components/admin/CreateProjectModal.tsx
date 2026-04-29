import { useState, useEffect, useMemo } from "react";
import { X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { notifyOpsMilestone, notifyOpsUpdate } from "@/lib/opsSync";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useClients, useTeamMembers } from "@/hooks/useSupabaseData";
import { toast } from "sonner";
import { format, addDays } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { projectTemplates } from "@/lib/projectTemplates";

const PROJECT_TYPES = [
  { value: "social_media", label: "Social Media" },
  { value: "trafego", label: "Tráfego" },
  { value: "automation", label: "Automação" },
  { value: "site", label: "Site" },
  { value: "landing_page", label: "Landing Page" },
  { value: "event", label: "Evento" },
  { value: "other", label: "Outro" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  editProject?: any;
}

export default function CreateProjectModal({ open, onClose, editProject }: Props) {
  const { user } = useAuth();
  const { data: clients } = useClients();
  const { data: teamMembers } = useTeamMembers();

  // Resolve dados do cliente selecionado para enriquecer o context do Ops
  const selectedClient = useMemo(
    () => (clients || []).find((c: any) => c.id === clientId),
    [clients, clientId]
  );

  const buildOpsContext = () => ({
    client_email: selectedClient?.email ?? null,
    client_full_name: selectedClient?.full_name ?? null,
    client_company: selectedClient?.company_name ?? null,
    client_phone: selectedClient?.phone ?? null,
    client_plan: selectedClient?.plan_name ?? null,
  });
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [useTemplates, setUseTemplates] = useState(true);

  const [clientId, setClientId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [projectType, setProjectType] = useState("other");
  const [startDate, setStartDate] = useState<Date | undefined>(new Date());
  const [deadline, setDeadline] = useState<Date | undefined>(undefined);
  const [scope, setScope] = useState("");
  const [objectives, setObjectives] = useState("");

  useEffect(() => {
    if (editProject) {
      setClientId(editProject.client_id || "");
      setName(editProject.name || "");
      setDescription(editProject.description || "");
      setProjectType(editProject.project_type || "other");
      setStartDate(editProject.start_date ? new Date(editProject.start_date) : new Date());
      setDeadline(editProject.deadline ? new Date(editProject.deadline) : undefined);
      setScope(editProject.scope || "");
      setObjectives(editProject.objectives || "");
    } else {
      setClientId("");
      setName("");
      setDescription("");
      setProjectType("other");
      setStartDate(new Date());
      setDeadline(undefined);
      setScope("");
      setObjectives("");
    }
  }, [editProject]);

  if (!open) return null;

  const isEdit = !!editProject;

  const handleSave = async () => {
    if (!clientId || !name.trim()) {
      toast.error("Selecione o cliente e informe o nome do projeto");
      return;
    }
    if (!startDate || !deadline) {
      toast.error("Informe as datas de início e prazo");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        client_id: clientId,
        name: name.trim(),
        description: description.trim() || null,
        project_type: projectType,
        start_date: format(startDate, "yyyy-MM-dd"),
        deadline: format(deadline, "yyyy-MM-dd"),
        scope: scope.trim() || null,
        objectives: objectives.trim() || null,
        ...(isEdit ? {} : { created_by: user?.id, status: "planning", progress: 0 }),
      };

      if (isEdit) {
        const { error } = await supabase.from("projects").update(payload).eq("id", editProject.id);
        if (error) throw error;
        toast.success("Projeto atualizado!");

        // Notifica Ops do update
        fetch("https://grxljyocuadywcksfyvu.supabase.co/functions/v1/receive-portal-sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-webhook-secret": "aceleriq-ops-portal-bridge-2025-x7k9m2n4p8q",
          },
          body: JSON.stringify({
            type: "project",
            data: { id: editProject.id, client_id: clientId, ...payload },
            context: buildOpsContext(),
          }),
        }).catch(() => {});
      } else {
        const { data: newProject, error } = await supabase.from("projects").insert(payload).select().single();
        if (error) throw error;

        // Create notification for client
        await supabase.from("notifications").insert({
          user_id: clientId,
          message: `Novo projeto criado: ${name.trim()}`,
          notification_type: "project",
          link: "/dashboard",
        });

        // Create system update
        if (newProject) {
          await supabase.from("updates").insert({
            project_id: newProject.id,
            author_id: user!.id,
            message: `Projeto "${name.trim()}" criado`,
            update_type: "system",
          });

          // Notifica o Ops que novo projeto foi criado — fire-and-forget
          const opsProjectPayload = {
            type: "project",
            data: {
              id: newProject.id,
              client_id: clientId,
              name: name.trim(),
              description: description || null,
              project_type: projectType,
              status: "planning",
              progress: 0,
              start_date: startDate?.toISOString() ?? null,
              deadline: deadline?.toISOString() ?? null,
            },
            context: buildOpsContext(),
          };
          fetch("https://grxljyocuadywcksfyvu.supabase.co/functions/v1/receive-portal-sync", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-webhook-secret": "aceleriq-ops-portal-bridge-2025-x7k9m2n4p8q",
            },
            body: JSON.stringify(opsProjectPayload),
          }).catch(() => {}); // silencioso

          // Auto-generate milestones & tasks from templates
          if (useTemplates && projectTemplates[projectType]) {
            const templates = projectTemplates[projectType];
            const projectStartDate = startDate || new Date();

            // Find team members by role for auto-assignment
            const roleMap: Record<string, string | null> = {};
            for (const member of (teamMembers || [])) {
              if (!roleMap[member.role]) {
                roleMap[member.role] = member.id;
              }
            }
            // Admin is the current user as fallback
            if (!roleMap["admin"]) roleMap["admin"] = user!.id;

            const maxMilestones = templates.length;
            for (let mIdx = 0; mIdx < maxMilestones; mIdx++) {
              const tmpl = templates[mIdx];
              const targetDate = format(addDays(projectStartDate, tmpl.offsetDays), "yyyy-MM-dd");

              const { data: milestone } = await supabase.from("milestones").insert({
                project_id: newProject.id,
                title: tmpl.title,
                target_date: targetDate,
                status: "pending",
                milestone_order: mIdx + 1,
              }).select().single();
              notifyOpsMilestone(milestone);

              if (milestone) {
                const taskInserts = tmpl.tasks.map((t, tIdx) => ({
                  project_id: newProject.id,
                  milestone_id: milestone.id,
                  title: t.title,
                  description: t.description || null,
                  priority: t.priority,
                  assigned_to: roleMap[t.role] || null,
                  status: "backlog" as string,
                  task_order: tIdx + 1,
                }));
                await supabase.from("tasks").insert(taskInserts);
              }
            }
          }
        }

        toast.success("Projeto criado com sucesso!");
      }

      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["updates"] });
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar projeto");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-[520px] mx-4 animate-in fade-in zoom-in-[0.96] duration-200" style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">{isEdit ? "Editar Projeto" : "Novo Projeto"}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Cliente *</label>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors">
              <option value="">Selecionar cliente...</option>
              {(clients || []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Nome do Projeto *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Social Media 2026"
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Descrição</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Descrição breve do projeto"
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors resize-none" />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Tipo</label>
            <select value={projectType} onChange={(e) => setProjectType(e.target.value)}
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors">
              {PROJECT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {!isEdit && projectTemplates[projectType] && (
            <label className="flex items-center gap-2.5 p-3 rounded-[10px] bg-primary/5 border border-primary/20 cursor-pointer">
              <input type="checkbox" checked={useTemplates} onChange={(e) => setUseTemplates(e.target.checked)}
                className="accent-primary w-4 h-4" />
              <div>
                <p className="text-[13px] font-medium text-foreground">Gerar milestones e tarefas automaticamente</p>
                <p className="text-[11px] text-muted-foreground">
                  {projectTemplates[projectType].length} milestones · {projectTemplates[projectType].reduce((sum, m) => sum + m.tasks.length, 0)} tarefas com atribuição automática por função
                </p>
              </div>
            </label>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Data Início</label>
              <Popover>
                <PopoverTrigger asChild>
                  <button className={cn("w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-left flex items-center gap-2 hover:border-primary/50 transition-colors cursor-pointer", !startDate && "text-muted-foreground")}>
                    <CalendarIcon className="w-3.5 h-3.5" />
                    {startDate ? format(startDate, "dd/MM/yyyy") : "Selecionar"}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={startDate} onSelect={setStartDate} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Prazo Final</label>
              <Popover>
                <PopoverTrigger asChild>
                  <button className={cn("w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-left flex items-center gap-2 hover:border-primary/50 transition-colors cursor-pointer", !deadline && "text-muted-foreground")}>
                    <CalendarIcon className="w-3.5 h-3.5" />
                    {deadline ? format(deadline, "dd/MM/yyyy") : "Selecionar"}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={deadline} onSelect={setDeadline} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Escopo</label>
            <textarea value={scope} onChange={(e) => setScope(e.target.value)} rows={2} placeholder="Detalhes do escopo..."
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors resize-none" />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Objetivos <span className="text-muted-foreground/40">(um por linha)</span></label>
            <textarea value={objectives} onChange={(e) => setObjectives(e.target.value)} rows={3} placeholder="Objetivo 1&#10;Objetivo 2"
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors resize-none" />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded-[10px] text-[13px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border border-border">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 rounded-[10px] text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 flex items-center gap-2">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saving ? "Salvando..." : isEdit ? "Salvar" : "Criar Projeto"}
          </button>
        </div>
      </div>
    </div>
  );
}
