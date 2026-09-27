import { useEffect, useRef } from "react";
import { useInRouterContext, useNavigate } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { caminhoSeguro, type CaminhoDoAgente } from "@/lib/agentes/acoesDoAgente";

/**
 * O caminho que o agente deixa quando termina (pedido do dono, 27/09: "quando
 * termina ele dá o caminho pra mim apertar e ir e já fica tudo certinho"):
 * um botão "Ir para ..." que abre a área com o estado certo. Com
 * `abrirSozinho`, vai sozinho uma vez (pedido "faz e me leva"). Qualquer
 * agente usa: no CartaoDeAcao depois de feito, ou solto depois da resposta.
 */
export default function CaminhoPronto({ caminho, abrirSozinho = false, className = "" }: { caminho: CaminhoDoAgente | null | undefined; abrirSozinho?: boolean; className?: string }) {
  const c = caminhoSeguro(caminho);
  const noRoteador = useInRouterContext();
  return c ? <BotaoDoCaminho caminho={c} abrirSozinho={abrirSozinho} noRoteador={noRoteador} className={className} /> : null;
}

function BotaoDoCaminho({ caminho, abrirSozinho, noRoteador, className }: { caminho: CaminhoDoAgente; abrirSozinho: boolean; noRoteador: boolean; className: string }) {
  const ir = noRoteador ? <IrComRoteador caminho={caminho} abrirSozinho={abrirSozinho} className={className} /> : <IrSemRoteador caminho={caminho} abrirSozinho={abrirSozinho} className={className} />;
  return ir;
}

function IrComRoteador(p: { caminho: CaminhoDoAgente; abrirSozinho: boolean; className: string }) {
  const navigate = useNavigate();
  return <Botao {...p} ir={() => navigate(p.caminho.destino)} />;
}

function IrSemRoteador(p: { caminho: CaminhoDoAgente; abrirSozinho: boolean; className: string }) {
  return <Botao {...p} ir={() => window.location.assign(p.caminho.destino)} />;
}

function Botao({ caminho, abrirSozinho, className, ir }: { caminho: CaminhoDoAgente; abrirSozinho: boolean; className: string; ir: () => void }) {
  const foi = useRef(false);
  useEffect(() => {
    if (abrirSozinho && !foi.current) {
      foi.current = true;
      ir();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirSozinho, caminho.destino]);
  return (
    <Button type="button" size="sm" className={`mb-1 mr-1.5 h-8 ${className}`} onClick={ir} data-caminho-do-agente={caminho.destino}>
      {caminho.rotulo} <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
    </Button>
  );
}
