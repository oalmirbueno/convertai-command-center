import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useClients, useTeamMembers } from "@/hooks/useSupabaseData";
import { projectTemplates } from "@/lib/projectTemplates";
import { format, addDays } from "date-fns";
import { Loader2, Sparkles, FolderPlus } from "lucide-react";

const PROJECT_TYPES = [
  { value: "site", label: "Site", desc: "Desenvolvimento de site institucional/landing — design, código, SEO básico, deploy." },
  { value: "landing_page", label: "Landing Page", desc: "Landing page focada em conversão — design, copy, formulário e tracking." },
  { value: "automation", label: "Automação", desc: "Automação de processos / integrações via APIs e webhooks." },
  { value: "social_media", label: "Social Media", desc: "Pacote avulso de social media — conteúdo, criativos e publicação." },
  { value: "trafego", label: "Tráfego pago", desc: "Setup e gestão de campanhas de tráfego pago." },
  { value: "video", label: "Vídeo", desc: "Produção audiovisual — pré-produção, captação, edição e entrega." },
  { value: "video_ai", label: "Vídeo IA", desc: "Vídeo gerado com IA — roteiro, prompts, geração, edição e entrega." },
  { value: "event", label: "Evento", desc: "Cobertura e divulgação de evento — pré, durante e pós." },
  { value: "other", label: "Outro", desc: "Projeto avulso personalizado." },
];

const typeMeta = (v: string) => PROJECT_TYPES.find(t => t.value === v) || PROJECT_TYPES[PROJECT_TYPES.length - 1];

interface Props {
  open: boolean;
  onClose: () => void;
  existingProjects: any[]; // already-loaded project_payments OR projects list
}

export default function NewIncomeModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: clients } = useClients();
  const { data: teamMembers } = useTeamMembers();

  const [saving, setSaving] = useState(false);
  const [clientId, setClientId] = useState("");
  const [projectMode, setProjectMode] = useState<"existing" | "new">("new");
  const [existingProjectId, setExistingProjectId] = useState("");
  const [projectType, setProjectType] = useState("site");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [brand, setBrand] = useState<"aceleriq" | "sitebolt" | "">("sitebolt");
  const [generateTasks, setGenerateTasks] = useState(true);
  const [totalValue, setTotalValue] = useState("");
  const [entryPct, setEntryPct] = useState("50");
  const [installmentsCount, setInstallmentsCount] = useState("1");
  const [firstDueDate, setFirstDueDate] = useState(new Date().toISOString().slice(0, 10));

  const selectedClient = useMemo(
    () => (clients || []).find((c: any) => c.id === clientId),
    [clients, clientId]
  );

  // Auto-fill name + description when type/client changes (only in 'new' mode)
  useEffect(() => {
    if (projectMode !== "new") return;
    const meta = typeMeta(projectType);
    const cName = selectedClient?.company_name || selectedClient?.full_name || "";
    setName(cName ? `${meta.label} — ${cName}` : meta.label);
    setDescription(meta.desc);
  }, [projectType, clientId, projectMode]);

  // Load existing one_off projects for selected client
  const [existingProjects, setExistingProjects] = useState<any[]>([]);
  useEffect(() => {
    if (!clientId) { setExistingProjects([]); return; }
    (async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, name, project_type, billing_mode")
        .eq("client_id", clientId)
        .eq("billing_mode", "one_off")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      setExistingProjects(data || []);
    })();
  }, [clientId]);

  const reset = () => {
    setClientId(""); setProjectMode("new"); setExistingProjectId("");
    setProjectType("site"); setName(""); setDescription(""); setBrand("sitebolt");
    setGenerateTasks(true); setTotalValue(""); setEntryPct("50");
    setInstallmentsCount("1"); setFirstDueDate(new Date().toISOString().slice(0, 10));
  };

  const handleSave = async () => {
    if (!clientId) return toast.error("Selecione o cliente");
    const total = parseFloat(totalValue);
    if (!total || total <= 0) return toast.error("Informe o valor total");
    if (projectMode === "existing" && !existingProjectId) return toast.error("Selecione o projeto");
    if (projectMode === "new" && !name.trim()) return toast.error("Informe o nome do projeto");

    setSaving(true);
    try {
      let projectId = existingProjectId;

      // 1. Create project if needed
      if (projectMode === "new") {
        const startDate = new Date();
        const deadline = addDays(startDate, 30);
        const { data: newProject, error } = await supabase
          .from("projects")
          .insert({
            client_id: clientId,
            name: name.trim(),
            description: description.trim() || null,
            project_type: projectType,
            billing_mode: "one_off",
            brand: brand || null,
            total_value: total,
            start_date: format(startDate, "yyyy-MM-dd"),
            deadline: format(deadline, "yyyy-MM-dd"),
            status: "planning",
            progress: 0,
            created_by: user?.id,
          } as any)
          .select()
          .single();
        if (error) throw error;
        projectId = newProject.id;

        // Auto-generate milestones + tasks from template
        if (generateTasks && projectTemplates[projectType]) {
          const roleMap: Record<string, string | null> = {};
          for (const m of (teamMembers || [])) {
            if (!roleMap[m.role]) roleMap[m.role] = m.id;
          }
          if (!roleMap["admin"]) roleMap["admin"] = user!.id;

          const tmpls = projectTemplates[projectType];
          for (let mIdx = 0; mIdx < tmpls.length; mIdx++) {
            const tmpl = tmpls[mIdx];
            const targetDate = format(addDays(startDate, tmpl.offsetDays), "yyyy-MM-dd");
            const { data: milestone } = await supabase.from("milestones").insert({
              project_id: projectId,
              title: tmpl.title,
              target_date: targetDate,
              status: "pending",
              milestone_order: mIdx + 1,
            }).select().single();
            if (milestone) {
              const taskRows = tmpl.tasks.map((t, tIdx) => ({
                project_id: projectId,
                milestone_id: milestone.id,
                title: t.title,
                description: t.description || null,
                priority: t.priority,
                assigned_to: roleMap[t.role] || null,
                status: "backlog",
                task_order: tIdx + 1,
              }));
              await supabase.from("tasks").insert(taskRows);
            }
          }
        }

        // System update
        await supabase.from("updates").insert({
          project_id: projectId,
          author_id: user!.id,
          message: `Projeto avulso "${name.trim()}" criado via Fluxo de Caixa`,
          update_type: "system",
        });

        // Notify client
        await supabase.from("notifications").insert({
          user_id: clientId,
          message: `Novo projeto criado: ${name.trim()}`,
          notification_type: "project",
          link: "/dashboard",
        });
      }

      // 2. Create payment plan
      const ePct = parseFloat(entryPct) || 0;
      const iCount = parseInt(installmentsCount) || 1;
      const entryAmount = (total * ePct) / 100;
      const remaining = total - entryAmount;
      const perInstallment = iCount > 0 ? remaining / iCount : 0;

      const { data: paymentData, error: payErr } = await supabase
        .from("project_payments")
        .insert({
          project_id: projectId,
          client_id: clientId,
          total_value: total,
          entry_percentage: ePct,
          entry_amount: entryAmount,
          installments_count: iCount,
          created_by: user?.id,
        } as any)
        .select()
        .single();
      if (payErr) throw payErr;

      const baseDate = new Date(firstDueDate + "T12:00:00");
      const instRows: any[] = [];
      if (ePct > 0) {
        instRows.push({
          payment_id: paymentData.id,
          installment_number: 0,
          amount: entryAmount,
          due_date: format(baseDate, "yyyy-MM-dd"),
          status: "pending",
          description: `Entrada (${ePct}%)`,
        });
      }
      for (let i = 1; i <= iCount; i++) {
        const d = new Date(baseDate); d.setMonth(d.getMonth() + i);
        instRows.push({
          payment_id: paymentData.id,
          installment_number: i,
          amount: perInstallment,
          due_date: format(d, "yyyy-MM-dd"),
          status: "pending",
          description: iCount === 1 ? "Pagamento na entrega" : `Parcela ${i}/${iCount}`,
        });
      }
      if (instRows.length) await supabase.from("payment_installments").insert(instRows);

      // 3. Auto-upgrade client to "hybrid" if previously recurring
      if (selectedClient?.client_type === "recurring") {
        await supabase.from("profiles").update({ client_type: "hybrid" }).eq("id", clientId);
        toast.success(`${selectedClient.company_name || selectedClient.full_name} agora é cliente híbrido`);
      }

      toast.success("Entrada avulsa registrada");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["all-project-payments-finance"] }),
        qc.invalidateQueries({ queryKey: ["project_payments"] }),
        qc.invalidateQueries({ queryKey: ["projects"] }),
        qc.invalidateQueries({ queryKey: ["clients"] }),
        qc.invalidateQueries({ queryKey: ["expenses"] }),
        qc.invalidateQueries({ queryKey: ["billing"] }),
        qc.refetchQueries({ queryKey: ["all-project-payments-finance"] }),
      ]);
      reset();
      onClose();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Erro ao registrar entrada");
    } finally {
      setSaving(false);
    }
  };

  const willBecomeHybrid = selectedClient?.client_type === "recurring" && projectMode === "new";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-card border-border max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Nova Entrada Avulsa
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Cliente */}
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Cliente *</label>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}
              className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50">
              <option value="">Selecionar cliente...</option>
              {(clients || []).map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.company_name || c.full_name} {c.client_type ? `· ${c.client_type === "recurring" ? "Recorrente" : c.client_type === "one_off" ? "Avulso" : "Híbrido"}` : ""}
                </option>
              ))}
            </select>
            {willBecomeHybrid && (
              <p className="text-[11px] text-primary mt-1.5 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                Esse cliente é recorrente — ao criar um projeto avulso ele vira <b className="font-semibold">híbrido</b> automaticamente.
              </p>
            )}
          </div>

          {/* Projeto: existing vs new */}
          {clientId && (
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5 block">Projeto</label>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button type="button" onClick={() => setProjectMode("new")}
                  className={`px-3 py-2 rounded-lg text-[12px] border transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                    projectMode === "new" ? "bg-primary/10 border-primary text-foreground font-semibold" : "bg-secondary border-border text-muted-foreground"
                  }`}>
                  <FolderPlus className="w-3.5 h-3.5" /> Criar novo
                </button>
                <button type="button" onClick={() => setProjectMode("existing")} disabled={existingProjects.length === 0}
                  className={`px-3 py-2 rounded-lg text-[12px] border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    projectMode === "existing" ? "bg-primary/10 border-primary text-foreground font-semibold" : "bg-secondary border-border text-muted-foreground"
                  }`}>
                  Vincular existente ({existingProjects.length})
                </button>
              </div>

              {projectMode === "existing" && (
                <select value={existingProjectId} onChange={(e) => setExistingProjectId(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50">
                  <option value="">Selecionar projeto avulso...</option>
                  {existingProjects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Novo projeto: tipo + nome + descrição */}
          {clientId && projectMode === "new" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Tipo</label>
                  <select value={projectType} onChange={(e) => setProjectType(e.target.value)}
                    className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50">
                    {PROJECT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Brand</label>
                  <select value={brand} onChange={(e) => setBrand(e.target.value as any)}
                    className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50">
                    <option value="">—</option>
                    <option value="aceleriq">AcelerIQ</option>
                    <option value="sitebolt">SiteBolt</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Nome do projeto</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
              </div>

              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Descrição</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                  className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 resize-none" />
              </div>

              {projectTemplates[projectType] && (
                <label className="flex items-center gap-2.5 p-2.5 rounded-lg bg-primary/5 border border-primary/20 cursor-pointer">
                  <input type="checkbox" checked={generateTasks} onChange={(e) => setGenerateTasks(e.target.checked)}
                    className="accent-primary w-4 h-4" />
                  <div className="text-[11px]">
                    <p className="text-foreground font-medium">Gerar tarefas automaticamente</p>
                    <p className="text-muted-foreground">
                      {projectTemplates[projectType].length} milestones · {projectTemplates[projectType].reduce((s, m) => s + m.tasks.length, 0)} tarefas
                    </p>
                  </div>
                </label>
              )}
            </>
          )}

          {/* Financeiro */}
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
            <p className="text-[11px] uppercase tracking-wider text-primary font-semibold">Financeiro</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Valor total *</label>
                <Input type="number" step="0.01" value={totalValue} onChange={(e) => setTotalValue(e.target.value)} className="mt-1" placeholder="0,00" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Entrada %</label>
                <Input type="number" step="1" min="0" max="100" value={entryPct} onChange={(e) => setEntryPct(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Parcelas</label>
                <Input type="number" step="1" min="1" value={installmentsCount} onChange={(e) => setInstallmentsCount(e.target.value)} className="mt-1" />
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Primeira data (entrada)</label>
              <Input type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} className="mt-1" />
            </div>
            {totalValue && parseFloat(totalValue) > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Entrada: <span className="text-foreground font-mono">R$ {((parseFloat(totalValue) * parseFloat(entryPct || "0")) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                {" · "}
                {installmentsCount}× de <span className="text-foreground font-mono">R$ {((parseFloat(totalValue) * (100 - parseFloat(entryPct || "0"))) / 100 / Math.max(parseInt(installmentsCount) || 1, 1)).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} disabled={saving}
              className="px-4 py-2 rounded-lg text-[12px] bg-secondary text-foreground border border-border cursor-pointer disabled:opacity-50">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-2 rounded-lg text-[12px] bg-primary text-primary-foreground border-none cursor-pointer disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {saving ? "Registrando..." : "Registrar Entrada"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
