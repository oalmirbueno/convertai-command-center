import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import AjudaRecolhida from "./AjudaRecolhida";
import MenuMais, { type ItemDoMenu } from "./MenuMais";
import { espaco, juntar, texto } from "./estilos";

/** Colunas dos controles dentro do grupo (classes inteiras para o Tailwind). */
const GRADE_DOS_CONTROLES: Record<1 | 2 | 3, string> = {
  1: "grid grid-cols-1 gap-2 [&>*]:w-full [&>*]:min-w-0",
  2: "grid grid-cols-2 gap-2 [&>*]:w-full [&>*]:min-w-0",
  3: "grid grid-cols-3 gap-2 [&>*]:w-full [&>*]:min-w-0",
};

/**
 * Grupo de funções (docs/design/SISTEMA.md 4.2, "agrupar antes de empilhar"):
 * título curto numa linha, os controles do grupo alinhados e do mesmo
 * tamanho, e o secundário num "..." ao lado do título. SEM borda e SEM fundo:
 * quem separa os grupos é o espaço (GradeDeGrupos). Dentro de um cartão
 * continua sem caixa.
 *
 * `grade`: os controles numa grade de 1, 2 ou 3 colunas iguais (botões da
 * mesma largura). Sem ela, os controles ficam em linha e quebram por dentro.
 */
export function GrupoDeFuncoes({
  titulo,
  ajuda,
  mais,
  acao,
  grade,
  className = "",
  children,
  ...resto
}: {
  /** Título curto (uma ou duas palavras): "Referência", "Logo", "Gerador". */
  titulo: ReactNode;
  /** Explicação longa: vira o "?" ao lado do título. */
  ajuda?: ReactNode;
  /** O secundário do grupo, no "..." à direita do título. */
  mais?: Array<ItemDoMenu | false | null | undefined>;
  /** Um controle pequeno à direita do título (contador, interruptor). */
  acao?: ReactNode;
  /** Controles numa grade de colunas iguais. */
  grade?: 1 | 2 | 3;
  className?: string;
  children?: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  const id = useId();
  const idDoTitulo = `grupo-${id.replace(/:/g, "")}`;
  const temMais = !!(mais && mais.some(Boolean));
  return (
    <div role="group" aria-labelledby={idDoTitulo} className={juntar("min-w-0", className)} data-grupo-de-funcoes="" {...resto}>
      <div className="mb-2 flex h-8 min-w-0 items-center">
        <h3 id={idDoTitulo} className={juntar(texto.rotulo, "min-w-0 truncate")}>
          {titulo}
        </h3>
        {ajuda && <AjudaRecolhida className="ml-1">{ajuda}</AjudaRecolhida>}
        <span className="min-w-0 flex-1" aria-hidden="true" />
        {acao && <div className="ml-2 flex shrink-0 items-center [&>*+*]:ml-2">{acao}</div>}
        {temMais && <MenuMais itens={mais as Array<ItemDoMenu | false | null | undefined>} rotulo={typeof titulo === "string" ? `Mais em ${titulo}` : "Mais ações"} className="ml-1" />}
      </div>
      <div className={grade ? GRADE_DOS_CONTROLES[grade] : "-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1"}>{children}</div>
    </div>
  );
}

function larguraDe(el: HTMLElement | null): number {
  return el ? el.clientWidth : 0;
}

/**
 * Grade de grupos de funções: os grupos lado a lado, alinhados, com respiro
 * (`espaco.grupos`: 24 px entre colunas, 20 px entre linhas). O número de
 * colunas sai da LARGURA DA CAIXA, não da janela (a direção do Estúdio mora
 * numa coluna estreita numa tela larga): cabe `colunas` grupos de pelo menos
 * `larguraMinima` px. Medido antes da pintura; mede de novo ao redimensionar
 * (ResizeObserver quando o navegador tem; senão o resize da janela).
 */
export function GradeDeGrupos({
  colunas = 2,
  larguraMinima = 240,
  className = "",
  children,
  ...resto
}: {
  /** Máximo de colunas. */
  colunas?: 2 | 3 | 4;
  /** Largura mínima de um grupo (px). */
  larguraMinima?: number;
  className?: string;
  children?: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  const caixa = useRef<HTMLDivElement>(null);
  const [cabem, setCabem] = useState(1);
  const medir = useCallback(() => {
    const largura = larguraDe(caixa.current);
    if (!largura) return;
    // 24 px entre colunas (gap-x-6).
    const n = Math.max(1, Math.min(colunas, Math.floor((largura + 24) / (larguraMinima + 24))));
    setCabem((antes) => (antes === n ? antes : n));
  }, [colunas, larguraMinima]);
  useLayoutEffect(() => {
    medir();
  }, [medir]);
  useEffect(() => {
    const el = caixa.current;
    const RO = typeof window !== "undefined" ? (window as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver : undefined;
    let obs: ResizeObserver | null = null;
    if (RO && el) {
      obs = new RO(() => medir());
      obs.observe(el);
    }
    window.addEventListener("resize", medir);
    return () => {
      window.removeEventListener("resize", medir);
      if (obs) obs.disconnect();
    };
  }, [medir]);
  return (
    <div
      ref={caixa}
      className={juntar(espaco.grupos, "items-start [&>*]:min-w-0", className)}
      style={{ gridTemplateColumns: `repeat(${cabem}, minmax(0, 1fr))` }}
      data-grade-de-grupos=""
      data-colunas={String(cabem)}
      {...resto}
    >
      {children}
    </div>
  );
}

export default GrupoDeFuncoes;
