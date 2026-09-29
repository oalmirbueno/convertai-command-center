import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChevronRight, Moon, Palette, Shield, Sun, User } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import NotificationsPanel from "@/components/NotificationsPanel";
import DadosDaAgencia from "@/components/agencia/DadosDaAgencia";
import { CabecalhoDePagina, SeletorCompacto, foco, juntar, texto } from "@/components/sistema";

/**
 * Configurações: uma lista limpa, uma linha por assunto (ícone, título curto e
 * a ação à direita). Tema no segmentado; Perfil e Segurança abrem o perfil
 * (onde a senha muda); Notificações abre o painel de avisos.
 */

function IconeDaLinha({ children }: { children: ReactNode }) {
  return (
    <span className="mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground" aria-hidden="true">
      {children}
    </span>
  );
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const linhas = [
    { icon: User, label: "Perfil", apoio: "Nome, empresa e foto", action: () => navigate("/perfil") },
    { icon: Bell, label: "Notificações", apoio: "Avisos e atualizações", action: () => setNotificationsOpen(true) },
    { icon: Shield, label: "Segurança", apoio: "Senha, no perfil", action: () => navigate("/perfil") },
  ];

  return (
    <div className="min-w-0 space-y-5">
      <CabecalhoDePagina titulo="Configurações" ajuda="Tema do painel, avisos, perfil, senha e os dados da agência." />

      <ul className="max-w-3xl divide-y divide-border border-y border-border">
        <li className="flex min-w-0 items-center py-3">
          <IconeDaLinha>
            <Palette className="h-4 w-4" />
          </IconeDaLinha>
          <span className={juntar(texto.corpo, "mr-3 min-w-0 flex-1 truncate font-medium")}>Aparência</span>
          <SeletorCompacto
            rotulo="Tema"
            valor={theme}
            onEscolher={(v) => setTheme(v === "light" ? "light" : "dark")}
            opcoes={[
              { valor: "dark", rotulo: "Escuro", icone: <Moon className="h-3.5 w-3.5" /> },
              { valor: "light", rotulo: "Claro", icone: <Sun className="h-3.5 w-3.5" /> },
            ]}
          />
        </li>
        {linhas.map((s) => (
          <li key={s.label} className="min-w-0">
            <button
              type="button"
              onClick={s.action}
              className={juntar("flex w-full min-w-0 items-center rounded-md py-3 text-left transition-colors hover:bg-muted/50", foco)}
            >
              <IconeDaLinha>
                <s.icon className="h-4 w-4" />
              </IconeDaLinha>
              <span className={juntar(texto.corpo, "mr-3 min-w-0 truncate font-medium")}>{s.label}</span>
              <span className={juntar(texto.auxiliar, "mr-2 hidden min-w-0 flex-1 truncate text-right sm:block")}>{s.apoio}</span>
              <span className="min-w-0 flex-1 sm:hidden" aria-hidden="true" />
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>

      <DadosDaAgencia />

      {notificationsOpen && <NotificationsPanel open={notificationsOpen} onOpenChange={setNotificationsOpen} />}
    </div>
  );
}
