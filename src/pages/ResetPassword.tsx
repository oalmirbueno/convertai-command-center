import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import aceleriqLogo from "@/assets/logo-aceleriq.png";

/**
 * Página de destino do link "Esqueci minha senha" (recuperação do Supabase Auth).
 * O SDK processa o token do link e cria a sessão; aqui o usuário define a nova
 * senha e segue direto para o painel.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setHasSession(Boolean(data.session));
      setReady(true);
    };
    check();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setHasSession(Boolean(session));
      setReady(true);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const submit = async () => {
    if (password.length < 8) { toast.error("A senha precisa ter pelo menos 8 caracteres"); return; }
    if (password !== confirm) { toast.error("As senhas não conferem"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Senha definida com sucesso! Bem-vindo ao painel.");
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      toast.error(err.message || "Não foi possível definir a senha. Peça um novo link.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl p-6 space-y-4">
        <img src={aceleriqLogo} alt="Aceleriq" className="h-8 mx-auto" />
        <div className="text-center">
          <h1 className="text-lg font-semibold text-foreground">Definir nova senha</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {hasSession
              ? "Crie a senha que você vai usar para acessar o painel."
              : ready
                ? "Link inválido ou expirado. Volte ao login e peça um novo link de recuperação."
                : "Validando o link de recuperação..."}
          </p>
        </div>
        {hasSession && (
          <div className="space-y-3">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Nova senha (mínimo 8 caracteres)"
              autoComplete="new-password"
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50"
            />
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirmar a nova senha"
              autoComplete="new-password"
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50"
            />
            <button
              onClick={submit}
              disabled={saving}
              className="w-full py-2.5 rounded-[10px] text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
            >
              {saving ? "Salvando..." : "Salvar senha e entrar"}
            </button>
          </div>
        )}
        {!hasSession && ready && (
          <button
            onClick={() => navigate("/login", { replace: true })}
            className="w-full py-2.5 rounded-[10px] text-[13px] bg-secondary text-foreground border border-border cursor-pointer"
          >
            Voltar ao login
          </button>
        )}
      </div>
    </div>
  );
}
