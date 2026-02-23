import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Shield, User } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-background">
      <div className="grid-perspective" />

      <div className="relative z-10 w-full max-w-sm px-6 animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-[10px] bg-primary mb-4">
            <span className="text-base font-bold text-primary-foreground">C</span>
          </div>
          <h1 className="text-lg font-semibold text-foreground">ConvertAI</h1>
          <p className="text-xs text-muted-foreground tracking-widest uppercase mt-1">Client Execution OS</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl bg-card p-8" style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
          <div className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Email</label>
              <input
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
                className="w-full bg-secondary border border-transparent rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors"
              />
            </div>

            <div className="pt-2 space-y-2.5">
              <button
                onClick={() => login("admin")}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-[10px] bg-primary text-primary-foreground text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer"
              >
                <Shield className="w-3.5 h-3.5" />
                Entrar como Admin
              </button>
              <button
                onClick={() => login("client")}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-[10px] bg-transparent border border-border text-muted-foreground text-[13px] font-medium hover:text-foreground hover:border-muted-foreground/50 transition-colors cursor-pointer"
              >
                <User className="w-3.5 h-3.5" />
                Entrar como Cliente
              </button>
            </div>
          </div>
        </div>

        <p className="text-center text-[11px] text-muted-foreground/40 mt-8">
          © 2026 ConvertAI
        </p>
      </div>
    </div>
  );
}
