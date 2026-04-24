import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, ArrowDownRight, Minus, LineChart, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type MetricStatus = "improved" | "stable" | "worsened";

export interface BeforeAfterMetric {
  metric_name: string;
  baseline_value: number;
  current_value: number;
  delta: number;
  deltaPct: number;
  status: MetricStatus;
  unit?: string;
  sparkline?: number[];
}

interface BeforeAfterPanelProps {
  metrics: BeforeAfterMetric[];
  improved_count: number;
  stable_count: number;
}

const STATUS_STYLES: Record<MetricStatus, { color: string; bg: string; label: string; Icon: typeof ArrowUpRight }> = {
  improved: { color: "text-primary", bg: "bg-primary/15 text-primary border-primary/30", label: "Melhorou", Icon: ArrowUpRight },
  stable: { color: "text-muted-foreground", bg: "bg-secondary text-muted-foreground border-border", label: "Estável", Icon: Minus },
  worsened: { color: "text-destructive", bg: "bg-destructive/15 text-destructive border-destructive/30", label: "Piorou", Icon: ArrowDownRight },
};

function fmt(n: number, unit?: string) {
  const formatted = Math.abs(n) >= 1000 ? n.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return unit ? `${formatted}${unit === "%" ? "" : " "}${unit}` : formatted;
}

export function BeforeAfterPanel({ metrics, improved_count, stable_count }: BeforeAfterPanelProps) {
  const hasData = metrics.length > 0;

  return (
    <Card className="p-6 md:p-8 bg-card border-border">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="text-lg font-light text-foreground">Seus resultados até agora</h3>
          </div>
          <p className="text-xs text-muted-foreground font-mono uppercase tracking-widest mt-1">
            Antes vs. depois · operação acelerada
          </p>
        </div>
        {hasData && (
          <div className="flex gap-2">
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
              {improved_count} melhoraram
            </Badge>
            <Badge variant="outline" className="bg-secondary text-muted-foreground border-border">
              {stable_count} estáveis
            </Badge>
          </div>
        )}
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-secondary/60 border border-border flex items-center justify-center mb-4">
            <LineChart className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
            Seus ganhos aparecerão aqui quando as primeiras métricas forem capturadas.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {metrics.map((m, i) => {
            const s = STATUS_STYLES[m.status];
            return (
              <motion.div
                key={m.metric_name}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.4 }}
                className="bg-secondary/30 border border-border rounded-xl p-4 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <span className="text-sm font-medium text-foreground line-clamp-2">{m.metric_name}</span>
                  <Badge variant="outline" className={cn("text-[10px] uppercase tracking-wider font-mono shrink-0", s.bg)}>
                    {s.label}
                  </Badge>
                </div>

                <div className="flex items-end gap-3 mb-2">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Antes</span>
                    <span className="text-base font-mono tabular-nums text-muted-foreground line-through">
                      {fmt(m.baseline_value, m.unit)}
                    </span>
                  </div>
                  <div className="text-muted-foreground/40 text-xl font-light pb-0.5">→</div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Depois</span>
                    <span className={cn("text-xl font-mono tabular-nums font-light", s.color)}>
                      {fmt(m.current_value, m.unit)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border/60">
                  <div className={cn("flex items-center gap-1 text-xs font-mono", s.color)}>
                    <s.Icon className="h-3.5 w-3.5" />
                    <span className="tabular-nums">
                      {m.delta > 0 ? "+" : ""}{fmt(m.delta, m.unit)}
                    </span>
                    <span className="text-muted-foreground">·</span>
                    <span className="tabular-nums">
                      {m.deltaPct > 0 ? "+" : ""}{m.deltaPct.toFixed(1)}%
                    </span>
                  </div>
                  {m.sparkline && m.sparkline.length > 1 && (
                    <Sparkline data={m.sparkline} color={`hsl(var(--${m.status === "improved" ? "primary" : m.status === "worsened" ? "destructive" : "muted-foreground"}))`} />
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 60;
  const h = 18;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={w} height={h} className="opacity-80">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
