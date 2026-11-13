import { Link, useNavigate } from "react-router-dom";
import { type EstadoDoProduto } from "@/lib/produto/api";
import { useRelerProduto } from "@/hooks/useProduto";
import { EstadoVazio, botao, texto } from "@/components/sistema";
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

  if (estado.convite) {
    return (
      <EstadoVazio
        titulo={`Você foi convidado para ${estado.convite.conta}`}
        descricao="Confirme o seu e-mail pelo link que enviamos e entre de novo."
        acao={<button type="button" className={botao.secundario} onClick={() => void reler()}>Já confirmei</button>}
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
