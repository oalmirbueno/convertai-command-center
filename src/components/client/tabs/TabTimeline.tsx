import { useState } from "react";
import { useMilestones } from "@/hooks/useSupabaseData";
import { Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const statusLabels: Record<string, string> = {
  completed: "Concluído",
  in_progress: "Em andamento",
  pending: "Pendente",
};

const statusBadge: Record<string, string> = {
  completed: "bg-success/10 text-success",
  in_progress: "bg-primary/10 text-primary",
  pending: "bg-muted text-muted-foreground",
};

export default function TabTimeline({ projectId }: { projectId: string }) {
  const { data: milestones, isLoading } = useMilestones(projectId);

  const formatDate = (d: string) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  };

  if (isLoading) {
    return (
      <div className="flex gap-8 py-8">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-40" />)}
      </div>
    );
  }

  if (!milestones?.length) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Timeline será atualizada em breve</p>;
  }

  // Find the index of the last completed milestone to draw the progress line
  const lastCompletedIdx = milestones.reduce((acc: number, m: any, i: number) => m.status === "completed" ? i : acc, -1);

  return (
    <div className="overflow-x-auto pb-4">
      {/* Horizontal timeline */}
      <div className="flex items-start gap-0 min-w-max px-4 py-8" style={{ scrollSnapType: "x mandatory" }}>
        {milestones.map((m: any, i: number) => (
          <div key={m.id} className="flex items-start" style={{ scrollSnapAlign: "start" }}>
            {/* Node + content */}
            <div className="flex flex-col items-center" style={{ minWidth: 160 }}>
              <Popover>
                <PopoverTrigger asChild>
                  <button className="relative z-10 focus:outline-none">
                    {m.status === "completed" ? (
                      <div className="w-3 h-3 rounded-full bg-primary flex items-center justify-center">
                        <Check className="w-2 h-2 text-primary-foreground" />
                      </div>
                    ) : m.status === "in_progress" ? (
                      <div className="w-3 h-3 rounded-full border-2 border-primary bg-transparent milestone-pulse" />
                    ) : (
                      <div className="w-3 h-3 rounded-full bg-secondary" />
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 bg-popover border-border rounded-[10px] p-4" sideOffset={12}>
                  <p className="text-sm font-medium text-foreground">{m.title}</p>
                  {m.description && <p className="text-xs text-muted-foreground mt-1">{m.description}</p>}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-muted-foreground">{formatDate(m.target_date)}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusBadge[m.status]}`}>
                      {statusLabels[m.status]}
                    </span>
                  </div>
                </PopoverContent>
              </Popover>
              <div className="mt-3 text-center">
                <p className="text-xs font-medium text-foreground">{m.title}</p>
                <p className="text-[11px] text-muted-foreground">{formatDate(m.target_date)}</p>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full mt-1 inline-block ${statusBadge[m.status]}`}>
                  {statusLabels[m.status]}
                </span>
              </div>
            </div>
            {/* Connecting line */}
            {i < milestones.length - 1 && (
              <div className="flex items-center mt-1.5" style={{ width: 80 }}>
                <div className={`h-[2px] w-full ${i <= lastCompletedIdx ? "bg-primary" : "bg-secondary"}`} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Mobile vertical fallback */}
      <div className="md:hidden space-y-4 mt-4">
        {milestones.map((m: any, i: number) => (
          <div key={m.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              {m.status === "completed" ? (
                <div className="w-3 h-3 rounded-full bg-primary flex items-center justify-center shrink-0">
                  <Check className="w-2 h-2 text-primary-foreground" />
                </div>
              ) : m.status === "in_progress" ? (
                <div className="w-3 h-3 rounded-full border-2 border-primary bg-transparent milestone-pulse shrink-0" />
              ) : (
                <div className="w-3 h-3 rounded-full bg-secondary shrink-0" />
              )}
              {i < milestones.length - 1 && (
                <div className={`w-[2px] flex-1 mt-1 ${i <= lastCompletedIdx ? "bg-primary" : "bg-secondary"}`} />
              )}
            </div>
            <div className="pb-4">
              <p className="text-xs font-medium text-foreground">{m.title}</p>
              <p className="text-[11px] text-muted-foreground">{formatDate(m.target_date)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
