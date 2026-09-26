import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { safeInternalPath } from "@/lib/internalNavigation";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CampoDeFormulario, GrupoDeCampos, botao, juntar, texto } from "@/components/sistema";
import { CampoDeSenha, MarcaAceleriq, campoPublico } from "@/components/publico/CascaPublica";
import consultantHero from "@/assets/consultant-hero-flipped.jpg";

type Mode = "login" | "signup";

/** Onde a mensagem de erro aparece: no lugar do apoio do campo, ou acima do botão. */
type CampoDoErro = "nome" | "email" | "senha" | "confirmar" | "termos" | "geral";

/* ─── Password strength ─── */
function getPasswordStrength(pw: string): { level: number; label: string; color: string } {
  if (pw.length < 8) return { level: 0, label: "Muito curta", color: "#FF3B3B" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { level: 33, label: "Fraca", color: "#FF3B3B" };
  if (score <= 2) return { level: 66, label: "Média", color: "#FFB800" };
  return { level: 100, label: "Forte", color: "#00FF66" };
}

/**
 * Máscara da foto: só um degradê nas bordas laterais para a foto se fundir
 * com o fundo. Nada de camada escura por cima (regra do dono: nunca escurecer foto).
 */
/** Caixa de marcar nativa (sem ResizeObserver, roda no Safari 11), no verde da marca. */
const caixaDeMarcar = "h-4 w-4 shrink-0 cursor-pointer rounded-sm accent-primary [color-scheme:dark] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

const MASCARA_DA_FOTO = "linear-gradient(to right, transparent 0%, #000 10%, #000 90%, transparent 100%)";

export default function Login() {
  const { user, profile, loading, loginWithCredentials, signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<CampoDoErro>("geral");

  // O histórico muda antes de uma rota lazy terminar de carregar. Enquanto
  // o login ainda está visível, use o mesmo snapshot do Router: uma nova
  // atualização do perfil não pode perder o next e mandar para o dashboard.
  const next = new URLSearchParams(location.search).get("next");
  const safeNext = safeInternalPath(next) ?? "/dashboard";

  // Quem acabou de criar a senha no primeiro acesso e nao conseguiu entrar
  // sozinho chega aqui com o e-mail ja preenchido e o aviso de que a senha
  // vale. Sem isso a pessoa achava que o cadastro tinha falhado.
  const handoff = (location.state || {}) as { email?: string; passwordJustCreated?: boolean };
  useEffect(() => {
    if (handoff.email) setEmail(handoff.email);
    if (handoff.passwordJustCreated) {
      toast.success("Senha criada. Agora é só entrar com ela.");
    }
    // roda uma vez, na chegada
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading && user && profile) {
      navigate(safeNext, { replace: true });
    }
  }, [loading, user, profile, navigate, safeNext]);

  // Usuário já autenticado mas perfil ainda a caminho conta como carregando:
  // mostrar o formulário nesse instante convidava a um segundo "Entrar" em
  // cima de um login que já tinha dado certo.
  if (loading || user) {
    return (
      <div className="dark flex min-h-screen flex-col items-center justify-center bg-background">
        {/* Espaço reservado para o logo (tamanho fixo): a marca não entra do
            nada quando a imagem termina de baixar e o texto não pula. */}
        <MarcaAceleriq altura={40} />
        <p className={juntar(texto.auxiliar, "mt-4")}>{loading || !profile ? "Carregando..." : "Redirecionando..."}</p>
      </div>
    );
  }

  const triggerError = (msg: string, campo: CampoDoErro = "geral") => {
    setError(msg);
    setErrorField(campo);
  };
  const clearError = () => {
    setError("");
    setErrorField("geral");
  };
  const erroDo = (campo: CampoDoErro) => (error && errorField === campo ? error : undefined);

  const switchMode = (m: Mode) => {
    setMode(m);
    clearError();
  };

  // Um só caminho para "esqueci a senha": o link ao lado de "Lembrar de mim"
  // e o "não recebi o convite" chamam a mesma função.
  const handleForgotPassword = async () => {
    const target = email.trim().toLowerCase();
    if (!target) { triggerError("Digite seu e-mail acima para receber o link de recuperação.", "email"); return; }
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(target, {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    if (resetError) {
      triggerError("Não foi possível enviar o link agora. Tente novamente em instantes.");
      return;
    }
    clearError();
    toast.success("Se este e-mail estiver cadastrado, você receberá um link para definir a senha. Confira a caixa de entrada e o spam.", { duration: 8000 });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    clearError();

    if (mode === "signup") {
      if (!fullName.trim()) { triggerError("Informe seu nome completo", "nome"); return; }
      if (password.length < 8) { triggerError("A senha deve ter no mínimo 8 caracteres", "senha"); return; }
      if (password !== confirmPassword) { triggerError("As senhas não coincidem", "confirmar"); return; }
      if (!acceptTerms) { triggerError("Aceite os termos para continuar", "termos"); return; }
      setSubmitting(true);
      try {
        await signup(
          email,
          password,
          fullName,
          company || undefined,
          phone?.replace(/\D/g, "") || undefined,
          `${window.location.origin}${safeNext}`,
        );
      } catch (err: any) {
        const msg = err.message?.toLowerCase() || "";
        if (msg.includes("already registered") || msg.includes("already exists")) {
          setMode("login");
          triggerError("Este email já está cadastrado. Tente fazer login.", "email");
        } else {
          triggerError(err.message || "Erro ao criar conta");
        }
      } finally {
        setSubmitting(false);
      }
    } else {
      setSubmitting(true);
      try {
        await loginWithCredentials(email, password);
      } catch (err: any) {
        const msg = err.message?.toLowerCase() || "";
        if (msg.includes("invalid login")) triggerError("Email ou senha incorretos", "senha");
        else if (msg.includes("email not confirmed")) triggerError("Confirme seu email antes de entrar", "email");
        else triggerError(err.message || "Erro ao entrar");
      } finally {
        setSubmitting(false);
      }
    }
  };

  const handleGoogleLogin = async () => {
    setSubmitting(true);
    clearError();
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}${safeNext}`,
        },
      });
      if (error) throw error;
    } catch (err: any) {
      triggerError(err.message || "Erro ao continuar com Google");
      setSubmitting(false);
    }
  };

  const formatPhone = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  const pwStrength = getPasswordStrength(password);
  const forcaDaSenha = mode === "signup" && password.length > 0 ? (
    <span className="flex min-w-0 items-center">
      <span className="mr-2 block h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${pwStrength.level}%`, background: pwStrength.color }} />
      </span>
      <span className="shrink-0" style={{ color: pwStrength.color }}>Senha {pwStrength.label.toLowerCase()}</span>
    </span>
  ) : undefined;

  const linkDiscreto = "rounded-sm text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="dark flex min-h-screen w-full overflow-x-hidden bg-background text-foreground">
      {/* Foto do consultor: só no computador, ao lado do formulário. */}
      <div className="relative hidden min-w-0 flex-1 overflow-hidden lg:block" aria-hidden="true">
        <img
          src={consultantHero}
          alt=""
          draggable={false}
          className="pointer-events-none absolute bottom-0 left-1/2 h-full w-auto max-w-none -translate-x-1/2 select-none"
          style={{ maskImage: MASCARA_DA_FOTO, WebkitMaskImage: MASCARA_DA_FOTO }}
        />
      </div>

      {/* Formulário: a tela toda no celular; coluna enxuta no computador. */}
      <main className="flex w-full min-w-0 flex-col px-4 pb-12 pt-10 sm:items-center sm:justify-center sm:px-6 sm:py-16 lg:w-[480px] lg:shrink-0 xl:w-[520px]">
        <div className="w-full min-w-0 sm:max-w-[360px]">
          <MarcaAceleriq altura={32} className="mb-8" />

          <h1 className={texto.tituloPagina}>{mode === "login" ? "Bem-vindo de volta" : "Crie sua conta"}</h1>

          <form onSubmit={handleSubmit} className="mt-6">
            <GrupoDeCampos colunas={1}>
              {mode === "signup" && (
                <>
                  <CampoDeFormulario rotulo="Nome completo" obrigatorio erro={erroDo("nome")}>
                    <input type="text" placeholder="Como podemos te chamar?" value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" className={campoPublico} />
                  </CampoDeFormulario>
                  <CampoDeFormulario rotulo="Empresa">
                    <input type="text" placeholder="Nome da sua empresa" value={company} onChange={e => setCompany(e.target.value)} autoComplete="organization" className={campoPublico} />
                  </CampoDeFormulario>
                  <CampoDeFormulario rotulo="Telefone ou WhatsApp">
                    <input type="tel" inputMode="tel" placeholder="(00) 00000-0000" value={phone} onChange={e => setPhone(formatPhone(e.target.value))} autoComplete="tel" className={campoPublico} />
                  </CampoDeFormulario>
                </>
              )}

              <CampoDeFormulario rotulo="E-mail" obrigatorio={mode === "signup"} erro={erroDo("email")}>
                <input type="email" inputMode="email" placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" className={campoPublico} />
              </CampoDeFormulario>

              <CampoDeFormulario rotulo="Senha" obrigatorio={mode === "signup"} erro={erroDo("senha")} apoio={forcaDaSenha}>
                <CampoDeSenha
                  placeholder={mode === "signup" ? "Mínimo 8 caracteres" : "Sua senha"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  mostrar={showPw}
                  aoAlternar={() => setShowPw(!showPw)}
                />
              </CampoDeFormulario>

              {mode === "signup" && (
                <CampoDeFormulario rotulo="Confirmar senha" obrigatorio erro={erroDo("confirmar")}>
                  <CampoDeSenha
                    placeholder="Repita a senha"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    mostrar={showConfirmPw}
                    aoAlternar={() => setShowConfirmPw(!showConfirmPw)}
                  />
                </CampoDeFormulario>
              )}
            </GrupoDeCampos>

            {mode === "login" && (
              <div className="mt-4 flex min-w-0 items-center justify-between">
                <div className="flex min-w-0 items-center">
                  <input type="checkbox" id="login-lembrar" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className={caixaDeMarcar} />
                  <label htmlFor="login-lembrar" className={juntar(texto.corpo, "ml-2 cursor-pointer select-none text-muted-foreground")}>Lembrar de mim</label>
                </div>
                <button type="button" onClick={() => { void handleForgotPassword(); }} className={juntar(linkDiscreto, "ml-3 shrink-0 text-primary hover:text-primary hover:underline")}>
                  Esqueci a senha
                </button>
              </div>
            )}

            {mode === "signup" && (
              <div className="mt-4 min-w-0">
                <div className="flex min-w-0 items-start">
                  <input type="checkbox" id="login-termos" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} className={juntar(caixaDeMarcar, "mt-0.5")} aria-invalid={(errorField === "termos" && !!error) || undefined} />
                  <label htmlFor="login-termos" className={juntar(texto.corpo, "ml-2 min-w-0 cursor-pointer select-none text-muted-foreground")}>
                    Li e concordo com os{" "}
                    <a href="#" className="text-primary hover:underline">termos de uso</a> e a{" "}
                    <a href="#" className="text-primary hover:underline">política de privacidade</a>
                  </label>
                </div>
                {erroDo("termos") && <p role="alert" className="mt-1.5 text-[12px] leading-4 text-destructive">{error}</p>}
              </div>
            )}

            {erroDo("geral") && <p role="alert" className="mt-4 text-[12px] leading-4 text-destructive [overflow-wrap:anywhere]">{error}</p>}

            <button
              type="submit"
              disabled={submitting || !email || !password}
              className={juntar(botao.primario, "mt-6 w-full")}
            >
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {mode === "login" ? "Entrar" : "Criar minha conta"}
            </button>
          </form>

          <div className="my-5 flex items-center" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            <span className={juntar(texto.auxiliar, "mx-3")}>ou</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <button type="button" disabled={submitting} onClick={handleGoogleLogin} className={juntar(botao.secundario, "w-full")}>
            <svg className="mr-2 h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continuar com Google
          </button>

          {/* Links discretos: trocar de modo e, no login, o convite que não chegou
              (mesmo caminho do "Esqueci a senha": manda o link de definir senha). */}
          <p className={juntar(texto.auxiliar, "mt-6 text-center leading-5")}>
            {mode === "login" ? (
              <>
                <button type="button" onClick={() => switchMode("signup")} className={linkDiscreto}>Criar conta</button>
                <span className="mx-2" aria-hidden="true">·</span>
                <button type="button" onClick={() => { void handleForgotPassword(); }} className={linkDiscreto}>Não recebi o convite</button>
              </>
            ) : (
              <>
                Já tem conta?{" "}
                <button type="button" onClick={() => switchMode("login")} className={juntar(linkDiscreto, "text-primary hover:text-primary hover:underline")}>Entrar</button>
              </>
            )}
          </p>
        </div>
      </main>
    </div>
  );
}
