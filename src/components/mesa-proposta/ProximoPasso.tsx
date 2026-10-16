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
      {/* 16/10/2026: só ícone (nome no aria-label e no title). */}
      {proxima && (
        <button type="button" className={destaque && !acao ? juntar(botao.primario, "w-9 px-0") : botao.icone} onClick={() => irPara(proxima)} data-seguir-para={proxima} aria-label={`Seguir para ${rotuloDaEtapa(proxima)}`} title={`Seguir para ${rotuloDaEtapa(proxima)}`}>
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
