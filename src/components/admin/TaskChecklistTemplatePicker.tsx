import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ListChecks, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface Props {
  taskId: string;
  currentCount: number;
  serviceTypeHint?: string;
}

export default function TaskChecklistTemplatePicker({
  taskId,
  currentCount,
  serviceTypeHint,
}: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["task-checklist-templates"],
    queryFn: async () => {
      const { data: t } = await supabase
        .from("task_checklist_templates" as any)
        .select("*")
        .order("title");
      const ids = (t || []).map((x: any) => x.id);
      if (!ids.length) return [];
      const { data: items } = await supabase
        .from("task_checklist_template_items" as any)
        .select("*")
        .in("template_id", ids)
        .order("order_index", { ascending: true });
      return (t || []).map((tpl: any) => ({
        ...tpl,
        items: (items || []).filter((i: any) => i.template_id === tpl.id),
      }));
    },
    enabled: open,
  });

  const ordered = (templates || []).slice().sort((a: any, b: any) => {
    if (!serviceTypeHint) return 0;
    const am = a.service_type === serviceTypeHint ? -1 : 0;
    const bm = b.service_type === serviceTypeHint ? -1 : 0;
    return am - bm;
  });

  const apply = async (tpl: any) => {
    if (!user) return;
    setApplying(tpl.id);
    try {
      const rows = tpl.items.map((it: any, idx: number) => ({
        task_id: taskId,
        title: it.label,
        item_order: currentCount + idx,
        created_by: user.id,
      }));
      const { error } = await supabase.from("task_checklist_items").insert(rows);
      if (error) throw error;
      toast.success(`Checklist "${tpl.title}" aplicado`);
      queryClient.invalidateQueries({ queryKey: ["task-checklist", taskId] });
      setOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao aplicar template");
    } finally {
      setApplying(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-[11px] text-primary hover:underline"
        >
          <Sparkles className="w-3 h-3" />
          Aplicar checklist pronto
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-0 bg-card border-border max-h-[400px] overflow-y-auto"
      >
        <div className="px-3 py-2 border-b border-border flex items-center gap-2">
          <ListChecks className="w-3.5 h-3.5 text-primary" />
          <p className="text-xs font-medium text-foreground">Biblioteca de checklists</p>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {ordered.map((tpl: any) => (
              <li key={tpl.id}>
                <button
                  type="button"
                  onClick={() => apply(tpl)}
                  disabled={applying === tpl.id}
                  className="w-full text-left px-3 py-2.5 hover:bg-secondary/50 transition-colors disabled:opacity-60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-foreground">{tpl.title}</p>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                      {tpl.items.length} itens
                    </span>
                  </div>
                  {tpl.description && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {tpl.description}
                    </p>
                  )}
                  {tpl.service_type && (
                    <span className="inline-block mt-1 text-[9px] uppercase tracking-wider text-primary/80">
                      {tpl.service_type}
                    </span>
                  )}
                </button>
              </li>
            ))}
            {!ordered.length && (
              <li className="px-3 py-4 text-center text-xs text-muted-foreground">
                Nenhum template cadastrado.
              </li>
            )}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
