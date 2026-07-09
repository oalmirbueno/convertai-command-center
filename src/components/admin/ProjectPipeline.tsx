import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Clapperboard, Music2, Scissors, Sparkles, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type PipelineStageKey = "brutos" | "trilhas" | "edicao" | "final";
export type PipelineState = {
  enabled: boolean;
  stages: Record<PipelineStageKey, boolean>;
  updated_at?: string;
};

export const PIPELINE_STAGES: {
  key: PipelineStageKey; label: string; short: string; icon: any;
}[] = [
  { key: "brutos",  label: "Brutos",       short: "BRU", icon: Clapperboard },
  { key: "trilhas", label: "Trilhas/SFX",  short: "TRI", icon: Music2 },
  { key: "edicao",  label: "Edição",       short: "EDT", icon: Scissors },
  { key: "final",   label: "Final",        short: "FIN", icon: Sparkles },
];

export function normalizePipeline(raw: any): PipelineState {
  const stages = raw?.stages || {};
  return {
    enabled: !!raw?.enabled,
    stages: {
      brutos:  !!stages.brutos,
      trilhas: !!stages.trilhas,
      edicao:  !!stages.edicao,
      final:   !!stages.final,
    },
    updated_at: raw?.updated_at,
  };
}

export function pipelineProgress(raw: any): { done: number; total: number; pct: number } {
  const p = normalizePipeline(raw);
  const total = PIPELINE_STAGES.length;
  const done = PIPELINE_STAGES.reduce((a, s) => a + (p.stages[s.key] ? 1 : 0), 0);
  return { done, total, pct: Math.round((done / total) * 100) };
}

/**
 * Compact stage bar for lists/cards. Renders nothing when pipeline is disabled.
 */
export function PipelineBar({ pipeline, className }: { pipeline: any; className?: string }) {
  const p = normalizePipeline(pipeline);
  if (!p.enabled) return null;
  return (
    <div className={cn("flex items-center gap-1", className)} title="Pipeline audiovisual">
      {PIPELINE_STAGES.map((s) => {
        const done = p.stages[s.key];
        return (
          <span
            key={s.key}
            className={cn(
              "h-1.5 w-5 rounded-full transition-colors",
              done ? "bg-primary" : "bg-secondary"
            )}
            aria-label={`${s.label}: ${done ? "concluído" : "pendente"}`}
          />
        );
      })}
    </div>
  );
}

/**
 * Full editor: enable toggle + 4 stage checkboxes. Optional and self-persists.
 */
export function ProjectPipelineChecklist({ projectId, projectName, pipeline }: {
  projectId: string;
  projectName?: string;
  pipeline: any;
}) {
  const qc = useQueryClient();
  const [state, setState] = useState<PipelineState>(() => normalizePipeline(pipeline));
  const [saving, setSaving] = useState<string | null>(null);
  const progress = useMemo(() => pipelineProgress(state), [state]);

  async function persist(next: PipelineState, tag: string) {
    setSaving(tag);
    setState(next);
    const payload = { ...next, updated_at: new Date().toISOString() };
    const { error } = await supabase
      .from("projects")
      .update({ pipeline: payload as any })
      .eq("id", projectId);
    setSaving(null);
    if (error) {
      toast.error("Não foi possível salvar o pipeline");
      return;
    }
    qc.invalidateQueries({ queryKey: ["projects"] });
  }

  async function toggleEnabled(v: boolean) {
    await persist({ ...state, enabled: v }, "enable");
    if (v) toast.success("Pipeline ativado");
  }

  async function toggleStage(key: PipelineStageKey) {
    if (!state.enabled) return;
    await persist(
      { ...state, stages: { ...state.stages, [key]: !state.stages[key] } },
      key
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Pipeline Audiovisual
          <span className="ml-1 text-[10px] normal-case tracking-normal text-muted-foreground/70">(opcional)</span>
        </p>
        {state.enabled ? (
          <span className="text-[10px] font-mono text-muted-foreground">
            {progress.done}/{progress.total} · {progress.pct}%
          </span>
        ) : (
          <button
            onClick={() => toggleEnabled(true)}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-dashed border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
          >
            <Plus className="w-2.5 h-2.5" /> ativar
          </button>
        )}
      </div>

      {state.enabled && (
        <>
          <div className="h-1 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress.pct}%` }}
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {PIPELINE_STAGES.map((s) => {
              const done = state.stages[s.key];
              const Icon = s.icon;
              const busy = saving === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => toggleStage(s.key)}
                  disabled={busy}
                  className={cn(
                    "group flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-all",
                    done
                      ? "bg-primary/10 border-primary/40 text-foreground"
                      : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
                  )}
                >
                  <div className={cn(
                    "w-5 h-5 rounded-md flex items-center justify-center shrink-0 border transition-colors",
                    done ? "bg-primary border-primary text-primary-foreground" : "border-border"
                  )}>
                    {done ? <Check className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                  </div>
                  <span className="text-[12px] font-medium truncate">{s.label}</span>
                </button>
              );
            })}
          </div>

          <button
            onClick={() => toggleEnabled(false)}
            className="text-[10px] text-muted-foreground/70 hover:text-destructive transition-colors"
          >
            desativar pipeline
          </button>
        </>
      )}
    </div>
  );
}
