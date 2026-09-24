import { useState, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSegundos, tempoCurto } from "@/components/mesa/Cronometro";
import { AVISO_DA_EVIDENCIA, ESCALA_DE_EVIDENCIA, type Evidencia } from "./adsApi";

/** Cartão das etapas: título pequeno em caixa alta, ação à direita, corpo livre. */
export function Cartao({
  titulo,
  dica,
  acao,
  children,
  className = "",
}: {
  titulo: ReactNode;
  dica?: ReactNode;
  acao?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-xl border border-border bg-card p-4 ${className}`}>
      <div className="mb-3 flex min-w-0 items-start">
        <div className="min-w-0 flex-1">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{titulo}</h3>
          {dica && <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{dica}</p>}
        </div>
        {acao && <div className="ml-2 shrink-0">{acao}</div>}
      </div>
      {children}
    </section>
  );
}

/** Selo E0 a E4 com cor e a escala inteira no tooltip (a atual em destaque). */
export function SeloDeEvidencia({ valor, className = "" }: { valor: Evidencia; className?: string }) {
  const nivel = ESCALA_DE_EVIDENCIA.find((e) => e.valor === valor) || ESCALA_DE_EVIDENCIA[0];
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Evidência ${nivel.valor}: ${nivel.rotulo}`}
            data-evidencia={nivel.valor}
            onClick={(e) => e.stopPropagation()}
            className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10.5px] font-semibold tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${nivel.cor} ${className}`}
          >
            {nivel.valor}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px] p-3">
          <p className="text-[12px] font-semibold">Escala de evidência</p>
          <ul className="mt-1.5 space-y-1">
            {ESCALA_DE_EVIDENCIA.map((e) => (
              <li key={e.valor} className={`text-[11.5px] leading-snug ${e.valor === nivel.valor ? "text-foreground" : "text-muted-foreground"}`}>
                <span className={`mr-1.5 font-semibold ${e.valor === nivel.valor ? "" : "opacity-70"}`}>{e.valor}</span>
                <span className={e.valor === nivel.valor ? "font-medium" : ""}>{e.rotulo}</span>: {e.dica}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{AVISO_DA_EVIDENCIA}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Rótulo de campo; sem dado, a caixa fica marcada como lacuna (nada é inventado). */
export function Campo({
  rotulo,
  lacuna,
  children,
  dica,
}: {
  rotulo: string;
  lacuna?: boolean;
  children: ReactNode;
  dica?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 flex min-w-0 items-center text-[11.5px] font-medium text-foreground/80">
        <span className="min-w-0 truncate">{rotulo}</span>
        {lacuna && <span className="ml-1.5 shrink-0 rounded-full bg-warning/15 px-1.5 py-px text-[10px] font-medium text-warning">lacuna</span>}
      </span>
      <span className={`block rounded-md ${lacuna ? "ring-1 ring-warning/50 ring-offset-0" : ""}`}>{children}</span>
      {dica && <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">{dica}</span>}
    </label>
  );
}

/** Andamento discreto de uma ação de IA (rótulo e cronômetro), fora do botão. */
export function Andamento({ desde, rotulo }: { desde: number | null; rotulo: string }) {
  const s = useSegundos(desde);
  if (desde === null) return null;
  return (
    <span role="status" className="inline-flex items-center text-[11.5px] text-muted-foreground">
      <span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-primary" aria-hidden="true" />
      {rotulo}
      <span className="ml-1.5 tabular-nums">{tempoCurto(s)}</span>
    </span>
  );
}

/** Marca o início de uma ação longa e solta ao terminar (para o cronômetro). */
export function useAndamento(): [number | null, <T>(fn: () => Promise<T>) => Promise<T>] {
  const [desde, setDesde] = useState<number | null>(null);
  const rodar = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setDesde(Date.now());
    try {
      return await fn();
    } finally {
      setDesde(null);
    }
  };
  return [desde, rodar];
}

/** Barra de 0 a 10 (nota do Jev). `inverso`: quanto maior, pior (risco). */
export function BarraDeNota({ rotulo, nota, inverso = false }: { rotulo: string; nota: number | null; inverso?: boolean }) {
  const boa = nota === null ? null : inverso ? nota <= 3 : nota >= 7;
  const media = nota === null ? null : inverso ? nota > 3 && nota <= 6 : nota >= 5 && nota < 7;
  const cor = nota === null ? "bg-muted" : boa ? "bg-success" : media ? "bg-warning" : "bg-destructive";
  return (
    <div className="min-w-0" title={`${rotulo}: ${nota === null ? "sem nota" : `${nota.toLocaleString("pt-BR")} de 10`}${inverso ? " (quanto menor, melhor)" : ""}`}>
      <div className="flex items-baseline justify-between text-[10.5px] text-muted-foreground">
        <span className="truncate">{rotulo}</span>
        <span className="ml-1 shrink-0 tabular-nums text-foreground">{nota === null ? "-" : nota.toLocaleString("pt-BR")}</span>
      </div>
      <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary" role="meter" aria-label={rotulo} aria-valuemin={0} aria-valuemax={10} aria-valuenow={nota === null ? undefined : nota}>
        <div className={`h-full rounded-full ${cor}`} style={{ width: `${nota === null ? 0 : nota * 10}%` }} />
      </div>
    </div>
  );
}
