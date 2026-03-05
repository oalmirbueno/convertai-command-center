import { useState, useEffect, useRef } from "react";
import { X, Loader2, Trash2, FileText, Camera, DollarSign, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { notifyUser } from "@/lib/notifyHelpers";
import BriefingPdfModal from "@/components/briefing/BriefingPdfModal";

const SERVICES = [
  { key: "trafego", label: "Tráfego Pago" },
  { key: "social", label: "Social Media" },
  { key: "automacao", label: "Automação" },
  { key: "site", label: "Site / Landing Page" },
  { key: "relatorios", label: "Relatórios" },
  { key: "cobranca", label: "Cobrança" },
];

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
  const [services, setServices] = useState<Record<string, boolean>>({});
  const [renewalDate, setRenewalDate] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

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
        const LABELS: Record<string, string> = { trafego: "Tráfego Pago", social: "Social Media", automacao: "Automação", site: "Site / Landing Page", relatorios: "Relatórios", cobranca: "Cobrança" };
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
        if (res.data?.error) throw new Error(res.data.error);
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
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Nova Senha</label>
                  <input value={clientPassword} onChange={(e) => setClientPassword(e.target.value)} type="password" placeholder="Deixe vazio para manter atual"
                    className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
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
