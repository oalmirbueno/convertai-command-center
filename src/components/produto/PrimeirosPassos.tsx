import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { aceitarConvite, fraseDoErro, recusarConvite, type EstadoDoProduto } from "@/lib/produto/api";
import { useRelerProduto } from "@/hooks/useProduto";
import { EstadoVazio, botao, juntar, texto } from "@/components/sistema";
import OnboardingDoProduto from "./OnboardingDoProduto";

/**
 * Quem entrou no produto e ainda não tem empresa passa pela chegada (ramo,
 * objetivo, empresa e funil) e vira a pessoa que administra. Quem foi
 * convidado e não confirmou o e-mail vê o que falta. O admin da casa ganha o
 * atalho para administrar o produto.
 */
export default function PrimeirosPassos({ estado }: { estado: EstadoDoProduto }) {
  const reler = useRelerProduto();
  const navigate = useNavigate();
  const [decidindo, setDecidindo] = useState(false);

  // O convite só vale se a pessoa aceitar: ninguém entra numa empresa sem querer.
  if (estado.convite) {
    const decidir = async (aceitar: boolean) => {
      setDecidindo(true);
      try {
        if (aceitar) await aceitarConvite();
        else await recusarConvite();
        await reler();
        toast.success(aceitar ? `Bem-vindo à ${estado.convite ? estado.convite.conta : "empresa"}.` : "Convite recusado.");
      } catch (e) {
        toast.error(fraseDoErro(e, "Não foi possível concluir. Confirme o seu e-mail e tente de novo."));
      } finally {
        setDecidindo(false);
      }
    };
    return (
      <EstadoVazio
        titulo={`Você foi convidado para ${estado.convite.conta}`}
        descricao={estado.convite.papel === "admin" ? "Para administrar a empresa no CRM." : "Para usar o CRM com a equipe."}
        acao={
          <div className="flex flex-wrap items-center justify-center">
            <button type="button" className={juntar(botao.secundario, "m-1")} onClick={() => void decidir(false)} disabled={decidindo} data-recusar-convite="">Recusar</button>
            <button type="button" className={juntar(botao.primario, "m-1")} onClick={() => void decidir(true)} disabled={decidindo} data-aceitar-convite="">Aceitar e entrar</button>
          </div>
        }
      />
    );
  }

  return (
    <div className="min-w-0" data-primeiros-passos="">
      <OnboardingDoProduto modo="logado" testeDias={estado.teste_dias} aoCriar={(destino) => navigate(destino, { replace: true })} />
      {estado.dono_da_casa && (
        <p className={`${texto.auxiliar} mx-auto mt-2 max-w-[560px] text-center`}>
          Você administra a Aceleriq. Para criar a empresa de um cliente, use{" "}
          <Link to="/produto" className="font-medium text-primary hover:underline">Administrar o produto</Link>.
        </p>
      )}
    </div>
  );
}
