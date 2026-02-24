import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, ArrowRight, Check } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

type Mode = "login" | "signup";

const BULLETS = [
  { icon: "✦", text: "Gestão de projetos em tempo real" },
  { icon: "✦", text: "Aprovações e entregas sem atrito" },
  { icon: "✦", text: "Relatórios automáticos com IA" },
];

export default function Login() {
  const { user, profile, loading, loginWithCredentials, signup } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (!loading && user && profile) {
      navigate("/dashboard", { replace: true });
    }
  }, [loading, user, profile, navigate]);

  if (loading || (user && profile)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
        <div className="w-9 h-9 rounded-[10px] flex items-center justify-center animate-pulse" style={{ background: 'linear-gradient(135deg, #00FF66, #00CC52)' }}>
          <span className="text-base font-bold text-primary-foreground">A</span>
        </div>
        <p className="text-xs text-muted-foreground">{loading ? "Carregando..." : "Redirecionando..."}</p>
      </div>
    );
  }

  const triggerError = (msg: string) => {
    setError(msg);
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setError("");

    if (mode === "signup") {
      if (!fullName.trim()) { triggerError("Informe seu nome completo"); return; }
      if (password.length < 6) { triggerError("A senha deve ter no mínimo 6 caracteres"); return; }
      if (password !== confirmPassword) { triggerError("As senhas não coincidem"); return; }
      setSubmitting(true);
      try {
        await signup(email, password, fullName, company || undefined);
      } catch (err: any) {
        const msg = err.message?.toLowerCase() || "";
        if (msg.includes("already registered") || msg.includes("already exists")) {
          triggerError("Este email já está cadastrado. Tente fazer login.");
          setMode("login");
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
        if (msg.includes("invalid login")) triggerError("Email ou senha incorretos");
        else if (msg.includes("email not confirmed")) triggerError("Confirme seu email antes de entrar");
        else triggerError(err.message || "Erro ao entrar");
      } finally {
        setSubmitting(false);
      }
    }
  };

  const inputCls = "w-full rounded-xl px-[18px] py-[14px] text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none transition-all border";
  const inputStyle = "bg-[#1A1A1A] border-[#2A2A2A] focus:border-primary focus:shadow-[0_0_0_3px_rgba(0,255,102,0.08)]";
  const labelCls = "text-[12px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 block";

  return (
    <div className="relative min-h-screen flex overflow-hidden bg-background">
      {/* LEFT PANEL — Impact */}
      <div className="hidden lg:flex w-[55%] relative items-center justify-center overflow-hidden" style={{ background: '#0D0D0D' }}>
        <div className="grid-perspective" />
        {/* Orb glow */}
        <div className="absolute w-[600px] h-[600px] rounded-full pointer-events-none" style={{
          background: 'radial-gradient(circle, rgba(0,255,102,0.05) 0%, transparent 70%)',
          top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        }} />

        <div className="relative z-10 max-w-md px-12 login-card">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #00FF66, #00CC52)' }}>
              <span className="text-xl font-bold text-primary-foreground">A</span>
            </div>
          </div>
          <h1 className="text-[48px] font-bold text-foreground leading-tight">
            Aceler<span className="text-primary">iq</span>
          </h1>
          <p className="text-muted-foreground text-[16px] tracking-[4px] uppercase mt-1 mb-12">Performance OS</p>

          {/* Bullets */}
          <div className="space-y-5 stagger-bullets">
            {BULLETS.map((b, i) => (
              <div key={i} className="flex items-center gap-3 bullet-item" style={{ animationDelay: `${0.6 + i * 0.3}s` }}>
                <span className="text-primary text-sm">{b.icon}</span>
                <span className="text-foreground text-[14px]">{b.text}</span>
              </div>
            ))}
          </div>

          <p className="text-muted-foreground/40 text-[12px] mt-16">
            Utilizado por +50 empresas que aceleram resultados
          </p>
        </div>
      </div>

      {/* RIGHT PANEL — Form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12" style={{ background: '#121212' }}>
        <div className="w-full max-w-[420px]">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8 login-card">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl mb-3" style={{ background: 'linear-gradient(135deg, #00FF66, #00CC52)' }}>
              <span className="text-lg font-bold text-primary-foreground">A</span>
            </div>
            <h1 className="text-xl font-bold text-foreground">Aceler<span className="text-primary">iq</span></h1>
            <p className="text-muted-foreground text-xs tracking-[3px] uppercase mt-1">Performance OS</p>
          </div>

          <div className={cn("login-form", shake && "animate-shake")}>
            {/* Tabs */}
            <div className="flex gap-6 mb-8 border-b border-border">
              {(["login", "signup"] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setError(""); }}
                  className={cn(
                    "pb-3 text-sm font-medium transition-colors relative bg-transparent border-none cursor-pointer",
                    mode === m ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {m === "login" ? "Entrar" : "Criar Conta"}
                  {mode === m && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-full" />
                  )}
                </button>
              ))}
            </div>

            {/* Header */}
            <div className="mb-8">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #00FF66, #00CC52)' }}>
                <span className="text-sm font-bold text-primary-foreground">A</span>
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-1">
                {mode === "login" ? "Bem-vindo de volta" : "Crie sua conta"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {mode === "login" ? "Acesse sua conta para continuar" : "Configure seu acesso em menos de 1 minuto"}
              </p>
            </div>

            <form onSubmit={handleCredentials} className="space-y-4">
              {mode === "signup" && (
                <>
                  <div>
                    <label className={labelCls}>Nome completo *</label>
                    <input type="text" placeholder="Seu nome completo" value={fullName} onChange={e => setFullName(e.target.value)} className={cn(inputCls, inputStyle)} />
                  </div>
                  <div>
                    <label className={labelCls}>Empresa <span className="text-muted-foreground/40">(opcional)</span></label>
                    <input type="text" placeholder="Nome da empresa" value={company} onChange={e => setCompany(e.target.value)} className={cn(inputCls, inputStyle)} />
                  </div>
                </>
              )}

              <div>
                <label className={labelCls}>{mode === "signup" ? "E-mail corporativo *" : "E-mail"}</label>
                <input type="email" placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" className={cn(inputCls, inputStyle)} />
              </div>

              <div>
                <label className={labelCls}>Senha</label>
                <input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} className={cn(inputCls, inputStyle)} />
              </div>

              {mode === "signup" && (
                <div>
                  <label className={labelCls}>Confirmar senha *</label>
                  <input type="password" placeholder="••••••••" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" className={cn(inputCls, inputStyle)} />
                </div>
              )}

              {mode === "login" && (
                <div className="flex justify-end">
                  <button type="button" className="text-xs text-primary hover:underline bg-transparent border-none cursor-pointer">Esqueceu a senha?</button>
                </div>
              )}

              {error && (
                <p className="text-xs text-destructive text-center py-1">{error}</p>
              )}

              <button
                type="submit"
                disabled={submitting || !email || !password}
                className="w-full flex items-center justify-center gap-2 h-12 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-all cursor-pointer disabled:opacity-40 login-btn btn-interactive"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                {mode === "login" ? "Entrar →" : "Criar minha conta →"}
              </button>
            </form>

            {/* Separator */}
            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">ou</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* Google button placeholder */}
            <button className="w-full flex items-center justify-center gap-2 h-12 rounded-xl border border-border text-sm text-muted-foreground hover:border-primary hover:text-foreground transition-all cursor-pointer bg-transparent">
              <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              Entrar com Google
            </button>

            {/* Switch mode */}
            <p className="text-center text-xs text-muted-foreground mt-6">
              {mode === "login" ? (
                <>Não tem conta?{" "}
                  <button type="button" onClick={() => { setMode("signup"); setError(""); }} className="text-primary hover:underline cursor-pointer bg-transparent border-none p-0">
                    Criar conta
                  </button>
                </>
              ) : (
                <>Já tem conta?{" "}
                  <button type="button" onClick={() => { setMode("login"); setError(""); }} className="text-primary hover:underline cursor-pointer bg-transparent border-none p-0">
                    Entrar
                  </button>
                </>
              )}
            </p>
          </div>

          <p className="text-center text-[11px] text-muted-foreground/30 mt-10">© 2026 Aceleriq</p>
        </div>
      </div>

      <style>{`
        .stagger-bullets .bullet-item {
          opacity: 0;
          animation: fadeInUp 0.5s ease-out forwards;
        }
        @keyframes animate-shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-6px); }
          40%, 80% { transform: translateX(6px); }
        }
        .animate-shake { animation: animate-shake 0.4s ease-out; }
      `}</style>
    </div>
  );
}
