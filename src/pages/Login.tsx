import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Zap, Shield, User } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-background grid-bg">
      {/* Orbs */}
      <div className="orb orb-purple w-72 h-72 -top-20 -left-20" />
      <div className="orb orb-green w-56 h-56 bottom-10 right-10" style={{ animationDelay: "3s" }} />
      <div className="orb orb-purple w-40 h-40 top-1/2 right-1/4 opacity-20" style={{ animationDelay: "5s" }} />

      <div className="relative z-10 w-full max-w-md px-6 animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-[hsl(280,76%,64%)] flex items-center justify-center glow-primary">
              <Zap className="w-6 h-6 text-primary-foreground" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Convert<span className="text-gradient">AI</span>
            </h1>
          </div>
          <p className="text-sm font-medium tracking-widest uppercase text-muted-foreground">
            Client Execution OS
          </p>
        </div>

        {/* Form Card */}
        <div className="glass rounded-2xl p-8 glow-sm">
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-muted-foreground text-xs uppercase tracking-wider">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-secondary/50 border-border/50 h-11 rounded-xl focus:ring-primary"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-muted-foreground text-xs uppercase tracking-wider">
                Senha
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-secondary/50 border-border/50 h-11 rounded-xl focus:ring-primary"
              />
            </div>

            <div className="pt-2 space-y-3">
              <p className="text-xs text-muted-foreground text-center mb-3">Acesso rápido para demonstração</p>
              <Button
                onClick={() => login("admin")}
                className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold gap-2"
              >
                <Shield className="w-4 h-4" />
                Entrar como Admin
              </Button>
              <Button
                onClick={() => login("client")}
                variant="outline"
                className="w-full h-11 rounded-xl border-border/50 hover:bg-secondary/80 gap-2"
              >
                <User className="w-4 h-4" />
                Entrar como Cliente
              </Button>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          © 2026 ConvertAI — Todos os direitos reservados
        </p>
      </div>
    </div>
  );
}
