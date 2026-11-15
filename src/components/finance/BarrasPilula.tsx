import type { ReactNode } from "react";

export interface BarraPilula {
  rotulo: string;
  valor: number;
  /** Parte ainda prevista (não realizada): sai hachurada em cima da barra cheia. */
  previsto?: number;
}

/**
 * Gráfico de barras em pílula (v4, como nas referências): barras largas com
 * topo e base redondos, as apagadas hachuradas e a do período atual cheia na
 * cor da marca, com o valor num balão em cima. Só desenha o que recebe: sem
 * valor, a barra vira um toco baixo. Altura fixa (nada pula ao carregar).
 */
export default function BarrasPilula({
  itens,
  destaque,
  formatar,
  altura = 220,
  rotuloAcessivel,
  vazio,
  className = "",
}: {
  itens: BarraPilula[];
  /** Índice da barra em destaque (o período atual). */
  destaque?: number;
  formatar: (v: number) => string;
  altura?: number;
  rotuloAcessivel: string;
  /** Mostrado por cima quando todos os valores são zero. */
  vazio?: ReactNode;
  className?: string;
}) {
  const total = (b: BarraPilula) => Math.max(0, b.valor) + Math.max(0, b.previsto || 0);
  const max = Math.max(1, ...itens.map(total));
  const tudoZero = itens.every((b) => total(b) === 0);
  const area = altura - 28; // o rodapé dos rótulos
  return (
    <div className={`relative min-w-0 ${className}`} style={{ height: altura }} role="img" aria-label={`${rotuloAcessivel}: ${itens.map((b) => `${b.rotulo} ${formatar(b.valor)}`).join(", ")}`}>
      {/* Linhas de guia tracejadas */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0" style={{ height: area }}>
        {[0, 1, 2, 3].map((n) => (
          <span key={n} className="absolute inset-x-0 border-t border-dashed border-border" style={{ top: `${(n / 4) * 100}%` }} />
        ))}
        <span className="absolute inset-x-0 bottom-0 border-t border-border" />
      </div>
      <div aria-hidden="true" className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${itens.length}, minmax(0, 1fr))` }}>
        {itens.map((b, i) => {
          const ativo = i === destaque;
          const t = total(b);
          const h = t > 0 ? Math.max(14, (t / max) * (area - 34)) : 8;
          const hPrevisto = t > 0 && b.previsto ? (Math.max(0, b.previsto) / t) * h : 0;
          return (
            <div key={i} className="flex min-w-0 flex-col items-center justify-end px-1 sm:px-2" title={`${b.rotulo}: ${formatar(b.valor)}${b.previsto ? ` · previsto ${formatar(b.previsto)}` : ""}`}>
              {ativo && t > 0 && (
                <span className={`mb-1.5 whitespace-nowrap rounded-full ${i === itens.length - 1 ? "self-end" : i === 0 ? "self-start" : ""} bg-foreground px-2 py-0.5 text-[11px] font-medium leading-4 tabular-nums text-background`}>{formatar(b.valor)}</span>
              )}
              <div className="flex w-full max-w-[56px] flex-col overflow-hidden rounded-full" style={{ height: h }}>
                {hPrevisto > 0 && <span className={`block w-full shrink-0 ds-hatch-forte ${ativo ? "bg-accent-solid/35" : "bg-primary/10"}`} style={{ height: hPrevisto }} />}
                <span className={`block w-full flex-1 ${ativo ? "bg-accent-solid" : "ds-hatch bg-primary/25"}`} />
              </div>
              <span className={`mt-2 block h-5 w-full truncate text-center text-[11px] leading-5 ${ativo ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{b.rotulo}</span>
            </div>
          );
        })}
      </div>
      {tudoZero && vazio && <div className="absolute inset-x-0 top-0 flex items-center justify-center text-[12px] text-muted-foreground" style={{ height: area }}>{vazio}</div>}
    </div>
  );
}
