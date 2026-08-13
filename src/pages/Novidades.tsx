import { CheckCircle2, Hammer, Sparkles } from "lucide-react";
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
 */

function ReleaseCard({ entry }: { entry: ReleaseEntry }) {
  const building = entry.status === "esta-semana";
  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
              building
                ? "border-warning/30 bg-warning/10 text-warning"
                : "border-primary/30 bg-primary/10 text-primary"
            }`}
          >
            {building ? <Hammer className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          </span>
          <h2 className="text-[15px] font-semibold leading-tight text-foreground">{entry.title}</h2>
        </div>
        <span className="text-[11px] text-muted-foreground">{formatReleaseDate(entry.date)}</span>
      </header>

      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{entry.summary}</p>

      <ul className="mt-4 space-y-3">
        {entry.items.map((item) => (
          <li key={item.title} className="border-l-2 border-border pl-3">
            <p className="text-[13px] font-medium text-foreground">{item.title}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
              {item.description}
            </p>
          </li>
        ))}
      </ul>
    </article>
  );
}

export default function Novidades() {
  const live = releasesByStatus("no-ar");
  const building = releasesByStatus("esta-semana");

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="heading-page">Novidades</h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          O seu painel evolui toda semana. Aqui fica o registro do que mudou, em português claro, e
          do que está sendo construído agora. Nada some e nada muda de lugar sem estar escrito aqui.
        </p>
      </div>

      {building.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Hammer className="h-3.5 w-3.5" /> Chegando nesta semana
          </h2>
          {building.map((entry) => (
            <ReleaseCard key={entry.id} entry={entry} />
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" /> Já está no ar
        </h2>
        {live.map((entry) => (
          <ReleaseCard key={entry.id} entry={entry} />
        ))}
      </section>

      {RELEASE_NOTES.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          As próximas novidades do painel aparecem aqui.
        </p>
      )}
    </div>
  );
}
