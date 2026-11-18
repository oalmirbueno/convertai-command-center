import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { avisoDaConta, type EstadoDoProduto } from "@/lib/produto/api";
import { EstadoVazio, botao } from "@/components/sistema";

/**
 * A ferramenta existe, mas a empresa não pode usar agora: teste vencido,
 * pagamento em aberto ou ferramenta fora do que foi contratado. Os dados
 * continuam guardados; a tela só diz o que aconteceu e o próximo passo.
 */
export default function SemAcesso({ estado, produto }: { estado: EstadoDoProduto; produto: "crm" | "email" }) {
  const admin = !!estado.eu && estado.eu.papel === "admin";
  const aviso = avisoDaConta(estado);
  const contratado = produto === "crm" ? !!estado.conta && estado.conta.crm_ativo : !!estado.conta && estado.conta.email_ativo;
  const nome = produto === "crm" ? "O CRM" : "O e-mail";
  return (
    <EstadoVazio
      icone={<Lock className="h-5 w-5" aria-hidden="true" />}
      titulo={contratado ? `${nome} está pausado` : `${nome} não faz parte do plano da empresa`}
      descricao={
        contratado
          ? `${aviso ? aviso.texto : "O acesso da empresa não está liberado."} Nada foi apagado.${admin ? "" : " Fale com quem administra a empresa."}`
          : admin ? "Dá para incluir pela Conta." : "Fale com quem administra a empresa."
      }
      acao={admin ? <Link to="/app/conta?parte=plano" className={botao.primario}>Ver a assinatura</Link> : undefined}
    />
  );
}
