import { Link } from "react-router-dom";
import { KanbanSquare, Mail } from "lucide-react";
import { useProduto } from "@/hooks/useProduto";
import { botao, juntar, texto } from "@/components/sistema";

/**
 * O caminho para o produto CRM e E-mail, em destaque, para quem tem empresa
 * nele. Aparece no painel do cliente e na área de membros: são lugares
 * separados, e este é o atalho de um para o outro. Quem não tem não vê nada.
 */
export default function AtalhoDoProduto({ className = "" }: { className?: string }) {
  const produto = useProduto();
  const estado = produto.data;
  if (!estado || !estado.conta) return null;
  const conta = estado.conta;
  return (
    <div className={juntar("flex min-w-0 flex-wrap items-center rounded-lg bg-primary/[0.07] px-3 py-2", className)} data-atalho-do-produto="">
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
