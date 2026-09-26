import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { AjudaRecolhida, foco, juntar, superficie, texto } from "@/components/sistema";

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
  primario: "text-primary",
  apagado: "text-muted-foreground",
};

/** Fundo suave + cor para etiquetas de estado. */
export const fundoDoTom: Record<Tom, string> = {
  neutro: "bg-muted text-foreground",
  sucesso: "bg-success/15 text-success",
  perigo: "bg-destructive/15 text-destructive",
  aviso: "bg-warning/15 text-warning",
  info: "bg-info/15 text-info",
  primario: "bg-primary/15 text-primary",
  apagado: "bg-muted text-muted-foreground",
};

/** Botão pequeno de ação de linha (32 px), para listas densas. */
export const botaoDeLinha = juntar(
  "inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-border bg-transparent px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50",
  foco,
);

/** Grade de indicadores: um nível só, sem caixa em volta. */
export function GradeDeKpis({ colunas = 4, className = "", children }: { colunas?: 3 | 4 | 5; className?: string; children: ReactNode }) {
  const grade =
    colunas === 3 ? "grid-cols-1 sm:grid-cols-3" : colunas === 5 ? "grid-cols-2 lg:grid-cols-5" : "grid-cols-2 lg:grid-cols-4";
  return <div className={juntar("grid min-w-0 gap-3", grade, className)}>{children}</div>;
}

/** Indicador: rótulo, número (tabular) e uma linha de estado. Explicação vai no "?". */
export function Kpi({
  rotulo,
  valor,
  apoio,
  tom = "neutro",
  ajuda,
  emPoco = false,
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
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={juntar(emPoco ? superficie.poco : superficie.painel, "flex min-w-0 flex-col px-3.5 py-3", className)}>
      <div className="flex min-w-0 items-center">
        <p className={juntar(texto.rotulo, "min-w-0 truncate")}>{rotulo}</p>
        {ajuda && <AjudaRecolhida className="ml-1">{ajuda}</AjudaRecolhida>}
      </div>
      <div className={juntar("mt-1 min-w-0 truncate text-[18px] font-semibold leading-6 tabular-nums", corDoTom[tom])}>{valor}</div>
      {apoio && (
        <p className={juntar(texto.auxiliar, "mt-0.5 truncate")} title={typeof apoio === "string" ? apoio : undefined}>
          {apoio}
        </p>
      )}
      {children}
    </div>
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
      className={juntar("-ml-0.5 inline-flex min-w-0 items-center rounded text-left", foco)}
    >
      <ChevronDown
        className={juntar("mr-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", !aberto && "-rotate-90")}
        aria-hidden="true"
      />
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

/** Etiqueta de estado (Pago, Pendente, Atrasado). */
export function Etiqueta({ tom = "apagado", className = "", children }: { tom?: Tom; className?: string; children: ReactNode }) {
  return <span className={juntar("inline-flex min-h-[20px] shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-4 tabular-nums", fundoDoTom[tom], className)}>{children}</span>;
}

/** Pé dos diálogos: botões à direita, o primário por último. */
export function AcoesDoDialogo({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-wrap items-center justify-end pt-1 [&>*+*]:ml-2">{children}</div>;
}
