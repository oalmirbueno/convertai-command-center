import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { juntar, texto } from "./estilos";

/**
 * Os três estados de toda tela: vazio, carregando e erro. Sempre no lugar do
 * conteúdo, com o mesmo formato, sem caixa extra em volta.
 */

/** Vazio: ícone discreto, título curto, uma linha e a ação que resolve. */
export function EstadoVazio({
  icone,
  titulo,
  descricao,
  acao,
  compacto = false,
  className = "",
}: {
  icone?: ReactNode;
  titulo: ReactNode;
  descricao?: ReactNode;
  acao?: ReactNode;
  /** Versão de uma linha, para dentro de listas e painéis. */
  compacto?: boolean;
  className?: string;
}) {
  if (compacto) {
    return (
      <div className={juntar("flex min-w-0 flex-wrap items-center rounded-md border border-dashed border-border px-3 py-3", className)}>
        <p className={juntar(texto.auxiliar, "mr-3 min-w-0 flex-1 leading-5")}>
          <span className="font-medium text-foreground">{titulo}</span>
          {descricao ? <> {descricao}</> : null}
        </p>
        {acao && <div className="shrink-0">{acao}</div>}
      </div>
    );
  }
  return (
    <div className={juntar("flex min-w-0 flex-col items-center px-4 py-12 text-center", className)} data-estado="vazio">
      {icone && (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
          {icone}
        </div>
      )}
      <p className={texto.tituloSecao}>{titulo}</p>
      {descricao && <p className={juntar(texto.auxiliar, "mt-1 max-w-md leading-5")}>{descricao}</p>}
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  );
}

/** Carregando: esqueleto com o formato do que vai chegar (não um spinner solto). */
export function Carregando({
  rotulo = "Carregando",
  linhas = 3,
  forma = "lista",
  className = "",
}: {
  rotulo?: string;
  linhas?: number;
  /** lista: linhas; grade: cartões de mídia; aba: título + bloco grande. */
  forma?: "lista" | "grade" | "aba";
  className?: string;
}) {
  if (forma === "aba") {
    return (
      <div aria-busy="true" aria-label={rotulo} className={juntar("space-y-3", className)}>
        <div className="h-8 w-2/3 animate-pulse rounded-md bg-muted sm:w-1/3" />
        <div className="h-24 animate-pulse rounded-lg bg-muted/80" />
        <div className="h-[45vh] animate-pulse rounded-lg bg-muted/60" />
      </div>
    );
  }
  if (forma === "grade") {
    return (
      <div aria-busy="true" aria-label={rotulo} className={juntar("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6", className)}>
        {Array.from({ length: Math.max(1, linhas) }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-lg bg-muted" style={{ paddingBottom: "125%" }} />
        ))}
      </div>
    );
  }
  return (
    <div aria-busy="true" aria-label={rotulo} className={juntar("space-y-2", className)}>
      {Array.from({ length: Math.max(1, linhas) }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-md bg-muted" style={{ opacity: 1 - i * 0.15 }} />
      ))}
    </div>
  );
}

/** Erro: o que aconteceu, em uma frase, e como tentar de novo. */
export function EstadoDeErro({
  titulo = "Não foi possível carregar.",
  descricao,
  acao,
  className = "",
}: {
  titulo?: ReactNode;
  descricao?: ReactNode;
  acao?: ReactNode;
  className?: string;
}) {
  return (
    <div role="alert" className={juntar("flex min-w-0 items-start rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5", className)}>
      <AlertTriangle className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="mr-3 min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">{titulo}</p>
        {descricao && <p className={juntar(texto.auxiliar, "mt-0.5 leading-5")}>{descricao}</p>}
      </div>
      {acao && <div className="shrink-0">{acao}</div>}
    </div>
  );
}
