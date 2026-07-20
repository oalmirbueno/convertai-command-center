import { useState, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Save, Lock, Camera } from "lucide-react";
import { toast } from "sonner";

export default function ProfilePage() {
  const { user, profile } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [company, setCompany] = useState(profile?.company_name || "");
  const [saving, setSaving] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || "");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Arquivo deve ter no máximo 5MB"); return; }
    setUploadingAvatar(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${user.id}/avatar.${ext}`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = `${publicUrl}?t=${Date.now()}`;
      await supabase.from("profiles").update({ avatar_url: url }).eq("id", user.id);
      setAvatarUrl(url);
      toast.success("Foto atualizada!");
    } catch (err: any) { toast.error(err.message || "Erro ao enviar foto"); }
    setUploadingAvatar(false);
  };

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

  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 8) {
      toast.error("A senha deve ter no mínimo 8 caracteres");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("As senhas não coincidem");
      return;
    }
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success("Senha alterada com sucesso!");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      toast.error(err.message || "Erro ao alterar senha");
    }
    setSavingPassword(false);
  };

  const initials = profile?.full_name?.split(" ").map(n => n[0]).join("").slice(0, 2) || "?";

  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-in max-w-lg w-full">
      <p className="heading-page">Meu Perfil</p>

      <div className="bg-card border border-border rounded-xl p-4 sm:p-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="relative group">
            <Avatar className="w-12 h-12 sm:w-16 sm:h-16">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={profile?.full_name} />}
              <AvatarFallback className="bg-primary/15 text-primary text-lg font-semibold">{initials}</AvatarFallback>
            </Avatar>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer border-none"
            >
              {uploadingAvatar ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Camera className="w-4 h-4 text-white" />}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
          </div>
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

      {/* Alterar Senha */}
      <div className="bg-card border border-border rounded-xl p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Alterar Senha</h3>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Nova Senha</label>
            <input value={newPassword} onChange={e => setNewPassword(e.target.value)} type="password" autoComplete="new-password" placeholder="Mínimo 8 caracteres"
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Confirmar Nova Senha</label>
            <input value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} type="password" autoComplete="new-password" placeholder="Repita a nova senha"
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
          </div>
        </div>
        <button onClick={handleChangePassword} disabled={savingPassword}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-[10px] text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 cursor-pointer disabled:opacity-50">
          {savingPassword ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
          {savingPassword ? "Salvando..." : "Alterar Senha"}
        </button>
      </div>
    </div>
  );
}
