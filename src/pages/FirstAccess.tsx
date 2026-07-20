import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Eye, EyeOff, ArrowRight, Check, ShieldCheck, AlertTriangle } from "lucide-react";
import aceleriqLogo from "@/assets/logo-aceleriq.png";

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

type Phase = "loading" | "form" | "invalid" | "used" | "done";

export default function FirstAccess() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { loginWithCredentials } = useAuth();
  const token = params.get("token") || "";

  const [phase, setPhase] = useState<Phase>("loading");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const strength = getPasswordStrength(password);

  useEffect(() => {
    if (!token) {
      setPhase("invalid");
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("client-first-access", {
          body: { action: "validate", token },
        });
        if (error) throw error;
        if (data?.valid) {
          setEmail(data.email || "");
          setName(data.full_name || "");
          setPhase("form");
        } else if (data?.error === "used") {
          setPhase("used");
        } else {
          setPhase("invalid");
        }
      } catch {
        setPhase("invalid");
      }
    })();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("A senha deve ter no mínimo 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("client-first-access", {
        body: { action: "set_password", token, password },
      });
      if (error) throw error;
      if (data?.error) {
        setError(data.message || data.error);
        setSubmitting(false);
        return;
      }
      setPhase("done");
      // Auto-login and redirect
      try {
        await loginWithCredentials(email, password);
        setTimeout(() => navigate("/dashboard", { replace: true }), 1200);
      } catch {
        setTimeout(() => navigate("/login", { replace: true }), 1600);
      }
    } catch (err: any) {
      setError(err.message || "Não foi possível criar a senha. Tente novamente.");
      setSubmitting(false);
    }
  };

  const firstName = name ? name.split(" ")[0] : "";

  return (
    <div className="dark min-h-screen flex flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="flex justify-center mb-8">
          <img src={aceleriqLogo} alt="AcelerIQ" className="h-16 w-auto" />
        </div>

        <div className="bg-card border border-border rounded-2xl p-7" style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.45)" }}>
          {phase === "loading" && (
            <div className="flex flex-col items-center gap-3 py-10">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">Validando seu acesso...</p>
            </div>
          )}

          {phase === "invalid" && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-destructive" />
              </div>
              <h1 className="text-base font-semibold text-foreground">Link inválido ou expirado</h1>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Este link de primeiro acesso não é mais válido. Fale com a equipe AcelerIQ
                para receber um novo, ou faça login se já tiver uma senha.
              </p>
              <button onClick={() => navigate("/login")}
                className="mt-2 text-[13px] font-medium text-primary hover:underline cursor-pointer bg-transparent border-none">
                Ir para o login
              </button>
            </div>
          )}

          {phase === "used" && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center">
                <ShieldCheck className="w-6 h-6 text-warning" />
              </div>
              <h1 className="text-base font-semibold text-foreground">Senha já criada</h1>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Você já definiu sua senha anteriormente. É só fazer login com seu e-mail
                e a senha que escolheu.
              </p>
              <button onClick={() => navigate("/login")}
                className="mt-2 px-5 py-2.5 rounded-[10px] text-[13px] font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer">
                Fazer login
              </button>
            </div>
          )}

          {phase === "done" && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center">
                <Check className="w-6 h-6 text-success" />
              </div>
              <h1 className="text-base font-semibold text-foreground">Tudo pronto!</h1>
              <p className="text-xs text-muted-foreground">Senha criada com sucesso. Entrando no portal...</p>
              <Loader2 className="w-4 h-4 animate-spin text-primary mt-1" />
            </div>
          )}

          {phase === "form" && (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="text-center space-y-1">
                <p className="text-[11px] uppercase tracking-[0.2em] text-primary font-semibold">Primeiro acesso</p>
                <h1 className="text-xl font-semibold text-foreground">
                  {firstName ? `Olá, ${firstName}!` : "Bem-vindo!"}
                </h1>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Crie a senha que você vai usar para entrar no Portal AcelerIQ.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">E-mail de acesso</label>
                <input value={email} disabled
                  className="w-full bg-secondary/60 border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-muted-foreground font-mono" />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Crie sua senha</label>
                <div className="relative">
                  <input value={password} onChange={(e) => setPassword(e.target.value)} type={showPw ? "text" : "password"}
                    placeholder="Mínimo 8 caracteres" autoFocus
                    style={{ fontSize: "16px" }}
                    className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 pr-10 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
                  <button type="button" onClick={() => setShowPw(!showPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer p-0">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {password.length > 0 && (
                  <div className="flex items-center gap-2 pt-1">
                    <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${strength.level}%`, backgroundColor: strength.color }} />
                    </div>
                    <span className="text-[10px]" style={{ color: strength.color }}>{strength.label}</span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Confirme a senha</label>
                <input value={confirm} onChange={(e) => setConfirm(e.target.value)} type={showPw ? "text" : "password"}
                  placeholder="Repita a senha"
                  style={{ fontSize: "16px" }}
                  className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors" />
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}

              <button type="submit" disabled={submitting}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-[10px] text-[14px] font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-60">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Criar senha e entrar <ArrowRight className="w-4 h-4" /></>}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-[11px] text-muted-foreground mt-6">
          AcelerIQ · Performance OS
        </p>
      </div>
    </div>
  );
}
