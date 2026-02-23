import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Shield, User, Loader2, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

type Mode = "login" | "signup";

export default function Login() {
  const { user, profile, loading, login, loginWithCredentials, signup } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Redirect when authenticated - ALWAYS via useEffect, never in render
  useEffect(() => {
    if (!loading && user && profile) {
      navigate("/dashboard", { replace: true });
    }
  }, [loading, user, profile, navigate]);

  // Show loading spinner while checking auth
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
        <div className="w-9 h-9 rounded-[10px] bg-primary flex items-center justify-center animate-pulse">
          <span className="text-base font-bold text-primary-foreground">C</span>
        </div>
        <p className="text-xs text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  // If already authenticated, show loading while redirect happens
  if (user && profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
        <div className="w-9 h-9 rounded-[10px] bg-primary flex items-center justify-center animate-pulse">
          <span className="text-base font-bold text-primary-foreground">C</span>
        </div>
        <p className="text-xs text-muted-foreground">Redirecionando...</p>
      </div>
    );
  }

  const handleDemoLogin = async (role: "admin" | "client") => {
    setSubmitting(true);
    setError("");
    try {
      await login(role);
    } catch (err: any) {
      console.error("[Login] Demo login error:", err);
      setError(err.message || "Erro ao entrar");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setError("");

    if (mode === "signup") {
      if (!fullName.trim()) {
        setError("Informe seu nome completo");
        return;
      }
      if (password.length < 6) {
        setError("A senha deve ter no mínimo 6 caracteres");
        return;
      }
      setSubmitting(true);
      try {
        await signup(email, password, fullName, company || undefined);
      } catch (err: any) {
        console.error("[Login] Signup error:", err);
        const msg = err.message?.toLowerCase() || "";
        if (msg.includes("already registered") || msg.includes("already exists")) {
          setError("Este email já está cadastrado. Tente fazer login.");
          setMode("login");
        } else {
          setError(err.message || "Erro ao criar conta");
        }
      } finally {
        setSubmitting(false);
      }
    } else {
      setSubmitting(true);
      try {
        await loginWithCredentials(email, password);
      } catch (err: any) {
        console.error("[Login] Credentials error:", err);
        const msg = err.message?.toLowerCase() || "";
        if (msg.includes("invalid login")) {
          setError("Email ou senha incorretos");
        } else if (msg.includes("email not confirmed")) {
          setError("Confirme seu email antes de entrar");
        } else {
          setError(err.message || "Erro ao entrar");
        }
      } finally {
        setSubmitting(false);
      }
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-background">
      <div className="grid-perspective" />

      <div className="relative z-10 w-full max-w-sm px-6 animate-fade-in">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-[10px] bg-primary mb-4">
            <span className="text-base font-bold text-primary-foreground">C</span>
          </div>
          <h1 className="text-lg font-semibold text-foreground">ConvertAI</h1>
          <p className="text-xs text-muted-foreground tracking-widest uppercase mt-1">Client Execution OS</p>
        </div>

        <div className="rounded-2xl bg-card p-8" style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
          <form onSubmit={handleCredentials} className="space-y-5">
            {mode === "signup" && (
              <>
                <div className="space-y-1.5">
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Nome Completo</label>
                  <input
                    type="text"
                    placeholder="Seu nome"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full bg-secondary border border-transparent rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Empresa <span className="text-muted-foreground/40">(opcional)</span></label>
                  <input
                    type="text"
                    placeholder="Nome da empresa"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    className="w-full bg-secondary border border-transparent rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors"
                  />
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Email</label>
              <input
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="w-full bg-secondary border border-transparent rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Senha</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className="w-full bg-secondary border border-transparent rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors"
              />
            </div>

            {error && (
              <p className="text-xs text-destructive text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting || !email || !password}
              className="w-full flex items-center justify-center gap-2 h-10 rounded-[10px] bg-primary text-primary-foreground text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
              {mode === "login" ? "Entrar" : "Criar Conta"}
            </button>

            <p className="text-center text-[12px] text-muted-foreground">
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

            <div className="pt-2 space-y-2.5">
              <p className="text-[11px] text-center text-muted-foreground/50 uppercase tracking-wider">Acesso rápido para teste</p>
              <button
                type="button"
                onClick={() => handleDemoLogin("admin")}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-[10px] bg-primary text-primary-foreground text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
                Entrar como Admin
              </button>
              <button
                type="button"
                onClick={() => handleDemoLogin("client")}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-[10px] bg-transparent border border-border text-muted-foreground text-[13px] font-medium hover:text-foreground hover:border-muted-foreground/50 transition-colors cursor-pointer disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <User className="w-3.5 h-3.5" />}
                Entrar como Cliente
              </button>
            </div>
          </form>
        </div>

        <p className="text-center text-[11px] text-muted-foreground/40 mt-8">© 2026 ConvertAI</p>
      </div>
    </div>
  );
}
