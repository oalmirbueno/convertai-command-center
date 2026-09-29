import { rotuloCurtoDoMes, rotuloDoMes } from "@/lib/horas/formato";
import { cn } from "@/lib/utils";

/**
 * Gráficos da central de horas (frente CR). Simples e legíveis nos dois temas:
 * uma série por gráfico (um eixo só), cor da marca ou de informação, rótulo
 * direto só no mês escolhido, nome e valor de cada barra no passar do mouse
 * (e no leitor de tela). A tabela do Histórico traz os mesmos números.
 */

export function BarrasPorMes({
  rotulo,
  serie,
  formatar,
  mesEscolhido,
  cor = "bg-primary",
}: {
  rotulo: string;
  serie: Array<{ mes: string; valor: number | null; projetado?: number | null }>;
  formatar: (v: number) => string;
  mesEscolhido: string;
  cor?: string;
}) {
  const maior = serie.reduce((m, p) => Math.max(m, p.valor || 0, p.projetado || 0), 0);
  const ALTURA = 88;
  return (
    <figure className="min-w-0" aria-label={rotulo}>
      <figcaption className="mb-2 text-[12px] font-medium text-muted-foreground">{rotulo}</figcaption>
      <div
        className="grid items-end gap-x-1 border-b border-border"
        style={{ gridTemplateColumns: `repeat(${Math.max(serie.length, 1)}, minmax(0, 1fr))`, height: ALTURA + 18 }}
      >
        {serie.map((p) => {
          const v = p.valor || 0;
          const h = maior > 0 ? Math.max(v > 0 ? 3 : 0, Math.round((v / maior) * ALTURA)) : 0;
          const hp = maior > 0 && p.projetado ? Math.round((p.projetado / maior) * ALTURA) : 0;
          const escolhido = p.mes === mesEscolhido;
          const titulo = `${rotuloDoMes(p.mes)}: ${p.valor === null ? "sem dado" : formatar(v)}${p.projetado ? ` (projetado ${formatar(p.projetado)})` : ""}`;
          return (
            <div key={p.mes} className="relative flex h-full min-w-0 flex-col items-center justify-end" title={titulo} aria-label={titulo} role="img">
              {escolhido && p.valor !== null && (
                <span className="mb-1 whitespace-nowrap text-[11px] font-medium tabular-nums text-foreground">{formatar(v)}</span>
              )}
              <div className="relative w-full max-w-[28px]" style={{ height: Math.max(h, hp) }}>
                {hp > h && (
                  <div aria-hidden="true" className="absolute inset-x-0 bottom-0 rounded-t-[4px] border border-dashed border-muted-foreground/50" style={{ height: hp }} />
                )}
                <div aria-hidden="true" className={cn("absolute inset-x-0 bottom-0 rounded-t-[4px]", cor, !escolhido && "opacity-60")} style={{ height: h }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 grid gap-x-1" style={{ gridTemplateColumns: `repeat(${Math.max(serie.length, 1)}, minmax(0, 1fr))` }} aria-hidden="true">
        {serie.map((p) => (
          <span key={p.mes} className={cn("truncate text-center text-[11px]", p.mes === mesEscolhido ? "font-medium text-foreground" : "text-muted-foreground")}>
            {rotuloCurtoDoMes(p.mes)}
          </span>
        ))}
      </div>
    </figure>
  );
}

const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const DIAS_LONGOS = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];

/** Mapa de horas: dia da semana × hora do dia, mais escuro = mais tempo trabalhado. */
export function MapaDeHoras({ mapa, formatar }: { mapa: number[][]; formatar: (segundos: number) => string }) {
  let maior = 0;
  for (const linha of mapa) for (const v of linha) if (v > maior) maior = v;
  const colunas = "grid min-w-[520px] grid-cols-[32px_repeat(24,minmax(0,1fr))] gap-[2px]";
  return (
    <div className="min-w-0 overflow-x-auto" role="group" aria-label="Mapa de horas trabalhadas por dia da semana e hora">
      <div className={colunas} aria-hidden="true">
        <span />
        {Array.from({ length: 24 }).map((_, h) => (
          <span key={h} className="text-center text-[11px] tabular-nums text-muted-foreground">
            {h % 3 === 0 ? h : ""}
          </span>
        ))}
      </div>
      {mapa.map((linha, d) => (
        <div key={d} className={cn(colunas, "mt-[2px]")}>
          <span className="text-[11px] leading-4 text-muted-foreground">{DIAS[d]}</span>
          {linha.map((v, h) => {
            const alfa = maior > 0 && v > 0 ? 0.15 + 0.85 * (v / maior) : 0;
            const titulo = `${DIAS_LONGOS[d]}, ${h}h: ${v > 0 ? formatar(v) : "nada"}`;
            return (
              <span
                key={h}
                title={titulo}
                aria-label={titulo}
                role="img"
                className={cn("h-4 rounded-[3px]", v > 0 ? "" : "bg-muted/60")}
                style={v > 0 ? { backgroundColor: `hsl(var(--primary) / ${alfa.toFixed(2)})` } : undefined}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Barra fina de proporção (tempo ou custo de um cliente contra o maior da lista). */
export function BarraFina({ fracao, cor = "bg-primary", rotulo }: { fracao: number; cor?: string; rotulo: string }) {
  const pct = Math.max(0, Math.min(1, fracao || 0)) * 100;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={rotulo} title={rotulo}>
      <div className={cn("h-full rounded-full", cor)} style={{ width: `${pct}%` }} />
    </div>
  );
}
