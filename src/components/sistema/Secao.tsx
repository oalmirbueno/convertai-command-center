import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import AjudaRecolhida from "./AjudaRecolhida";
import { useRecolhido } from "./TituloRecolhivel";
import { foco, juntar, texto } from "./estilos";

/** Título que vira o botão de recolher (Secao com `recolher`). */
export interface RecolherDoCabecalho {
  recolhido: boolean;
  onAlternar: () => void;
  /** Linha curta à vista com o bloco recolhido (ex.: "12 itens"). */
  resumo?: ReactNode;
}

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
  recolher,
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
  /** Estado (descrição) numa linha só, com reticências. O título já é sempre uma linha (28/09). */
  truncar?: boolean;
  /** Ajuste do título (tamanho), somado por cima do padrão do nível. */
  classeDoTitulo?: string;
  /** O título vira o botão de recolher (seta que gira; recolhido, o resumo fica ao lado). */
  recolher?: RecolherDoCabecalho;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  const Titulo = nivel === 3 ? "h3" : "h2";
  const recolhido = !!(recolher && recolher.recolhido);
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
            {titulo && recolher ? (
              <Titulo className={juntar(nivel === 3 ? "text-[13px] font-semibold leading-5 text-foreground" : texto.tituloSecao, "min-w-0", classeDoTitulo)}>
                <button
                  type="button"
                  onClick={recolher.onAlternar}
                  aria-expanded={!recolhido}
                  title={recolhido ? "Mostrar" : "Recolher"}
                  className={juntar("relative -left-1 flex min-w-0 max-w-full items-center rounded-md px-1 py-0.5 text-left hover:bg-muted", foco)}
                  data-titulo-recolhivel=""
                >
                  <ChevronDown className={juntar("mr-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", recolhido ? "-rotate-90" : "")} aria-hidden="true" />
                  {/* 28/09 (dono: "título grande não pode quebrar"): uma linha só, com
                      reticências só quando falta espaço de verdade. O botão se desloca
                      com relative -left-1 e NÃO com margem negativa: a margem tirava
                      4 px da largura medida e o título cortava ("O que enviar e
                      quan...") com a coluna inteira sobrando. */}
                  <span className="min-w-0 truncate">{titulo}</span>
                </button>
              </Titulo>
            ) : titulo ? (
              <Titulo className={juntar(nivel === 3 ? "text-[13px] font-semibold leading-5 text-foreground" : texto.tituloSecao, "min-w-0 truncate", classeDoTitulo)}>
                {titulo}
              </Titulo>
            ) : null}
            {ajuda && !recolhido && (
              <AjudaRecolhida className="ml-1.5" rotulo={rotuloDaAjuda}>
                {ajuda}
              </AjudaRecolhida>
            )}
          </div>
        )}
        {/* Recolhido, o resumo fica EMBAIXO do título (não aperta o título ao lado). */}
        {recolhido && recolher && recolher.resumo ? <p className="mt-0.5 min-w-0 truncate pl-5 text-[12px] text-muted-foreground" data-resumo-recolhido="">{recolher.resumo}</p> : null}
        {descricao && !recolhido && <p className={juntar(texto.auxiliar, "mt-0.5", recolher && "pl-5", truncar && "truncate")}>{descricao}</p>}
      </div>
      {/* Sem min-w-0 de propósito: o grupo nunca fica mais estreito que a maior ação. */}
      {acao && <div className="-m-1 flex flex-initial shrink-[5] flex-wrap items-center justify-end [&>*]:m-1">{acao}</div>}
    </div>
  );
}

/** Cartão da seção: o mesmo fundo, borda e canto do Dossiê da Central. */
const CARTAO = "rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm sm:px-5 sm:py-4";

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
  recolher,
  resumo,
  recolhidaDeInicio = false,
  cartao = false,
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
  /**
   * Chave para recolher a seção (lembrada no navegador; ponha o cliente ou a
   * área nela). Com ela, o título vira o botão de recolher. Precisa de `titulo`.
   */
  recolher?: string;
  /** Linha curta à vista com a seção recolhida ("12 itens"). */
  resumo?: ReactNode;
  /** Começa recolhida enquanto a pessoa não escolheu. */
  recolhidaDeInicio?: boolean;
  /**
   * Seção num cartão (fundo, borda e canto do Dossiê). Para telas em que as
   * seções ficavam soltas no branco (Central, 28/09). Ignora `divisoria`.
   */
  cartao?: boolean;
  children?: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  if (recolher && titulo) {
    return (
      <SecaoRecolhivel
        chave={recolher}
        inicial={recolhidaDeInicio}
        resumo={resumo}
        titulo={titulo}
        descricao={descricao}
        acao={acao}
        ajuda={ajuda}
        divisoria={divisoria}
        cartao={cartao}
        nivel={nivel}
        id={id}
        className={className}
        corpoClassName={corpoClassName}
        resto={resto}
      >
        {children}
      </SecaoRecolhivel>
    );
  }
  const temCabecalho = !!(titulo || descricao || acao);
  return (
    <section id={id} className={juntar("min-w-0", cartao ? CARTAO : divisoria && "border-t border-border pt-5", className)} {...resto}>
      {temCabecalho && <CabecalhoDeSecao className="mb-3" titulo={titulo} descricao={descricao} acao={acao} ajuda={titulo ? ajuda : undefined} nivel={nivel} />}
      <div className={juntar("min-w-0", corpoClassName)}>{children}</div>
    </section>
  );
}

function SecaoRecolhivel({
  chave,
  inicial,
  resumo,
  titulo,
  descricao,
  acao,
  ajuda,
  divisoria,
  cartao,
  nivel,
  id,
  className,
  corpoClassName,
  resto,
  children,
}: {
  chave: string;
  inicial: boolean;
  resumo?: ReactNode;
  titulo: ReactNode;
  descricao?: ReactNode;
  acao?: ReactNode;
  ajuda?: ReactNode;
  divisoria: boolean;
  cartao: boolean;
  nivel: 2 | 3;
  id?: string;
  className: string;
  corpoClassName: string;
  resto: Record<string, string | undefined>;
  children?: ReactNode;
}) {
  const [recolhido, setRecolhido] = useRecolhido(chave, inicial);
  return (
    <section id={id} className={juntar("min-w-0", cartao ? CARTAO : divisoria && "border-t border-border pt-5", className)} data-recolhido={recolhido ? "sim" : "nao"} {...resto}>
      <CabecalhoDeSecao
        className={recolhido ? "" : "mb-3"}
        titulo={titulo}
        descricao={descricao}
        acao={recolhido ? undefined : acao}
        ajuda={ajuda}
        nivel={nivel}
        recolher={{ recolhido, onAlternar: () => setRecolhido(!recolhido), resumo }}
      />
      {!recolhido && <div className={juntar("min-w-0", corpoClassName)}>{children}</div>}
    </section>
  );
}
