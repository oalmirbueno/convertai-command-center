import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { User, Bell, Shield, Sun, Moon } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function SettingsPage() {
  const { profile } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  const sections = [
    { icon: User, label: "Perfil", desc: "Editar nome, empresa e foto", action: () => navigate("/perfil") },
    { icon: Bell, label: "Notificações", desc: "Preferências de alerta e comunicação", action: () => {} },
    { icon: Shield, label: "Segurança", desc: "Alterar senha e autenticação", action: () => {} },
  ];

  return (
    <div className="-mx-4 flex h-full min-h-0 w-auto flex-col animate-fade-in md:mx-0 md:block md:h-auto md:space-y-6">
      <div className="shrink-0 border-b border-border/60 bg-background/95 px-4 pb-3 backdrop-blur-sm md:border-b-0 md:bg-transparent md:px-0 md:pb-0 md:backdrop-blur-none">
        <p className="heading-page">Configurações</p>
        <p className="text-sm text-muted-foreground mt-1">
          Personalize a experiência, gerencie perfil, notificações e segurança.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-4 md:overflow-visible md:px-0 md:pt-0 md:pb-0">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {/* Aparência */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-3 md:col-span-2 xl:col-span-3">
            <div>
              <p className="text-sm font-medium text-foreground">Aparência</p>
              <p className="text-[11px] text-muted-foreground">Alterne entre tema claro e escuro.</p>
            </div>
            <div className="bg-secondary/40 border border-border rounded-xl p-1.5 flex gap-1 max-w-md">
              <button
                onClick={() => setTheme("dark")}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  theme === "dark"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Moon className="w-4 h-4" />
                Escuro
              </button>
              <button
                onClick={() => setTheme("light")}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  theme === "light"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Sun className="w-4 h-4" />
                Claro
              </button>
            </div>
          </div>

          {/* Sections as cards */}
          {sections.map((s) => (
            <button
              key={s.label}
              onClick={s.action}
              className="group bg-card border border-border rounded-xl p-5 flex flex-col gap-3 hover:border-primary/40 hover:bg-secondary/20 transition-all cursor-pointer text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                <s.icon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{s.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
