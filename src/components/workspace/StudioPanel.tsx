import { useEffect, useMemo, useRef, useState } from "react";
import {
  NotebookPen, Brain, Sparkles, ChevronDown, Minus, X, Plus,
  Trash2, GitBranch, ExternalLink, Copy, Wand2, FileText, Link2, MessageSquare,
  Bot, Send, Loader2, History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";


/**
 * Studio flutuante — Notas, Mapa Mental, Roteiro (Prepro Director GPT), Processo.
 * Persistência por contexto (scope + clientId + parentId) no localStorage.
 * Suporta @mention para vincular arquivos do view atual.
 */

const PREPRO_GPT = "https://chatgpt.com/g/g-6a4e9158529c8191a937cee536c18c9f-prepro-director-gpt";

type FileRef = { id: string; name: string; kind: "file" | "folder"; url?: string | null };

type Mode = "agent" | "notes" | "map" | "script" | "process";


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

type SlashCmd = { key: string; label: string; hint: string; insert: string };

function buildSlashCommands(ctx: { clientName?: string | null; folderPath?: string | null; contextLabel: string }): SlashCmd[] {
  const c = ctx.clientName || ctx.contextLabel || "cliente";
  const pasta = ctx.folderPath || "raiz";
  return [
    { key: "cliente", label: "Cliente atual", hint: c, insert: `**Cliente:** ${c}\n` },
    { key: "pasta",   label: "Pasta atual",   hint: pasta, insert: `**Pasta:** ${pasta}\n` },
    { key: "hook",    label: "Bloco HOOK",    hint: "roteiro 0-3s",
      insert: `\n### HOOK (0-3s)\nFALA: \nIMAGEM: \nTEXTO EM TELA: \n` },
    { key: "desenv",  label: "Bloco DESENVOLVIMENTO", hint: "proof/argumento",
      insert: `\n### DESENVOLVIMENTO (3-25s)\nFALA: \nB-ROLL: \nSFX/TRILHA: \n` },
    { key: "cta",     label: "Bloco CTA",      hint: "chamada final",
      insert: `\n### CTA\nFALA: \nTEXTO: \nDESTINO: \n` },
    { key: "brief",   label: "Template BRIEFING", hint: "objetivo + público + canal",
      insert: `\n## Briefing\n- **Objetivo:** \n- **Público:** \n- **Canal:** \n- **Duração:** \n- **Tom:** \n- **Referências:** \n` },
    { key: "check",   label: "Checklist de entrega", hint: "pipeline pastas",
      insert: `\n## Checklist entrega\n- [ ] 1. Brutos\n- [ ] 2. Trilhas/SFX\n- [ ] 3. Edição\n- [ ] 4. Final aprovado\n- [ ] 5. Publicado\n` },
    { key: "kanban",  label: "Ver Kanban do cliente", hint: "abre em nova aba",
      insert: `[Kanban do cliente](#kanban)` },
  ];
}


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
  clientId?: string | null;
  clientName?: string | null;
  folderPath?: string | null;
  availableFiles: FileRef[];
  onOpenFile?: (id: string) => void;
}

export function StudioPanel({ contextKey, contextLabel, clientId, clientName, folderPath, availableFiles, onOpenFile }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState<boolean>(() => localStorage.getItem("studio_open") === "1");
  const [minimized, setMinimized] = useState<boolean>(() => localStorage.getItem("studio_min") === "1");
  const [dock, setDock] = useState<"br" | "bl" | "bc">(() => (localStorage.getItem("studio_dock") as any) || "br");
  const [mode, setMode] = useState<Mode>("agent");
  const [state, setState] = useState<StudioState>(() => loadState(contextKey));

  const notesRef = useRef<HTMLTextAreaElement>(null);
  const scriptRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<{ where: "notes" | "script"; q: string; start: number } | null>(null);
  const [slashMenu, setSlashMenu] = useState<{ where: "notes" | "script"; q: string; start: number } | null>(null);

  // reload state when context changes
  useEffect(() => { setState(loadState(contextKey)); }, [contextKey]);
  useEffect(() => { saveState(contextKey, state); }, [contextKey, state]);
  useEffect(() => { localStorage.setItem("studio_open", open ? "1" : "0"); }, [open]);
  useEffect(() => { localStorage.setItem("studio_min", minimized ? "1" : "0"); }, [minimized]);
  useEffect(() => { localStorage.setItem("studio_dock", dock); }, [dock]);


  const mentionMatches = useMemo(() => {
    if (!mentionQuery) return [] as FileRef[];
    const q = mentionQuery.q.toLowerCase();
    return availableFiles.filter(f => f.name.toLowerCase().includes(q)).slice(0, 8);
  }, [mentionQuery, availableFiles]);

  function handleTextChange(where: "notes" | "script", val: string, caret: number) {
    if (where === "notes") setState(s => ({ ...s, notes: val }));
    else setState(s => ({ ...s, script: val }));
    const before = val.slice(0, caret);
    const mAt = /@([^\s@]{0,40})$/.exec(before);
    const mSlash = /(^|\s)\/([^\s/]{0,20})$/.exec(before);
    if (mAt) { setMentionQuery({ where, q: mAt[1], start: caret - mAt[0].length }); setSlashMenu(null); }
    else if (mSlash) { setSlashMenu({ where, q: mSlash[2], start: caret - (mSlash[2].length + 1) }); setMentionQuery(null); }
    else { setMentionQuery(null); setSlashMenu(null); }
  }

  function insertSlash(cmd: SlashCmd) {
    if (!slashMenu) return;
    const { where, start, q } = slashMenu;
    const cur = where === "notes" ? state.notes : state.script;
    const before = cur.slice(0, start);
    const after = cur.slice(start + 1 + q.length);
    const next = before + cmd.insert + after;
    if (where === "notes") setState(s => ({ ...s, notes: next }));
    else setState(s => ({ ...s, script: next }));
    setSlashMenu(null);
    setTimeout(() => {
      const el = where === "notes" ? notesRef.current : scriptRef.current;
      if (el) { el.focus(); const p = before.length + cmd.insert.length; el.setSelectionRange(p, p); }
    }, 10);
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

  const dockPos =
    dock === "br" ? "right-4 bottom-4" :
    dock === "bl" ? "left-4 bottom-4" :
                    "left-1/2 -translate-x-1/2 bottom-4";
  const dockSize = minimized
    ? "w-[280px] h-[52px]"
    : dock === "bc"
      ? "w-[min(96vw,880px)] h-[min(72vh,620px)]"
      : "w-[min(96vw,480px)] h-[min(78vh,680px)]";

  return (
    <div className={cn(
      "fixed z-40 bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all",
      dockPos, dockSize
    )}>
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 h-[52px] border-b border-border shrink-0 bg-secondary/40">
        <Sparkles className="w-4 h-4 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight truncate">Studio</p>
          {!minimized && <p className="text-[10px] text-muted-foreground truncate">{contextLabel}</p>}
        </div>
        {!minimized && (
          <div className="flex items-center gap-0.5 mr-1 border border-border rounded-md p-0.5 bg-background/60">
            <button onClick={() => setDock("bl")} title="Dock esquerda"
              className={cn("px-1.5 py-0.5 rounded text-[10px]", dock === "bl" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}>◧</button>
            <button onClick={() => setDock("bc")} title="Centralizar embaixo"
              className={cn("px-1.5 py-0.5 rounded text-[10px]", dock === "bc" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}>▬</button>
            <button onClick={() => setDock("br")} title="Dock direita"
              className={cn("px-1.5 py-0.5 rounded text-[10px]", dock === "br" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}>◨</button>
          </div>
        )}
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
          <div className="flex items-center gap-0.5 px-2 pt-2 border-b border-border shrink-0 overflow-x-auto">
            {[
              { k: "agent",   icon: Bot,         label: "Agente" },
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
            {mode === "agent" && (
              <AgentChat
                clientId={clientId ?? null}
                clientName={clientName ?? null}
                folderPath={folderPath ?? contextLabel}
                availableFiles={availableFiles}
                notes={state.notes}
                script={state.script}
              />
            )}
            {mode === "notes" && (

              <div className="p-3 space-y-2 h-full flex flex-col">
                <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                  <MessageSquare className="w-3 h-3" /> <b>@</b> vincula arquivos · <b>/</b> insere blocos (hook, CTA, briefing, cliente…)
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
                  {slashMenu?.where === "notes" && (
                    <SlashList
                      items={buildSlashCommands({ clientName, folderPath, contextLabel }).filter(c => c.label.toLowerCase().includes(slashMenu.q.toLowerCase()) || c.key.includes(slashMenu.q.toLowerCase()))}
                      onPick={insertSlash}
                    />
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
                    <Button size="sm" onClick={() => setMode("agent")} className="h-7 gap-1 text-[10px]">
                      <Wand2 className="w-3 h-3" /> Abrir no Prepro
                    </Button>

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
                  {slashMenu?.where === "script" && (
                    <SlashList
                      items={buildSlashCommands({ clientName, folderPath, contextLabel }).filter(c => c.label.toLowerCase().includes(slashMenu.q.toLowerCase()) || c.key.includes(slashMenu.q.toLowerCase()))}
                      onPick={insertSlash}
                    />
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
                  <button onClick={() => setMode("agent")}
                     className="w-full flex items-center gap-2 p-2.5 rounded-lg bg-primary/10 hover:bg-primary/15 border border-primary/30 text-primary text-[12px] font-medium">
                    <Wand2 className="w-4 h-4" />
                    <span className="flex-1 text-left">Abrir o Prepro Director aqui</span>
                  </button>
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

function SlashList({ items, onPick }: { items: SlashCmd[]; onPick: (c: SlashCmd) => void }) {
  if (!items.length) return null;
  return (
    <div className="absolute bottom-2 left-2 right-2 bg-popover border border-border rounded-lg shadow-xl overflow-hidden z-10 max-h-[240px] overflow-y-auto">
      <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-muted-foreground bg-secondary/40 border-b border-border">
        Comandos
      </div>
      {items.map(c => (
        <button key={c.key} onClick={() => onPick(c)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-secondary text-left">
          <Sparkles className="w-3 h-3 text-primary shrink-0" />
          <span className="font-medium">{c.label}</span>
          <span className="text-[10px] text-muted-foreground truncate ml-auto">{c.hint}</span>
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

// =========================
// AGENT CHAT (persistente por cliente)
// =========================

type AgentThread = { id: string; title: string; updated_at: string; client_id: string | null; folder_path?: string | null };
type AgentMsg = { id: string; role: "user" | "assistant" | "system"; content: string; created_at: string };

function AgentChat({ clientId, clientName, folderPath, availableFiles, notes, script }: {
  clientId: string | null; clientName: string | null; folderPath: string;
  availableFiles: FileRef[]; notes: string; script: string;
}) {
  const { toast } = useToast();
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<AgentMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [streamBuf, setStreamBuf] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Threads escopadas por cliente + pasta — cada diretório tem seu contexto isolado
  useEffect(() => { void loadThreads(); setActiveId(null); }, [clientId, folderPath]);
  async function loadThreads() {
    let q = supabase.from("workspace_agent_threads").select("id,title,updated_at,client_id,folder_path")
      .order("updated_at", { ascending: false }).limit(30);
    q = clientId ? q.eq("client_id", clientId) : q.is("client_id", null);
    q = folderPath ? q.eq("folder_path", folderPath) : q.is("folder_path", null);
    const { data } = await q;
    setThreads((data as AgentThread[]) || []);
    if (data && data.length) setActiveId(data[0].id);
  }


  useEffect(() => { if (activeId) void loadMsgs(activeId); else setMsgs([]); }, [activeId]);
  async function loadMsgs(id: string) {
    const { data } = await supabase.from("workspace_agent_messages")
      .select("id,role,content,created_at").eq("thread_id", id).order("created_at", { ascending: true });
    setMsgs((data as AgentMsg[]) || []);
  }

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, streamBuf]);

  async function newThread() {
    const { data: sess } = await supabase.auth.getUser();
    if (!sess.user) return;
    const { data, error } = await supabase.from("workspace_agent_threads")
      .insert({ user_id: sess.user.id, client_id: clientId, folder_path: folderPath || null, title: "Nova conversa" })
      .select("id,title,updated_at,client_id,folder_path").single();

    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    setThreads(t => [data as AgentThread, ...t]);
    setActiveId(data.id);
    setMsgs([]);
  }

  async function deleteThread(id: string) {
    await supabase.from("workspace_agent_threads").delete().eq("id", id);
    setThreads(t => t.filter(x => x.id !== id));
    if (activeId === id) { setActiveId(null); setMsgs([]); }
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    let tid = activeId;
    if (!tid) {
      const { data: sess } = await supabase.auth.getUser();
      if (!sess.user) return;
      const { data } = await supabase.from("workspace_agent_threads")
        .insert({ user_id: sess.user.id, client_id: clientId, folder_path: folderPath || null, title: text.slice(0, 60) })
        .select("id,title,updated_at,client_id,folder_path").single();

      if (!data) return;
      tid = data.id;
      setThreads(t => [data as AgentThread, ...t]);
      setActiveId(tid);
    }
    setInput("");
    setMsgs(m => [...m, { id: crypto.randomUUID(), role: "user", content: text, created_at: new Date().toISOString() }]);
    setStreaming(true); setStreamBuf("");

    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/workspace-agent`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          thread_id: tid,
          message: text,
          context: {
            client_name: clientName,
            folder_path: folderPath,
            notes, script,
            files: availableFiles.slice(0, 20).map(f => ({ name: f.name, url: f.url })),
          },
        }),
      });
      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        full += chunk;
        setStreamBuf(full);
      }
      setMsgs(m => [...m, { id: crypto.randomUUID(), role: "assistant", content: full, created_at: new Date().toISOString() }]);
      setStreamBuf("");
      void loadThreads();
    } catch (e: any) {
      toast({ title: "Falha no agente", description: e?.message?.slice(0, 200), variant: "destructive" });
    } finally { setStreaming(false); }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header: cliente + histórico + nova */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-secondary/30">
        <Bot className="w-3.5 h-3.5 text-primary" />
        <span className="text-[10px] font-medium text-foreground/80 truncate flex-1">
          {clientName ? `Agente · ${clientName}` : "Agente · Global"}
        </span>
        <button onClick={() => setShowHistory(v => !v)}
          className="p-1 rounded hover:bg-secondary text-muted-foreground" title="Histórico">
          <History className="w-3 h-3" />
        </button>
        <button onClick={newThread}
          className="p-1 rounded hover:bg-secondary text-muted-foreground" title="Nova conversa">
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {showHistory && (
        <div className="max-h-[140px] overflow-y-auto border-b border-border bg-background/60">
          {threads.length === 0 && <p className="text-[10px] text-muted-foreground px-3 py-2">Nenhuma conversa ainda.</p>}
          {threads.map(t => (
            <div key={t.id} className={cn("group flex items-center gap-1 px-2 py-1.5 hover:bg-secondary/60 cursor-pointer",
              activeId === t.id && "bg-secondary")}
              onClick={() => { setActiveId(t.id); setShowHistory(false); }}>
              <MessageSquare className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="text-[11px] truncate flex-1">{t.title}</span>
              <button onClick={(e) => { e.stopPropagation(); deleteThread(t.id); }}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-destructive">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Mensagens */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {msgs.length === 0 && !streaming && (
          <div className="text-center py-8 space-y-2">
            <Bot className="w-8 h-8 text-primary/40 mx-auto" />
            <p className="text-[11px] text-muted-foreground">
              Peça roteiro, plano de gravação, storyboard, ideias.<br/>
              O agente já conhece <b>{clientName || "este contexto"}</b>.
            </p>
          </div>
        )}
        {msgs.map(m => (
          <div key={m.id} className={cn("flex gap-2", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap break-words",
              m.role === "user" ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground")}>
              {m.content}
            </div>
          </div>
        ))}
        {streaming && streamBuf && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap break-words bg-secondary text-foreground">
              {streamBuf}<span className="inline-block w-1.5 h-3 bg-primary/60 ml-0.5 animate-pulse" />
            </div>
          </div>
        )}
        {streaming && !streamBuf && (
          <div className="flex items-center gap-2 text-muted-foreground text-[11px]">
            <Loader2 className="w-3 h-3 animate-spin" /> pensando...
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border p-2 flex items-end gap-1 bg-secondary/30">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="Pergunte ao agente... (Enter envia, Shift+Enter quebra linha)"
          rows={2}
          className="flex-1 resize-none bg-background border border-border rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-primary/50"
        />
        <Button size="sm" onClick={send} disabled={streaming || !input.trim()} className="h-8 px-2">
          {streaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        </Button>
      </div>
    </div>
  );
}
