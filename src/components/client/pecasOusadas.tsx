import type { ReactNode } from "react";
import { ArrowUpRight, Check } from "lucide-react";
import { foco, juntar, superficie } from "@/components/sistema/estilos";

/**
 * Peças visuais da rodada ousada (15/11/2026) para o portal do cliente, as
 * aprovações, os relatórios, os pedidos, os documentos e o cofre. São só
 * aparência: nenhuma busca dado nem guarda estado. O que é do painel inteiro
 * (StatCard, Card, ListRow, StatusPill, gráficos) continua em `@/components/ds`.
 */

export type TomDaBolha = "neutro" | "marca" | "solido" | "tinta" | "info" | "alerta" | "perigo" | "sucesso" | "violeta";

const TOM_DA_BOLHA: Record<TomDaBolha, string> = {
  neutro: "bg-muted text-foreground",
  marca: "bg-accent-soft text-primary",
  solido: "bg-accent-solid text-on-accent",
  tinta: "bg-foreground text-background",
  info: "bg-info-soft text-info",
  alerta: "bg-warning-soft text-warning",
  perigo: "bg-danger-soft text-destructive",
  sucesso: "bg-success-soft text-success",
  violeta: "bg-chart-2/15 text-chart-2",
};

const TAMANHO_DA_BOLHA = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
  xl: "h-14 w-14",
} as const;

/** Ícone num círculo (o "avatar" de uma linha, de um cartão ou de um atalho). Decorativo. */
export function Bolha({ children, tom = "neutro", tamanho = "md", className = "" }: { children: ReactNode; tom?: TomDaBolha; tamanho?: keyof typeof TAMANHO_DA_BOLHA; className?: string }) {
  return (
    <span aria-hidden="true" className={juntar("inline-flex shrink-0 items-center justify-center rounded-full", TAMANHO_DA_BOLHA[tamanho], TOM_DA_BOLHA[tom], className)}>
      {children}
    </span>
  );
}

const TAMANHO_DO_NUMERO = {
  md: "text-[24px] leading-8 tracking-[-0.02em]",
  lg: "text-[32px] leading-10 tracking-[-0.03em] max-sm:text-[28px] max-sm:leading-9",
  xl: "text-[40px] leading-[44px] tracking-[-0.035em] max-sm:text-[32px] max-sm:leading-10",
} as const;

/**
 * Número grande com o rótulo pequeno e apagado em cima (para dentro de um
 * cartão que junta vários números). Fora de cartão, use o StatCard.
 */
export function Metrica({
  rotulo,
  valor,
  apoio,
  tamanho = "lg",
  corDoValor = "text-foreground",
  extra,
  className = "",
}: {
  rotulo: ReactNode;
  valor: ReactNode;
  /** Linha curta embaixo do número. */
  apoio?: ReactNode;
  tamanho?: keyof typeof TAMANHO_DO_NUMERO;
  corDoValor?: string;
  /** Barra ou minigráfico embaixo (só com dado que a tela já tem). */
  extra?: ReactNode;
  className?: string;
}) {
  return (
    <div className={juntar("min-w-0", className)}>
      <p className="truncate text-[12px] font-medium leading-4 text-muted-foreground">{rotulo}</p>
      <p className={juntar("mt-1.5 truncate font-semibold tabular-nums", TAMANHO_DO_NUMERO[tamanho], corDoValor)}>{valor}</p>
      {apoio && <p className="mt-1 truncate text-[12px] leading-4 text-muted-foreground">{apoio}</p>}
      {extra && <div className="mt-3 min-w-0">{extra}</div>}
    </div>
  );
}

const TOM_DO_AVISO = {
  perigo: { fundo: "bg-danger-soft", bolha: "perigo" as TomDaBolha, seta: "text-destructive" },
  info: { fundo: "bg-info-soft", bolha: "info" as TomDaBolha, seta: "text-info" },
  alerta: { fundo: "bg-warning-soft", bolha: "alerta" as TomDaBolha, seta: "text-warning" },
  sucesso: { fundo: "bg-success-soft", bolha: "sucesso" as TomDaBolha, seta: "text-success" },
} as const;

/**
 * Aviso em faixa: fundo suave no tom, ícone num círculo, uma frase forte e uma
 * linha de apoio. Com `aoClicar`, a faixa inteira é o botão e ganha a seta.
 */
export function AvisoEmFaixa({
  tom,
  icone,
  titulo,
  apoio,
  aoClicar,
  acao,
  className = "",
}: {
  tom: keyof typeof TOM_DO_AVISO;
  icone: ReactNode;
  titulo: ReactNode;
  apoio?: ReactNode;
  aoClicar?: () => void;
  /** Ação à direita quando a faixa não é clicável. */
  acao?: ReactNode;
  className?: string;
}) {
  const t = TOM_DO_AVISO[tom];
  const miolo = (
    <>
      <Bolha tom={t.bolha} tamanho="lg" className="mr-4 bg-card max-sm:mr-3 max-sm:h-10 max-sm:w-10">
        {icone}
      </Bolha>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-5 text-foreground">{titulo}</span>
        {apoio && <span className="mt-1 hidden truncate text-[13px] leading-5 text-muted-foreground sm:block">{apoio}</span>}
      </span>
      {aoClicar && (
        <span aria-hidden="true" className={juntar("ml-3 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card", t.seta)}>
          <ArrowUpRight className="h-4 w-4" />
        </span>
      )}
      {!aoClicar && acao && <span className="ml-3 flex shrink-0 items-center">{acao}</span>}
    </>
  );
  const classes = juntar("flex w-full min-w-0 items-center rounded-lg p-4 text-left sm:p-5", t.fundo, className);
  if (aoClicar) {
    return (
      <button type="button" onClick={aoClicar} className={juntar(classes, "transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0", foco)}>
        {miolo}
      </button>
    );
  }
  return <div className={classes}>{miolo}</div>;
}

/**
 * Trilha de etapas: círculos ligados por uma linha; as feitas ganham o visto,
 * a atual fica sólida e as próximas, apagadas. No celular os nomes somem (quem
 * chama mostra a etapa atual por extenso).
 */
export function Trilha({ etapas, atual, rotulo }: { etapas: string[]; atual: number; rotulo: string }) {
  return (
    <ol className="flex min-w-0 items-start" aria-label={rotulo}>
      {etapas.map((etapa, i) => {
        const feita = i < atual;
        const agora = i === atual;
        const traco = "h-0.5 min-w-0 flex-1 rounded-full";
        return (
          <li key={etapa} className="flex min-w-0 flex-1 flex-col items-center text-center" aria-current={agora ? "step" : undefined}>
            <div className="flex w-full min-w-0 items-center">
              <span aria-hidden="true" className={juntar(traco, i === 0 ? "invisible" : i <= atual ? "bg-foreground" : "bg-border")} />
              <span
                className={juntar(
                  "mx-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums",
                  agora ? "bg-primary text-primary-foreground ring-4 ring-primary/20" : feita ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
                )}
              >
                {feita ? <Check className="h-4 w-4" aria-label="Concluída" /> : i + 1}
              </span>
              <span aria-hidden="true" className={juntar(traco, i === etapas.length - 1 ? "invisible" : feita ? "bg-foreground" : "bg-border")} />
            </div>
            <span className={juntar("mt-2 hidden max-w-full truncate px-1 text-[12px] leading-4 sm:block", agora ? "font-semibold text-foreground" : "text-muted-foreground")}>{etapa}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Rótulo pequeno e apagado em cima de um bloco de texto (dentro de cartão). */
export function Legenda({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={juntar("block text-[12px] font-medium leading-4 text-muted-foreground", className)}>{children}</span>;
}

/**
 * Atalho em azulejo: ícone num círculo e o nome embaixo (como a grade de
 * "o que você precisa?" das referências). No celular, três por linha.
 */
export function Azulejo({ icone, rotulo, aoClicar, destaque = false, contador }: { icone: ReactNode; rotulo: string; aoClicar: () => void; destaque?: boolean; contador?: number }) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      className={juntar(
        superficie.painel,
        "group relative flex min-w-0 touch-manipulation flex-col items-center px-2 py-4 text-center transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 sm:py-5",
        foco,
      )}
    >
      <Bolha tom={destaque ? "solido" : "neutro"} tamanho="lg" className="transition-colors group-hover:bg-foreground group-hover:text-background max-sm:h-10 max-sm:w-10">
        {icone}
      </Bolha>
      <span className="mt-2.5 block max-w-full truncate text-[13px] font-medium leading-5 text-foreground max-sm:text-[12px]">{rotulo}</span>
      {typeof contador === "number" && contador > 0 && (
        <span className="absolute right-3 top-3 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent-solid px-1.5 text-[11px] font-semibold leading-none tabular-nums text-on-accent">{contador}</span>
      )}
    </button>
  );
}
