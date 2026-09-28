import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import AjudaRecolhida, { avisarSeForExplicacao } from "./AjudaRecolhida";
import { foco, juntar, texto } from "./estilos";

/**
 * Cabeçalho de página ou de área: título curto, uma linha de apoio, ajuda
 * recolhida e as ações à direita (um primário no máximo). Sem caixa em volta.
 * Quando falta largura (celular), as ações encolhem primeiro e quebram por
 * dentro até a largura da maior delas; só então o título encolhe (com
 * reticências, nunca abaixo de 120 px). Nada passa da borda.
 */
export default function CabecalhoDePagina({
  titulo,
  descricao,
  acoes,
  ajuda,
  voltar,
  nivel = 1,
  className = "",
}: {
  titulo: ReactNode;
  /** Estado curto em uma linha (ex.: "Montado 26/09 14:10"). Explicação vai em `ajuda` (o "?"). */
  descricao?: ReactNode;
  acoes?: ReactNode;
  /** O que a página faz: vira o "?" ao lado do título. */
  ajuda?: ReactNode;
  /** Link de volta (ex.: { para: "/clientes", rotulo: "Clientes" }). */
  voltar?: { para: string; rotulo: string };
  /** h1 na página; h2 quando a página já tem h1 (dentro de uma mesa). */
  nivel?: 1 | 2;
  className?: string;
}) {
  const Titulo = nivel === 2 ? "h2" : "h1";
  avisarSeForExplicacao("CabecalhoDePagina", descricao);
  return (
    <div className={juntar("flex min-w-0 items-end justify-between", className)}>
      <div className={juntar("mb-1 min-w-[120px] flex-auto", acoes && "mr-4")}>
        {voltar && (
          <Link to={voltar.para} className={juntar("mb-1 inline-flex items-center rounded text-[12px] text-muted-foreground hover:text-foreground", foco)}>
            <ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {voltar.rotulo}
          </Link>
        )}
        <div className="flex min-w-0 items-center">
          <Titulo className={juntar(texto.tituloPagina, "min-w-0 truncate")}>{titulo}</Titulo>
          {ajuda && <AjudaRecolhida className="ml-2">{ajuda}</AjudaRecolhida>}
        </div>
        {descricao && <p className={juntar(texto.auxiliar, "mt-1 truncate")}>{descricao}</p>}
      </div>
      {acoes && <div className="-m-1 mb-0 flex flex-initial shrink-[5] flex-wrap items-center justify-end [&>*]:m-1">{acoes}</div>}
    </div>
  );
}
