import { CheckCircle2, Hammer, Sparkles } from "lucide-react";
import { CabecalhoDePagina, EstadoVazio, Secao, juntar, texto } from "@/components/sistema";
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

function Novidade({ entry }: { entry: ReleaseEntry }) {
  const building = entry.status === "esta-semana";
  return (
    <article className="min-w-0 py-5 first:pt-0">
      <header className="flex min-w-0 items-start">
        <span
          className={juntar(
            "mr-2.5 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
            building ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary",
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
        <ul className="mt-3 space-y-2.5 pl-[30px]">
          {entry.items.map((item) => (
            <li key={item.title} className="min-w-0">
              <p className={juntar(texto.corpo, "font-medium")}>{item.title}</p>
              <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{item.description}</p>
            </li>
          ))}
        </ul>
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
            <div className="divide-y divide-border">
              {building.map((entry) => (
                <Novidade key={entry.id} entry={entry} />
              ))}
            </div>
          </Secao>
        )}

        {live.length > 0 && (
          <Secao
            divisoria={building.length > 0}
            recolher="novidades:no-ar"
            titulo={
              <span className="inline-flex items-center">
                <Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" aria-hidden="true" /> Já está no ar
              </span>
            }
          >
            <div className="divide-y divide-border">
              {live.map((entry) => (
                <Novidade key={entry.id} entry={entry} />
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
