import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WORKSPACE_TEMPLATES, WorkspaceTemplate, TplNode } from "@/lib/workspaceTemplates";
import { Building2, Palette, TrendingUp, Clapperboard, Users, Wallet, Handshake, Folder, ChevronRight, Sparkles, Loader2 } from "lucide-react";

const ICON_MAP = { Building2, Palette, TrendingUp, Clapperboard, Users, Wallet, Handshake };

function countNodes(nodes: TplNode[]): number {
  return nodes.reduce((a, n) => a + 1 + countNodes(n.children || []), 0);
}

function TreePreview({ nodes, depth = 0 }: { nodes: TplNode[]; depth?: number }) {
  return (
    <div className="space-y-1">
      {nodes.map((n, i) => (
        <div key={i}>
          <div className="flex items-start gap-1.5 text-[11px]" style={{ paddingLeft: depth * 12 }}>
            {depth > 0 && <ChevronRight className="w-2.5 h-2.5 opacity-40 mt-0.5 shrink-0" />}
            <Folder className="w-3 h-3 text-primary/70 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-foreground/90 truncate">{n.name}</div>
              {n.hint && (
                <div className="text-[10px] text-muted-foreground/80 leading-snug mt-0.5">
                  {n.hint}
                </div>
              )}
            </div>
          </div>
          {n.children && <TreePreview nodes={n.children} depth={depth + 1} />}
        </div>
      ))}
    </div>
  );
}

export function TemplatePicker({
  open, onOpenChange, scope, onApply, applying,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scope: "global" | "client";
  onApply: (tpl: WorkspaceTemplate) => Promise<void> | void;
  applying?: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const available = WORKSPACE_TEMPLATES.filter(t => t.scope === "any" || t.scope === scope);
  const current = available.find(t => t.id === selected) || available[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="w-4 h-4 text-primary" />
            Aplicar template de organização
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Cria a estrutura de pastas dentro do local atual. Pastas existentes são preservadas.
          </p>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.1fr] max-h-[70vh]">
          <div className="border-r overflow-y-auto p-3 space-y-1.5">
            {available.map(t => {
              const Icon = ICON_MAP[t.icon];
              const isActive = current?.id === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setSelected(t.id)}
                  className={cn(
                    "w-full text-left rounded-lg border p-3 transition-all group",
                    isActive
                      ? "border-primary/50 bg-primary/5"
                      : "border-border hover:border-primary/30 hover:bg-secondary/50"
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <div className={cn(
                      "w-8 h-8 rounded-md flex items-center justify-center shrink-0",
                      isActive ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground group-hover:text-foreground"
                    )}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-foreground truncate">{t.name}</div>
                      <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{t.description}</div>
                      <div className="text-[10px] text-muted-foreground/70 mt-1 font-mono">
                        {countNodes(t.tree)} pastas
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <div>
                <div className="text-[13px] font-medium">{current?.name}</div>
                <div className="text-[10px] text-muted-foreground">Prévia da estrutura</div>
              </div>
              <Button
                size="sm"
                disabled={!!applying}
                onClick={() => current && onApply(current)}
                className="gap-1.5"
              >
                {applying === current?.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {applying === current?.id ? "Criando..." : "Aplicar"}
              </Button>
            </div>
            <div className="p-5 overflow-y-auto flex-1 bg-secondary/20">
              {current && <TreePreview nodes={current.tree} />}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
