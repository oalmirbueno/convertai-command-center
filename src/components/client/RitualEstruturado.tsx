import { estruturaDoRitual, proximoPassoDoTexto } from "@/lib/ritualTexto";

/**
 * A mensagem do ritual, do jeito que o portal do cliente mostra.
 *
 * No WhatsApp o texto vai com *asteriscos* e blocos curtos. No painel o
 * cliente espera algo mais organizado e completo: cada bloco vira uma secao
 * com titulo proprio, listas viram listas, e a despedida "tudo detalhado no
 * painel" some porque ele JA esta no painel. O texto e o mesmo; a forma nao.
 */
const ROTULOS: Record<string, string> = {
  "onde estamos": "Onde estamos",
  "o que avançou": "O que avançou",
  "o que avancou": "O que avançou",
  "o que os números dizem": "O que os números dizem",
  "o que os numeros dizem": "O que os números dizem",
  "o que vem agora": "O que vem agora",
  "precisamos de você": "Precisamos de você",
  "precisamos de voce": "Precisamos de você",
};

function rotulo(titulo: string): string {
  return ROTULOS[titulo.toLowerCase().trim()] ?? titulo.replace(/[:*]/g, "").trim();
}

export function RitualEstruturado({ body, nextSteps, compact = false, className = "" }: {
  body: string | null | undefined;
  nextSteps?: string | null;
  /** Cartao ou linha do tempo: abertura + os dois primeiros blocos, sem cortar frase. */
  compact?: boolean;
  className?: string;
}) {
  const e = estruturaDoRitual(body);
  if (!e.abertura && e.blocos.length === 0 && e.solto.length === 0) return null;
  const blocos = compact ? e.blocos.slice(0, 2) : e.blocos;
  const restantes = compact ? e.blocos.slice(2) : [];
  // O proximo passo separado costuma ser o mesmo texto de "O que vem agora" e
  // "Precisamos de voce"; mostrar duas vezes so polui.
  const passo = (nextSteps ?? "").trim();
  const passoRepetido = !passo || passo === proximoPassoDoTexto(body) || e.blocos.some((b) => b.linhas.join(" ").trim() === passo);
  return (
    <div className={`space-y-3 ${className}`}>
      {e.abertura && <p className="text-[13px] leading-relaxed text-foreground">{e.abertura}</p>}
      {e.solto.length > 0 && e.blocos.length === 0 && (
        <p className="whitespace-pre-line text-[13px] leading-relaxed text-muted-foreground">{e.solto.join("\n")}</p>
      )}
      {blocos.map((b, i) => (
        <section key={`${b.titulo}-${i}`} className="rounded-lg border border-border/70 bg-secondary/25 px-3.5 py-2.5">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-primary">{rotulo(b.titulo)}</p>
          {b.linhas.length > 1 ? (
            <ul className="mt-1 space-y-1">
              {b.linhas.map((l, j) => (
                <li key={j} className="flex gap-2 text-[12.5px] leading-relaxed text-foreground"><span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />{l}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[12.5px] leading-relaxed text-foreground">{b.linhas[0] ?? ""}</p>
          )}
        </section>
      ))}
      {restantes.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Também nesta atualização: {restantes.map((b) => rotulo(b.titulo)).join(" · ")}.
        </p>
      )}
      {!compact && !passoRepetido && (
        <section className="rounded-lg border border-primary/25 bg-primary/[0.05] px-3.5 py-2.5">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-primary">Próximo passo combinado</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-foreground">{passo}</p>
        </section>
      )}
      {!compact && e.fechamento && <p className="text-[12px] leading-relaxed text-muted-foreground">{e.fechamento}</p>}
    </div>
  );
}

export default RitualEstruturado;
