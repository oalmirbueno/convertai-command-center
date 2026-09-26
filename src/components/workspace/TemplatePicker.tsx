import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WORKSPACE_TEMPLATES, WorkspaceTemplate, TplNode } from "@/lib/workspaceTemplates";
import { Building2, Palette, TrendingUp, Clapperboard, Users, Wallet, Handshake, Folder, Sparkles, Loader2 } from "lucide-react";
import { botao, foco, juntar, superficie, texto, useEstadoDaTela } from "@/components/sistema";

const ICON_MAP = { Building2, Palette, TrendingUp, Clapperboard, Users, Wallet, Handshake };

function countNodes(nodes: TplNode[]): number {
  return nodes.reduce((a, n) => a + 1 + countNodes(n.children || []), 0);
}

/** Prévia da estrutura: pastas em árvore, com a dica de cada uma em uma linha. */
function TreePreview({ nodes, depth = 0 }: { nodes: TplNode[]; depth?: number }) {
  return (
    <ul className="min-w-0">
      {nodes.map((n, i) => (
        <li key={i} className="min-w-0">
          <div className="flex min-w-0 items-start py-1" style={{ paddingLeft: depth * 14 }}>
            <Folder className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className={juntar(texto.corpo, "truncate")}>{n.name}</p>
              {n.hint && <p className={juntar(texto.auxiliar, "truncate")} title={n.hint}>{n.hint}</p>}
            </div>
          </div>
          {n.children && n.children.length > 0 && <TreePreview nodes={n.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

/**
 * Escolha de template de pastas do Workspace. Sistema de design
 * (docs/design/SISTEMA.md): lista com divisória à esquerda, prévia à direita,
 * um primário ("Aplicar") na linha do título da prévia. O template escolhido
 * fica guardado (sair e voltar mantém).
 */
export function TemplatePicker({
  open, onOpenChange, scope, onApply, applying,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scope: "global" | "client";
  onApply: (tpl: WorkspaceTemplate) => Promise<void> | void;
  applying?: string | null;
}) {
  const [selected, setSelected] = useEstadoDaTela<string | null>("workspace:template", null, {
    validar: (v) => v === null || typeof v === "string",
  });
  const available = WORKSPACE_TEMPLATES.filter(t => t.scope === "any" || t.scope === scope);
  const current = available.find(t => t.id === selected) || available[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 pb-3 pt-4 text-left">
          <DialogTitle className="text-[15px]">Template de pastas</DialogTitle>
          <DialogDescription className="text-[12px]">
            Cria as pastas no local aberto. As que já existem ficam como estão.
          </DialogDescription>
        </DialogHeader>

        {/* Celular: a janela rola inteira. Computador: cada coluna rola sozinha. */}
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto overscroll-contain md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden">
          <ul
            aria-label="Templates"
            className="min-w-0 divide-y divide-border border-b border-border p-2 md:min-h-0 md:overflow-y-auto md:overscroll-contain md:border-b-0 md:border-r"
          >
            {available.map(t => {
              const Icon = ICON_MAP[t.icon];
              const isActive = current?.id === t.id;
              return (
                <li key={t.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setSelected(t.id)}
                    aria-pressed={isActive}
                    className={juntar(
                      "flex w-full min-w-0 items-start rounded-md px-2.5 py-2.5 text-left transition-colors",
                      isActive ? "bg-muted" : "hover:bg-muted/50",
                      foco,
                    )}
                  >
                    <span
                      className={juntar(
                        "mr-2.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                        isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                      )}
                      aria-hidden="true"
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={juntar(texto.corpo, "block truncate font-medium")}>{t.name}</span>
                      <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")} title={t.description}>{t.description}</span>
                      <span className={juntar(texto.auxiliar, "mt-0.5 block tabular-nums")}>{countNodes(t.tree)} pastas</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="flex min-w-0 shrink-0 items-center justify-between border-b border-border px-4 py-3 sm:px-5">
              <div className="mr-3 min-w-0">
                <p className={juntar(texto.tituloSecao, "truncate text-[14px]")}>{current?.name}</p>
                <p className={texto.auxiliar}>Prévia da estrutura</p>
              </div>
              <button
                type="button"
                disabled={!!applying || !current}
                onClick={() => current && onApply(current)}
                className={botao.primario}
              >
                {applying === current?.id
                  ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  : <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                {applying === current?.id ? "Criando..." : "Aplicar"}
              </button>
            </div>
            <div className="min-h-0 flex-1 p-3 sm:p-4 md:overflow-y-auto md:overscroll-contain">
              <div className={juntar(superficie.poco, "px-3 py-2")}>
                {current && <TreePreview nodes={current.tree} />}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
