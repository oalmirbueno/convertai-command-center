import { CheckCircle2, Hammer, Sparkles } from "lucide-react";
import { ChevronDown } from "lucide-react";
import { CabecalhoDePagina, EstadoVazio, Secao, foco, juntar, superficie, texto } from "@/components/sistema";
import {
  RELEASE_NOTES,
  formatReleaseDate,
  releasesByStatus,
  type ReleaseEntry,
} from "@/lib/releaseNotes";

/**
 * Novidades do painel.
 *
 * Existe por um motivo simples: o cliente precisa saber que o sistema evolui
 * toda semana e o que exatamente mudou para ele. A tela separa o que já está
 * no ar do que está sendo construído agora, para nunca prometer antes da hora.
 * Lista limpa: uma entrada por linha, separadas por divisória, sem caixa.
 */

function Novidade({ entry, aberta = false }: { entry: ReleaseEntry; aberta?: boolean }) {
  const building = entry.status === "esta-semana";
  return (
    <article className="min-w-0 px-4 py-4 sm:px-5">
      <header className="flex min-w-0 items-start">
        <span
          className={juntar(
            "mr-2.5 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
            building ? "bg-warning-soft text-warning" : "bg-accent-soft text-primary",
          )}
          aria-hidden="true"
        >
          {building ? <Hammer className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
        </span>
        <h3 className={juntar(texto.tituloSecao, "mr-3 min-w-0 flex-1 truncate")} title={entry.title}>{entry.title}</h3>
        <time dateTime={entry.date} className={juntar(texto.auxiliar, "mt-0.5 shrink-0 tabular-nums")}>
          {formatReleaseDate(entry.date)}
        </time>
      </header>

      <p className="mt-1.5 pl-[30px] text-[13px] leading-5 text-muted-foreground">{entry.summary}</p>

      {entry.items.length > 0 && (
        <details className="group mt-2 pl-[30px]" open={aberta}>
          <summary className={juntar("relative -left-2.5 inline-flex h-7 cursor-pointer list-none items-center rounded-full px-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden", foco)}>
            {entry.items.length} {entry.items.length === 1 ? "melhoria" : "melhorias"}
            <ChevronDown className="ml-1 h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
          </summary>
        <ul className="mt-2 space-y-2.5">
          {entry.items.map((item) => (
            <li key={item.title} className="min-w-0">
              <p className={juntar(texto.corpo, "font-medium")}>{item.title}</p>
              <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{item.description}</p>
            </li>
          ))}
        </ul>
        </details>
      )}
    </article>
  );
}

export default function Novidades() {
  const live = releasesByStatus("no-ar");
  const building = releasesByStatus("esta-semana");

  return (
    <div className="min-w-0 space-y-6">
      <CabecalhoDePagina
        titulo="Novidades"
        descricao={RELEASE_NOTES.length ? `${RELEASE_NOTES.length} ${RELEASE_NOTES.length === 1 ? "registro" : "registros"}` : undefined}
        ajuda="O painel evolui toda semana. Aqui fica o que mudou e o que está sendo construído agora. Nada some nem muda de lugar sem estar escrito aqui."
      />

      <div className="max-w-3xl space-y-6">
        {building.length > 0 && (
          <Secao
            recolher="novidades:chegando"
            titulo={
              <span className="inline-flex items-center">
                <Hammer className="mr-1.5 h-3.5 w-3.5 text-warning" aria-hidden="true" /> Chegando nesta semana
              </span>
            }
          >
            <div className={juntar(superficie.painel, "min-w-0 divide-y divide-border/60")}>
              {building.map((entry) => (
                <Novidade key={entry.id} entry={entry} aberta />
              ))}
            </div>
          </Secao>
        )}

        {live.length > 0 && (
          <Secao
            recolher="novidades:no-ar"
            titulo={
              <span className="inline-flex items-center">
                <Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" aria-hidden="true" /> Já está no ar
              </span>
            }
          >
            <div className={juntar(superficie.painel, "min-w-0 divide-y divide-border/60")}>
              {live.map((entry, i) => (
                <Novidade key={entry.id} entry={entry} aberta={i === 0 && building.length === 0} />
              ))}
            </div>
          </Secao>
        )}

        {RELEASE_NOTES.length === 0 && (
          <EstadoVazio icone={<Sparkles className="h-5 w-5" />} titulo="Nada novo por enquanto" descricao="As próximas novidades do painel aparecem aqui." />
        )}
      </div>
    </div>
  );
}
