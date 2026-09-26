import type { ReactNode } from "react";
import AjudaRecolhida from "./AjudaRecolhida";
import { juntar, texto } from "./estilos";

/**
 * Cabeçalho de seção (só o cabeçalho, sem o conteúdo): título curto com o "?"
 * ao lado, uma linha de estado e as ações à direita, na mesma linha.
 *
 * Quando falta largura (celular), as ações encolhem primeiro e quebram POR
 * DENTRO, em mais de uma linha à direita, até a largura da maior delas (o
 * mínimo automático do flex); só então o título encolhe (com reticências,
 * nunca abaixo de 96 px). Nada passa da borda. Espaço entre as ações por
 * margem (Safari 11 não tem gap em flex): -m-1 no grupo e m-1 em cada ação,
 * que também separa as linhas.
 *
 * Usado pela Secao e pelos cabeçalhos das mesas (CabecalhoDaParte da Mesa
 * Ads, CabecalhoDaEtapa da Mesa Publicidade, Cabecalho da Mesa Roteiros).
 */
export function CabecalhoDeSecao({
  titulo,
  descricao,
  acao,
  ajuda,
  rotuloDaAjuda,
  nivel = 2,
  icone,
  truncar = false,
  classeDoTitulo = "",
  className = "",
  ...resto
}: {
  titulo?: ReactNode;
  /** Estado curto em uma linha (contagem, data). Explicação vai em `ajuda`. */
  descricao?: ReactNode;
  /** Ações à direita do título. */
  acao?: ReactNode;
  /** Texto de ajuda longo, recolhido num "?". */
  ajuda?: ReactNode;
  /** Nome do "?" para leitor de tela (padrão "O que é isto?"). */
  rotuloDaAjuda?: string;
  nivel?: 2 | 3;
  /** Ícone pequeno antes do título. */
  icone?: ReactNode;
  /** Título e estado numa linha só, com reticências (em vez de quebrar). */
  truncar?: boolean;
  /** Ajuste do título (tamanho), somado por cima do padrão do nível. */
  classeDoTitulo?: string;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  const Titulo = nivel === 3 ? "h3" : "h2";
  return (
    <div className={juntar("flex min-w-0 items-start", className)} data-cabecalho-de-secao="" {...resto}>
      {/* Título: cresce para ocupar a sobra; as ações encolhem com peso 5 (cedem primeiro). Pesos >= 1: com soma menor que 1 o flex não tira todo o excesso. */}
      <div className={juntar("min-w-[96px] flex-auto", acao && "mr-3")}>
        {(titulo || ajuda) && (
          <div className="flex min-w-0 items-center">
            {icone && (
              <span className="mr-1.5 inline-flex shrink-0 text-primary" aria-hidden="true">
                {icone}
              </span>
            )}
            {titulo && (
              <Titulo className={juntar(nivel === 3 ? "text-[13px] font-semibold leading-5 text-foreground" : texto.tituloSecao, "min-w-0", truncar && "truncate", classeDoTitulo)}>
                {titulo}
              </Titulo>
            )}
            {ajuda && (
              <AjudaRecolhida className="ml-1.5" rotulo={rotuloDaAjuda}>
                {ajuda}
              </AjudaRecolhida>
            )}
          </div>
        )}
        {descricao && <p className={juntar(texto.auxiliar, "mt-0.5", truncar && "truncate")}>{descricao}</p>}
      </div>
      {/* Sem min-w-0 de propósito: o grupo nunca fica mais estreito que a maior ação. */}
      {acao && <div className="-m-1 flex flex-initial shrink-[5] flex-wrap items-center justify-end [&>*]:m-1">{acao}</div>}
    </div>
  );
}

/**
 * Seção: título, uma linha de apoio, ação à direita e o conteúdo, SEM caixa.
 * Seções vizinhas se separam por espaço (e, com `divisoria`, por uma linha
 * fina em cima). Ajuda longa vai em `ajuda` (vira o "?" ao lado do título).
 * No celular as ações quebram por dentro (ver CabecalhoDeSecao).
 */
export default function Secao({
  titulo,
  descricao,
  acao,
  ajuda,
  divisoria = false,
  nivel = 2,
  id,
  className = "",
  corpoClassName = "",
  children,
  ...resto
}: {
  titulo?: ReactNode;
  /** Estado curto em uma linha (contagem, data, "3 de 9 completos"). Explicação NÃO: vai em `ajuda`. */
  descricao?: ReactNode;
  /** Botões à direita do título. */
  acao?: ReactNode;
  /** Texto de ajuda longo, recolhido num "?". */
  ajuda?: ReactNode;
  /** Linha fina em cima (entre seções da mesma página). */
  divisoria?: boolean;
  /** Nível do título (h2 por padrão; h3 dentro de outra seção). */
  nivel?: 2 | 3;
  id?: string;
  className?: string;
  corpoClassName?: string;
  children?: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  const temCabecalho = !!(titulo || descricao || acao);
  return (
    <section id={id} className={juntar("min-w-0", divisoria && "border-t border-border pt-5", className)} {...resto}>
      {temCabecalho && <CabecalhoDeSecao className="mb-3" titulo={titulo} descricao={descricao} acao={acao} ajuda={titulo ? ajuda : undefined} nivel={nivel} />}
      <div className={juntar("min-w-0", corpoClassName)}>{children}</div>
    </section>
  );
}
