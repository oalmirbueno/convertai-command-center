import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

export default function ProfilePage() {
  const { user, profile } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [company, setCompany] = useState(profile?.company_name || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!fullName.trim()) { toast.error("Nome é obrigatório"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("profiles").update({
        full_name: fullName.trim(),
        company_name: company.trim() || null,
      }).eq("id", user!.id);
      if (error) throw error;
      toast.success("Perfil atualizado!");
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar");
    }
    setSaving(false);
  };

  const initials = profile?.full_name?.split(" ").map(n => n[0]).join("").slice(0, 2) || "?";

  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-in max-w-lg w-full">
      <p className="heading-page">Meu Perfil</p>

      <div className="bg-card border border-border rounded-xl p-4 sm:p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Avatar className="w-12 h-12 sm:w-16 sm:h-16">
            <AvatarFallback className="bg-primary/15 text-primary text-lg font-semibold">{initials}</AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-medium text-foreground">{profile?.full_name}</p>
            <p className="text-xs text-muted-foreground">{profile?.email}</p>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary mt-1 inline-block">
              {profile?.role === "admin" ? "Administrador" : profile?.role === "client" ? "Cliente" : profile?.role}
            </span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Nome Completo</label>
            <input value={fullName} onChange={e => setFullName(e.target.value)}
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Empresa</label>
            <input value={company} onChange={e => setCompany(e.target.value)}
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Email</label>
            <input value={profile?.email || ""} disabled
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-muted-foreground cursor-not-allowed" />
          </div>
        </div>

        <button onClick={handleSave} disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-[10px] text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 cursor-pointer disabled:opacity-50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </div>
  );
}
