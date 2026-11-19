import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, KanbanSquare, Mail } from "lucide-react";
import { useProduto } from "@/hooks/useProduto";
import { juntar, texto } from "@/components/sistema";
import { useTrocaDeAcesso } from "./TrocaDeAcesso";
import { linkDoCorreio } from "@/lib/produto/rotas-do-correio";

/**
 * O acesso rápido do painel ao Correio e ao CRM, em destaque, para quem tem empresa no produto. Aparece no
 * painel do cliente e na área de membros.
 *
 * 19/11/2026 (pedido do dono: "fácil de ir e voltar, sem misturar"): dois cartões, um para cada lugar. O Correio
 * abre com ?de=painel, e o botão de voltar dele traz para o painel. O CRM continua com a sua casa em /app.
 *
 * 18/11/2026: o login geral do painel não é usuário do CRM nem do Correio. Nesse caso o cartão explica que
 * cada pessoa entra com o próprio usuário e passa pela troca de acesso.
 */
export default function AtalhoDoProduto({ className = "" }: { className?: string }) {
  const produto = useProduto();
  const troca = useTrocaDeAcesso();
  const estado = produto.data;
  if (!estado) return null;
  const geral = !estado.conta && !!estado.crm_da_empresa;
  if (!estado.conta && !geral) return null;
  const conta = estado.conta;
  const temCrm = geral || !!(conta && conta.crm_ativo);
  const temEmail = geral || !!(conta && conta.email_ativo);

  const cartao = "group flex min-w-0 flex-1 basis-[260px] items-center rounded-xl border border-border bg-card p-3.5 text-left transition-shadow hover:shadow-md";
  const conteudo = (icone: ReactNode, cor: string, titulo: string, ajuda: string) => (
    <>
      <span className={juntar("mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", cor)} aria-hidden="true">{icone}</span>
      <span className="min-w-0 flex-1">
        <span className={juntar(texto.corpo, "block truncate font-semibold")}>{titulo}</span>
        <span className={juntar(texto.auxiliar, "block truncate")}>{ajuda}</span>
      </span>
      <ArrowRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </>
  );
  const correio = conteudo(<Mail className="h-5 w-5" />, "bg-[#0E4A35] text-[#12E86A]", "Correio", geral ? "Entre com o seu usuário" : "Sua caixa de e-mail");
  const crm = conteudo(<KanbanSquare className="h-5 w-5" />, "bg-primary/10 text-primary", "CRM", geral ? "Entre com o seu usuário" : "Funil, agenda e equipe");

  return (
    <section className={juntar("min-w-0", className)} aria-label="Acesso rápido" data-atalho-do-produto={geral ? "login-do-crm" : ""}>
      <p className={juntar(texto.auxiliar, "mb-2 font-medium")}>Acesso rápido{conta ? ` · ${conta.nome}` : estado.crm_da_empresa ? ` · ${estado.crm_da_empresa.nome}` : ""}</p>
      <div className="flex min-w-0 flex-wrap [&>*]:mb-2 [&>*]:mr-2">
        {temEmail && (geral ? (
          <button type="button" className={cartao} onClick={() => troca.abrir("correio")} data-atalho="correio">{correio}</button>
        ) : (
          <Link to={linkDoCorreio("painel")} className={cartao} data-atalho="correio">{correio}</Link>
        ))}
        {temCrm && (geral ? (
          <button type="button" className={cartao} onClick={() => troca.abrir("crm")} data-atalho="entrar-no-crm">{crm}</button>
        ) : (
          <Link to="/app" className={cartao} data-atalho="crm">{crm}</Link>
        ))}
      </div>
      {troca.janela}
    </section>
  );
}
