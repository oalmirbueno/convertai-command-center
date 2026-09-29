import { juntar, texto } from "@/components/sistema/estilos";
import type { LinhaDoDiff, ParteDoDiff } from "../../../supabase/functions/_shared/contrato-modelo";

/**
 * A diferença que precisa estar à vista antes de qualquer cláusula mudar
 * (frente CON, 30/09: "nunca reescreve cláusula sem mostrar a diferença").
 * Riscado em vermelho o que sai, sublinhado em verde o que entra.
 */

export function PartesDoDiff({ partes, className }: { partes: ParteDoDiff[]; className?: string }) {
  return (
    <p className={juntar(texto.corpo, "min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]", className)} data-diff="">
      {partes.map((p, i) =>
        p.tipo === "igual" ? (
          <span key={i}>{p.texto}</span>
        ) : p.tipo === "saiu" ? (
          <del key={i} className="rounded-sm bg-destructive/10 text-destructive line-through" data-saiu="">
            {p.texto}
          </del>
        ) : (
          <ins key={i} className="rounded-sm bg-success/15 text-success no-underline" data-entrou="">
            {p.texto}
          </ins>
        ),
      )}
    </p>
  );
}

/** Diferença entre versões do documento: só as linhas que mudaram, com o contexto de uma linha antes. */
export function LinhasDoDiff({ linhas }: { linhas: LinhaDoDiff[] }) {
  const mostrar: boolean[] = linhas.map((l) => l.tipo !== "igual");
  linhas.forEach((l, i) => {
    if (l.tipo !== "igual" && i > 0 && linhas[i - 1].tipo === "igual") mostrar[i - 1] = true;
  });
  if (!mostrar.some(Boolean)) return <p className={texto.auxiliar}>Nenhuma diferença no texto.</p>;
  return (
    <ol className="min-w-0 space-y-1.5" data-diff-de-versoes="">
      {linhas.map((l, i) => {
        if (!mostrar[i]) return null;
        const pulou = i > 0 && !mostrar[i - 1];
        return (
          <li key={i} className="min-w-0">
            {pulou && <span className={juntar(texto.auxiliar, "mb-1 block")}>...</span>}
            {l.tipo === "mudou" && l.partes ? (
              <PartesDoDiff partes={l.partes} />
            ) : (
              <p
                className={juntar(
                  texto.corpo,
                  "min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]",
                  l.tipo === "saiu" && "text-destructive line-through",
                  l.tipo === "entrou" && "text-success",
                  l.tipo === "igual" && "text-muted-foreground",
                )}
              >
                {l.tipo === "entrou" ? "+ " : l.tipo === "saiu" ? "- " : ""}
                {l.texto}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
