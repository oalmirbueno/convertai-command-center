import { useState } from "react";
import { X, Loader2, Copy, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { fireWebhook, webhooks } from "@/lib/webhooks";

function generatePassword(len = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#";
  return Array.from(crypto.getRandomValues(new Uint8Array(len)))
    .map((b) => chars[b % chars.length])
    .join("");
}

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
}

export default function CreateClientModal({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [services, setServices] = useState<Record<string, boolean>>({});
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [createdSuccess, setCreatedSuccess] = useState(false);

  if (!open) return null;

  const toggleService = (key: string) => {
    setServices((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const reset = () => {
    setFullName(""); setCompany(""); setEmail(""); setPhone("");
    setServices({});
    setGeneratedPassword("");
    setCreatedSuccess(false);
    setShowPassword(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const copyPassword = () => {
    navigator.clipboard.writeText(generatedPassword);
    toast.success("Senha copiada!");
  };

  const handleSave = async () => {
    if (!fullName.trim() || !company.trim() || !email.trim()) {
      toast.error("Preencha nome, empresa e email");
      return;
    }
    setSaving(true);
    try {
      const password = generatePassword();
      const { data: currentSession } = await supabase.auth.getSession();

      const { data: signupData, error: signupErr } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: fullName.trim(), role: "client", company_name: company.trim() } },
      });

      if (signupErr) {
        if (signupErr.message?.includes("already registered")) {
          toast.error("Este email já está cadastrado");
        } else {
          toast.error(signupErr.message);
        }
        setSaving(false);
        return;
      }

      if (signupData?.user) {
        await supabase.from("profiles").update({
          phone: phone.trim() || null,
          company_name: company.trim(),
          services_config: services,
        }).eq("id", signupData.user.id);
      }

      if (currentSession?.session) {
        await supabase.auth.setSession({
          access_token: currentSession.session.access_token,
          refresh_token: currentSession.session.refresh_token,
        });
      }

      setGeneratedPassword(password);
      setCreatedSuccess(true);
      queryClient.invalidateQueries({ queryKey: ["clients"] });

      // Fire webhook (fire and forget)
      if (signupData?.user) {
        fireWebhook(webhooks.onboardClient, {
          client_id: signupData.user.id,
          name: fullName.trim(),
          email: email.trim(),
          company: company.trim(),
          phone: phone.trim() || '',
          services: services,
          send_welcome_email: true,
        });
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar cliente");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-[520px] mx-4 animate-in fade-in zoom-in-[0.96] duration-200" style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">
            {createdSuccess ? "Cliente Criado" : "Novo Cliente"}
          </h2>
          <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {createdSuccess ? (
          <>
            <div className="px-6 py-6 space-y-5">
              <div className="text-center space-y-1">
                <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-3">
                  <span className="text-success text-xl">✓</span>
                </div>
                <p className="text-sm font-semibold text-foreground">{fullName}</p>
                <p className="text-xs text-muted-foreground">{email}</p>
              </div>

              <div className="bg-secondary border border-border rounded-xl p-4 space-y-3">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Credenciais de Acesso</p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Email</span>
                    <span className="text-sm font-mono text-foreground">{email}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Senha</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-mono text-foreground">
                        {showPassword ? generatedPassword : "••••••••••"}
                      </span>
                      <button onClick={() => setShowPassword(!showPassword)}
                        className="text-muted-foreground hover:text-foreground p-1 bg-transparent border-none cursor-pointer">
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={copyPassword}
                        className="text-muted-foreground hover:text-foreground p-1 bg-transparent border-none cursor-pointer">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
                Envie essas credenciais ao cliente. A senha pode ser alterada depois pelo admin ou pelo próprio cliente.
              </p>
            </div>

            <div className="px-6 py-4 border-t border-border flex justify-end">
              <button onClick={handleClose}
                className="px-5 py-2 rounded-[10px] text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer">
                Fechar
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Nome Completo *</label>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nome do cliente"
                  className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Empresa *</label>
                <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Nome da empresa"
                  className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Email *</label>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="email@empresa.com"
                    className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Telefone</label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000"
                    className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
                </div>
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
            </div>

            <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
              <button onClick={handleClose} disabled={saving} className="px-4 py-2 rounded-[10px] text-[13px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border border-border">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving} className="px-5 py-2 rounded-[10px] text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 flex items-center gap-2">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {saving ? "Criando..." : "Criar Cliente"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
