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
 *
 * Celular (< 640 px, 16/10/2026, dono: "muita informação, mais clean"): a
 * linha de apoio (`descricao`) some, as ações ficam numa linha só (rolam por
 * dentro se não couberem, nunca empurram a tela) e o bloco fica mais baixo.
 * Ações com texto usam BotaoComIcone, que vira só ícone no celular.
 */
export default function CabecalhoDePagina({
  titulo,
  descricao,
  acoes,
  ajuda,
  voltar,
  nivel = 1,
  aoLado,
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
  /** Na mesma linha do título, depois do "?" (ex.: abas em ícone). Encolhe e rola antes do título. */
  aoLado?: ReactNode;
  className?: string;
}) {
  const Titulo = nivel === 2 ? "h2" : "h1";
  avisarSeForExplicacao("CabecalhoDePagina", descricao);
  return (
    <div className={juntar("flex min-w-0 justify-between", aoLado && !descricao ? "items-center" : "items-end", className)}>
      {/* Celular com ações: o título fica inteiro até 65% da linha (depois, reticências) e as ações rolam no resto. */}
      <div className={juntar("min-w-[120px] flex-auto", aoLado && !descricao ? "" : "sm:mb-1", acoes && "mr-3 sm:mr-4", acoes && !aoLado && "max-sm:max-w-[65%] max-sm:shrink-0")}>
        {voltar && (
          <Link to={voltar.para} className={juntar("mb-1 inline-flex items-center rounded text-[12px] text-muted-foreground hover:text-foreground", foco)}>
            <ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {voltar.rotulo}
          </Link>
        )}
        <div className="flex min-w-0 items-center">
          <Titulo className={juntar(texto.tituloPagina, "min-w-0 truncate", aoLado && "shrink-0")}>{titulo}</Titulo>
          {ajuda && <AjudaRecolhida className="ml-2">{ajuda}</AjudaRecolhida>}
          {aoLado && <div className="ml-4 flex min-w-0 flex-1 items-center">{aoLado}</div>}
        </div>
        {descricao && <p className={juntar(texto.auxiliar, "mt-1 hidden truncate sm:block")}>{descricao}</p>}
      </div>
      {acoes && (
        <div
          className="scrollbar-hidden -m-1 mb-0 flex min-w-0 flex-1 flex-nowrap items-center justify-start overflow-x-auto overflow-y-hidden overscroll-x-contain sm:min-w-[auto] sm:flex-initial sm:shrink-[5] sm:flex-wrap sm:justify-end sm:overflow-visible [&>*]:m-1 [&>*]:shrink-0 sm:[&>*]:shrink max-sm:[&>*:first-child]:ml-auto"
          data-acoes-do-cabecalho=""
        >
          {acoes}
        </div>
      )}
    </div>
  );
}
