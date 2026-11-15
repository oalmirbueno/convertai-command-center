import { StatCard, StatGrid } from "@/components/ds";
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
    <article className="group/novidade relative min-w-0 px-5 py-5 pl-[60px] sm:px-6 sm:pl-[68px]">
      {/* Linha do tempo: o círculo do registro e o fio que liga ao próximo. */}
      <span aria-hidden="true" className="absolute bottom-0 left-[35px] top-0 w-px bg-border/70 group-first/novidade:top-6 group-last/novidade:bottom-auto group-last/novidade:h-6 sm:left-[39px]" />
      <span
        className={juntar(
          "absolute left-5 top-5 flex h-8 w-8 items-center justify-center rounded-full ring-4 ring-card sm:left-6",
          building ? "bg-warning-soft text-warning" : "bg-accent-soft text-primary",
        )}
        aria-hidden="true"
      >
        {building ? <Hammer className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
      </span>
      <header className="min-w-0">
        <time dateTime={entry.date} className={juntar(texto.auxiliar, "block tabular-nums")}>
          {formatReleaseDate(entry.date)}
        </time>
        <h3 className={juntar(texto.tituloSecao, "mt-0.5 min-w-0 [overflow-wrap:anywhere]")}>{entry.title}</h3>
      </header>

      <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">{entry.summary}</p>

      {entry.items.length > 0 && (
        <details className="group mt-2" open={aberta}>
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
        ajuda="O painel evolui toda semana. Aqui fica o que mudou e o que está sendo construído agora. Nada some nem muda de lugar sem estar escrito aqui."
      />

      {RELEASE_NOTES.length > 0 && (
        <StatGrid cols={2} label="Novidades em números" className="max-w-3xl">
          <StatCard variant="ink" icon={<Sparkles className="h-4 w-4" />} label="No ar" value={live.length} hint={live.length === 1 ? "novidade publicada" : "novidades publicadas"} />
          <StatCard variant="accent" icon={<Hammer className="h-4 w-4" />} label="Chegando" value={building.length} hint="Em construção nesta semana" />
        </StatGrid>
      )}

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
            <div className={juntar(superficie.painel, "min-w-0 py-1")}>
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
            <div className={juntar(superficie.painel, "min-w-0 py-1")}>
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
