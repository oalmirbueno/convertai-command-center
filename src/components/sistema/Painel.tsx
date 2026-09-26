import type { ReactNode } from "react";
import AjudaRecolhida from "./AjudaRecolhida";
import { juntar, superficie, texto } from "./estilos";

/**
 * Painel: a ÚNICA superfície elevada do sistema. Use só quando o bloco
 * precisa se destacar do fundo (um formulário que é o assunto da tela, um
 * cartão de mídia, uma lista que é uma coisa só). Dentro dele, nada de outro
 * cartão: separe por divisória fina ou por um poço (superficie.poco).
 */
export default function Painel({
  titulo,
  descricao,
  acao,
  ajuda,
  rodape,
  semEspaco = false,
  as: Tag = "div",
  className = "",
  children,
  ...resto
}: {
  titulo?: ReactNode;
  /** Estado curto em uma linha; explicação vai num AjudaRecolhida no título. */
  descricao?: ReactNode;
  acao?: ReactNode;
  /** Explicação longa: vira o "?" ao lado do título (some na impressão). */
  ajuda?: ReactNode;
  /** Faixa de baixo, separada por divisória (ações do formulário, totais). */
  rodape?: ReactNode;
  /** Sem espaço interno (lista que encosta nas bordas). */
  semEspaco?: boolean;
  as?: "div" | "section" | "article" | "aside";
  className?: string;
  children?: ReactNode;
} & Record<`data-${string}`, string | undefined> & { "aria-label"?: string }) {
  const temCabecalho = !!(titulo || descricao || acao);
  return (
    <Tag className={juntar(superficie.painel, "min-w-0", className)} {...resto}>
      {temCabecalho && (
        <div className={juntar("flex min-w-0 items-start justify-between", semEspaco ? "border-b border-border px-4 py-3" : "px-4 pt-4 sm:px-5 sm:pt-5")}>
          <div className="mr-3 min-w-0 flex-1">
            {titulo && (
              <div className="flex min-w-0 items-center">
                <h3 className={juntar(texto.tituloSecao, "min-w-0")}>{titulo}</h3>
                {ajuda && <AjudaRecolhida className="no-print ml-1.5">{ajuda}</AjudaRecolhida>}
              </div>
            )}
            {descricao && <p className={juntar(texto.auxiliar, "mt-0.5")}>{descricao}</p>}
          </div>
          {acao && <div className="flex shrink-0 items-center [&>*+*]:ml-2">{acao}</div>}
        </div>
      )}
      <div className={juntar("min-w-0", semEspaco ? "" : temCabecalho ? "px-4 pb-4 pt-3 sm:px-5 sm:pb-5" : "p-4 sm:p-5")}>{children}</div>
      {rodape && <div className="flex min-w-0 flex-wrap items-center justify-end border-t border-border px-4 py-3 sm:px-5 [&>*+*]:ml-2">{rodape}</div>}
    </Tag>
  );
}
