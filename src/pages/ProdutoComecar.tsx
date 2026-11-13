import { type CSSProperties } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Moon, Sun } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { botao } from "@/components/sistema";
import OnboardingDoProduto from "@/components/produto/OnboardingDoProduto";
import { lerEscolhaDeCompra } from "@/lib/produto/venda";
import "@/components/produto/produto.css";

/**
 * A chegada ao CRM para quem ainda não tem login (endereço /crm/comecar): as
 * perguntas vêm antes do cadastro. Quem já está logado vai direto ao produto,
 * que mostra a mesma chegada se a pessoa ainda não tiver empresa.
 * Quem vem da página de venda traz o plano e os usuários no endereço
 * (?plano=pro&usuarios=3) e faz o caminho curto: ramo, empresa e acesso.
 */
export default function ProdutoComecar() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { search } = useLocation();
  if (user) return <Navigate to="/app" replace />;
  return (
    <div className="produto-fundo min-h-screen px-4 pb-10 pt-4 text-foreground sm:px-6" style={{} as CSSProperties} data-produto-comecar="">
      <div className="mx-auto flex w-full max-w-[560px] justify-end">
        <button type="button" className={botao.icone} onClick={toggleTheme} aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"} title={theme === "dark" ? "Tema claro" : "Tema escuro"}>
          {theme === "dark" ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      <OnboardingDoProduto modo="publico" inicial={lerEscolhaDeCompra(search)} />
    </div>
  );
}
