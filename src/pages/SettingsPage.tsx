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
    <div className="space-y-6 animate-fade-in max-w-lg w-full">
      <p className="heading-page">Configurações</p>

      {/* Aparência */}
      <div className="space-y-2">
        <p className="label-sm">Aparência</p>
        <div className="bg-card border border-border rounded-xl p-1.5 flex gap-1">
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

      <div className="space-y-2">
        {sections.map((s) => (
          <button
            key={s.label}
            onClick={s.action}
            className="w-full bg-card border border-border rounded-xl px-4 sm:px-5 py-4 flex items-center gap-3 sm:gap-4 hover:border-muted-foreground/30 transition-colors cursor-pointer text-left"
          >
            <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center shrink-0">
              <s.icon className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">{s.label}</p>
              <p className="text-[11px] text-muted-foreground">{s.desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
