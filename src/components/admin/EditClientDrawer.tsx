import { useState, useEffect, useRef } from "react";
import { X, Loader2, Trash2, FileText, Camera, DollarSign, CheckCircle2, Clock, AlertCircle, Plus, ChevronDown, ChevronUp, Activity, ListChecks, PackageCheck, FolderOpen, BarChart3, Briefcase, KeyRound, Eye, EyeOff, Copy } from "lucide-react";
import ClientVault from "@/components/vault/ClientVault";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { notifyUser } from "@/lib/notifyHelpers";
import BriefingPdfModal from "@/components/briefing/BriefingPdfModal";
import { todayBR, toBRDateKey } from "@/lib/dateBR";


const SERVICES = [
  { key: "trafego", label: "Tráfego Pago" },
  { key: "social", label: "Social Media" },
  { key: "videos_ia", label: "Vídeos com IA" },
  { key: "edicao_video", label: "Edição de Vídeo" },
  { key: "design", label: "Design / Branding" },
  { key: "copywriting", label: "Copywriting" },
  { key: "seo", label: "SEO" },
  { key: "email_marketing", label: "E-mail Marketing" },
  { key: "automacao", label: "Automação" },
  { key: "site", label: "Site / Landing Page" },
  { key: "relatorios", label: "Relatórios" },
  { key: "cobranca", label: "Cobrança" },
];

const NON_RECURRING_TYPES = ["automation", "site", "landing_page", "event", "other"];
const NON_RECURRING_SERVICE_KEYS = ["automacao", "site"];

const CLIENT_STATUS_OPTIONS = [
  { value: "onboarding", label: "Em Andamento", color: "bg-warning" },
  { value: "active", label: "Ativo", color: "bg-success" },
  { value: "inactive", label: "Inativo", color: "bg-muted-foreground" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  client: any;
}

export default function EditClientDrawer({ open, onClose, client }: Props) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [planName, setPlanName] = useState("");
  const [planValue, setPlanValue] = useState("");
  const [planStatus, setPlanStatus] = useState("active");
  const [clientPassword, setClientPassword] = useState("");
  const [showStoredPw, setShowStoredPw] = useState(false);
  const [services, setServices] = useState<Record<string, boolean>>({});
  const [renewalDate, setRenewalDate] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Payment management state
  const [payCreateForProject, setPayCreateForProject] = useState<string | null>(null);
  const [payTotal, setPayTotal] = useState("");
  const [payEntryPct, setPayEntryPct] = useState("50");
  const [payInstCount, setPayInstCount] = useState("1");
  const [payNotes, setPayNotes] = useState("");
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [markPaidId, setMarkPaidId] = useState<string | null>(null);

  // Fetch client's briefing
  const { data: clientBriefing } = useQuery({
    queryKey: ["client-briefing", client?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("briefings")
        .select("*")
        .eq("client_id", client.id)
        .eq("submitted", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!client?.id,
  });

  // Fetch non-recurring projects with payments (always query, regardless of services_config)
  const { data: nonRecurringProjects } = useQuery({
    queryKey: ["client-nonrecurring-projects", client?.id],
    queryFn: async () => {
      const { data: projects } = await supabase
        .from("projects")
        .select("id, name, project_type")
        .eq("client_id", client.id)
        .is("deleted_at", null)
        .in("project_type", NON_RECURRING_TYPES);
      if (!projects?.length) return [];

      const { data: payments } = await supabase
        .from("project_payments")
        .select("*, installments:payment_installments(*)")
        .in("project_id", projects.map(p => p.id));

      return projects.map(p => ({
        ...p,
        payment: (payments || []).find((pay: any) => pay.project_id === p.id) || null,
      }));
    },
    enabled: !!client?.id,
  });

  // Executive summary queries
  const { data: clientProjects } = useQuery({
    queryKey: ["client-exec-projects", client?.id],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name, status, progress, project_type, deadline")
        .eq("client_id", client.id).is("deleted_at", null).order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!client?.id,
  });

  const clientProjectIds = (clientProjects || []).map((p: any) => p.id);

  const { data: clientTasks } = useQuery({
    queryKey: ["client-exec-tasks", client?.id, clientProjectIds.join(",")],
    queryFn: async () => {
      if (!clientProjectIds.length) return [];
      const { data } = await supabase.from("tasks").select("id, status, priority")
        .in("project_id", clientProjectIds).is("deleted_at", null);
      return data || [];
    },
    enabled: !!client?.id && clientProjectIds.length > 0,
  });

  const { data: clientFiles } = useQuery({
    queryKey: ["client-exec-files", client?.id],
    queryFn: async () => {
      const { data } = await supabase.from("files").select("id, approval_status, created_at")
        .eq("client_id", client.id).order("created_at", { ascending: false }).limit(20);
      return data || [];
    },
    enabled: !!client?.id,
  });

  const { data: clientReports } = useQuery({
    queryKey: ["client-exec-reports", client?.id],
    queryFn: async () => {
      if (!clientProjectIds.length) return [];
      const { data } = await supabase.from("reports").select("id, status")
        .in("project_id", clientProjectIds);
      return data || [];
    },
    enabled: !!client?.id && clientProjectIds.length > 0,
  });

  const { data: clientBilling } = useQuery({
    queryKey: ["client-exec-billing", client?.id],
    queryFn: async () => {
      const { data } = await supabase.from("billing").select("id, status, amount, due_date")
        .eq("client_id", client.id);
      return data || [];
    },
    enabled: !!client?.id,
  });

  // Compute executive metrics
  const execActiveProjects = (clientProjects || []).filter((p: any) => p.status !== "done").length;
  const execOpenTasks = (clientTasks || []).filter((t: any) => t.status !== "done").length;
  const execUrgentTasks = (clientTasks || []).filter((t: any) => (t.priority === "urgent" || t.priority === "high") && t.status !== "done").length;
  const execPendingFiles = (clientFiles || []).filter((f: any) => f.approval_status === "pending").length;
  const execPublishedReports = (clientReports || []).filter((r: any) => r.status === "published").length;
  const execPendingBills = (clientBilling || []).filter((b: any) => b.status === "pending").length;
  const execOverdueBills = (clientBilling || []).filter((b: any) => b.status === "pending" && new Date(b.due_date) < new Date()).length;
  useEffect(() => {
    if (client) {
      setFullName(client.full_name || "");
      setCompany(client.company_name || "");
      setEmail(client.email || "");
      setPhone(client.phone || "");
      setPlanName((client as any).plan_name || "");
      setPlanValue((client as any).plan_value != null ? String((client as any).plan_value) : "");
      setPlanStatus(client.plan_status || "active");
      setRenewalDate(client.plan_renewal_date || "");
      setServices(client.services_config || {});
      setClientPassword("");
      setAvatarUrl(client.avatar_url || "");
    }
  }, [client]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !client) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Arquivo deve ter no máximo 5MB"); return; }
    setUploadingAvatar(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${client.id}/avatar.${ext}`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = `${publicUrl}?t=${Date.now()}`;
      await supabase.from("profiles").update({ avatar_url: url }).eq("id", client.id);
      setAvatarUrl(url);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Logo atualizada!");
    } catch (err: any) { toast.error(err.message || "Erro ao enviar logo"); }
    setUploadingAvatar(false);
  };

  if (!open || !client) return null;

  const toggleService = (key: string) => {
    setServices((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    if (!fullName.trim() || !company.trim()) {
      toast.error("Preencha nome e empresa");
      return;
    }
    if (clientPassword && clientPassword.length < 6) {
      toast.error("Senha deve ter no mínimo 6 caracteres");
      return;
    }
    setSaving(true);
    try {
      const planChanged = (planName.trim() || "") !== (client.plan_name || "");
      const oldServices = client.services_config || {};
      const servicesChanged = JSON.stringify(services) !== JSON.stringify(oldServices);

      const updatePayload: any = {
        full_name: fullName.trim(),
        company_name: company.trim(),
        phone: phone.trim() || null,
        plan_status: planStatus,
        services_config: services,
      };

      // Only admin can change plan name and renewal date
      if (isAdmin) {
        updatePayload.plan_name = planName.trim() || null;
        updatePayload.plan_value = planValue ? parseFloat(planValue) : null;
        updatePayload.plan_renewal_date = renewalDate || null;
      }

      const { error } = await supabase.from("profiles").update(updatePayload).eq("id", client.id);
      if (error) throw error;

      // Notify client about plan/service changes
      if (isAdmin && planChanged && planName.trim()) {
        await notifyUser(client.id, `Seu plano foi atualizado para "${planName.trim()}"`, "project", "/dashboard");
      }
      if (servicesChanged) {
        const LABELS: Record<string, string> = { trafego: "Tráfego Pago", social: "Social Media", videos_ia: "Vídeos com IA", edicao_video: "Edição de Vídeo", design: "Design / Branding", copywriting: "Copywriting", seo: "SEO", email_marketing: "E-mail Marketing", automacao: "Automação", site: "Site / Landing Page", relatorios: "Relatórios", cobranca: "Cobrança" };
        const added = Object.keys(services).filter(k => services[k] && !oldServices[k]).map(k => LABELS[k] || k);
        const removed = Object.keys(oldServices).filter(k => oldServices[k] && !services[k]).map(k => LABELS[k] || k);
        if (added.length) await notifyUser(client.id, `Serviços ativados: ${added.join(", ")}`, "project", "/dashboard");
        if (removed.length) await notifyUser(client.id, `Serviços desativados: ${removed.join(", ")}`, "project", "/dashboard");
      }

      // Update password if provided (admin only)
      if (isAdmin && clientPassword) {
        const res = await supabase.functions.invoke("manage-team", {
          body: { action: "update_password", user_id: client.id, password: clientPassword },
        });
        if (res.error) throw new Error(res.error.message || "Erro ao alterar senha");
        if (res.data?.error) throw new Error(res.data.error);
        // Store plaintext so admin can view it later + clear any pending first-access
        await supabase.from("profiles").update({
          portal_password: clientPassword,
          first_access_token: null,
          first_access_used_at: new Date().toISOString(),
        }).eq("id", client.id);
        toast.success("Senha do cliente alterada!");
      }

      toast.success("Cliente atualizado!");
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setClientPassword("");
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      const res = await supabase.functions.invoke("manage-team", {
        body: { action: "delete", user_id: client.id },
      });
      if (res.error) throw new Error(res.error.message || "Erro ao excluir");
      if (res.data?.error) throw new Error(res.data.error);

      toast.success("Cliente excluído com sucesso!");
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setConfirmDelete(false);
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao excluir cliente");
    }
  };

  const handleCreatePayment = async (projectId: string) => {
    const total = parseFloat(payTotal);
    const entryPct = parseFloat(payEntryPct);
    const count = parseInt(payInstCount);
    if (!total || isNaN(entryPct) || !count) return;
    setPaySubmitting(true);
    try {
      const entryAmount = (total * entryPct) / 100;
      const remaining = total - entryAmount;
      const perInstallment = count > 0 ? remaining / count : 0;
      const { data: paymentData, error: paymentError } = await supabase
        .from("project_payments")
        .insert({ project_id: projectId, client_id: client.id, total_value: total, entry_percentage: entryPct, entry_amount: entryAmount, installments_count: count, notes: payNotes.trim() || null, created_by: profile?.id })
        .select().single();
      if (paymentError) throw paymentError;
      const rows: any[] = [{ payment_id: paymentData.id, installment_number: 0, amount: entryAmount, due_date: todayBR(), status: "pending", description: `Entrada (${entryPct}%)` }];
      for (let i = 1; i <= count; i++) {
        const d = new Date(); d.setMonth(d.getMonth() + i);
        rows.push({ payment_id: paymentData.id, installment_number: i, amount: perInstallment, due_date: toBRDateKey(d), status: "pending", description: count === 1 ? "Pagamento na entrega" : `Parcela ${i}/${count}` });
      }

      const { error: instErr } = await supabase.from("payment_installments").insert(rows);
      if (instErr) throw instErr;
      queryClient.invalidateQueries({ queryKey: ["client-nonrecurring-projects"] });
      queryClient.invalidateQueries({ queryKey: ["project-payments"] });
      toast.success("Plano de pagamento criado!");
      setPayCreateForProject(null); setPayTotal(""); setPayEntryPct("50"); setPayInstCount("1"); setPayNotes("");
    } catch (err: any) { toast.error(err.message || "Erro ao criar plano"); }
    setPaySubmitting(false);
  };

  const handleMarkInstallmentPaid = async (installmentId: string) => {
    setPaySubmitting(true);
    try {
      await supabase.from("payment_installments").update({ status: "paid", paid_date: todayBR() }).eq("id", installmentId);
      queryClient.invalidateQueries({ queryKey: ["client-nonrecurring-projects"] });
      toast.success("Pagamento registrado!");
    } catch { toast.error("Erro ao registrar pagamento"); }
    setPaySubmitting(false);
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex justify-end">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-card border-l border-border w-full max-w-[400px] h-full animate-in slide-in-from-right duration-200 flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Editar Cliente</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-1">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
            {/* Avatar upload */}
            <div className="flex items-center gap-4 pb-2">
              <div className="relative group">
                <div className="w-16 h-16 rounded-full overflow-hidden bg-secondary border border-border flex items-center justify-center">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={client.full_name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-lg font-semibold text-primary">
                      {client.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer border-none"
                >
                  {uploadingAvatar ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Camera className="w-4 h-4 text-white" />}
                </button>
                <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{client.company_name || client.full_name}</p>
                <p className="text-[11px] text-muted-foreground">Clique na foto para alterar a logo</p>
              </div>
            </div>
            {/* Executive Summary */}
            {isAdmin && (
              <div className="bg-secondary/50 border border-border rounded-xl p-3.5 space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
                  <Activity className="w-3 h-3" /> Resumo Executivo
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Projetos", value: execActiveProjects, icon: Briefcase, color: "text-primary" },
                    { label: "Tarefas", value: execOpenTasks, icon: ListChecks, color: "text-sky-400", alert: execUrgentTasks > 0 ? `${execUrgentTasks} urgentes` : "" },
                    { label: "Aprovações", value: execPendingFiles, icon: PackageCheck, color: execPendingFiles > 0 ? "text-amber-400" : "text-muted-foreground" },
                    { label: "Relatórios", value: execPublishedReports, icon: BarChart3, color: "text-primary" },
                    { label: "Pendências", value: execPendingBills, icon: DollarSign, color: execPendingBills > 0 ? "text-warning" : "text-muted-foreground" },
                    { label: "Atrasados", value: execOverdueBills, icon: AlertCircle, color: execOverdueBills > 0 ? "text-destructive" : "text-muted-foreground" },
                  ].map((m) => (
                    <div key={m.label} className="text-center py-1.5">
                      <m.icon className={`w-3.5 h-3.5 mx-auto mb-0.5 ${m.color}`} />
                      <p className="text-sm font-mono font-medium text-foreground">{m.value}</p>
                      <p className="text-[9px] text-muted-foreground">{m.label}</p>
                      {"alert" in m && m.alert && <p className="text-[8px] text-destructive">{m.alert}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Status do Cliente */}
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Status do Cliente</label>
              <div className="flex gap-1.5">
                {CLIENT_STATUS_OPTIONS.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setPlanStatus(s.value)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] border transition-colors cursor-pointer ${
                      planStatus === s.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-transparent border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <div className={`w-1.5 h-1.5 rounded-full ${s.color}`} />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Nome Completo</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)}
                className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Empresa</label>
              <input value={company} onChange={(e) => setCompany(e.target.value)}
                className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Email</label>
              <input value={email} disabled
                className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-muted-foreground cursor-not-allowed" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Telefone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors" />
            </div>

            {/* Admin-only fields */}
            {isAdmin && (
              <>
                <div className="space-y-1.5">
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Nome do Plano</label>
                  <input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="Ex: Básico, Pro, Premium"
                    className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Valor do Plano (R$)</label>
                  <input type="number" step="0.01" value={planValue} onChange={(e) => setPlanValue(e.target.value)} placeholder="Ex: 1500.00"
                    className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Data de Vencimento</label>
                  <input type="date" value={renewalDate} onChange={(e) => setRenewalDate(e.target.value)}
                    className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Senha de Acesso</label>
                  {client.portal_password ? (
                    <div className="flex items-center justify-between gap-2 bg-secondary border border-border rounded-[10px] px-3.5 py-2.5">
                      <span className="text-sm font-mono text-foreground truncate">
                        {showStoredPw ? client.portal_password : "••••••••••"}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button type="button" onClick={() => setShowStoredPw(!showStoredPw)}
                          className="text-muted-foreground hover:text-foreground p-1 bg-transparent border-none cursor-pointer">
                          {showStoredPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        <button type="button" onClick={() => { navigator.clipboard.writeText(client.portal_password); toast.success("Senha copiada!"); }}
                          className="text-muted-foreground hover:text-foreground p-1 bg-transparent border-none cursor-pointer">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[12px] text-muted-foreground bg-secondary/60 border border-border rounded-[10px] px-3.5 py-2.5">
                      O cliente ainda não definiu a senha no primeiro acesso. Você pode definir uma abaixo.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Definir / Alterar Senha</label>
                  <input value={clientPassword} onChange={(e) => setClientPassword(e.target.value)} type="text" placeholder="Deixe vazio para manter atual"
                    className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground/60 placeholder:font-sans focus:outline-none focus:border-primary/50 transition-colors" />
                </div>

              </>
            )}

            <div className="pt-2">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3 block">Serviços Ativos</label>
              <div className="space-y-3">
                {SERVICES.map((s) => (
                  <div key={s.key} className="flex items-center justify-between">
                    <span className="text-sm text-foreground">{s.label}</span>
                    <Switch checked={!!services[s.key]} onCheckedChange={() => toggleService(s.key)} />
                  </div>
                ))}
              </div>
            </div>

            {/* Briefing */}
            {clientBriefing && (
              <div className="pt-2">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 block">Briefing</label>
                <button
                  onClick={() => setBriefingOpen(true)}
                  className="inline-flex items-center gap-2 w-full px-4 py-3 rounded-xl text-[13px] text-foreground bg-secondary/70 border border-border hover:border-primary/30 hover:bg-secondary transition-colors cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-primary" />
                  <span className="flex-1 text-left">Ver Diagnóstico Estratégico</span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(clientBriefing.created_at).toLocaleDateString("pt-BR")}
                  </span>
                </button>
              </div>
            )}

            {/* Cofre de Acessos */}
            <div className="pt-2">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <KeyRound className="w-3 h-3" /> Cofre de Acessos
              </label>
              <ClientVault clientId={client.id} canManage={isAdmin || ["design","traffic","manager"].includes(profile?.role || "")} />
            </div>

            {/* Pagamentos de projetos não recorrentes */}
            {isAdmin && nonRecurringProjects && nonRecurringProjects.length > 0 && (
              <div className="pt-2">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 block">
                  <DollarSign className="w-3 h-3 inline mr-1" />Pagamentos de Projetos
                </label>
                <div className="space-y-2">
                  {nonRecurringProjects.map((proj: any) => {
                    const pay = proj.payment;
                    const isExpanded = expandedProject === proj.id;

                    if (!pay) {
                      return (
                        <div key={proj.id} className="rounded-xl bg-secondary/50 border border-border">
                          <div className="px-4 py-3 text-[13px]">
                            <p className="font-medium text-foreground">{proj.name}</p>
                            {payCreateForProject === proj.id ? (
                              <div className="mt-3 space-y-3">
                                <div>
                                  <label className="text-[10px] text-muted-foreground">Valor Total (R$)</label>
                                  <input type="number" placeholder="5000" value={payTotal} onChange={e => setPayTotal(e.target.value)}
                                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground mt-1 focus:outline-none focus:border-primary/50" />
                                </div>
                                <div className="flex gap-2">
                                  <div className="flex-1">
                                    <label className="text-[10px] text-muted-foreground">Entrada (%)</label>
                                    <input type="number" min="0" max="100" value={payEntryPct} onChange={e => setPayEntryPct(e.target.value)}
                                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground mt-1 focus:outline-none focus:border-primary/50" />
                                  </div>
                                  <div className="flex-1">
                                    <label className="text-[10px] text-muted-foreground">Parcelas</label>
                                    <input type="number" min="1" max="24" value={payInstCount} onChange={e => setPayInstCount(e.target.value)}
                                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground mt-1 focus:outline-none focus:border-primary/50" />
                                  </div>
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground">Observações</label>
                                  <input placeholder="Opcional" value={payNotes} onChange={e => setPayNotes(e.target.value)}
                                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground mt-1 focus:outline-none focus:border-primary/50" />
                                </div>
                                {parseFloat(payTotal) > 0 && (
                                  <div className="bg-background rounded-lg p-2 text-[11px] text-muted-foreground space-y-0.5">
                                    <p>Entrada: <strong>R$ {((parseFloat(payTotal) * parseFloat(payEntryPct || "0")) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong> ({payEntryPct}%)</p>
                                    <p>Restante: <strong>{payInstCount}x de R$ {(((parseFloat(payTotal) - (parseFloat(payTotal) * parseFloat(payEntryPct || "0")) / 100) / (parseInt(payInstCount) || 1))).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong></p>
                                  </div>
                                )}
                                <div className="flex gap-2">
                                  <button onClick={() => { setPayCreateForProject(null); setPayTotal(""); setPayEntryPct("50"); setPayInstCount("1"); setPayNotes(""); }}
                                    className="flex-1 px-3 py-1.5 rounded-lg text-[12px] border border-border text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent">Cancelar</button>
                                  <button onClick={() => handleCreatePayment(proj.id)} disabled={paySubmitting || !parseFloat(payTotal)}
                                    className="flex-1 px-3 py-1.5 rounded-lg text-[12px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 border-none">
                                    {paySubmitting ? "Criando..." : "Criar Plano"}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button onClick={() => { setPayCreateForProject(proj.id); setPayTotal(""); setPayEntryPct("50"); setPayInstCount("1"); setPayNotes(""); }}
                                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-primary border border-primary/30 hover:bg-primary/5 transition-colors cursor-pointer bg-transparent">
                                <Plus className="w-3 h-3" /> Criar Plano de Pagamento
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    }

                    const installments = pay.installments || [];
                    const paidTotal = installments.filter((i: any) => i.status === "paid").reduce((sum: number, i: any) => sum + Number(i.amount), 0);
                    const remaining = pay.total_value - paidTotal;
                    const paidCount = installments.filter((i: any) => i.status === "paid").length;
                    const totalCount = installments.length;
                    const hasOverdue = installments.some((i: any) => i.status !== "paid" && new Date(i.due_date) < new Date());

                    return (
                      <div key={proj.id} className="rounded-xl bg-secondary/50 border border-border">
                        <button onClick={() => setExpandedProject(isExpanded ? null : proj.id)}
                          className="w-full px-4 py-3 flex items-center justify-between cursor-pointer bg-transparent border-none text-left">
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-center gap-2">
                              <p className="text-[13px] font-medium text-foreground">{proj.name}</p>
                              {hasOverdue && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive">Atrasado</span>}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                              <span className="text-success">R$ {paidTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                              <span>/</span>
                              <span>R$ {Number(pay.total_value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                              <span className="text-warning">• Falta R$ {remaining.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                              <div className="h-full rounded-full bg-success transition-all" style={{ width: `${pay.total_value > 0 ? Math.round((paidTotal / pay.total_value) * 100) : 0}%` }} />
                            </div>
                          </div>
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0 ml-2" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 ml-2" />}
                        </button>

                        {isExpanded && (
                          <div className="px-4 pb-3 space-y-1.5 border-t border-border pt-2">
                            <p className="text-[10px] text-muted-foreground">{paidCount}/{totalCount} parcelas • Entrada: {pay.entry_percentage}%</p>
                            {installments
                              .sort((a: any, b: any) => a.installment_number - b.installment_number)
                              .map((inst: any) => {
                                const isPaid = inst.status === "paid";
                                const isOverdue = !isPaid && new Date(inst.due_date) < new Date();
                                return (
                                  <div key={inst.id} className="flex items-center gap-2 py-1.5">
                                    <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${isPaid ? "text-success bg-success/10" : isOverdue ? "text-destructive bg-destructive/10" : "text-warning bg-warning/10"}`}>
                                      {isPaid ? <CheckCircle2 className="w-3 h-3" /> : isOverdue ? <AlertCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[12px] text-foreground">{inst.description}</p>
                                      <p className="text-[10px] text-muted-foreground">
                                        {new Date(inst.due_date).toLocaleDateString("pt-BR")}
                                        {inst.paid_date && ` • Pago ${new Date(inst.paid_date).toLocaleDateString("pt-BR")}`}
                                      </p>
                                    </div>
                                    <span className="text-[12px] font-medium text-foreground whitespace-nowrap">R$ {Number(inst.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                                    {!isPaid && (
                                      <button onClick={(e) => { e.stopPropagation(); handleMarkInstallmentPaid(inst.id); }}
                                        disabled={paySubmitting}
                                        className="text-[10px] px-2 py-1 rounded-lg bg-success/10 text-success hover:bg-success/20 transition-colors cursor-pointer border-none whitespace-nowrap">
                                        Pago ✓
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {client.projectCount !== undefined && (
              <div className="pt-2">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 block">Projetos</label>
                <p className="text-sm text-muted-foreground">{client.projectCount} projeto(s) vinculados</p>
              </div>
            )}
          </div>

          <div className="px-5 py-4 border-t border-border flex items-center justify-between">
            {isAdmin ? (
              <button onClick={() => setConfirmDelete(true)} disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-[13px] text-destructive hover:bg-destructive/10 transition-colors cursor-pointer bg-transparent border-none">
                <Trash2 className="w-3.5 h-3.5" />
                Excluir
              </button>
            ) : <div />}
            <div className="flex gap-3">
              <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded-[10px] text-[13px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border border-border">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving} className="px-5 py-2 rounded-[10px] text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 flex items-center gap-2">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {isAdmin && (
        <ConfirmModal
          open={confirmDelete}
          title="Excluir Cliente"
          description={`Tem certeza que deseja excluir "${client.full_name}"? Todos os dados relacionados (projetos, arquivos, cobranças) serão removidos permanentemente.`}
          confirmLabel="Excluir Cliente"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      <BriefingPdfModal
        open={briefingOpen}
        onClose={() => setBriefingOpen(false)}
        briefing={clientBriefing}
        clientName={client.company_name || client.full_name}
      />
    </>
  );
}
