import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { StatCard, StatGrid } from "@/components/ds";
import { foco, juntar, superficie } from "@/components/sistema/estilos";

/**
 * Peças da rodada ousada (15/11/2026) para as mesas e o estúdio: embrulham o
 * design system (`@/components/ds`) com os nomes e o formato de dado que as
 * mesas já usavam na FaixaDeNumeros, para a troca não mexer em conta nenhuma.
 *
 * - <NumerosOusados>: fileira de cartões de número grande; um sólido na cor da
 *   marca (`destaque`) e um de tinta (`tinta`), como nas referências.
 * - <NumerosAbertos>: os mesmos números SEM cartão, para dentro de um Painel
 *   (cartão dentro de cartão não entra).
 * - <AzulejoDeNumero>: um número só, com gráfico pequeno opcional.
 */

export interface NumeroOusado {
  rotulo: string;
  valor: ReactNode;
  /** Linha curta embaixo do número. */
  apoio?: ReactNode;
  /** Variação em % (vira a pílula com seta). */
  variacao?: number | null;
  /** Custo que cai é bom. */
  inverter?: boolean;
  icone?: ReactNode;
  /** Explicação longa: vira o "?". */
  ajuda?: ReactNode;
  /** Gráfico pequeno do ds/charts, só com dado que a tela já tem. */
  grafico?: ReactNode;
  graficoAoLado?: boolean;
  para?: string;
  aoClicar?: () => void;
  /** Dica ao passar o mouse (só no número aberto). */
  dica?: string;
  chave?: string;
}

type Colunas = 2 | 3 | 4 | 5 | 6;

/** Fileira de cartões de número. `destaque` e `tinta` são a posição do cartão sólido e do de tinta (-1 tira). */
export function NumerosOusados({
  itens,
  rotulo,
  colunas,
  destaque = 0,
  tinta = -1,
  tamanho = "lg",
  className = "",
  ...resto
}: {
  itens: NumeroOusado[];
  /** Nome da fileira para leitor de tela. */
  rotulo?: string;
  colunas?: Colunas;
  destaque?: number;
  tinta?: number;
  tamanho?: "md" | "lg" | "xl";
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  const n = itens.length;
  const cols = (colunas || Math.max(2, Math.min(6, n))) as Colunas;
  return (
    <div className={juntar("min-w-0", className)} {...resto}>
      <StatGrid cols={cols} label={rotulo}>
        {itens.map((item, i) => (
          <StatCard
            key={item.chave || item.rotulo}
            label={item.rotulo}
            value={item.valor}
            hint={item.apoio}
            delta={typeof item.variacao === "number" ? item.variacao : undefined}
            invertDelta={item.inverter}
            icon={item.icone}
            help={item.ajuda}
            chart={item.grafico}
            chartPosition={item.graficoAoLado ? "side" : "bottom"}
            variant={i === destaque ? "accent" : i === tinta ? "ink" : "default"}
            size={tamanho}
            to={item.para}
            onClick={item.aoClicar}
            className={n % 2 === 1 && i === n - 1 && n > 1 ? "max-lg:col-span-2" : undefined}
          />
        ))}
      </StatGrid>
    </div>
  );
}

const GRADE_ABERTA: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 lg:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6",
};

/** Um número aberto (sem cartão): rótulo pequeno e apagado, número grande, linha de apoio. */
export function NumeroAberto({ item, tamanho = "lg", className = "" }: { item: NumeroOusado; tamanho?: "md" | "lg"; className?: string }) {
  const miolo = (
    <>
      <span className="flex min-w-0 items-center text-[12px] font-medium leading-4 text-muted-foreground">
        {item.icone && <span aria-hidden="true" className="mr-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">{item.icone}</span>}
        <span className="truncate">{item.rotulo}</span>
      </span>
      <span
        className={juntar(
          "mt-2 block min-w-0 truncate font-semibold tabular-nums tracking-[-0.03em] text-foreground",
          tamanho === "lg" ? "text-[24px] leading-8 sm:text-[32px] sm:leading-10" : "text-[20px] leading-7 sm:text-[24px] sm:leading-8",
        )}
        title={typeof item.valor === "string" ? item.valor : undefined}
      >
        {item.valor}
      </span>
      {item.apoio && <span className="mt-1 block min-w-0 text-[12px] leading-4 text-muted-foreground line-clamp-2">{item.apoio}</span>}
      {item.grafico && <span className="mt-3 block min-w-0">{item.grafico}</span>}
    </>
  );
  const base = juntar("block min-w-0 text-left", className);
  if (item.para) return <Link to={item.para} title={item.dica} className={juntar(base, "rounded-md transition-opacity hover:opacity-80", foco)}>{miolo}</Link>;
  if (item.aoClicar) return <button type="button" onClick={item.aoClicar} title={item.dica} className={juntar(base, "w-full rounded-md transition-opacity hover:opacity-80", foco)}>{miolo}</button>;
  return <div className={base} title={item.dica}>{miolo}</div>;
}

/** Números grandes sem cartão, lado a lado, para dentro de um Painel ou de uma seção. */
export function NumerosAbertos({
  itens,
  rotulo,
  colunas,
  tamanho = "lg",
  className = "",
  ...resto
}: {
  itens: NumeroOusado[];
  rotulo?: string;
  colunas?: 1 | 2 | 3 | 4 | 5 | 6;
  tamanho?: "md" | "lg";
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  const cols = Math.max(1, Math.min(colunas || itens.length, itens.length || 1));
  return (
    <div role="group" aria-label={rotulo} className={juntar("grid min-w-0 gap-x-8 gap-y-6", GRADE_ABERTA[cols], className)} {...resto}>
      {itens.map((item) => (
        <NumeroAberto key={item.chave || item.rotulo} item={item} tamanho={tamanho} />
      ))}
    </div>
  );
}

/** Círculo de ícone (48 px) dos azulejos e das linhas de lista das mesas. */
export function IconeEmCirculo({ children, tom = "neutro", tamanho = "md", className = "" }: { children: ReactNode; tom?: "neutro" | "marca" | "solido" | "tinta"; tamanho?: "sm" | "md" | "lg"; className?: string }) {
  const tons = {
    neutro: "bg-muted text-foreground",
    marca: "bg-muted text-foreground",
    solido: "bg-accent-solid text-on-accent",
    tinta: "bg-foreground text-background",
  } as const;
  const tamanhos = { sm: "h-8 w-8", md: "h-10 w-10", lg: "h-12 w-12" } as const;
  return (
    <span aria-hidden="true" className={juntar("inline-flex shrink-0 items-center justify-center rounded-full", tamanhos[tamanho], tons[tom], className)}>
      {children}
    </span>
  );
}

/**
 * Cartão de indicador com a marcação na mão (para quem precisa de <dt>/<dd>,
 * de `data-*` no cartão ou do "?" próprio): mesmo desenho do StatCard do
 * sistema (rótulo pequeno e apagado, número grande que cabe numa linha,
 * variação em pílula com seta). `variante`: `solido` (cor da marca) ou `tinta`.
 */
export function CartaoDeIndicador({
  rotulo,
  valor,
  variacao,
  bomQuandoSobe = true,
  dicaDaVariacao = "Comparado ao período anterior do mesmo tamanho",
  apoio,
  ajuda,
  dica,
  grafico,
  variante = "padrao",
  tamanho = "lg",
  lista = false,
  className = "",
  ...resto
}: {
  rotulo: ReactNode;
  valor: ReactNode;
  /** Variação em % contra o período anterior. Zero ou nulo não aparece. */
  variacao?: number | null;
  bomQuandoSobe?: boolean;
  dicaDaVariacao?: string;
  apoio?: ReactNode;
  /** O "?" (um AjudaRecolhida pronto), depois do rótulo. */
  ajuda?: ReactNode;
  /** Dica ao passar o mouse no cartão. */
  dica?: string;
  grafico?: ReactNode;
  variante?: "padrao" | "solido" | "tinta";
  tamanho?: "md" | "lg" | "xl";
  /** Dentro de um <dl>: o rótulo é <dt> e o valor <dd>. */
  lista?: boolean;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  const Rotulo = lista ? "dt" : "p";
  const Valor = lista ? "dd" : "div";
  const simples = typeof valor === "string" || typeof valor === "number";
  const teto = { md: ["24px", "28px"], lg: ["28px", "36px"], xl: ["32px", "40px"] }[tamanho];
  const estilo = { "--ds-chars": simples ? Math.max(3, String(valor).length) : undefined, "--ds-valor-max-celular": teto[0], "--ds-valor-max-tela": teto[1] } as CSSProperties;
  const temVariacao = typeof variacao === "number" && variacao !== 0;
  const sobe = temVariacao && (variacao as number) > 0;
  const bom = sobe === bomQuandoSobe;
  return (
    <div
      className={juntar(superficie.painel, variante === "solido" && superficie.destaque, variante === "tinta" && superficie.tinta, "flex min-w-0 flex-col p-5 sm:p-6", className)}
      title={dica}
      data-card={variante === "solido" ? "accent" : variante === "tinta" ? "ink" : "default"}
      {...resto}
    >
      <Rotulo className="flex min-w-0 items-center text-[13px] font-medium leading-5 text-muted-foreground">
        <span className="truncate" title={typeof rotulo === "string" ? rotulo : undefined}>{rotulo}</span>
        {ajuda}
      </Rotulo>
      <Valor className="mt-4 min-w-0">
        <span className="ds-stat-caixa block min-w-0">
          <span className="ds-stat-valor text-foreground" data-cabe={simples ? "" : undefined} style={estilo}>{valor}</span>
        </span>
        {(temVariacao || apoio) && (
          <span className="mt-2.5 flex min-w-0 items-center">
            {temVariacao && (
              <span className={juntar("inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-full px-2 text-[11px] font-medium leading-none tabular-nums", bom ? "bg-muted text-success" : "bg-danger-soft text-destructive")} title={dicaDaVariacao}>
                <svg aria-hidden="true" viewBox="0 0 10 10" className={juntar("mr-1 inline-block h-2.5 w-2.5 shrink-0", !sobe && "rotate-180")} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 8.5v-7M2 4.5l3-3 3 3" />
                </svg>
                {sobe ? "+" : ""}
                {Math.round(variacao as number)}%
              </span>
            )}
            {apoio && <span className={juntar("min-w-0 text-[12px] leading-4 text-muted-foreground line-clamp-2", temVariacao && "ml-2")}>{apoio}</span>}
          </span>
        )}
      </Valor>
      {grafico && <div className="mt-auto min-w-0 pt-5">{grafico}</div>}
    </div>
  );
}
