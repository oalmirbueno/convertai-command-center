import { Children, createContext, useContext, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { foco, juntar } from "@/components/sistema";
import { StatCard } from "@/components/ds";

/**
 * Peças locais das abas do Financeiro (design etapa 2, E6-F2).
 *
 * O sistema (src/components/sistema) não tem cartão de indicador nem título
 * recolhível; estas peças usam só os tokens dele, para as abas do
 * Financeiro repetirem o mesmo jeito sem reescrever classes. Candidatas a
 * subir para o sistema depois.
 */

export type Tom = "neutro" | "sucesso" | "perigo" | "aviso" | "info" | "primario" | "apagado";

/** Cor do número por tom. */
export const corDoTom: Record<Tom, string> = {
  neutro: "text-foreground",
  sucesso: "text-success",
  perigo: "text-destructive",
  aviso: "text-warning",
  info: "text-info",
  primario: "text-foreground",
  apagado: "text-muted-foreground",
};

/** Fundo suave + cor para etiquetas de estado. */
export const fundoDoTom: Record<Tom, string> = {
  neutro: "bg-muted text-foreground",
  sucesso: "bg-muted text-success",
  perigo: "bg-danger-soft text-destructive",
  aviso: "bg-warning-soft text-warning",
  info: "bg-info-soft text-info",
  primario: "bg-muted text-foreground",
  apagado: "bg-muted text-muted-foreground",
};

/** Botão pequeno de ação de linha (32 px), para listas densas. */
export const botaoDeLinha = juntar(
  "toque-compacto inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-border bg-card px-3.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50",
  foco,
);

/** A ação que resolve a linha (Pagar, Receber, Lançar): pílula de tinta, 32 px. */
export const botaoPrincipalDeLinha = juntar(
  "toque-compacto inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-foreground px-3.5 text-[12px] font-medium text-background transition-colors hover:bg-foreground/85 disabled:pointer-events-none disabled:opacity-50",
  foco,
);

/** Linha de lista do Financeiro (dentro de um Painel sem espaço): mais ar e fundo suave ao passar o mouse. */
export const linhaDeLista = "flex min-w-0 flex-wrap items-center px-4 py-3.5 transition-colors hover:bg-muted/40 sm:px-6";
/** A lista dessas linhas. v4 (15/11/2026): sem traço em cada linha; o respiro e o fundo ao passar o mouse separam. */
export const listaDeLinhas = "py-1.5";

/**
 * v4 (15/11/2026): no celular o cartão tem meia tela e o rótulo era cortado ("Saldo em cai…").
 * Com isto o rótulo do StatCard quebra em duas linhas em vez de virar reticências.
 */
export const rotuloInteiroNoCelular = "max-sm:[&>span:first-child_.truncate]:whitespace-normal";

/** Onde o Kpi mora: solto, numa grade de cartões ou numa grade de poços (dentro de um Painel). */
const DentroDaGrade = createContext<{ naGrade: boolean; emPoco: boolean; indice: number; destacar: boolean }>({ naGrade: false, emPoco: false, indice: -1, destacar: false });

const PONTO_DO_TOM: Record<Tom, string> = {
  neutro: "",
  sucesso: "bg-success",
  perigo: "bg-destructive",
  aviso: "bg-warning",
  info: "bg-info",
  primario: "bg-primary",
  apagado: "bg-muted-foreground",
};

/** Poço: o indicador dentro de um Painel (nunca cartão dentro de cartão). */
const cascaDePoco = "rounded-md border-transparent bg-muted/60 p-4 shadow-none sm:p-5";

/**
 * Grade de indicadores (rodada ousada, 15/11/2026): um cartão por número, com
 * ar entre eles, número grande e, por fileira, um cartão sólido na cor da
 * marca e um de tinta (o primeiro e o segundo, quando o tom deles deixa).
 * `semMoldura` quando a grade já mora dentro de um Painel: os números viram
 * poços (nunca cartão dentro de cartão) e não há destaque.
 * `destaques={false}` desliga o cartão verde e o de tinta.
 */
export function GradeDeKpis({
  colunas = 4,
  semMoldura = false,
  destaques = true,
  className = "",
  children,
}: {
  colunas?: 2 | 3 | 4 | 5;
  semMoldura?: boolean;
  destaques?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const grade =
    colunas === 2
      ? "grid-cols-2"
      : colunas === 3
        ? "grid-cols-1 sm:grid-cols-3"
        : colunas === 5
          ? "grid-cols-2 lg:grid-cols-3 desk:grid-cols-5 max-lg:[&>*:last-child:nth-child(odd)]:col-span-2"
          : "grid-cols-2 xl:grid-cols-4 max-xl:[&>*:last-child:nth-child(odd)]:col-span-2";
  const itens = Children.toArray(children);
  return (
    <div className={juntar("grid min-w-0", semMoldura ? "gap-3" : "gap-3 sm:gap-5", grade, className)} data-grade-de-kpis="">
      {itens.map((filho, i) => (
        <DentroDaGrade.Provider key={i} value={{ naGrade: true, emPoco: semMoldura, indice: i, destacar: destaques && !semMoldura && itens.length > 1 }}>
          {filho}
        </DentroDaGrade.Provider>
      ))}
    </div>
  );
}

/**
 * Indicador: rótulo pequeno, número GRANDE (algarismos da mesma largura, cabe
 * sempre numa linha) e uma linha de estado. Explicação vai no "?". O tom vira
 * a bolinha do rótulo; só o perigo pinta o número.
 */
export function Kpi({
  rotulo,
  valor,
  apoio,
  tom = "neutro",
  ajuda,
  emPoco = false,
  variante,
  icone,
  grafico,
  tamanho,
  className = "",
  children,
}: {
  rotulo: ReactNode;
  valor: ReactNode;
  apoio?: ReactNode;
  tom?: Tom;
  ajuda?: ReactNode;
  /** Dentro de um Painel: vira poço (nunca cartão dentro de cartão). */
  emPoco?: boolean;
  /** Cartão sólido na cor da marca, de tinta ou o comum. Sem isto, a grade escolhe. */
  variante?: "default" | "accent" | "ink";
  /** Ícone num círculo antes do rótulo. */
  icone?: ReactNode;
  /** Minigráfico de `ds/charts` com dado que a tela já tem. */
  grafico?: ReactNode;
  tamanho?: "md" | "lg" | "xl";
  className?: string;
  children?: ReactNode;
}) {
  const onde = useContext(DentroDaGrade);
  const poco = emPoco || onde.emPoco;
  // Destaque automático: o primeiro da fileira é o sólido e o segundo o de tinta, se o tom não for de alerta.
  const calmo = tom !== "perigo" && tom !== "aviso";
  const tipo = variante || (poco || !onde.destacar || !calmo ? "default" : onde.indice === 0 ? "accent" : onde.indice === 1 ? "ink" : "default");
  const ponto = tipo === "default" ? PONTO_DO_TOM[tom] : "";
  return (
    <StatCard
      label={
        ponto ? (
          <>
            <span aria-hidden="true" className={juntar("mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle", ponto)} />
            {rotulo}
          </>
        ) : (
          rotulo
        )
      }
      value={valor}
      hint={apoio}
      help={ajuda}
      icon={icone}
      variant={tipo}
      size={tamanho || (poco ? "md" : "lg")}
      chart={grafico || children ? <>{grafico}{children}</> : undefined}
      className={juntar(rotuloInteiroNoCelular, poco && cascaDePoco, tom === "perigo" && tipo === "default" && "[&_.ds-stat-valor]:text-destructive", className)}
    />
  );
}

/** Um número da faixa (a mesma forma da FaixaDeNumeros do sistema). */
export interface NumeroDoResumo {
  rotulo: string;
  valor: ReactNode;
  apoio?: ReactNode;
  aoLado?: ReactNode;
  ponto?: "verde" | "info" | "alerta" | "perigo" | "neutro";
  corDoValor?: string;
  lado?: ReactNode;
  extra?: ReactNode;
  para?: string;
  aoClicar?: () => void;
  dica?: string;
  chave?: string;
  /** Cartão sólido, de tinta ou comum. Sem isto, a fileira escolhe. */
  variante?: "default" | "accent" | "ink";
  /** Ícone num círculo antes do rótulo. */
  icone?: ReactNode;
}

const PONTO_DO_NUMERO: Record<NonNullable<NumeroDoResumo["ponto"]>, string> = {
  verde: "bg-success",
  info: "bg-info",
  alerta: "bg-warning",
  perigo: "bg-destructive",
  neutro: "bg-muted-foreground",
};

/**
 * Fileira de números em cartões grandes (rodada ousada): recebe os mesmos
 * `itens` da FaixaDeNumeros e desenha um StatCard por número, com o primeiro
 * sólido na cor da marca e o segundo de tinta (`destaques={false}` desliga).
 */
export function Numeros({
  itens,
  rotulo,
  colunas = 4,
  destaques = true,
  tamanho,
  emPoco = false,
  grade: gradeExata,
  emFaixa = false,
  className = "",
  ...resto
}: {
  itens: NumeroDoResumo[];
  rotulo?: string;
  colunas?: 1 | 2 | 3 | 4 | 5 | 6;
  destaques?: boolean;
  tamanho?: "md" | "lg" | "xl";
  /** Dentro de um Painel: poços no lugar de cartões. */
  emPoco?: boolean;
  /** Classes exatas da grade (ex.: "grid-cols-2 md:grid-cols-3"). Vence `colunas`. */
  grade?: string;
  /** v4 C2: um painel só com os números soltos dentro (rótulo pequeno, número médio, sem cartão por número). */
  emFaixa?: boolean;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  const n = itens.length;
  if (emFaixa) {
    return (
      <div role="group" aria-label={rotulo} className={juntar("grid min-w-0 content-start gap-x-6 gap-y-6 rounded-lg border border-border bg-card p-5 shadow-card sm:p-6", gradeExata || "grid-cols-2 lg:grid-cols-3", className)} {...resto}>
        {itens.map((item) => {
          const ponto = item.ponto ? PONTO_DO_NUMERO[item.ponto] : "";
          const corpo = (
            <>
              <p className="flex min-w-0 items-center text-[12px] leading-4 text-muted-foreground">
                {ponto && <span aria-hidden="true" className={juntar("mr-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full", ponto)} />}
                <span className="truncate" title={item.dica}>{item.rotulo}</span>
              </p>
              <p className={juntar("mt-1.5 truncate text-[24px] font-medium leading-8 tracking-[-0.02em] tabular-nums", item.corDoValor || "text-foreground")}>{item.valor}</p>
              {(item.apoio || item.aoLado) && <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{item.apoio || item.aoLado}</p>}
              {item.extra && <div className="mt-2">{item.extra}</div>}
            </>
          );
          return item.aoClicar ? (
            <button key={item.chave || item.rotulo} type="button" onClick={item.aoClicar} className={juntar("min-w-0 rounded-md text-left", foco)}>{corpo}</button>
          ) : (
            <div key={item.chave || item.rotulo} className="min-w-0">{corpo}</div>
          );
        })}
      </div>
    );
  }
  const c = Math.max(1, Math.min(colunas, n || colunas));
  const grade =
    c === 1
      ? "grid-cols-1"
      : c === 2
        ? "grid-cols-2"
        : c === 3
          ? "grid-cols-2 lg:grid-cols-3 max-lg:[&>*:last-child:nth-child(odd)]:col-span-2"
          : c === 4
            ? "grid-cols-2 xl:grid-cols-4 max-xl:[&>*:last-child:nth-child(odd)]:col-span-2"
            : c === 5
              ? "grid-cols-2 lg:grid-cols-3 desk:grid-cols-5 max-lg:[&>*:last-child:nth-child(odd)]:col-span-2"
              : "grid-cols-2 lg:grid-cols-3 desk:grid-cols-6 max-lg:[&>*:last-child:nth-child(odd)]:col-span-2";
  return (
    <div role="group" aria-label={rotulo} className={juntar("grid min-w-0", emPoco ? "gap-3" : "gap-3 sm:gap-5", gradeExata || grade, className)} {...resto}>
      {itens.map((item, i) => {
        const alerta = item.ponto === "perigo" || item.ponto === "alerta" || /destructive|warning/.test(item.corDoValor || "");
        const tipo = item.variante || (!destaques || emPoco || n < 2 || alerta ? "default" : i === 0 ? "accent" : i === 1 ? "ink" : "default");
        const ponto = item.ponto && tipo === "default" ? PONTO_DO_NUMERO[item.ponto] : "";
        return (
          <StatCard
            key={item.chave || item.rotulo}
            label={
              ponto ? (
                <>
                  <span aria-hidden="true" className={juntar("mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle", ponto)} />
                  {item.rotulo}
                </>
              ) : (
                item.rotulo
              )
            }
            value={item.valor}
            hint={item.apoio || item.aoLado}
            corner={item.lado}
            icon={item.icone}
            chart={item.extra}
            to={item.para}
            onClick={item.aoClicar}
            variant={tipo}
            size={tamanho || (emPoco ? "md" : c >= 5 ? "md" : "lg")}
            className={juntar(rotuloInteiroNoCelular, emPoco && cascaDePoco, tipo === "default" && /destructive/.test(item.corDoValor || "") && "[&_.ds-stat-valor]:text-destructive")}
          />
        );
      })}
    </div>
  );
}

/**
 * Tabela limpa (rodada ousada): cabeçalho numa faixa em pílula, linhas com
 * sem traço (v4) e com fundo suave ao passar o mouse, números à direita.
 */
export const tabela = {
  /** Quem rola para o lado no celular. */
  moldura: "min-w-0 overflow-x-auto",
  tabela: "w-full border-separate border-spacing-0 text-[13px] leading-5",
  cabeca: "text-left [&_th]:whitespace-nowrap [&_th]:bg-muted [&_th]:px-4 [&_th]:py-3 [&_th]:text-[12px] [&_th]:font-medium [&_th]:text-muted-foreground [&_th:first-child]:rounded-l-full [&_th:last-child]:rounded-r-full",
  corpo: "[&_td]:px-4 [&_td]:py-3 [&_tr]:transition-colors [&_tr:hover>td]:bg-muted/40 [&_tr>td:first-child]:rounded-l-xl [&_tr>td:last-child]:rounded-r-xl",
  numero: "text-right tabular-nums",
} as const;

/** Gráficos do recharts no padrão novo: eixo apagado sem traço, grade só horizontal e dica em cartão flutuante. */
export const grafico = {
  eixo: { tick: { fontSize: 11, fill: "hsl(var(--muted-foreground))" }, axisLine: false, tickLine: false } as const,
  grade: { stroke: "hsl(var(--border))", strokeDasharray: "0", vertical: false } as const,
  dica: {
    contentStyle: { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 16, fontSize: 12, padding: "10px 14px", boxShadow: "var(--shadow-pop)", color: "hsl(var(--popover-foreground))" },
    labelStyle: { color: "hsl(var(--muted-foreground))", marginBottom: 4 },
    itemStyle: { color: "hsl(var(--popover-foreground))", padding: 0 },
    cursor: { fill: "hsl(var(--muted-foreground))", fillOpacity: 0.08 },
  } as const,
  legenda: { fontSize: 12, paddingTop: 8 } as const,
  /** Canto das barras (todas arredondadas, como nas referências). */
  raio: [8, 8, 8, 8] as [number, number, number, number],
  cor: (n: 1 | 2 | 3 | 4 | 5) => `hsl(var(--chart-${n}))`,
} as const;

/** Círculo antes de uma linha de lista: ícone ou sigla curta (REC, ADS, PRJ). */
export function IconeDaLinha({ children, tom = "apagado", className = "" }: { children: ReactNode; tom?: Tom; className?: string }) {
  return (
    <span aria-hidden="true" className={juntar("mr-3 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold leading-none", fundoDoTom[tom], className)}>
      {children}
    </span>
  );
}

/** Título de seção que recolhe e abre o bloco (vai no `titulo` da Secao). */
export function TituloRecolhivel({
  aberto,
  onAlternar,
  controla,
  children,
}: {
  aberto: boolean;
  onAlternar: () => void;
  /** id do bloco que abre e fecha. */
  controla?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onAlternar}
      aria-expanded={aberto}
      aria-controls={controla}
      className={juntar("-ml-1.5 inline-flex min-w-0 items-center rounded-full py-0.5 pl-1.5 pr-3 text-left transition-colors hover:bg-muted", foco)}
    >
      <ChevronDown
        className={juntar("mr-1.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", !aberto && "-rotate-90")}
        aria-hidden="true"
      />
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

/** Etiqueta de estado (Pago, Pendente, Atrasado): pílula de fundo suave com a bolinha do tom. `semPonto` para contagem e categoria. */
export function Etiqueta({ tom = "apagado", semPonto = false, className = "", children }: { tom?: Tom; semPonto?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={juntar("inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium leading-none tabular-nums", fundoDoTom[tom], className)}>
      {!semPonto && tom !== "neutro" && <span aria-hidden="true" className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Pé dos diálogos: botões à direita, o primário por último. */
export function AcoesDoDialogo({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-wrap items-center justify-end pt-1 [&>*+*]:ml-2">{children}</div>;
}
