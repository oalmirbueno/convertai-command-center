import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STAGES = [
  "Abertura",
  "Diagnóstico",
  "Arquitetura Base",
  "Plano Diretor",
  "Implantação",
  "Ativação",
  "Otimização",
  "Escala",
];

interface JourneyProgressProps {
  current_stage: string;
  stage_index: number; // 0-based
  total_stages?: number;
  progress_pct: number;
  delivered_count: number;
}

export function JourneyProgress({
  current_stage,
  stage_index,
  total_stages = 8,
  progress_pct,
  delivered_count,
}: JourneyProgressProps) {
  const stages = STAGES.slice(0, total_stages);
  const safeIndex = Math.max(0, Math.min(stages.length - 1, stage_index));

  return (
    <Card className="p-6 md:p-8 bg-card border-border">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <div>
          <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-mono">
            Jornada ACELERA
          </span>
          <h3 className="text-lg font-light text-foreground mt-1">
            Etapa atual: <span className="text-primary">{current_stage}</span>
          </h3>
        </div>
        <div className="text-right">
          <span className="text-2xl font-mono font-light text-primary tabular-nums">
            {Math.round(progress_pct)}%
          </span>
        </div>
      </div>

      {/* Progress bar with stages */}
      <div className="relative pt-2 pb-8">
        {/* Background line */}
        <div className="absolute top-[22px] left-0 right-0 h-0.5 bg-secondary rounded-full" />
        {/* Filled line */}
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${(safeIndex / (stages.length - 1)) * 100}%` }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
          className="absolute top-[22px] left-0 h-0.5 bg-primary rounded-full"
          style={{ boxShadow: "0 0 8px hsl(var(--primary))" }}
        />

        <div className="relative flex justify-between">
          {stages.map((stage, i) => {
            const isDone = i < safeIndex;
            const isCurrent = i === safeIndex;
            return (
              <div key={stage} className="flex flex-col items-center" style={{ flex: "1 1 0", minWidth: 0 }}>
                <div className="relative">
                  {isCurrent && (
                    <motion.div
                      className="absolute inset-0 rounded-full bg-primary/40"
                      animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    />
                  )}
                  <div
                    className={cn(
                      "relative w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors",
                      isDone && "bg-primary border-primary text-primary-foreground",
                      isCurrent && "bg-primary border-primary text-primary-foreground",
                      !isDone && !isCurrent && "bg-card border-border text-muted-foreground"
                    )}
                    style={isCurrent ? { boxShadow: "0 0 16px hsl(var(--primary) / 0.6)" } : undefined}
                  >
                    {isDone ? (
                      <Check className="h-4 w-4" strokeWidth={2.5} />
                    ) : (
                      <span className="text-xs font-mono tabular-nums">{i + 1}</span>
                    )}
                  </div>
                </div>
                <span
                  className={cn(
                    "text-[10px] md:text-xs font-mono uppercase tracking-wider mt-3 text-center px-1 leading-tight",
                    isCurrent && "text-primary font-medium",
                    isDone && "text-foreground/80",
                    !isDone && !isCurrent && "text-muted-foreground"
                  )}
                >
                  {stage}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground border-t border-border pt-4">
        <span className="font-mono tabular-nums text-foreground">{safeIndex + 1}</span>
        <span>de</span>
        <span className="font-mono tabular-nums">{stages.length} etapas</span>
        <span className="text-muted-foreground/40">·</span>
        <span className="font-mono tabular-nums text-primary">{delivered_count}</span>
        <span>entregáveis concluídos</span>
      </div>
    </Card>
  );
}
