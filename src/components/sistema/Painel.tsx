import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import AjudaRecolhida, { avisarSeForExplicacao } from "./AjudaRecolhida";
import { useChaveDeRecolher, useRecolhido } from "./TituloRecolhivel";
import { foco, juntar, superficie, texto } from "./estilos";

type PropsDoPainel = {
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
  /**
   * Tudo recolhe (28/09): com `titulo` em texto, o painel já nasce recolhível
   * (aberto), com chave automática por rota, cliente e título. Passe a chave
   * para escolher (com o cliente nela) ou `false` para desligar.
   */
  recolher?: string | false;
  /** Linha à vista com o painel recolhido. Sem ela, a `descricao`. */
  resumo?: ReactNode;
  /** Começa recolhido enquanto a pessoa não escolheu. */
  recolhidoDeInicio?: boolean;
  className?: string;
  children?: ReactNode;
} & Record<`data-${string}`, string | undefined> & { "aria-label"?: string };

/**
 * Painel: a ÚNICA superfície elevada do sistema. Use só quando o bloco
 * precisa se destacar do fundo (um formulário que é o assunto da tela, um
 * cartão de mídia, uma lista que é uma coisa só). Nunca para embrulhar uma
 * seção (28/09). Dentro dele, nada de outro cartão: separe por divisória fina
 * ou por um poço (superficie.poco).
 */
export default function Painel(props: PropsDoPainel) {
  const chave = useChaveDeRecolher(props.titulo, props.recolher, "auto-painel");
  if (chave && props.titulo) return <PainelRecolhivel {...props} chave={chave} />;
  return <CorpoDoPainel {...props} />;
}

function PainelRecolhivel(props: PropsDoPainel & { chave: string }) {
  const [recolhido, setRecolhido] = useRecolhido(props.chave, !!props.recolhidoDeInicio);
  return <CorpoDoPainel {...props} recolhido={recolhido} onAlternar={() => setRecolhido(!recolhido)} />;
}

function CorpoDoPainel({
  titulo,
  descricao,
  acao,
  ajuda,
  rodape,
  semEspaco = false,
  as: Tag = "div",
  className = "",
  children,
  recolhido,
  onAlternar,
  resumo,
  // Fora do DOM:
  recolher: _recolher,
  recolhidoDeInicio: _inicio,
  chave: _chave,
  ...resto
}: PropsDoPainel & { recolhido?: boolean; onAlternar?: () => void; chave?: string }) {
  avisarSeForExplicacao("Painel", descricao);
  const recolhivel = !!onAlternar;
  const fechado = recolhivel && !!recolhido;
  const temCabecalho = !!(titulo || descricao || acao);
  const linhaDeBaixo = fechado ? (resumo !== undefined && resumo !== null ? resumo : descricao) : descricao;
  return (
    <Tag className={juntar(superficie.painel, "min-w-0", className)} data-recolhido={recolhivel ? (fechado ? "sim" : "nao") : undefined} {...resto}>
      {temCabecalho && (
        <div className={juntar("flex min-w-0 items-start justify-between", semEspaco || fechado ? "px-4 py-3" : "px-4 pt-4 sm:px-5 sm:pt-5", semEspaco && !fechado && "border-b border-border", fechado && "sm:px-5")}>
          <div className="mr-3 min-w-0 flex-1">
            {titulo && (
              <div className="flex min-w-0 items-center">
                {recolhivel ? (
                  <>
                    {/* Setinha pequena; o título continua título (clicar nele também alterna). relative -left-1, nunca margem negativa. */}
                    <button
                      type="button"
                      onClick={onAlternar}
                      aria-expanded={!fechado}
                      aria-label={fechado ? "Mostrar" : "Recolher"}
                      title={fechado ? "Mostrar" : "Recolher"}
                      className={juntar("toque-compacto relative -left-1 inline-flex h-6 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", foco)}
                      data-recolher-secao=""
                    >
                      <ChevronDown className={juntar("h-4 w-4 transition-transform", fechado ? "-rotate-90" : "")} aria-hidden="true" />
                    </button>
                    <h3 className={juntar(texto.tituloSecao, "min-w-0 cursor-pointer select-none truncate")} onClick={onAlternar}>
                      {titulo}
                    </h3>
                  </>
                ) : (
                  <h3 className={juntar(texto.tituloSecao, "min-w-0 truncate")}>{titulo}</h3>
                )}
                {ajuda && !fechado && <AjudaRecolhida className="no-print ml-1.5">{ajuda}</AjudaRecolhida>}
              </div>
            )}
            {linhaDeBaixo && (
              <p className={juntar(texto.auxiliar, "mt-0.5", recolhivel && "pl-5", fechado && "truncate")} data-resumo-recolhido={fechado ? "" : undefined}>
                {linhaDeBaixo}
              </p>
            )}
          </div>
          {acao && !fechado && <div className="flex shrink-0 items-center [&>*+*]:ml-2">{acao}</div>}
        </div>
      )}
      {!fechado && <div className={juntar("min-w-0", semEspaco ? "" : temCabecalho ? "px-4 pb-4 pt-3 sm:px-5 sm:pb-5" : "p-4 sm:p-5")}>{children}</div>}
      {rodape && !fechado && <div className="flex min-w-0 flex-wrap items-center justify-end border-t border-border px-4 py-3 sm:px-5 [&>*+*]:ml-2">{rodape}</div>}
    </Tag>
  );
}
