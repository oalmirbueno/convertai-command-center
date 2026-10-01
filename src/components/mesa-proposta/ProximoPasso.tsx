import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { proximaEtapa, rotuloDaEtapa, type EtapaDaProposta } from "./caminhoDaProposta";
import { useIrParaEtapa } from "./navegacaoDaProposta";

/**
 * O fim de cada etapa da Mesa Proposta (frente PRS, 30/09): uma linha com o
 * próximo passo do caminho, sempre no mesmo lugar. `acao` troca o botão
 * padrão ("Seguir para Revisar") por outro (ex.: "Gerar o rascunho com IA");
 * `estado` é uma linha curta à esquerda ("Falta o preço").
 */
export default function ProximoPasso({ etapa, estado, acao, destaque = true }: { etapa: EtapaDaProposta; estado?: ReactNode; acao?: ReactNode; destaque?: boolean }) {
  const irPara = useIrParaEtapa();
  const proxima = proximaEtapa(etapa);
  if (!proxima && !acao) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end border-t border-border pt-4 [&>*]:mb-2 [&>*]:ml-2" data-proximo-passo={etapa}>
      {estado ? <span className={juntar(texto.auxiliar, "mr-auto min-w-0")}>{estado}</span> : null}
      {acao}
      {proxima && (
        <button type="button" className={destaque && !acao ? botao.primario : botao.secundario} onClick={() => irPara(proxima)} data-seguir-para={proxima}>
          Seguir para {rotuloDaEtapa(proxima)}
          <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
