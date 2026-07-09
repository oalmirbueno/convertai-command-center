import { useEffect, useMemo, useRef, useState } from "react";
import {
  NotebookPen, Brain, Sparkles, ChevronDown, Minus, X, Plus,
  Trash2, GitBranch, ExternalLink, Copy, Wand2, FileText, Link2, MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

/**
 * Studio flutuante — Notas, Mapa Mental, Roteiro (Prepro Director GPT), Processo.
 * Persistência por contexto (scope + clientId + parentId) no localStorage.
 * Suporta @mention para vincular arquivos do view atual.
 */

const PREPRO_GPT = "https://chatgpt.com/g/g-6a4e9158529c8191a937cee536c18c9f-prepro-director-gpt";

type FileRef = { id: string; name: string; kind: "file" | "folder"; url?: string | null };

type Mode = "notes" | "map" | "script" | "process";

type StudioState = {
  notes: string;
  script: string;
  mapRoot: MapNode;
  mentions: { id: string; name: string; url?: string | null }[];
};

type MapNode = { id: string; label: string; children: MapNode[] };

const DEFAULT_MAP: MapNode = {
  id: "root",
  label: "Projeto",
  children: [
    { id: "a", label: "Briefing / Roteiro", children: [
      { id: "a1", label: "Objetivo", children: [] },
      { id: "a2", label: "Referências", children: [] },
    ]},
    { id: "b", label: "Pré-produção", children: [
      { id: "b1", label: "Locação / Elenco", children: [] },
      { id: "b2", label: "Cronograma", children: [] },
    ]},
    { id: "c", label: "Produção", children: [
      { id: "c1", label: "Captação / Brutos", children: [] },
    ]},
    { id: "d", label: "Pós", children: [
      { id: "d1", label: "Edição", children: [] },
      { id: "d2", label: "Trilha / SFX", children: [] },
      { id: "d3", label: "Aprovação", children: [] },
    ]},
    { id: "e", label: "Entrega", children: [] },
  ],
};

const PROCESS_STEPS = [
  { title: "1. Descoberta",  hint: "Briefing, referências, objetivo. Puxe o roteiro aqui e valide com o Prepro GPT." },
  { title: "2. Pré-produção", hint: "Storyboard, locações, cronograma. Anexe materiais via @." },
  { title: "3. Produção",     hint: "Captação. Suba brutos direto no Workspace (arraste ou use o link de Inbox)." },
  { title: "4. Pós-produção", hint: "Edição, trilha, cor. Envie previews para aprovação em 1 clique." },
  { title: "5. Entrega",      hint: "Versão final publicada. Registre variações e links de destino." },
];

const STORAGE_PREFIX = "workspace_studio_v1:";

function makeEmpty(): StudioState {
  return { notes: "", script: "", mapRoot: JSON.parse(JSON.stringify(DEFAULT_MAP)), mentions: [] };
}
function loadState(ctxKey: string): StudioState {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + ctxKey);
    if (!raw) return makeEmpty();
    const p = JSON.parse(raw);
    return { ...makeEmpty(), ...p };
  } catch { return makeEmpty(); }
}
function saveState(ctxKey: string, s: StudioState) {
  try { localStorage.setItem(STORAGE_PREFIX + ctxKey, JSON.stringify(s)); } catch {}
}

interface Props {
  contextKey: string;
  contextLabel: string;
  availableFiles: FileRef[];
  onOpenFile?: (id: string) => void;
}

export function StudioPanel({ contextKey, contextLabel, availableFiles, onOpenFile }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState<boolean>(() => localStorage.getItem("studio_open") === "1");
  const [minimized, setMinimized] = useState<boolean>(() => localStorage.getItem("studio_min") === "1");
  const [mode, setMode] = useState<Mode>("notes");
  const [state, setState] = useState<StudioState>(() => loadState(contextKey));
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const scriptRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<{ where: "notes" | "script"; q: string; start: number } | null>(null);

  // reload state when context changes
  useEffect(() => { setState(loadState(contextKey)); }, [contextKey]);
  useEffect(() => { saveState(contextKey, state); }, [contextKey, state]);
  useEffect(() => { localStorage.setItem("studio_open", open ? "1" : "0"); }, [open]);
  useEffect(() => { localStorage.setItem("studio_min", minimized ? "1" : "0"); }, [minimized]);

  const mentionMatches = useMemo(() => {
    if (!mentionQuery) return [] as FileRef[];
    const q = mentionQuery.q.toLowerCase();
    return availableFiles.filter(f => f.name.toLowerCase().includes(q)).slice(0, 8);
  }, [mentionQuery, availableFiles]);

  function handleTextChange(where: "notes" | "script", val: string, caret: number) {
    if (where === "notes") setState(s => ({ ...s, notes: val }));
    else setState(s => ({ ...s, script: val }));
    // detect @token
    const before = val.slice(0, caret);
    const m = /@([^\s@]{0,40})$/.exec(before);
    if (m) setMentionQuery({ where, q: m[1], start: caret - m[0].length });
    else setMentionQuery(null);
  }

  function insertMention(f: FileRef) {
    if (!mentionQuery) return;
    const { where, start, q } = mentionQuery;
    const insert = `[@${f.name}](wsfile:${f.id})`;
    const cur = where === "notes" ? state.notes : state.script;
    const before = cur.slice(0, start);
    const after = cur.slice(start + 1 + q.length);
    const next = before + insert + after;
    if (where === "notes") setState(s => ({ ...s, notes: next }));
    else setState(s => ({ ...s, script: next }));
    setState(s => ({ ...s, mentions: [...s.mentions.filter(x => x.id !== f.id), { id: f.id, name: f.name, url: f.url }] }));
    setMentionQuery(null);
    setTimeout(() => {
      const el = where === "notes" ? notesRef.current : scriptRef.current;
      if (el) { el.focus(); const p = before.length + insert.length; el.setSelectionRange(p, p); }
    }, 10);
  }

  function copyBriefingForGPT() {
    const parts = [
      `# Roteiro / Contexto (${contextLabel})`,
      "",
      state.script || "(vazio)",
      "",
      "## Notas de produção",
      state.notes || "(vazio)",
      "",
      "## Arquivos vinculados",
      ...state.mentions.map(m => `- ${m.name}${m.url ? ` — ${m.url}` : ""}`),
    ].join("\n");
    navigator.clipboard.writeText(parts);
    toast({ title: "Contexto copiado", description: "Cole no Prepro Director GPT." });
  }

  // --- Mind map ops ---
  function mapUpdate(id: string, fn: (n: MapNode) => MapNode | null): void {
    setState(s => {
      const walk = (n: MapNode): MapNode | null => {
        if (n.id === id) return fn(n);
        const nc = n.children.map(walk).filter(Boolean) as MapNode[];
        return { ...n, children: nc };
      };
      const r = walk(s.mapRoot);
      return { ...s, mapRoot: r || DEFAULT_MAP };
    });
  }
  function addChild(parentId: string) {
    mapUpdate(parentId, n => ({ ...n, children: [...n.children, { id: crypto.randomUUID(), label: "Novo", children: [] }] }));
  }
  function renameNode(id: string, label: string) {
    mapUpdate(id, n => ({ ...n, label }));
  }
  function deleteNode(id: string) {
    if (id === "root") return;
    setState(s => {
      const walk = (n: MapNode): MapNode => ({ ...n, children: n.children.filter(c => c.id !== id).map(walk) });
      return { ...s, mapRoot: walk(s.mapRoot) };
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setMinimized(false); }}
        className="fixed bottom-4 right-4 z-40 h-11 px-4 rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90 flex items-center gap-2 text-sm font-medium"
        title="Abrir Studio (notas, mapa mental, roteiro)"
      >
        <Sparkles className="w-4 h-4" /> Studio
      </button>
    );
  }

  return (
    <div className={cn(
      "fixed z-40 right-4 bottom-4 bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all",
      minimized ? "w-[280px] h-[52px]" : "w-[min(96vw,480px)] h-[min(78vh,680px)]"
    )}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-[52px] border-b border-border shrink-0 bg-secondary/40">
        <Sparkles className="w-4 h-4 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight truncate">Studio</p>
          {!minimized && <p className="text-[10px] text-muted-foreground truncate">{contextLabel}</p>}
        </div>
        <button onClick={() => setMinimized(m => !m)} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground" title={minimized ? "Expandir" : "Minimizar"}>
          {minimized ? <ChevronDown className="w-3.5 h-3.5 rotate-180" /> : <Minus className="w-3.5 h-3.5" />}
        </button>
        <button onClick={() => setOpen(false)} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground" title="Fechar">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {!minimized && (
        <>
          {/* Tabs */}
          <div className="flex items-center gap-0.5 px-2 pt-2 border-b border-border shrink-0">
            {[
              { k: "notes",   icon: NotebookPen, label: "Notas" },
              { k: "map",     icon: Brain,       label: "Mapa" },
              { k: "script",  icon: FileText,    label: "Roteiro" },
              { k: "process", icon: GitBranch,   label: "Processo" },
            ].map(t => {
              const active = mode === t.k;
              const Icon = t.icon;
              return (
                <button key={t.k} onClick={() => setMode(t.k as Mode)}
                  className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-t-md text-[11px] font-medium border-b-2 -mb-px transition-colors",
                    active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                </button>
              );
            })}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {mode === "notes" && (
              <div className="p-3 space-y-2 h-full flex flex-col">
                <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                  <MessageSquare className="w-3 h-3" /> Digite <b>@</b> para vincular arquivos do painel atual.
                </div>
                <div className="relative flex-1 min-h-0">
                  <textarea
                    ref={notesRef}
                    value={state.notes}
                    onChange={e => handleTextChange("notes", e.target.value, e.target.selectionStart)}
                    onKeyUp={e => handleTextChange("notes", (e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart)}
                    onClick={e => handleTextChange("notes", (e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart)}
                    placeholder="Contexto do projeto, ideias, notas de reunião, próximos passos..."
                    className="w-full h-full min-h-[240px] resize-none bg-background border border-border rounded-lg p-3 text-[13px] leading-relaxed font-mono focus:outline-none focus:border-primary/50"
                  />
                  {mentionQuery?.where === "notes" && mentionMatches.length > 0 && (
                    <MentionList items={mentionMatches} onPick={insertMention} />
                  )}
                </div>
                {!!state.mentions.length && (
                  <div className="flex flex-wrap gap-1 pt-1 border-t border-border">
                    {state.mentions.map(m => (
                      <button key={m.id} onClick={() => onOpenFile?.(m.id)}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-1">
                        <Link2 className="w-2.5 h-2.5" /> {m.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {mode === "script" && (
              <div className="p-3 space-y-2 h-full flex flex-col">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">Roteiro em construção — use <b>@</b> para citar materiais.</span>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" onClick={copyBriefingForGPT} className="h-7 gap-1 text-[10px]">
                      <Copy className="w-3 h-3" /> Copiar p/ GPT
                    </Button>
                    <a href={PREPRO_GPT} target="_blank" rel="noopener noreferrer"
                       className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-primary text-primary-foreground text-[10px] font-medium hover:opacity-90">
                      <Wand2 className="w-3 h-3" /> Prepro GPT <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                </div>
                <div className="relative flex-1 min-h-0">
                  <textarea
                    ref={scriptRef}
                    value={state.script}
                    onChange={e => handleTextChange("script", e.target.value, e.target.selectionStart)}
                    onKeyUp={e => handleTextChange("script", (e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart)}
                    onClick={e => handleTextChange("script", (e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart)}
                    placeholder={"CENA 1 — Abertura\nINT. Estúdio. Dia.\n\nNarrador (V.O.): ..."}
                    className="w-full h-full min-h-[260px] resize-none bg-background border border-border rounded-lg p-3 text-[13px] leading-relaxed font-mono focus:outline-none focus:border-primary/50"
                  />
                  {mentionQuery?.where === "script" && mentionMatches.length > 0 && (
                    <MentionList items={mentionMatches} onPick={insertMention} />
                  )}
                </div>
              </div>
            )}

            {mode === "map" && (
              <div className="p-3">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] text-muted-foreground">Clique num nó para editar; use <b>+</b> para ramificar.</p>
                  <button onClick={() => setState(s => ({ ...s, mapRoot: JSON.parse(JSON.stringify(DEFAULT_MAP)) }))}
                    className="text-[10px] text-muted-foreground hover:text-foreground">
                    Reset
                  </button>
                </div>
                <MindMapView root={state.mapRoot} onRename={renameNode} onAdd={addChild} onDelete={deleteNode} />
              </div>
            )}

            {mode === "process" && (
              <div className="p-3 space-y-2">
                <p className="text-[10px] text-muted-foreground mb-2">
                  Fluxo padrão de audiovisual — clique para expandir.
                </p>
                <ol className="relative border-l-2 border-primary/20 pl-4 space-y-3">
                  {PROCESS_STEPS.map((s, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[22px] top-1 w-3.5 h-3.5 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center text-[8px] font-bold text-primary">
                        {i + 1}
                      </span>
                      <p className="text-[12px] font-semibold text-foreground">{s.title}</p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{s.hint}</p>
                    </li>
                  ))}
                </ol>
                <div className="pt-3 border-t border-border mt-4">
                  <a href={PREPRO_GPT} target="_blank" rel="noopener noreferrer"
                     className="flex items-center gap-2 p-2.5 rounded-lg bg-primary/10 hover:bg-primary/15 border border-primary/30 text-primary text-[12px] font-medium">
                    <Wand2 className="w-4 h-4" />
                    <span className="flex-1">Consultar Prepro Director GPT</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MentionList({ items, onPick }: { items: FileRef[]; onPick: (f: FileRef) => void }) {
  return (
    <div className="absolute bottom-2 left-2 right-2 bg-popover border border-border rounded-lg shadow-xl overflow-hidden z-10">
      {items.map(f => (
        <button key={f.id} onClick={() => onPick(f)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-secondary text-left">
          <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="truncate">{f.name}</span>
        </button>
      ))}
    </div>
  );
}

function MindMapView({ root, onRename, onAdd, onDelete }:
  { root: MapNode; onRename: (id: string, l: string) => void; onAdd: (id: string) => void; onDelete: (id: string) => void; }) {
  return (
    <div className="space-y-1">
      <MapNodeRow node={root} depth={0} onRename={onRename} onAdd={onAdd} onDelete={onDelete} />
    </div>
  );
}

function MapNodeRow({ node, depth, onRename, onAdd, onDelete }: {
  node: MapNode; depth: number;
  onRename: (id: string, l: string) => void; onAdd: (id: string) => void; onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(node.label);
  useEffect(() => { setVal(node.label); }, [node.label]);
  const colors = ["text-primary", "text-blue-400", "text-purple-400", "text-amber-400"];
  const color = colors[depth % colors.length];
  return (
    <div>
      <div className="group flex items-center gap-1 py-1 rounded-md hover:bg-secondary/40" style={{ paddingLeft: depth * 14 }}>
        <span className={cn("w-1.5 h-1.5 rounded-full bg-current", color)} />
        {editing ? (
          <Input
            autoFocus
            value={val}
            onChange={e => setVal(e.target.value)}
            onBlur={() => { onRename(node.id, val.trim() || node.label); setEditing(false); }}
            onKeyDown={e => { if (e.key === "Enter") { onRename(node.id, val.trim() || node.label); setEditing(false); } }}
            className="h-6 text-[12px] py-0"
          />
        ) : (
          <button className="text-[12px] font-medium text-left flex-1 truncate" onClick={() => setEditing(true)}>
            {node.label}
          </button>
        )}
        <button onClick={() => onAdd(node.id)} className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-secondary text-muted-foreground" title="Adicionar sub-nó">
          <Plus className="w-3 h-3" />
        </button>
        {node.id !== "root" && (
          <button onClick={() => onDelete(node.id)} className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 text-destructive" title="Remover">
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
      {node.children.map(c => (
        <MapNodeRow key={c.id} node={c} depth={depth + 1} onRename={onRename} onAdd={onAdd} onDelete={onDelete} />
      ))}
    </div>
  );
}
