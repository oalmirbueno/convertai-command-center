import { useState, useEffect, useRef } from "react";
import { X, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { notifyUser } from "@/lib/notifyHelpers";

const SERVICES = [
  { key: "trafego", label: "Tráfego Pago" },
  { key: "social", label: "Social Media" },
  { key: "automacao", label: "Automação" },
  { key: "site", label: "Site / Landing Page" },
  { key: "relatorios", label: "Relatórios" },
  { key: "cobranca", label: "Cobrança" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  client: any;
}

export default function EditClientDrawer({ open, onClose, client }: Props) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [planName, setPlanName] = useState("");
  const [services, setServices] = useState<Record<string, boolean>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (client) {
      setFullName(client.full_name || "");
      setCompany(client.company_name || "");
      setEmail(client.email || "");
      setPhone(client.phone || "");
      setPlanName((client as any).plan_name || "");
      setServices(client.services_config || {});
    }
  }, [client]);

  if (!open || !client) return null;

  const toggleService = (key: string) => {
    setServices((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    if (!fullName.trim() || !company.trim()) {
      toast.error("Preencha nome e empresa");
      return;
    }
    setSaving(true);
    try {
      // Detect what changed for notification
      const planChanged = (planName.trim() || "") !== (client.plan_name || "");
      const oldServices = client.services_config || {};
      const servicesChanged = JSON.stringify(services) !== JSON.stringify(oldServices);

      const { error } = await supabase.from("profiles").update({
        full_name: fullName.trim(),
        company_name: company.trim(),
        phone: phone.trim() || null,
        plan_name: planName.trim() || null,
        services_config: services,
      } as any).eq("id", client.id);

      if (error) throw error;

      // Notify client about plan/service changes
      if (planChanged && planName.trim()) {
        await notifyUser(client.id, `Seu plano foi atualizado para "${planName.trim()}"`, "project", "/dashboard");
      }
      if (servicesChanged) {
        const LABELS: Record<string, string> = { trafego: "Tráfego Pago", social: "Social Media", automacao: "Automação", site: "Site / Landing Page", relatorios: "Relatórios", cobranca: "Cobrança" };
        const added = Object.keys(services).filter(k => services[k] && !oldServices[k]).map(k => LABELS[k] || k);
        const removed = Object.keys(oldServices).filter(k => oldServices[k] && !services[k]).map(k => LABELS[k] || k);
        if (added.length) await notifyUser(client.id, `Serviços ativados: ${added.join(", ")}`, "project", "/dashboard");
        if (removed.length) await notifyUser(client.id, `Serviços desativados: ${removed.join(", ")}`, "project", "/dashboard");
      }

      toast.success("Cliente atualizado!");
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error("Sessão expirada");

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
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Nome do Plano</label>
              <input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="Ex: Básico, Pro, Premium"
                className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
            </div>

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

            {client.projectCount !== undefined && (
              <div className="pt-2">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 block">Projetos</label>
                <p className="text-sm text-muted-foreground">{client.projectCount} projeto(s) vinculados</p>
              </div>
            )}
          </div>

          <div className="px-5 py-4 border-t border-border flex items-center justify-between">
            <button onClick={() => setConfirmDelete(true)} disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-[13px] text-destructive hover:bg-destructive/10 transition-colors cursor-pointer bg-transparent border-none">
              <Trash2 className="w-3.5 h-3.5" />
              Excluir
            </button>
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

      <ConfirmModal
        open={confirmDelete}
        title="Excluir Cliente"
        description={`Tem certeza que deseja excluir "${client.full_name}"? Todos os dados relacionados (projetos, arquivos, cobranças) serão removidos permanentemente.`}
        confirmLabel="Excluir Cliente"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
