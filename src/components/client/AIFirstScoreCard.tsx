import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Sparkles, Cpu, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

export type AIFirstStatus = "below" | "on_track" | "above";

interface AIFirstScoreCardProps {
  score: number;
  target: number;
  totalNodes: number;
  aiNodes: number;
  automationNodes: number;
  status: AIFirstStatus;
}

const STATUS_CONFIG: Record<AIFirstStatus, { color: string; ring: string; label: string; message: string }> = {
  below: {
    color: "text-warning",
    ring: "hsl(var(--warning))",
    label: "Em construção",
    message: "Estamos construindo a camada de IA na sua operação. Em breve você verá o score subir.",
  },
  on_track: {
    color: "text-info",
    ring: "hsl(var(--info))",
    label: "No caminho",
    message: "Sua operação está se transformando em AI-first conforme o plano.",
  },
  above: {
    color: "text-primary",
    ring: "hsl(var(--primary))",
    label: "Acima da meta",
    message: "Parabéns! Sua operação já supera a meta de IA do plano contratado.",
  },
};

export function AIFirstScoreCard({
  score,
  target,
  totalNodes,
  aiNodes,
  automationNodes,
  status,
}: AIFirstScoreCardProps) {
  const cfg = STATUS_CONFIG[status];
  const size = 200;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = c - (clamped / 100) * c;
  const targetAngle = (Math.max(0, Math.min(100, target)) / 100) * 360 - 90;

  return (
    <Card className="p-6 md:p-8 bg-card border-border overflow-hidden relative">
      <div className="flex flex-col items-center text-center">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-mono">
            AI-First Score
          </span>
        </div>
        <span className={cn("text-[10px] uppercase tracking-widest font-mono mb-6", cfg.color)}>
          {cfg.label}
        </span>

        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="hsl(var(--secondary))"
              strokeWidth={stroke}
            />
            <motion.circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={cfg.ring}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              initial={{ strokeDashoffset: c }}
              animate={{ strokeDashoffset: offset }}
              transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
              style={{ filter: `drop-shadow(0 0 8px ${cfg.ring})` }}
            />
          </svg>

          {/* Target tick */}
          <div
            className="absolute top-1/2 left-1/2 origin-left"
            style={{
              transform: `rotate(${targetAngle}deg) translateX(${r - stroke / 2 - 4}px)`,
              width: stroke + 8,
              height: 2,
            }}
          >
            <div className="w-full h-full bg-foreground/70" />
          </div>

          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <motion.span
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.6 }}
              className={cn("text-5xl font-mono font-light tabular-nums", cfg.color)}
            >
              {Math.round(clamped)}
            </motion.span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mt-1">
              de 100
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 w-full mt-8 max-w-sm">
          <Stat label="Meta" value={target} mono />
          <Stat label="Nodes IA" value={aiNodes} icon={<Cpu className="h-3 w-3" />} sub={`/ ${totalNodes}`} />
          <Stat label="Automações" value={automationNodes} icon={<Workflow className="h-3 w-3" />} />
        </div>

        <p className="text-sm text-muted-foreground mt-6 max-w-md leading-relaxed">
          {cfg.message}
        </p>
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  sub,
  icon,
  mono,
}: {
  label: string;
  value: number;
  sub?: string;
  icon?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="bg-secondary/40 border border-border rounded-lg px-3 py-2.5 flex flex-col items-center">
      <div className="flex items-center gap-1 text-muted-foreground mb-1">
        {icon}
        <span className="text-[10px] uppercase tracking-widest font-mono">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className={cn("text-lg font-mono tabular-nums text-foreground", mono && "text-primary")}>
          {value}
        </span>
        {sub && <span className="text-[10px] text-muted-foreground font-mono">{sub}</span>}
      </div>
    </div>
  );
}
