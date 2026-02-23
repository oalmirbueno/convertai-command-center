import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Label } from "@/components/ui/label";
import { Shield, User } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-background">
      {/* Grid perspective background */}
      <div className="grid-perspective" />

      {/* Subtle radial glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_50%_50%,hsl(249_76%_64%/0.06),transparent)]" />

      <div className="relative z-10 w-full max-w-sm px-6 animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-accent mb-5 pulse-glow">
            <span className="text-2xl font-bold text-primary-foreground">C</span>
          </div>
          <h1 className="text-xl font-medium tracking-[0.12em] uppercase text-foreground">
            Convert<span className="text-gradient">AI</span>
          </h1>
          <p className="label-mc mt-2 opacity-40">Client Execution OS</p>
        </div>

        {/* Form Card — no border, deep shadow + glass */}
        <div className="glass rounded-2xl p-8" style={{ boxShadow: '0 25px 60px rgba(0,0,0,0.5)' }}>
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="label-mc">Email</Label>
              <input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-transparent border-0 border-b border-border/30 pb-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary transition-colors"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="label-mc">Senha</Label>
              <input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-transparent border-0 border-b border-border/30 pb-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            <div className="pt-4">
              <p className="label-mc text-center mb-4 opacity-30">Acesso rápido</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => login("admin")}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 hover:border-primary/40 transition-all cursor-pointer"
                >
                  <Shield className="w-3.5 h-3.5" />
                  Admin
                </button>
                <button
                  onClick={() => login("client")}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 hover:border-accent/40 transition-all cursor-pointer"
                >
                  <User className="w-3.5 h-3.5" />
                  Cliente
                </button>
              </div>
            </div>
          </div>
        </div>

        <p className="text-center label-mc mt-8 opacity-20">
          © 2026 ConvertAI
        </p>
      </div>
    </div>
  );
}
