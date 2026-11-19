import { Link } from "react-router-dom";
import { KanbanSquare, Mail } from "lucide-react";
import { useProduto } from "@/hooks/useProduto";
import { botao, juntar, texto } from "@/components/sistema";
import { useTrocaDeAcesso } from "./TrocaDeAcesso";

/**
 * O caminho para o produto CRM e E-mail, em destaque, para quem tem empresa
 * nele. Aparece no painel do cliente e na área de membros: são lugares
 * separados, e este é o atalho de um para o outro. Quem não tem não vê nada.
 *
 * 18/11/2026: o login geral do painel não é usuário do CRM. Quando a empresa
 * tem CRM e quem está no painel é o login geral, o atalho explica que cada
 * pessoa entra com o próprio usuário e leva ao login do CRM.
 */
export default function AtalhoDoProduto({ className = "" }: { className?: string }) {
  const produto = useProduto();
  const troca = useTrocaDeAcesso();
  const estado = produto.data;
  if (!estado) return null;
  if (!estado.conta && estado.crm_da_empresa) {
    return (
      <div className={juntar("flex min-w-0 flex-wrap items-center rounded-lg bg-muted px-3 py-2", className)} data-atalho-do-produto="login-do-crm">
        <span className="mr-3 min-w-0 flex-1">
          <span className={juntar(texto.corpo, "block truncate font-medium")}>{estado.crm_da_empresa.nome} tem CRM</span>
          <span className={juntar(texto.auxiliar, "block truncate")}>Cada pessoa entra no CRM com o próprio usuário.</span>
        </span>
        <button type="button" className={juntar(botao.primario, "h-8")} onClick={() => troca.abrir("crm")} data-atalho="entrar-no-crm">
          <KanbanSquare className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Entrar no CRM
        </button>
        {troca.janela}
      </div>
    );
  }
  if (!estado.conta) return null;
  const conta = estado.conta;
  return (
    <div className={juntar("flex min-w-0 flex-wrap items-center rounded-lg bg-muted px-3 py-2", className)} data-atalho-do-produto="">
      <p className={juntar(texto.corpo, "mr-3 min-w-0 flex-1 truncate font-medium")}>{conta.nome}</p>
      {conta.crm_ativo && (
        <Link to="/app/crm" className={juntar(botao.primario, "h-8")} data-atalho="crm">
          <KanbanSquare className="mr-1.5 h-4 w-4" aria-hidden="true" />
          CRM
        </Link>
      )}
      <Link to="/app/email" className={juntar(conta.crm_ativo ? botao.secundario : botao.primario, "ml-2 h-8")} data-atalho="email">
        <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" />
        E-mail
      </Link>
    </div>
  );
}
