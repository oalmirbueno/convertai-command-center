import { useState } from "react";
import { X, Loader2, CalendarIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useClients } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

const PROJECT_TYPES = ["social_media", "trafego", "automacao", "site", "evento", "outro"];
const typeLabels: Record<string, string> = {
  social_media: "Social Media", trafego: "Tráfego", automacao: "Automação",
  site: "Site / Landing Page", evento: "Evento", outro: "Outro",
};

interface Props { open: boolean; onClose: () => void; }

export default function MeetingNotesModal({ open, onClose }: Props) {
  const { user } = useAuth();
  const { data: clients } = useClients();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  const [clientId, setClientId] = useState("");
  const [projectType, setProjectType] = useState("social_media");
  const [startDate, setStartDate] = useState<Date>(new Date());
  const [deadline, setDeadline] = useState<Date | undefined>();
  const [content, setContent] = useState("");

  if (!open) return null;

  const handleSave = async () => {
    if (!clientId || !content.trim()) { toast.error("Preencha cliente e conteúdo"); return; }
    if (!deadline) { toast.error("Selecione o prazo"); return; }
    setSaving(true);
    try {
      const client = (clients || []).find((c: any) => c.id === clientId);
      const name = `${typeLabels[projectType]} — ${client?.company_name || client?.full_name}`;

      const { data: project, error } = await supabase.from("projects").insert({
        name, description: content.trim().slice(0, 200), scope: content.trim(),
        project_type: projectType, client_id: clientId, created_by: user?.id || null,
        start_date: format(startDate, "yyyy-MM-dd"), deadline: format(deadline, "yyyy-MM-dd"),
        status: "planning", progress: 0,
      }).select().single();
      if (error) throw error;

      await supabase.from("milestones").insert({
        project_id: project.id, title: "Kick-off",
        target_date: format(startDate, "yyyy-MM-dd"), status: "completed", milestone_order: 0,
      });
      await supabase.from("updates").insert({
        project_id: project.id, author_id: user!.id,
        message: "Projeto criado a partir de ata de reunião", update_type: "milestone",
      });
      // Notify client
      const { data: adminRole } = await supabase.from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
      await supabase.from("notifications").insert({
        user_id: clientId,
        message: `Novo projeto criado: ${name}`,
        notification_type: "system", link: "/dashboard",
      });

      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Projeto criado a partir da ata!");
      onClose();
      navigate("/kanban");
    } catch (err: any) {
      toast.error(err.message || "Erro");
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-[540px] mx-4 animate-in fade-in zoom-in-[0.96] duration-200" style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Nova Ata de Reunião</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-1"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Cliente *</label>
            <select value={clientId} onChange={e => setClientId(e.target.value)} className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors">
              <option value="">Selecionar...</option>
              {(clients || []).map((c: any) => <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Tipo de Projeto</label>
            <select value={projectType} onChange={e => setProjectType(e.target.value)} className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors">
              {PROJECT_TYPES.map(t => <option key={t} value={t}>{typeLabels[t]}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Data Início</label>
              <Popover>
                <PopoverTrigger asChild>
                  <button className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-left flex items-center gap-2 cursor-pointer">
                    <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    {format(startDate, "dd/MM/yyyy")}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={startDate} onSelect={d => d && setStartDate(d)} className="p-3 pointer-events-auto" /></PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Prazo Estimado</label>
              <Popover>
                <PopoverTrigger asChild>
                  <button className={cn("w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-left flex items-center gap-2 cursor-pointer", !deadline && "text-muted-foreground")}>
                    <CalendarIcon className="w-3.5 h-3.5" />
                    {deadline ? format(deadline, "dd/MM/yyyy") : "Selecionar"}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={deadline} onSelect={setDeadline} className="p-3 pointer-events-auto" /></PopoverContent>
              </Popover>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Conteúdo da Reunião *</label>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={12} placeholder="Cole aqui suas anotações..."
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors resize-none" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded-[10px] text-[13px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border border-border">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 rounded-[10px] text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 flex items-center gap-2">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saving ? "Criando..." : "Gerar Projeto a partir da Ata"}
          </button>
        </div>
      </div>
    </div>
  );
}
