import { useInRouterContext, useSearchParams } from "react-router-dom";
import { Briefcase } from "lucide-react";
import { BotaoComCusto } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { modeloEfetivo, partesDoAgenteSenior, type EscolhaDoModelo } from "./agenteSeniorApi";
import { deixarPlanoParaOAgente } from "./ponteDoAgente";

/**
 * "Enviar ao agente sênior de tráfego" (dono, 27/09: "quando manda pro plano
 * de teste ter a opção enviar ao agente sênior e ali ele já assumir e deixar
 * top"). Um clique: o plano vai para a aba Conta e o agente sênior assume
 * sozinho (lê o plano e a conta, monta a campanha na Meta com os criativos
 * aprovados, tudo pausado, e deixa o Confirmar para ativar). O clique é a
 * ordem de montar; ativar continua com o Confirmar. O custo é o de uma
 * mensagem do agente, com o modelo escolhido para o cliente.
 */

function ComRoteador({ planoId, nome }: { planoId: string; nome: string }) {
  const [params, setParams] = useSearchParams();
  return (
    <Botao
      planoId={planoId}
      nome={nome}
      ir={() => {
        const next = new URLSearchParams(params);
        next.set("etapa", "conta");
        next.set("plano", planoId);
        next.delete("criativo");
        setParams(next);
      }}
    />
  );
}

function SemRoteador({ planoId, nome }: { planoId: string; nome: string }) {
  return (
    <Botao
      planoId={planoId}
      nome={nome}
      ir={() => {
        try {
          const next = new URLSearchParams(window.location.search);
          next.set("etapa", "conta");
          window.location.search = next.toString();
        } catch {
          /* sem endereço: o plano fica guardado e o agente assume ao abrir a aba Conta */
        }
      }}
    />
  );
}

function Botao({ planoId, nome, ir }: { planoId: string; nome: string; ir: () => void }) {
  const { clientId, catalogo } = useMesa();
  const [escolha] = useEstadoDaTela<EscolhaDoModelo>(`mesa-ads:agente-senior:modelo:${clientId}`, { modelo: "", raciocinio: "" }, { esperaMs: 0 });
  const efetivo = modeloEfetivo(catalogo, escolha);
  return (
    <BotaoComCusto
      rotulo={<><Briefcase className="mr-1 h-3.5 w-3.5" /> Enviar ao agente sênior</>}
      titulo="Enviar ao agente sênior de tráfego"
      descricao="Ele assume o plano: lê a conta, monta a campanha na Meta com os criativos aprovados, tudo pausado, e deixa o Confirmar para você ativar."
      partes={() => partesDoAgenteSenior(catalogo, false, efetivo)}
      fecharAoConfirmar
      className="h-9"
      executar={async () => {
        deixarPlanoParaOAgente(clientId, planoId, nome);
        ir();
        return null;
      }}
    />
  );
}

export default function EnviarAoAgenteSenior({ plano }: { plano: { id: string; nome: string } }) {
  const noRoteador = useInRouterContext();
  return noRoteador ? <ComRoteador planoId={plano.id} nome={plano.nome} /> : <SemRoteador planoId={plano.id} nome={plano.nome} />;
}
