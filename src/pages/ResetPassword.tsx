import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { CampoDeFormulario, GrupoDeCampos, botao, juntar } from "@/components/sistema";
import CascaPublica, { CampoDeSenha } from "@/components/publico/CascaPublica";

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
  const [showPw, setShowPw] = useState(false);
  // Erro no lugar do apoio do campo em que ele aconteceu.
  const [erro, setErro] = useState<{ campo: "senha" | "confirmar"; texto: string } | null>(null);

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

  const submit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErro(null);
    if (password.length < 8) { setErro({ campo: "senha", texto: "A senha precisa ter pelo menos 8 caracteres." }); return; }
    if (password !== confirm) { setErro({ campo: "confirmar", texto: "As senhas não conferem." }); return; }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Senha definida. Bem-vindo ao painel.");
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      setErro({ campo: "confirmar", texto: err.message || "Não foi possível definir a senha. Peça um novo link." });
    } finally {
      setSaving(false);
    }
  };

  if (!hasSession) {
    return (
      <CascaPublica
        titulo={ready ? "Link inválido ou expirado" : "Nova senha"}
        descricao={ready ? "Volte ao login e peça um novo link." : "Validando o link de recuperação..."}
      >
        {ready && (
          <div>
            <button type="button" onClick={() => navigate("/login", { replace: true })} className={botao.primario}>
              Voltar ao login
            </button>
          </div>
        )}
      </CascaPublica>
    );
  }

  return (
    <CascaPublica titulo="Nova senha" descricao="Crie a senha que você vai usar no painel.">
      <form onSubmit={submit}>
        <GrupoDeCampos colunas={1}>
          <CampoDeFormulario rotulo="Nova senha" apoio="Mínimo 8 caracteres." erro={erro && erro.campo === "senha" ? erro.texto : undefined}>
            <CampoDeSenha
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              autoComplete="new-password"
              autoFocus
              mostrar={showPw}
              aoAlternar={() => setShowPw((v) => !v)}
            />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Confirmar a senha" erro={erro && erro.campo === "confirmar" ? erro.texto : undefined}>
            <CampoDeSenha
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repita a senha"
              autoComplete="new-password"
              mostrar={showPw}
              aoAlternar={() => setShowPw((v) => !v)}
            />
          </CampoDeFormulario>
        </GrupoDeCampos>
        <button type="submit" disabled={saving} className={juntar(botao.primario, "mt-6 w-full")}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {saving ? "Salvando..." : "Salvar senha e entrar"}
        </button>
      </form>
    </CascaPublica>
  );
}
