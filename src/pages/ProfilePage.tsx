import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Save, Lock, Camera } from "lucide-react";
import { toast } from "sonner";
import { CabecalhoDePagina, CampoDeFormulario, GrupoDeCampos, Painel, botao, campo, foco, juntar, superficie, texto } from "@/components/sistema";
import { StatusPill } from "@/components/ds";

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

  // O perfil chega depois da primeira pintura: preenche os campos quando ele
  // chega, sem apagar o que a pessoa já começou a digitar.
  useEffect(() => {
    if (!profile) return;
    setFullName((v) => v || profile.full_name || "");
    setCompany((v) => v || profile.company_name || "");
    setAvatarUrl((v) => v || profile.avatar_url || "");
  }, [profile]);

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
      toast.success("Foto atualizada");
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
      toast.success("Perfil atualizado");
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
      toast.success("Senha alterada");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      const raw = (err?.message || "").toLowerCase();
      const code = (err?.code || err?.error_code || "").toLowerCase();
      if (code === "same_password" || raw.includes("different from the old") || raw.includes("should be different")) {
        toast.error("A nova senha precisa ser diferente da senha atual.");
      } else if (raw.includes("weak") || raw.includes("pwned") || raw.includes("compromised")) {
        toast.error("Essa senha é muito fraca ou já vazou. Escolha uma senha mais forte.");
      } else if (raw.includes("session")) {
        toast.error("Sua sessão expirou. Faça login novamente para trocar a senha.");
      } else {
        toast.error(err.message || "Erro ao alterar senha");
      }
    }
    setSavingPassword(false);
  };

  const initials = profile?.full_name?.split(" ").map(n => n[0]).join("").slice(0, 2) || "?";
  const papel = profile?.role === "admin" ? "Administrador" : profile?.role === "client" ? "Cliente" : profile?.role;

  return (
    <div className="min-w-0 space-y-6 sm:space-y-8">
      <CabecalhoDePagina
        titulo="Perfil"
        ajuda="Seus dados de acesso ao painel. O e-mail é o do login e só a equipe Aceleriq pode trocar."
      />

      {/* Rodada ousada (15/11/2026): quem é você no cartão de tinta, com a foto grande; os dados e a senha ao lado. */}
      <div className="grid min-w-0 max-w-5xl grid-cols-1 items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-6">
        <section aria-label="Você" className={juntar(superficie.painel, superficie.tinta, "flex min-w-0 flex-col items-center p-6 text-center sm:p-8")}>
          <div className="relative h-24 w-24 shrink-0">
            <Avatar className="h-full w-full">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={profile?.full_name} />}
              <AvatarFallback className="bg-muted text-[32px] font-semibold text-foreground">{initials}</AvatarFallback>
            </Avatar>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              aria-label="Trocar foto"
              title="Trocar foto"
              className={juntar(
                "toque-compacto absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground transition-transform hover:scale-105",
                foco,
              )}
            >
              {uploadingAvatar ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
          </div>
          <p className="mt-5 max-w-full truncate text-[24px] font-semibold leading-8 tracking-[-0.03em] text-foreground">{profile?.full_name}</p>
          <p className={juntar(texto.auxiliar, "mt-1 max-w-full truncate")}>{profile?.email}</p>
          {papel && <StatusPill tone="success" className="mt-4">{papel}</StatusPill>}
          {profile?.company_name && <p className={juntar(texto.auxiliar, "mt-4 max-w-full truncate")}>{profile.company_name}</p>}
        </section>

        <div className="min-w-0 space-y-5">
        <Painel
          as="section"
          aria-label="Seus dados"
          titulo="Seus dados"
          rodape={
            <button type="button" onClick={handleSave} disabled={saving} className={botao.primario}>
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              {saving ? "Salvando..." : "Salvar"}
            </button>
          }
        >
          <GrupoDeCampos>
            <CampoDeFormulario rotulo="Nome completo" obrigatorio>
              <input value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Empresa">
              <input value={company} onChange={e => setCompany(e.target.value)} autoComplete="organization" className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="E-mail" largo>
              <input value={profile?.email || ""} disabled className={campo} />
            </CampoDeFormulario>
          </GrupoDeCampos>
        </Painel>

        {/* Alterar Senha */}
        <Painel
          as="section"
          aria-label="Senha"
          titulo={
            <span className="inline-flex items-center">
              <Lock className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> Senha
            </span>
          }
          rodape={
            <button type="button" onClick={handleChangePassword} disabled={savingPassword} className={botao.secundario}>
              {savingPassword ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Lock className="mr-1.5 h-3.5 w-3.5" />}
              {savingPassword ? "Salvando..." : "Alterar senha"}
            </button>
          }
        >
          <GrupoDeCampos>
            <CampoDeFormulario rotulo="Nova senha">
              <input value={newPassword} onChange={e => setNewPassword(e.target.value)} type="password" autoComplete="new-password" placeholder="Mínimo 8 caracteres" className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Confirmar nova senha">
              <input value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} type="password" autoComplete="new-password" placeholder="Repita a nova senha" className={campo} />
            </CampoDeFormulario>
          </GrupoDeCampos>
        </Painel>
        </div>
      </div>
    </div>
  );
}
