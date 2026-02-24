import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useProjects, useClients } from "@/hooks/useSupabaseData";
import { Plus, FileText, Eye, Send, Edit, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const metricFields = [
  { key: "reach", label: "Alcance" },
  { key: "impressions", label: "Impressões" },
  { key: "engagement", label: "Engajamento %" },
  { key: "clicks", label: "Cliques" },
  { key: "ctr", label: "CTR %" },
  { key: "conversions", label: "Conversões" },
];

function formatNumber(n: number) {
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function formatDate(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function MiniBars() {
  const bars = [60, 75, 45, 90, 70];
  return (
    <div className="flex items-end gap-0.5 h-6 mt-1.5">
      {bars.map((v, i) => (
        <div key={i} className="flex-1 bg-primary/50 rounded-sm" style={{ height: `${v}%` }} />
      ))}
    </div>
  );
}

export default function AdminReports() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: projects } = useProjects();
  const { data: clients } = useClients();

  const { data: reports, isLoading } = useQuery({
    queryKey: ["reports"],
    queryFn: async () => {
      const { data } = await supabase
        .from("reports")
        .select("*, project:projects(name), client:profiles!reports_client_id_fkey(full_name, company_name)")
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!user,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [previewReport, setPreviewReport] = useState<any>(null);
  const [editReport, setEditReport] = useState<any>(null);

  // Form state
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [summary, setSummary] = useState("");
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  const filteredProjects = (projects || []).filter((p: any) => !clientId || p.client_id === clientId);

  const openNew = () => {
    setEditReport(null);
    setClientId("");
    setProjectId("");
    setTitle("");
    setPeriodStart("");
    setPeriodEnd("");
    setSummary("");
    setMetrics({});
    setModalOpen(true);
  };

  const openEdit = (r: any) => {
    setEditReport(r);
    setClientId(r.client_id);
    setProjectId(r.project_id);
    setTitle(r.title);
    setPeriodStart(r.period_start || "");
    setPeriodEnd(r.period_end || "");
    setSummary(r.summary || "");
    setMetrics((r.metrics as Record<string, number>) || {});
    setModalOpen(true);
  };

  const handleSave = async (status: string) => {
    if (!clientId || !projectId || !title) {
      toast.error("Preencha cliente, projeto e título.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        client_id: clientId,
        project_id: projectId,
        title,
        period_start: periodStart || null,
        period_end: periodEnd || null,
        summary: summary || null,
        metrics,
        status,
        created_by: user!.id,
      };

      if (editReport) {
        await supabase.from("reports").update(payload).eq("id", editReport.id);
      } else {
        await supabase.from("reports").insert(payload);
      }

      if (status === "published") {
        await supabase.from("notifications").insert({
          user_id: clientId,
          message: `Novo relatório disponível: ${title}`,
          notification_type: "report",
          link: "/relatorios",
        });
        await supabase.from("updates").insert({
          project_id: projectId,
          author_id: user!.id,
          message: `Relatório publicado: ${title}`,
          update_type: "milestone",
        });
      }

      queryClient.invalidateQueries({ queryKey: ["reports"] });
      setModalOpen(false);
      toast.success(status === "published" ? "Relatório publicado!" : "Rascunho salvo!");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSendToClient = async (r: any) => {
    if (r.status !== "published") {
      await supabase.from("reports").update({ status: "published" }).eq("id", r.id);
    }
    await supabase.from("notifications").insert({
      user_id: r.client_id,
      message: `Novo relatório disponível: ${r.title}`,
      notification_type: "report",
      link: "/relatorios",
    });
    queryClient.invalidateQueries({ queryKey: ["reports"] });
    toast.success("Relatório enviado ao cliente!");
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        {[1, 2].map(i => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Relatórios</h1>
        <button onClick={openNew} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer">
          <Plus className="w-4 h-4" /> Novo Relatório
        </button>
      </div>

      {(!reports || reports.length === 0) ? (
        <div className="text-center py-16">
          <FileText className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum relatório criado ainda</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map((r: any) => {
            const m = (r.metrics || {}) as Record<string, number>;
            return (
              <div key={r.id} className="bg-card border border-border rounded-2xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">📊 {r.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(r as any).client?.company_name || (r as any).client?.full_name} • {(r as any).project?.name}
                      {r.period_start && r.period_end && ` • ${formatDate(r.period_start)}-${formatDate(r.period_end)}`}
                    </p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${r.status === "published" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                    {r.status === "published" ? "Publicado" : "Rascunho"}
                  </span>
                </div>

                {Object.keys(m).length > 0 && (
                  <div className="flex flex-wrap gap-4 mt-4">
                    {metricFields.filter(f => m[f.key] !== undefined).map(f => (
                      <div key={f.key} className="min-w-[80px]">
                        <p className="text-base font-mono text-foreground">{f.key.includes("engagement") || f.key === "ctr" ? m[f.key] + "%" : formatNumber(m[f.key])}</p>
                        <p className="text-[10px] uppercase text-muted-foreground">{f.label}</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 mt-4">
                  <button onClick={() => openEdit(r)} className="text-[12px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1">
                    <Edit className="w-3 h-3" /> Editar
                  </button>
                  <button onClick={() => setPreviewReport(r)} className="text-[12px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1">
                    <Eye className="w-3 h-3" /> Ver
                  </button>
                  <button onClick={() => handleSendToClient(r)} className="text-[12px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1">
                    <Send className="w-3 h-3" /> Enviar ao Cliente
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editReport ? "Editar Relatório" : "Novo Relatório"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-[11px] uppercase tracking-wider">Cliente</Label>
              <Select value={clientId} onValueChange={(v) => { setClientId(v); setProjectId(""); }}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {(clients || []).map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.company_name || c.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px] uppercase tracking-wider">Projeto</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {filteredProjects.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px] uppercase tracking-wider">Título</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Relatório Semanal — Redes Sociais" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[11px] uppercase tracking-wider">Período Início</Label>
                <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
              </div>
              <div>
                <Label className="text-[11px] uppercase tracking-wider">Período Fim</Label>
                <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-[11px] uppercase tracking-wider">Resumo</Label>
              <Textarea value={summary} onChange={e => setSummary(e.target.value)} rows={3} placeholder="Resumo do período..." />
            </div>
            <div>
              <Label className="text-[11px] uppercase tracking-wider mb-2 block">Métricas</Label>
              <div className="grid grid-cols-2 gap-3">
                {metricFields.map(f => (
                  <div key={f.key}>
                    <label className="text-[10px] text-muted-foreground uppercase">{f.label}</label>
                    <Input
                      type="number"
                      value={metrics[f.key] ?? ""}
                      onChange={e => setMetrics(prev => ({ ...prev, [f.key]: Number(e.target.value) }))}
                      placeholder="0"
                      className="bg-secondary"
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => handleSave("draft")}
                disabled={saving}
                className="flex-1 px-4 py-2.5 rounded-xl text-[13px] bg-secondary text-foreground hover:bg-secondary/80 transition-colors cursor-pointer border-none"
              >
                Salvar Rascunho
              </button>
              <button
                onClick={() => handleSave("published")}
                disabled={saving}
                className="flex-1 px-4 py-2.5 rounded-xl text-[13px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none font-medium"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Publicar"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview Modal */}
      <Dialog open={!!previewReport} onOpenChange={() => setPreviewReport(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {previewReport && (() => {
            const m = (previewReport.metrics || {}) as Record<string, number>;
            return (
              <>
                <DialogHeader>
                  <div className="flex items-center gap-3">
                    <DialogTitle className="text-lg">{previewReport.title}</DialogTitle>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${previewReport.status === "published" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                      {previewReport.status === "published" ? "Publicado" : "Rascunho"}
                    </span>
                  </div>
                  {previewReport.period_start && (
                    <p className="text-xs text-muted-foreground">{formatDate(previewReport.period_start)} — {formatDate(previewReport.period_end)}</p>
                  )}
                </DialogHeader>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4">
                  {metricFields.filter(f => m[f.key] !== undefined).map(f => (
                    <div key={f.key} className="bg-secondary/50 rounded-xl p-4">
                      <p className="text-[10px] uppercase text-muted-foreground">{f.label}</p>
                      <p className="text-2xl font-mono font-light text-foreground mt-1">
                        {f.key === "engagement" || f.key === "ctr" ? m[f.key] + "%" : formatNumber(m[f.key])}
                      </p>
                      <MiniBars />
                    </div>
                  ))}
                </div>
                {previewReport.summary && (
                  <div className="mt-6">
                    <p className="text-[11px] uppercase text-muted-foreground mb-2">Resumo</p>
                    <p className="text-[13px] text-foreground/80 leading-relaxed">{previewReport.summary}</p>
                  </div>
                )}
                {previewReport.file_url && (
                  <a href={previewReport.file_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 mt-4 text-[13px] text-primary hover:underline">
                    📄 Baixar PDF
                  </a>
                )}
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
