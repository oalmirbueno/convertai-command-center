import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, ArrowRight, Eye, EyeOff, Check, BarChart3, Zap, Target } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import consultantHero from "@/assets/consultant-hero-flipped.jpg";

type Mode = "login" | "signup";

/* ─── Counter-up hook ─── */
function useCountUp(target: number, duration = 1000, delay = 700) {
  const [val, setVal] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (started.current) return;
      started.current = true;
      const start = performance.now();
      const tick = (now: number) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        setVal(Math.round(target * progress));
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, delay);
    return () => clearTimeout(timer);
  }, [target, duration, delay]);
  return val;
}

/* ─── Password strength ─── */
function getPasswordStrength(pw: string): { level: number; label: string; color: string } {
  if (pw.length < 6) return { level: 0, label: "Muito curta", color: "#FF3B3B" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { level: 33, label: "Fraca", color: "#FF3B3B" };
  if (score <= 2) return { level: 66, label: "Média", color: "#FFB800" };
  return { level: 100, label: "Forte", color: "#00FF66" };
}

export default function Login() {
  const { user, profile, loading, loginWithCredentials, signup } = useAuth();
  const navigate = useNavigate();
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
  const [shake, setShake] = useState(false);

  const empresas = useCountUp(50, 1000, 800);
  const satisfacao = useCountUp(98, 1000, 900);
  const avaliacao = useCountUp(49, 1000, 1000); // 4.9 → animate as 49, display /10

  useEffect(() => {
    if (!loading && user && profile) navigate("/dashboard", { replace: true });
  }, [loading, user, profile, navigate]);

  if (loading || (user && profile)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
        <div className="w-9 h-9 rounded-[10px] flex items-center justify-center animate-pulse" style={{ background: "linear-gradient(135deg, #00FF66, #00CC52)" }}>
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setError("");

    if (mode === "signup") {
      if (!fullName.trim()) { triggerError("Informe seu nome completo"); return; }
      if (password.length < 6) { triggerError("A senha deve ter no mínimo 6 caracteres"); return; }
      if (password !== confirmPassword) { triggerError("As senhas não coincidem"); return; }
      if (!acceptTerms) { triggerError("Aceite os termos para continuar"); return; }
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

  const formatPhone = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  const pwStrength = getPasswordStrength(password);

  const inputCls = "w-full rounded-xl px-[18px] py-[14px] text-sm text-foreground placeholder:text-[#444444] focus:outline-none transition-all border bg-[#1A1A1A] border-[#2A2A2A] focus:border-primary focus:shadow-[0_0_0_3px_rgba(0,255,102,0.08)]";
  const labelCls = "text-[11px] uppercase tracking-[0.5px] text-muted-foreground font-semibold mb-1.5 block";

  return (
    <div className="relative min-h-screen flex overflow-hidden bg-background">
      {/* ═══ LEFT PANEL ═══ */}
      <div className="hidden lg:flex w-[55%] relative overflow-hidden login-left" style={{ background: "#0D0D0D" }}>
        <div className="tech-grid-bg" />
        {/* Orb glow behind person */}
        <div className="absolute w-[500px] h-[500px] rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(0,255,102,0.06) 0%, transparent 70%)", top: "25%", left: "15%", transform: "translate(-50%, -20%)" }} />

        {/* Consultant image — far LEFT, fades to right */}
        <img
          src={consultantHero}
          alt="Consultora Aceleriq"
          className="absolute -left-8 bottom-0 h-[85%] w-auto object-cover object-top pointer-events-none select-none"
          style={{
            maskImage: "linear-gradient(to right, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 85%)",
            WebkitMaskImage: "linear-gradient(to right, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 85%)",
            animation: "fadeIn 1s ease-out 0.3s both",
          }}
        />

        {/* Content — RIGHT column, no overlap with image */}
        <div className="relative z-10 flex flex-col justify-between h-full ml-auto pr-14 pl-6 py-10" style={{ maxWidth: "340px" }}>
          {/* Spacer top */}
          <div />

          {/* Center: Logo + Welcome + Value props */}
          <div className="flex-1 flex flex-col justify-center">
            <div style={{ animation: "fadeInUp 0.5s ease-out 0.2s both" }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, hsl(var(--primary)), hsl(145 100% 32%))" }}>
                  <span className="text-xl font-bold text-primary-foreground">A</span>
                </div>
                <div>
                  <span className="font-bold text-[22px] text-foreground">Aceler<span className="text-primary">iq</span></span>
                  <p className="text-[10px] text-muted-foreground/50 tracking-[3px] uppercase -mt-0.5">Performance OS</p>
                </div>
              </div>
            </div>
            <div style={{ animation: "fadeInUp 0.6s ease-out 0.4s both" }}>
              <h2 className="text-[26px] font-bold text-foreground mb-3 leading-tight">
                Bom te ver<br />por aqui!
              </h2>
              <p className="text-[14px] text-muted-foreground leading-[1.8] mb-8">
                Gerencie projetos, acompanhe entregas e receba relatórios inteligentes — tudo num só lugar.
              </p>
            </div>

            <div className="space-y-5" style={{ animation: "fadeInUp 0.6s ease-out 0.6s both" }}>
              {[
                { Icon: BarChart3, text: "Projetos e entregas em tempo real" },
                { Icon: Zap, text: "Aprovações e feedback sem atrito" },
                { Icon: Target, text: "Estratégias sob medida para você" },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-primary/10">
                    <item.Icon className="w-4 h-4 text-primary" />
                  </div>
                  <span className="text-sm text-foreground/80">{item.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom: Metrics + Copyright */}
          <div style={{ animation: "fadeIn 0.5s ease-out 1s both" }}>
            <div className="flex items-center gap-6 mb-3">
              {[
                { value: `+${empresas}`, label: "empresas" },
                { value: `${satisfacao}%`, label: "satisfação" },
                { value: `${(avaliacao / 10).toFixed(1)}★`, label: "avaliação" },
              ].map((m, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="text-primary text-sm font-bold font-mono">{m.value}</span>
                  <span className="text-[10px] text-muted-foreground/40 uppercase">{m.label}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground/20">© 2026 Aceleriq</p>
          </div>
        </div>
      </div>

      {/* ═══ RIGHT PANEL ═══ */}
      <div className="flex-1 flex items-center justify-center px-6 py-12" style={{ background: "#121212" }}>
        <div className="w-full max-w-[420px]">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-6" style={{ animation: "fadeInUp 0.4s ease-out" }}>
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-[14px] mb-3" style={{ background: "linear-gradient(135deg, #00FF66, #00CC52)" }}>
              <span className="text-xl font-bold text-primary-foreground">A</span>
            </div>
            <h1 className="text-xl font-bold text-foreground">Aceler<span className="text-primary">iq</span></h1>
            <p className="text-muted-foreground text-xs tracking-[3px] uppercase mt-1">Performance OS</p>
          </div>

          <div className={cn("login-card", shake && "animate-shake")}>
            {/* Logo icon desktop */}
            <div className="hidden lg:flex w-12 h-12 rounded-[14px] items-center justify-center mb-7" style={{ background: "#00FF66" }}>
              <span className="text-[22px] font-bold" style={{ color: "#0D0D0D" }}>A</span>
            </div>

            {/* Tabs */}
            <div className="flex gap-8 mb-9">
              {(["login", "signup"] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setError(""); }}
                  className={cn(
                    "pb-3 text-sm font-bold transition-colors relative bg-transparent border-none cursor-pointer",
                    mode === m ? "text-foreground" : "text-muted-foreground/50 hover:text-muted-foreground"
                  )}
                >
                  {m === "login" ? "Entrar" : "Criar Conta"}
                  {mode === m && <span className="absolute bottom-0 left-0 right-0 h-[3px] bg-primary rounded-full" />}
                </button>
              ))}
            </div>

            {/* Header */}
            <div className="mb-8" key={mode} style={{ animation: "fadeIn 0.3s ease-out" }}>
              <h2 className="text-2xl font-bold text-foreground mb-1.5">
                {mode === "login" ? "Bem-vindo de volta" : "Crie sua conta"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {mode === "login" ? "Acesse seu painel para acompanhar seus projetos." : "Acompanhe seus projetos e resultados em tempo real."}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5" key={`form-${mode}`} style={{ animation: "fadeIn 0.3s ease-out" }}>
              {mode === "signup" && (
                <>
                  <div>
                    <label className={labelCls}>Nome completo *</label>
                    <input type="text" placeholder="Como podemos te chamar?" value={fullName} onChange={e => setFullName(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Empresa</label>
                    <input type="text" placeholder="Nome da sua empresa" value={company} onChange={e => setCompany(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Telefone / WhatsApp</label>
                    <input type="tel" placeholder="(00) 00000-0000" value={phone} onChange={e => setPhone(formatPhone(e.target.value))} className={inputCls} />
                  </div>
                </>
              )}

              <div>
                <label className={labelCls}>{mode === "signup" ? "E-mail *" : "E-mail"}</label>
                <input type="email" placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" className={inputCls} />
              </div>

              <div>
                <label className={labelCls}>Senha {mode === "signup" && "*"}</label>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    placeholder={mode === "signup" ? "Mínimo 6 caracteres" : "••••••••"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-primary transition-colors bg-transparent border-none cursor-pointer p-1"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {mode === "signup" && password.length > 0 && (
                  <div className="mt-2">
                    <div className="h-1 rounded-full bg-[#2A2A2A] overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pwStrength.level}%`, background: pwStrength.color }} />
                    </div>
                    <p className="text-[11px] mt-1" style={{ color: pwStrength.color }}>Senha {pwStrength.label.toLowerCase()}</p>
                  </div>
                )}
              </div>

              {mode === "signup" && (
                <div>
                  <label className={labelCls}>Confirmar senha *</label>
                  <div className="relative">
                    <input
                      type={showConfirmPw ? "text" : "password"}
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      className={inputCls}
                    />
                    <button type="button" onClick={() => setShowConfirmPw(!showConfirmPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-primary transition-colors bg-transparent border-none cursor-pointer p-1">
                      {showConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {mode === "login" && (
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <button type="button" onClick={() => setRememberMe(!rememberMe)} className={cn("w-[18px] h-[18px] rounded border-2 flex items-center justify-center shrink-0 transition-all bg-transparent cursor-pointer", rememberMe ? "border-primary bg-primary" : "border-[#2A2A2A]")}>
                      {rememberMe && <Check className="w-3 h-3 text-primary-foreground" />}
                    </button>
                    <span className="text-[13px] text-muted-foreground">Lembrar de mim</span>
                  </label>
                  <button type="button" className="text-[13px] text-primary hover:underline bg-transparent border-none cursor-pointer">Esqueceu a senha?</button>
                </div>
              )}

              {mode === "signup" && (
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <button type="button" onClick={() => setAcceptTerms(!acceptTerms)} className={cn("w-[18px] h-[18px] rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all bg-transparent cursor-pointer", acceptTerms ? "border-primary bg-primary" : "border-[#2A2A2A]")}>
                    {acceptTerms && <Check className="w-3 h-3 text-primary-foreground" />}
                  </button>
                  <span className="text-[13px] text-muted-foreground leading-relaxed">
                    Li e concordo com os{" "}
                    <a href="#" className="text-primary hover:underline">termos de uso</a> e{" "}
                    <a href="#" className="text-primary hover:underline">política de privacidade</a>
                  </span>
                </label>
              )}

              {error && <p className="text-xs text-destructive text-center py-1 animate-fade-in">{error}</p>}

              <button
                type="submit"
                disabled={submitting || !email || !password}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-primary text-primary-foreground text-[15px] font-bold hover:opacity-90 transition-all cursor-pointer disabled:opacity-40 login-btn btn-interactive border-none"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {mode === "login" ? "Entrar" : "Criar minha conta"}
              </button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-[#2A2A2A]" />
              <span className="text-xs text-[#444444]" style={{ background: "#121212", padding: "0 8px" }}>ou</span>
              <div className="flex-1 h-px bg-[#2A2A2A]" />
            </div>

            {/* Google */}
            <button className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl border border-[#2A2A2A] text-sm text-muted-foreground hover:border-primary hover:text-foreground transition-all cursor-pointer bg-transparent">
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continuar com Google
            </button>

            {/* Switch */}
            <p className="text-center text-[13px] text-muted-foreground mt-6">
              {mode === "login" ? (
                <>Não tem conta?{" "}<button type="button" onClick={() => { setMode("signup"); setError(""); }} className="text-primary hover:underline cursor-pointer bg-transparent border-none p-0 font-semibold">Criar conta</button></>
              ) : (
                <>Já tem conta?{" "}<button type="button" onClick={() => { setMode("login"); setError(""); }} className="text-primary hover:underline cursor-pointer bg-transparent border-none p-0 font-semibold">Entrar</button></>
              )}
            </p>

            {/* Mobile metrics */}
            <p className="lg:hidden text-center text-[11px] text-muted-foreground/40 mt-6">
              +50 empresas · 98% satisfação · 4.9★
            </p>
          </div>

          <p className="text-center text-[11px] text-muted-foreground/30 mt-10">© 2026 Aceleriq</p>
        </div>
      </div>

      <style>{`
        .login-left { animation: fadeIn 0.8s ease-out; }
        @keyframes bounceIn { 0%{transform:scale(0);opacity:0} 60%{transform:scale(1.1)} 100%{transform:scale(1);opacity:1} }
        .status-online { animation: statusPulse 2s ease-in-out infinite; }
        @keyframes statusPulse { 0%,100%{box-shadow:0 0 0 0 rgba(0,255,102,0.4)} 50%{box-shadow:0 0 0 6px rgba(0,255,102,0)} }
        .testimonial-card { animation: fadeInUp 0.6s ease-out 0.5s both; }
        .login-card { animation: fadeInUp 0.5s ease-out; }
        .animate-shake { animation: loginShake 0.4s ease-out; }
        @keyframes loginShake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-8px)} 75%{transform:translateX(8px)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes fadeInUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @media (prefers-reduced-motion: reduce) {
          *,*::before,*::after { animation-duration:0.01ms!important; transition-duration:0.01ms!important; }
        }
      `}</style>
    </div>
  );
}
