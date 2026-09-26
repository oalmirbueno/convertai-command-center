import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { foco, juntar, superficie, texto } from "./estilos";

/**
 * Faixa de números (docs/design/SISTEMA.md, seção 15): os contadores de uma
 * tela numa superfície só, separados por linhas finas, no lugar de um cartão
 * por número. Unifica as cópias que nasceram no Dashboard, no Comercial, nos
 * Relatórios, nas Métricas e no portal do cliente (frente C, 26/09).
 *
 * - Colunas: 2 no celular e `colunas` (até a quantidade de números) de
 *   1024 px para cima; ou `grade` com as classes exatas.
 * - Linhas: cada célula desenha a borda de cima e da esquerda, e a grade
 *   recua 1 px para esconder as da beirada. Célula que sobra na última linha
 *   fica vazia, sem bloco cinza. Número ímpar no celular: o último ocupa a
 *   linha (só com `colunas`, onde a base é conhecida).
 * - Número que leva a outra tela: `para` (link de verdade: abre em outra aba,
 *   leitor de tela anuncia link). `aoClicar` para ação na própria tela.
 * - Uso por partes: `children` com <CelulaDeNumero> (célula com barra ou
 *   minigráfico embaixo).
 */

export interface NumeroDaFaixa {
  rotulo: string;
  valor: ReactNode;
  /** Linha de estado embaixo do valor (unidade, comparação, detalhe). */
  apoio?: ReactNode;
  /** Na mesma linha do valor, depois dele (selo de variação, apoio curto). */
  aoLado?: ReactNode;
  /** Pontinho de cor antes do rótulo. */
  ponto?: "verde" | "info" | "alerta" | "perigo" | "neutro";
  /** Classe de cor do valor (ex.: "text-warning"). Padrão: text-foreground. */
  corDoValor?: string;
  /** Etiqueta à direita do rótulo (situação). */
  lado?: ReactNode;
  /** Extra embaixo (barra de referência, minigráfico). */
  extra?: ReactNode;
  /** Leva a outra tela (vira link). */
  para?: string;
  /** Ação na própria tela (vira botão). */
  aoClicar?: () => void;
  /** Dica ao passar o mouse na célula que leva a algum lugar. */
  dica?: string;
  /** Chave da linha (padrão: o rótulo). */
  chave?: string;
}

const corDoPonto: Record<NonNullable<NumeroDaFaixa["ponto"]>, string> = {
  verde: "bg-success",
  info: "bg-info",
  alerta: "bg-warning",
  perigo: "bg-destructive",
  neutro: "bg-muted-foreground",
};

type Tamanho = "grande" | "compacto";

const classeDoValor = (tamanho: Tamanho) =>
  tamanho === "compacto" ? "text-[16px] font-semibold leading-6 tabular-nums" : "text-[18px] font-semibold leading-7 tabular-nums sm:text-[20px]";
const classeDaCelula = (tamanho: Tamanho) => juntar("block min-w-0 border-l border-t border-border text-left", tamanho === "compacto" ? "px-4 py-2.5" : "px-4 py-3");

/** Miolo de uma célula (rótulo, valor, apoio e extra). */
function Miolo({
  item,
  tamanho,
  apoioAoLado = false,
  apoioLivre = false,
}: {
  item: Omit<NumeroDaFaixa, "rotulo"> & { rotulo: ReactNode };
  tamanho: Tamanho;
  apoioAoLado?: boolean;
  /** Apoio pode quebrar linha (célula avulsa com texto maior). */
  apoioLivre?: boolean;
}) {
  // Ao lado do valor: o selo e, com apoioAoLado, o apoio. Só ele encolhe (o valor fica inteiro).
  const aoLado = apoioAoLado && item.apoio ? item.apoio : item.aoLado;
  return (
    <>
      <span className="flex min-w-0 items-start justify-between">
        <span className={juntar(texto.rotulo, "flex min-w-0 items-center")}>
          {item.ponto && <span aria-hidden="true" className={juntar("mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full", corDoPonto[item.ponto])} />}
          <span className="truncate">{item.rotulo}</span>
        </span>
        {item.lado && <span className="ml-2 shrink-0">{item.lado}</span>}
      </span>
      <span className={juntar("flex min-w-0 items-center", tamanho === "compacto" ? "mt-0.5" : "mt-1")}>
        {/* O valor não encolhe por causa do que vem ao lado (só corta se passar da célula). */}
        <span className={juntar("min-w-0 max-w-full shrink-0 truncate", classeDoValor(tamanho), item.corDoValor || "text-foreground")}>{item.valor}</span>
        {aoLado ? <span className={juntar(texto.auxiliar, "ml-2 min-w-0 shrink truncate")}>{aoLado}</span> : null}
      </span>
      {item.apoio && !apoioAoLado && apoioLivre ? <div className={juntar(texto.auxiliar, "mt-0.5 leading-[18px]")}>{item.apoio}</div> : null}
      {item.apoio && !apoioAoLado && !apoioLivre ? (
        <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")} title={typeof item.apoio === "string" ? item.apoio : undefined}>
          {item.apoio}
        </span>
      ) : null}
      {item.extra}
    </>
  );
}

/** Uma célula avulsa (uso por partes, dentro de <FaixaDeNumeros>). */
export function CelulaDeNumero({
  rotulo,
  valor,
  apoio,
  lado,
  destaque = false,
  tamanho = "grande",
  className = "",
  children,
}: {
  rotulo: ReactNode;
  valor: ReactNode;
  apoio?: ReactNode;
  lado?: ReactNode;
  /** Valor em verde. */
  destaque?: boolean;
  tamanho?: Tamanho;
  className?: string;
  /** Extra embaixo (barra de referência, minigráfico). */
  children?: ReactNode;
}) {
  return (
    <div className={juntar(classeDaCelula(tamanho), className)}>
      <Miolo item={{ rotulo, valor, apoio, lado, extra: children, corDoValor: destaque ? "text-primary" : undefined }} tamanho={tamanho} apoioLivre />
    </div>
  );
}

function gradeDasColunas(colunas: number, n: number): string {
  const c = Math.max(1, Math.min(colunas, n || colunas));
  if (c === 1) return "grid-cols-1";
  if (c === 2) return "grid-cols-2";
  if (c === 3) return "grid-cols-2 lg:grid-cols-3";
  if (c === 5) return "grid-cols-2 lg:grid-cols-5";
  if (c >= 6) return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6";
  return "grid-cols-2 lg:grid-cols-4";
}

export default function FaixaDeNumeros({
  itens,
  rotulo,
  colunas = 4,
  grade,
  tamanho = "grande",
  semMoldura = false,
  apoioAoLado = false,
  className = "",
  children,
  ...resto
}: {
  /** Os números. Ou use `children` com <CelulaDeNumero>. */
  itens?: NumeroDaFaixa[];
  /** Nome da faixa para leitor de tela. */
  rotulo?: string;
  /** Colunas de 1024 px para cima (no celular são 2). Nunca mais que a quantidade de números. */
  colunas?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Classes exatas da grade (ex.: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6"). Vence `colunas`. */
  grade?: string;
  /** grande: valor de 20 px (resumo da tela). compacto: 16 px (faixa dentro de uma seção). */
  tamanho?: Tamanho;
  /** Sem a moldura de painel (a faixa já mora dentro de um Painel). */
  semMoldura?: boolean;
  /** O apoio vai na linha do valor, depois dele (faixa mais baixa). */
  apoioAoLado?: boolean;
  className?: string;
  children?: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  const lista = itens || [];
  const n = lista.length;
  const classes = grade || gradeDasColunas(colunas, n);
  // Ímpar no celular (base de 2 colunas): o último ocupa a linha, sem buraco.
  const baseDeDuas = !grade && classes.indexOf("grid-cols-2") === 0;
  return (
    <div role="group" aria-label={rotulo} className={juntar("min-w-0 overflow-hidden", !semMoldura && superficie.painel, className)} {...resto}>
      <div className={juntar("-ml-px -mt-px grid", classes)}>
        {children}
        {lista.map((item, i) => {
          const sobra = baseDeDuas && n % 2 === 1 && i === n - 1 && n > 1 ? (classes.indexOf("lg:") >= 0 ? "col-span-2 lg:col-span-1" : "col-span-2") : "";
          const base = juntar(classeDaCelula(tamanho), sobra);
          const chave = item.chave || item.rotulo;
          if (item.para) {
            return (
              <Link key={chave} to={item.para} title={item.dica} className={juntar(base, "transition-colors hover:bg-muted/40", foco)}>
                <Miolo item={item} tamanho={tamanho} apoioAoLado={apoioAoLado} />
              </Link>
            );
          }
          if (item.aoClicar) {
            return (
              <button key={chave} type="button" onClick={item.aoClicar} title={item.dica} className={juntar(base, "w-full transition-colors hover:bg-muted/40", foco)}>
                <Miolo item={item} tamanho={tamanho} apoioAoLado={apoioAoLado} />
              </button>
            );
          }
          return (
            <div key={chave} className={base}>
              <Miolo item={item} tamanho={tamanho} apoioAoLado={apoioAoLado} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
