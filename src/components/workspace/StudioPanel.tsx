import { useEffect, useMemo, useRef, useState } from "react";
import {
  NotebookPen, Brain, Sparkles, ChevronDown, Minus, X, Plus,
  Trash2, GitBranch, ExternalLink, Copy, Wand2, FileText, Link2, MessageSquare,
  Bot, Send, Loader2, History, Paperclip, File as FileIcon, Folder as FolderIcon,
  Columns3, Pencil, GripVertical, Settings, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";


/**
 * Studio flutuante — Notas, Mapa Mental, Roteiro (Prepro Director GPT), Processo.
 * Persistência por contexto (scope + clientId + parentId) no localStorage.
 * Suporta @mention para vincular arquivos do view atual.
 */

const PREPRO_GPT = "https://chatgpt.com/g/g-6a4e9158529c8191a937cee536c18c9f-prepro-director-gpt";

type FileRef = { id: string; name: string; kind: "file" | "folder"; url?: string | null };

type Mode = "agent" | "notes";


type StudioState = {
  notes: string;
  script: string;
  mapRoot: MapNode;
  mentions: { id: string; name: string; url?: string | null }[];
  board: BoardCol[];
  boardLog: string[];
};

type MapNode = { id: string; label: string; children: MapNode[] };

type BoardCard = { id: string; title: string; desc?: string };
type BoardCol = { id: string; title: string; cards: BoardCard[] };

const DEFAULT_BOARD: BoardCol[] = [
  { id: "todo", title: "A fazer",     cards: [] },
  { id: "doing", title: "Em andamento", cards: [] },
  { id: "review", title: "Revisão",     cards: [] },
  { id: "done",  title: "Feito",        cards: [] },
];

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

type SlashAction = "createTask" | "openKanban" | "uploadImage" | "insertVideo" | "insertMindmap";
type SlashCmd = { key: string; label: string; hint: string; insert: string; action?: SlashAction };

function buildSlashCommands(ctx: { clientName?: string | null; folderPath?: string | null; contextLabel: string }): SlashCmd[] {
  const c = ctx.clientName || ctx.contextLabel || "cliente";
  const pasta = ctx.folderPath || "raiz";
  return [
    { key: "tarefa",   label: "Nova tarefa (Kanban do projeto)", hint: "título !alta @nome 15/07", insert: "", action: "createTask" },
    { key: "kanban",   label: "Ver Kanban do projeto",           hint: "abre inline com tasks reais", insert: "", action: "openKanban" },
    { key: "imagem",   label: "Imagem → OCR",                    hint: "extrai texto da imagem", insert: "", action: "uploadImage" },
    { key: "video",    label: "Embed de vídeo",                  hint: "YouTube / Vimeo / Drive", insert: "", action: "insertVideo" },
    { key: "mapa",     label: "Mapa mental (ASCII)",             hint: "insere estrutura hierárquica", insert: "", action: "insertMindmap" },
    { key: "checklist",label: "Checklist",                       hint: "lista com checkboxes", insert: `\n- [ ] \n- [ ] \n- [ ] \n` },
    { key: "cliente",  label: "Cliente atual",                   hint: c, insert: `**Cliente:** ${c}\n` },
    { key: "pasta",    label: "Pasta atual",                     hint: pasta, insert: `**Pasta:** ${pasta}\n` },
    { key: "hook",     label: "Bloco HOOK",                      hint: "roteiro 0-3s",
      insert: `\n### HOOK (0-3s)\nFALA: \nIMAGEM: \nTEXTO EM TELA: \n` },
    { key: "desenv",   label: "Bloco DESENVOLVIMENTO",           hint: "proof/argumento",
      insert: `\n### DESENVOLVIMENTO (3-25s)\nFALA: \nB-ROLL: \nSFX/TRILHA: \n` },
    { key: "cta",      label: "Bloco CTA",                       hint: "chamada final",
      insert: `\n### CTA\nFALA: \nTEXTO: \nDESTINO: \n` },
    { key: "brief",    label: "Template BRIEFING",               hint: "objetivo + público + canal",
      insert: `\n## Briefing\n- **Objetivo:** \n- **Público:** \n- **Canal:** \n- **Duração:** \n- **Tom:** \n- **Referências:** \n` },
  ];
}

const MINDMAP_TEMPLATE = `\n## 🧠 Mapa Mental\n- Ideia central\n  - Ramo 1\n    - Detalhe\n    - Detalhe\n  - Ramo 2\n    - Detalhe\n  - Ramo 3\n`;

function videoEmbedFromUrl(url: string): string | null {
  const u = url.trim();
  const yt = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vm = u.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  const dr = u.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  if (dr) return `https://drive.google.com/file/d/${dr[1]}/preview`;
  return null;
}

// Destaca trechos [start,end) do texto com <mark> para busca fuzzy.
function highlightRanges(text: string, ranges: [number, number][]): React.ReactNode {
  if (!ranges?.length) return text;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: React.ReactNode[] = [];
  let cur = 0;
  sorted.forEach(([s, e], i) => {
    if (s > cur) out.push(text.slice(cur, s));
    out.push(<mark key={i} className="bg-primary/25 text-primary rounded-sm px-0.5">{text.slice(s, e)}</mark>);
    cur = e;
  });
  if (cur < text.length) out.push(text.slice(cur));
  return <>{out}</>;
}



// Parser inline: "Editar hook !alta @maria 15/07" → { title, priority, assigneeName, dueISO }
export function parseTaskShorthand(raw: string): { title: string; priority: "low"|"medium"|"high"|"urgent"; assigneeName?: string; dueISO?: string } {
  let s = " " + raw.trim() + " ";
  let priority: "low"|"medium"|"high"|"urgent" = "medium";
  const pm = s.match(/\s!(baixa|low|media|média|medium|alta|high|urgente|urgent)\b/i);
  if (pm) {
    const p = pm[1].toLowerCase();
    priority = p.startsWith("bai") || p === "low" ? "low"
      : p.startsWith("alt") || p === "high" ? "high"
      : p.startsWith("urg") ? "urgent" : "medium";
    s = s.replace(pm[0], " ");
  }
  let assigneeName: string | undefined;
  const am = s.match(/\s@([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9._-]{1,40}(?:\s[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9._-]{1,40})?)/);
  if (am) { assigneeName = am[1].trim(); s = s.replace(am[0], " "); }
  let dueISO: string | undefined;
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const rel = s.match(/\s(hoje|amanha|amanhã|\+(\d+)([dsw]))\b/i);
  if (rel) {
    if (/hoje/i.test(rel[1])) dueISO = iso(today);
    else if (/amanh/i.test(rel[1])) { const d = new Date(today); d.setDate(d.getDate()+1); dueISO = iso(d); }
    else {
      const n = parseInt(rel[2], 10); const u = rel[3].toLowerCase();
      const d = new Date(today);
      d.setDate(d.getDate() + (u === "d" ? n : u === "s" || u === "w" ? n*7 : n));
      dueISO = iso(d);
    }
    s = s.replace(rel[0], " ");
  } else {
    const dm = s.match(/\s(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
    if (dm) {
      const day = parseInt(dm[1], 10), mon = parseInt(dm[2], 10) - 1;
      const yr = dm[3] ? (dm[3].length === 2 ? 2000 + parseInt(dm[3], 10) : parseInt(dm[3], 10)) : today.getFullYear();
      const d = new Date(yr, mon, day);
      if (!isNaN(d.getTime())) dueISO = iso(d);
      s = s.replace(dm[0], " ");
    } else {
      const im = s.match(/\s(\d{4}-\d{2}-\d{2})\b/);
      if (im) { dueISO = im[1]; s = s.replace(im[0], " "); }
    }
  }
  const title = s.replace(/\s+/g, " ").trim();
  return { title, priority, assigneeName, dueISO };
}



const STORAGE_PREFIX = "workspace_studio_v1:";

function makeEmpty(): StudioState {
  return {
    notes: "", script: "",
    mapRoot: JSON.parse(JSON.stringify(DEFAULT_MAP)),
    mentions: [],
    board: JSON.parse(JSON.stringify(DEFAULT_BOARD)),
    boardLog: [],
  };
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
  folderId?: string | null;
  folderPath?: string | null;
  availableFiles: FileRef[];
  onOpenFile?: (id: string) => void;
}

export function StudioPanel({ contextKey, contextLabel, clientId, clientName, folderId, folderPath, availableFiles, onOpenFile }: Props) {
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
  const [taskDraft, setTaskDraft] = useState<{ raw: string; where: "notes"|"script"; insertAt: number; tokenLen: number } | null>(null);

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

  const [kanbanOpen, setKanbanOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [ocrBusy, setOcrBusy] = useState(false);

  function insertAtCaret(text: string) {
    const el = notesRef.current;
    const cur = state.notes;
    const caret = el?.selectionStart ?? cur.length;
    const next = cur.slice(0, caret) + text + cur.slice(caret);
    setState(s => ({ ...s, notes: next }));
    setTimeout(() => { if (el) { el.focus(); const p = caret + text.length; el.setSelectionRange(p, p); } }, 10);
  }

  async function ocrFile(file: File): Promise<string> {
    const dataUrl: string = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const { data, error } = await supabase.functions.invoke("workspace-ocr", { body: { image: dataUrl } });
    if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message || "OCR falhou");
    return (data as any)?.text || "";
  }

  async function handleImageFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    setOcrBusy(true);
    toast({ title: "Analisando imagem…", description: "Extraindo texto via Lovable AI (Gemini Flash Lite)." });
    try {
      const text = await ocrFile(file);
      insertAtCaret(`\n> 🖼️ **Imagem — texto extraído:**\n${text.split("\n").map(l => `> ${l}`).join("\n")}\n`);
      toast({ title: "OCR concluído", description: `${text.length} caracteres extraídos.` });
    } catch (e: any) {
      toast({ title: "Falha no OCR", description: e?.message?.slice(0, 200), variant: "destructive" });
    } finally { setOcrBusy(false); }
  }

  function onNotesPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData.items || []);
    const img = items.find(i => i.type.startsWith("image/"));
    if (img) {
      const f = img.getAsFile();
      if (f) { e.preventDefault(); void handleImageFile(f); return; }
    }
    const txt = e.clipboardData.getData("text/plain");
    const embed = videoEmbedFromUrl(txt);
    if (embed) {
      e.preventDefault();
      insertAtCaret(`\n@video[${txt}](${embed})\n`);
    }
  }

  function insertSlash(cmd: SlashCmd) {
    if (!slashMenu) return;
    const { where, start, q } = slashMenu;
    const cur = where === "notes" ? state.notes : state.script;
    const before = cur.slice(0, start);
    const after = cur.slice(start + 1 + q.length);

    if (cmd.action === "createTask") {
      const lineStart = before.lastIndexOf("\n") + 1;
      const currentLine = cur.slice(lineStart, start).trim();
      setTaskDraft({ raw: currentLine, where, insertAt: start, tokenLen: 1 + q.length });
      setSlashMenu(null);
      return;
    }

    // Ações que apenas removem o token /xxx e disparam side-effect
    const cleaned = before + after;
    const applyCleaned = () => {
      if (where === "notes") setState(s => ({ ...s, notes: cleaned }));
      else setState(s => ({ ...s, script: cleaned }));
      setSlashMenu(null);
    };

    if (cmd.action === "openKanban") { applyCleaned(); setKanbanOpen(true); return; }
    if (cmd.action === "uploadImage") { applyCleaned(); setTimeout(() => imageInputRef.current?.click(), 30); return; }
    if (cmd.action === "insertVideo") {
      applyCleaned();
      const url = window.prompt("Cole o link do vídeo (YouTube / Vimeo / Drive):", "");
      if (url) {
        const embed = videoEmbedFromUrl(url);
        insertAtCaret(embed ? `\n@video[${url}](${embed})\n` : `\n[${url}](${url})\n`);
      }
      return;
    }
    if (cmd.action === "insertMindmap") { applyCleaned(); insertAtCaret(MINDMAP_TEMPLATE); return; }

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
              { k: "notes",   icon: NotebookPen, label: "Notas" },
              { k: "agent",   icon: Bot,         label: "Agente" },
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
                folderId={folderId ?? null}
                folderPath={folderPath ?? contextLabel}
                availableFiles={availableFiles}
                notes={state.notes}
                script={state.script}
                boardLog={state.boardLog}
              />
            )}
            {mode === "notes" && (
              <div className="p-3 space-y-2 h-full flex flex-col">
                <div className="text-[10px] text-muted-foreground flex items-center gap-2 flex-wrap">
                  <MessageSquare className="w-3 h-3" /> <b>/</b> comandos · <b>@</b> arquivos · cole <b>imagem</b> (OCR) ou <b>link de vídeo</b> (embed)
                  {ocrBusy && <span className="text-primary flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> OCR…</span>}
                </div>
                <input ref={imageInputRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void handleImageFile(f); e.target.value = ""; }} />
                <div className="relative flex-1 min-h-0 grid grid-rows-[minmax(180px,1fr)_auto]">
                  <textarea
                    ref={notesRef}
                    value={state.notes}
                    onChange={e => handleTextChange("notes", e.target.value, e.target.selectionStart)}
                    onKeyUp={e => handleTextChange("notes", (e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart)}
                    onClick={e => handleTextChange("notes", (e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart)}
                    onPaste={onNotesPaste}
                    placeholder="/ para comandos · @ para arquivos · cole imagem/vídeo…"
                    className="w-full h-full min-h-[180px] resize-none bg-background border border-border rounded-lg p-3 text-[13px] leading-relaxed font-mono focus:outline-none focus:border-primary/50"
                  />
                  {state.notes.trim().length > 0 && (
                    <div className="mt-2 border-t border-border pt-2 max-h-[240px] overflow-y-auto">
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Preview</div>
                      <NotesPreview src={state.notes} />
                    </div>
                  )}
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


          </div>
        </>
      )}

      {taskDraft && (
        <QuickTaskDialog
          draft={taskDraft}
          clientId={clientId ?? null}
          clientName={clientName ?? null}
          onClose={() => setTaskDraft(null)}
          onCreated={(summary) => {
            // Insere linha de checklist com o resumo da tarefa criada no ponto do slash
            const { where, insertAt, tokenLen } = taskDraft;
            const cur = where === "notes" ? state.notes : state.script;
            const before = cur.slice(0, insertAt);
            const after = cur.slice(insertAt + tokenLen);
            // Remove o resto da linha corrente que virou a tarefa (do início da linha ao slash)
            const lineStart = before.lastIndexOf("\n") + 1;
            const cleanedBefore = before.slice(0, lineStart);
            const line = `- [ ] ${summary}\n`;
            const next = cleanedBefore + line + after;
            if (where === "notes") setState(s => ({ ...s, notes: next }));
            else setState(s => ({ ...s, script: next }));
            // Registra também no log do Kanban interno para o agente ter contexto
            setState(s => ({ ...s, boardLog: [`[${new Date().toISOString().slice(0,16).replace("T"," ")}] tarefa criada: ${summary}`, ...s.boardLog].slice(0, 40) }));
            setTaskDraft(null);
          }}
        />
      )}
      <KanbanInlineDialog open={kanbanOpen} onOpenChange={setKanbanOpen} clientId={clientId ?? null} clientName={clientName ?? null} />
    </div>
  );
}

// Preview leve das Notas: renderiza checkboxes, imagens ![](url), links, embeds de vídeo @video[nome](embedUrl) e menções wsfile.
function NotesPreview({ src }: { src: string }) {
  const lines = src.split("\n");
  const out: React.ReactNode[] = [];
  lines.forEach((raw, i) => {
    // vídeo embed
    const v = raw.match(/^@video\[([^\]]*)\]\((https?:[^)]+)\)\s*$/);
    if (v) {
      out.push(
        <div key={i} className="my-2 aspect-video w-full max-w-md rounded overflow-hidden border border-border">
          <iframe src={v[2]} className="w-full h-full" allow="autoplay; encrypted-media" allowFullScreen title={v[1]} />
        </div>
      );
      return;
    }
    // imagem markdown
    const img = raw.match(/^!\[([^\]]*)\]\((https?:[^)]+)\)\s*$/);
    if (img) {
      out.push(<img key={i} src={img[2]} alt={img[1]} className="my-2 max-h-48 rounded border border-border" />);
      return;
    }
    // checkbox
    const cb = raw.match(/^(\s*)- \[( |x|X)\] (.+)$/);
    if (cb) {
      const checked = cb[2].toLowerCase() === "x";
      out.push(
        <div key={i} className="flex items-start gap-2 text-[12px] py-0.5" style={{ paddingLeft: cb[1].length * 6 }}>
          <span className={cn("mt-[3px] w-3 h-3 border rounded-sm flex items-center justify-center shrink-0", checked ? "bg-primary border-primary" : "border-muted-foreground/40")}>
            {checked && <Check className="w-2 h-2 text-primary-foreground" />}
          </span>
          <span className={checked ? "line-through text-muted-foreground" : ""}>{cb[3]}</span>
        </div>
      );
      return;
    }
    // heading
    if (raw.startsWith("### ")) { out.push(<div key={i} className="text-[12px] font-semibold text-primary mt-1">{raw.slice(4)}</div>); return; }
    if (raw.startsWith("## "))  { out.push(<div key={i} className="text-[13px] font-bold mt-1">{raw.slice(3)}</div>); return; }
    if (raw.startsWith("# "))   { out.push(<div key={i} className="text-[14px] font-bold mt-1">{raw.slice(2)}</div>); return; }
    if (raw.startsWith("> "))   { out.push(<div key={i} className="border-l-2 border-primary/40 pl-2 text-[11px] text-muted-foreground italic">{raw.slice(2)}</div>); return; }
    if (raw.trim() === "")      { out.push(<div key={i} className="h-1" />); return; }
    // linha simples com wsfile mention
    const withMentions = raw.replace(/\[@([^\]]+)\]\(wsfile:[^)]+\)/g, "@$1");
    out.push(<div key={i} className="text-[12px] leading-relaxed">{withMentions}</div>);
  });
  return <div className="space-y-0.5">{out}</div>;
}

// Kanban inline: mostra as tasks reais do projeto ativo do cliente (tabela tasks via projects)
function KanbanInlineDialog({ open, onOpenChange, clientId, clientName }: { open: boolean; onOpenChange: (v: boolean) => void; clientId: string | null; clientName: string | null }) {
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<Array<{ id: string; title: string; status: string; priority: string | null; due_date: string | null; project_id: string }>>([]);
  const [projectName, setProjectName] = useState<string>("");

  useEffect(() => {
    if (!open || !clientId) return;
    (async () => {
      setLoading(true);
      const { data: projs } = await supabase.from("projects").select("id, name").eq("client_id", clientId).order("created_at", { ascending: false }).limit(1);
      const pid = projs?.[0]?.id;
      setProjectName(projs?.[0]?.name || "");
      if (!pid) { setTasks([]); setLoading(false); return; }
      const { data: ts } = await supabase.from("tasks").select("id, title, status, priority, due_date, project_id").eq("project_id", pid).order("created_at", { ascending: false });
      setTasks((ts as any) || []);
      setLoading(false);
    })();
  }, [open, clientId]);

  const cols: Array<{ key: string; title: string }> = [
    { key: "todo", title: "A fazer" },
    { key: "doing", title: "Em andamento" },
    { key: "review", title: "Revisão" },
    { key: "done", title: "Feito" },
  ];

  async function move(taskId: string, next: string) {
    setTasks(cur => cur.map(t => t.id === taskId ? { ...t, status: next } : t));
    await supabase.from("tasks").update({ status: next }).eq("id", taskId);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Columns3 className="w-4 h-4 text-primary" /> Kanban · {clientName || "cliente"} {projectName && <span className="text-muted-foreground font-normal">/ {projectName}</span>}
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="p-8 flex items-center justify-center text-muted-foreground text-xs"><Loader2 className="w-4 h-4 animate-spin mr-2" /> carregando…</div>
        ) : !clientId ? (
          <p className="text-xs text-muted-foreground">Selecione um cliente no Workspace primeiro.</p>
        ) : tasks.length === 0 ? (
          <p className="text-xs text-muted-foreground">Este projeto ainda não tem tarefas. Use <b>/tarefa</b> nas Notas para criar.</p>
        ) : (
          <div className="grid grid-cols-4 gap-2 max-h-[60vh] overflow-y-auto">
            {cols.map(col => (
              <div key={col.key} className="bg-secondary/30 rounded-lg p-2 space-y-1.5">
                <div className="text-[10px] uppercase font-semibold text-muted-foreground px-1 flex items-center justify-between">
                  <span>{col.title}</span>
                  <span className="text-[9px] opacity-60">{tasks.filter(t => t.status === col.key).length}</span>
                </div>
                {tasks.filter(t => t.status === col.key).map(t => (
                  <div key={t.id} className="bg-background rounded p-2 border border-border text-[11px] space-y-1">
                    <div className="font-medium">{t.title}</div>
                    <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                      {t.priority && <span className={cn("px-1.5 py-0.5 rounded",
                        t.priority === "urgent" ? "bg-destructive/20 text-destructive" :
                        t.priority === "high" ? "bg-amber-500/20 text-amber-600" : "bg-secondary")}>{t.priority}</span>}
                      {t.due_date && <span>· {t.due_date}</span>}
                    </div>
                    <div className="flex gap-1 pt-1">
                      {cols.filter(c => c.key !== t.status).map(c => (
                        <button key={c.key} onClick={() => move(t.id, c.key)}
                          className="text-[9px] px-1.5 py-0.5 rounded border border-border hover:bg-secondary text-muted-foreground hover:text-foreground">
                          → {c.title}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
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

function AgentChat({ clientId, clientName, folderId, folderPath, availableFiles, notes, script, boardLog }: {
  clientId: string | null; clientName: string | null; folderId: string | null; folderPath: string;
  availableFiles: FileRef[]; notes: string; script: string; boardLog?: string[];
}) {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<AgentMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    if (window.innerWidth < 768) return false;
    return localStorage.getItem("studio_agent_sidebar") !== "0";
  });
  useEffect(() => {
    if (isMobile) return;
    try { localStorage.setItem("studio_agent_sidebar", sidebarOpen ? "1" : "0"); } catch {}
  }, [sidebarOpen, isMobile]);
  const [streamBuf, setStreamBuf] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [personaOpen, setPersonaOpen] = useState(false);
  type PersonaRow = { gpt_url: string | null; gpt_name: string | null; client_id: string | null; folder_path: string | null };
  const [persona, setPersona] = useState<{ active: PersonaRow | null; scopeLevel: "folder" | "client" | "global" | "none" }>({ active: null, scopeLevel: "none" });
  async function reloadPersona() {
    const { data } = await supabase.from("workspace_agent_personas")
      .select("gpt_url,gpt_name,client_id,folder_path");
    const rows = (data || []) as PersonaRow[];
    const pick = (fn: (r: PersonaRow) => boolean) => rows.find(fn) || null;
    let active: PersonaRow | null = null;
    let level: "folder" | "client" | "global" | "none" = "none";
    if (clientId && folderPath) {
      active = pick(r => r.client_id === clientId && r.folder_path === folderPath);
      if (active) level = "folder";
    }
    if (!active && clientId) {
      active = pick(r => r.client_id === clientId && !r.folder_path);
      if (active) level = "client";
    }
    if (!active) {
      active = pick(r => !r.client_id && !r.folder_path);
      if (active) level = "global";
    }
    setPersona({ active, scopeLevel: level });
  }
  useEffect(() => { void reloadPersona(); }, [clientId, folderPath]);

  // @ e / no composer do agente
  const [mention, setMention] = useState<{ q: string; start: number } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [slash, setSlash] = useState<{ q: string; start: number } | null>(null);
  const [slashIdx, setSlashIdx] = useState(0);
  // arquivos anexados à próxima mensagem (sincronizam com @ do input)
  const [attached, setAttached] = useState<FileRef[]>([]);
  // recentes globais por usuário (top 8)
  const RECENT_KEY = "studio:recentMentions";
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
  });
  const pushRecent = (id: string) => setRecentIds(prev => {
    const next = [id, ...prev.filter(x => x !== id)].slice(0, 8);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
    return next;
  });


  const AGENT_SLASH: { key: string; label: string; hint: string; prompt: string }[] = [
    { key: "roteiro",   label: "Gerar roteiro",       hint: "Prepro 6 passos",         prompt: "Gere um roteiro completo seguindo os 6 passos do Prepro Director com base nos materiais anexados." },
    { key: "storyboard",label: "Storyboard",          hint: "cena a cena",             prompt: "Monte um storyboard cena a cena (visual + fala + duração) usando os arquivos anexados." },
    { key: "resumir",   label: "Resumir arquivos",    hint: "insights + próximos passos", prompt: "Analise e resuma os arquivos anexados. Traga insights e próximos passos." },
    { key: "brief",     label: "Extrair briefing",    hint: "objetivo + público + tom", prompt: "Extraia um briefing (objetivo, público, canal, duração, tom, referências) dos anexos." },
    { key: "checklist", label: "Checklist de pipeline", hint: "brutos → publicado",    prompt: "Gere um checklist de pipeline personalizado para este projeto (Brutos → Trilhas/SFX → Edição → Final → Publicado)." },
    { key: "hooks",     label: "5 hooks",              hint: "aberturas 0-3s",         prompt: "Sugira 5 opções de hook (0-3s) alinhadas ao contexto e materiais anexados." },
    { key: "cta",       label: "Variações de CTA",     hint: "3 opções",               prompt: "Escreva 3 variações de CTA para este roteiro/contexto." },
    { key: "revisar",   label: "Revisar roteiro",      hint: "notas do Prepro",        prompt: "Revise o roteiro atual conforme a metodologia Prepro Director e liste correções priorizadas." },
  ];

  // Threads escopadas por cliente. Filtro opcional: "cliente" (todas as pastas) ou "pasta" (apenas a atual).
  const [threadScope, setThreadScope] = useState<"client" | "folder">(() => {
    try { return (localStorage.getItem("studio:threadScope") as any) || "client"; } catch { return "client"; }
  });
  useEffect(() => { try { localStorage.setItem("studio:threadScope", threadScope); } catch {} }, [threadScope]);
  const lastThreadKey = (cid?: string | null, fp?: string | null, scope?: string) =>
    `studio:lastThread:${scope || threadScope}:${cid || "_global"}:${scope === "folder" ? (fp || "_root") : "_any"}`;
  useEffect(() => { void loadThreads(); }, [clientId, folderPath, threadScope]);
  async function loadThreads() {
    let q = supabase.from("workspace_agent_threads").select("id,title,updated_at,client_id,folder_path")
      .order("updated_at", { ascending: false }).limit(50);
    q = clientId ? q.eq("client_id", clientId) : q.is("client_id", null);
    if (threadScope === "folder") {
      q = folderPath ? q.eq("folder_path", folderPath) : q.is("folder_path", null);
    }
    const { data } = await q;
    const list = (data as AgentThread[]) || [];
    setThreads(list);
    if (!list.length) { setActiveId(null); return; }
    let restored: string | null = null;
    try { restored = localStorage.getItem(lastThreadKey(clientId, folderPath, threadScope)); } catch {}
    const pick = (restored && list.find(t => t.id === restored)?.id) || list[0].id;
    setActiveId(pick);
  }

  // Persiste a última thread ativa por (escopo, cliente, pasta) para restaurar ao reabrir
  useEffect(() => {
    if (!activeId) return;
    try { localStorage.setItem(lastThreadKey(clientId, folderPath, threadScope), activeId); } catch {}
  }, [activeId, clientId, folderPath, threadScope]);



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




  // Fuzzy: retorna { score, ranges } — score maior = melhor. Prioriza: exato > prefixo > subsequência.
  function fuzzyScore(name: string, q: string): { score: number; ranges: [number, number][] } | null {
    if (!q) return { score: 0, ranges: [] };
    const n = name.toLowerCase(); const s = q.toLowerCase();
    if (n === s) return { score: 1000, ranges: [[0, s.length]] };
    if (n.startsWith(s)) return { score: 800, ranges: [[0, s.length]] };
    const idx = n.indexOf(s);
    if (idx >= 0) return { score: 600 - idx, ranges: [[idx, idx + s.length]] };
    // subsequência
    let si = 0, score = 0, streak = 0;
    const ranges: [number, number][] = [];
    for (let i = 0; i < n.length && si < s.length; i++) {
      if (n[i] === s[si]) {
        ranges.push([i, i + 1]);
        streak++; score += 10 + streak * 2;
        si++;
      } else { streak = 0; }
    }
    if (si < s.length) return null;
    // merge ranges contíguos
    const merged: [number, number][] = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && last[1] === r[0]) last[1] = r[1]; else merged.push([r[0], r[1]]);
    }
    return { score, ranges: merged };
  }
  type ScoredFile = FileRef & { _score: number; _ranges: [number, number][]; _recent?: boolean };
  const mentionMatches = useMemo<ScoredFile[]>(() => {
    if (!mention) return [];
    const q = mention.q.trim();
    if (!q) {
      // sem query: recentes primeiro, depois pastas, depois arquivos
      const recents = recentIds
        .map(id => availableFiles.find(f => f.id === id))
        .filter(Boolean) as FileRef[];
      const rest = availableFiles.filter(f => !recentIds.includes(f.id));
      return [
        ...recents.map(f => ({ ...f, _score: 999, _ranges: [] as [number, number][], _recent: true })),
        ...rest.map(f => ({ ...f, _score: f.kind === "folder" ? 1 : 0, _ranges: [] as [number, number][] })),
      ].slice(0, 10);
    }
    const scored = availableFiles
      .map(f => {
        const r = fuzzyScore(f.name, q);
        if (!r) return null;
        const bonus = f.kind === "folder" ? 5 : 0;
        const rec = recentIds.includes(f.id) ? 50 : 0;
        return { ...f, _score: r.score + bonus + rec, _ranges: r.ranges, _recent: rec > 0 } as ScoredFile;
      })
      .filter(Boolean) as ScoredFile[];
    return scored.sort((a, b) => b._score - a._score).slice(0, 10);
  }, [mention, availableFiles, recentIds]);

  useEffect(() => { setMentionIdx(0); }, [mention?.q]);
  useEffect(() => { setSlashIdx(0); }, [slash?.q]);

  const slashMatches = useMemo(() => {
    if (!slash) return [] as typeof AGENT_SLASH;
    const q = slash.q.toLowerCase();
    return AGENT_SLASH.filter(c => c.key.includes(q) || c.label.toLowerCase().includes(q));
  }, [slash]);

  function onInputChange(val: string, caret: number) {
    setInput(val);
    const before = val.slice(0, caret);
    const mAt = /@([^\s@]{0,40})$/.exec(before);
    const mSlash = /(^|\s)\/([^\s/]{0,20})$/.exec(before);
    if (mAt) { setMention({ q: mAt[1], start: caret - mAt[0].length }); setSlash(null); }
    else if (mSlash) { setSlash({ q: mSlash[2], start: caret - (mSlash[2].length + 1) }); setMention(null); }
    else { setMention(null); setSlash(null); }
  }


  function pickMention(f: FileRef) {
    if (!mention) return;
    const insert = `[@${f.name}](wsfile:${f.id})`;
    const before = input.slice(0, mention.start);
    const after = input.slice(mention.start + 1 + mention.q.length);
    const next = before + insert + " " + after;
    setInput(next);
    setAttached(prev => prev.some(x => x.id === f.id) ? prev : [...prev, f]);
    pushRecent(f.id);
    setMention(null);

    setTimeout(() => {
      const el = inputRef.current;
      if (el) { el.focus(); const p = before.length + insert.length + 1; el.setSelectionRange(p, p); }
    }, 10);
  }

  function pickSlash(cmd: typeof AGENT_SLASH[number]) {
    if (!slash) return;
    const before = input.slice(0, slash.start);
    const after = input.slice(slash.start + 1 + slash.q.length);
    const next = (before + cmd.prompt + " " + after).trimStart();
    setInput(next);
    setSlash(null);
    setTimeout(() => inputRef.current?.focus(), 10);
  }

  function removeAttached(id: string) {
    setAttached(prev => prev.filter(f => f.id !== id));
    // remove todas as ocorrências do link do arquivo no input
    setInput(prev => prev.replace(new RegExp(`\\s?\\[@[^\\]]+\\]\\(wsfile:${id}\\)`, "g"), "").trim());
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
    // Preserva anexos no conteúdo da mensagem — histórico da thread mantém as referências
    const attachBlock = attached.length
      ? `\n\n---\n📎 Anexos:\n${attached.map(a => `- [${a.name}](wsfile:${a.id})${a.url ? ` (${a.url})` : ""}`).join("\n")}`
      : "";
    const finalText = text + attachBlock;
    const currentAttachments = attached;
    setInput("");
    setAttached([]);
    setMsgs(m => [...m, { id: crypto.randomUUID(), role: "user", content: finalText, created_at: new Date().toISOString() }]);
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
          message: finalText,
          context: {
            client_id: clientId,
            client_name: clientName,
            folder_id: folderId,
            folder_path: folderPath,
            notes: boardLog && boardLog.length
              ? `${notes}\n\n---\n## Atividade do Kanban (últimas ${boardLog.length})\n${boardLog.map(l => `- ${l}`).join("\n")}`
              : notes,
            script,
            // arquivos citados via @ ganham prioridade e vão marcados
            attachments: currentAttachments.map(f => ({ id: f.id, name: f.name, kind: f.kind, url: f.url })),
            // conteúdo da pasta atual (auto): subpastas + arquivos
            folder_contents: {
              subfolders: availableFiles.filter(f => f.kind === "folder").slice(0, 30).map(f => ({ id: f.id, name: f.name })),
              files: availableFiles.filter(f => f.kind === "file").slice(0, 40).map(f => ({ id: f.id, name: f.name, url: f.url })),
              total: availableFiles.length,
            },
            // legado (compatibilidade)
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
    <div className="flex h-full min-h-0">
      {/* Sidebar de threads */}
      {sidebarOpen && (
        <aside className="w-[180px] shrink-0 border-r border-border bg-background/60 flex flex-col min-h-0">
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-secondary/30">
            <MessageSquare className="w-3 h-3 text-muted-foreground" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex-1 truncate">
              {clientName ? clientName : "Global"}
            </span>
            <button onClick={newThread} className="p-1 rounded hover:bg-secondary text-muted-foreground" title="Nova conversa">
              <Plus className="w-3 h-3" />
            </button>
            <button onClick={() => setSidebarOpen(false)} className="p-1 rounded hover:bg-secondary text-muted-foreground" title="Recolher">
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border bg-background/40">
            <button onClick={() => setThreadScope("client")}
              className={cn("flex-1 text-[9px] uppercase tracking-wider py-1 rounded",
                threadScope === "client" ? "bg-primary/20 text-primary font-semibold" : "text-muted-foreground hover:bg-secondary")}>
              Cliente
            </button>
            <button onClick={() => setThreadScope("folder")}
              className={cn("flex-1 text-[9px] uppercase tracking-wider py-1 rounded",
                threadScope === "folder" ? "bg-primary/20 text-primary font-semibold" : "text-muted-foreground hover:bg-secondary")}>
              Pasta
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {threads.length === 0 && <p className="text-[10px] text-muted-foreground px-3 py-2">Nenhuma conversa ainda.</p>}
            {threads.map(t => (
              <div key={t.id}
                className={cn("group flex flex-col gap-0.5 px-2 py-1.5 hover:bg-secondary/60 cursor-pointer border-l-2",
                  activeId === t.id ? "bg-secondary border-primary" : "border-transparent")}
                onClick={() => setActiveId(t.id)}>
                <div className="flex items-center gap-1">
                  <MessageSquare className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="text-[11px] truncate flex-1">{t.title}</span>
                  <button onClick={(e) => { e.stopPropagation(); deleteThread(t.id); }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-destructive">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                {threadScope === "client" && t.folder_path && (
                  <span className="text-[9px] text-muted-foreground/70 truncate pl-4">📁 {t.folder_path}</span>
                )}
              </div>
            ))}
          </div>
        </aside>
      )}


      <div className="flex flex-col h-full flex-1 min-w-0">
        {/* Header: cliente + toggle sidebar + nova */}
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-secondary/30">
          {!sidebarOpen && (
            <button onClick={() => setSidebarOpen(true)}
              className="p-1 rounded hover:bg-secondary text-muted-foreground" title="Mostrar conversas">
              <History className="w-3 h-3" />
            </button>
          )}
          <Bot className="w-3.5 h-3.5 text-primary" />
          <span className="text-[10px] font-medium text-foreground/80 truncate flex-1">
            {clientName ? `Agente · ${clientName}` : "Agente · Global"}
            {folderPath && <span className="text-muted-foreground"> · /{folderPath.split("/").slice(-2).join("/")}</span>}
          </span>
          <button onClick={() => setPersonaOpen(true)}
            className="p-1 rounded hover:bg-secondary text-muted-foreground" title="Configurar GPT persona">
            <Settings className="w-3 h-3" />
          </button>
          <button onClick={newThread}
            className="p-1 rounded hover:bg-secondary text-muted-foreground" title="Nova conversa">
            <Plus className="w-3 h-3" />
          </button>
        </div>
        <PersonaDialog open={personaOpen} onOpenChange={setPersonaOpen}
          active={persona.active} scopeLevel={persona.scopeLevel}
          clientId={clientId} clientName={clientName} folderPath={folderPath}
          onSaved={reloadPersona} />
        {/* Chip de contexto auto por pasta */}
        <div className="px-2 py-1 border-b border-border bg-background/60 flex flex-wrap items-center gap-1 text-[9px] text-muted-foreground">
          <span className="px-1.5 py-0.5 rounded bg-secondary/60 text-foreground/70">📁 /{folderPath || "raiz"}</span>
          <span className="px-1.5 py-0.5 rounded bg-secondary/40">📎 {availableFiles.filter(f=>f.kind==="file").length} arq</span>
          <span className="px-1.5 py-0.5 rounded bg-secondary/40">🗂 {availableFiles.filter(f=>f.kind==="folder").length} sub</span>
          {notes?.trim() && <span className="px-1.5 py-0.5 rounded bg-secondary/40">📝 notas</span>}
          {script?.trim() && <span className="px-1.5 py-0.5 rounded bg-secondary/40">🎬 roteiro</span>}
          <span className="ml-auto opacity-60">contexto auto</span>
        </div>


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
      <div className="border-t border-border bg-secondary/30">
        {attached.length > 0 && (
          <div className="flex flex-wrap gap-1 px-2 pt-2">
            {attached.map(a => (
              <span key={a.id} className="inline-flex items-center gap-1 text-[10px] bg-primary/10 text-primary rounded-full pl-2 pr-1 py-0.5">
                {a.kind === "folder" ? <FolderIcon className="w-2.5 h-2.5" /> : <FileIcon className="w-2.5 h-2.5" />}
                <span className="max-w-[140px] truncate">{a.name}</span>
                <button onClick={() => removeAttached(a.id)} className="hover:bg-primary/20 rounded-full p-0.5">
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="relative p-2 flex items-end gap-1">
          {/* Popover @ arquivos — busca fuzzy + navegação por teclado */}
          {mention && (
            <div className="absolute bottom-full left-2 right-2 mb-1 bg-popover border border-border rounded-lg shadow-xl overflow-hidden z-20 max-h-[260px] overflow-y-auto">
              <div className="px-3 py-1 flex items-center gap-2 text-[9px] uppercase tracking-wider text-muted-foreground bg-secondary/40 border-b border-border">
                <span>Anexar do workspace</span>
                <span className="ml-auto normal-case tracking-normal text-[10px] text-muted-foreground/70">
                  {mention.q ? `"${mention.q}"` : "digite para filtrar"} · ↑↓ ⏎
                </span>
              </div>
              {mentionMatches.length === 0 ? (
                <div className="px-3 py-3 text-[11px] text-muted-foreground text-center">Nenhum arquivo encontrado</div>
              ) : mentionMatches.map((f, i) => (
                <button key={f.id}
                  onMouseEnter={() => setMentionIdx(i)}
                  onClick={() => pickMention(f)}
                  className={cn("w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left",
                    i === mentionIdx ? "bg-primary/15 text-foreground" : "hover:bg-secondary")}>
                  {f.kind === "folder"
                    ? <FolderIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    : <FileIcon className="w-3.5 h-3.5 text-primary shrink-0" />}
                  <span className="truncate flex-1">{highlightRanges(f.name, f._ranges)}</span>
                  {f._recent && <span className="text-[9px] uppercase tracking-wider text-primary/70 shrink-0">recente</span>}
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 shrink-0">
                    {f.kind === "folder" ? "pasta" : "arquivo"}
                  </span>
                </button>
              ))}
            </div>
          )}
          {/* Popover / ações */}
          {slash && slashMatches.length > 0 && (
            <div className="absolute bottom-full left-2 right-2 mb-1 bg-popover border border-border rounded-lg shadow-xl overflow-hidden z-20 max-h-[240px] overflow-y-auto">
              <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-muted-foreground bg-secondary/40 border-b border-border">
                Ações do agente
              </div>
              {slashMatches.map((c, i) => (
                <button key={c.key}
                  onMouseEnter={() => setSlashIdx(i)}
                  onClick={() => pickSlash(c)}
                  className={cn("w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left",
                    i === slashIdx ? "bg-primary/15" : "hover:bg-secondary")}>
                  <Sparkles className="w-3 h-3 text-primary shrink-0" />
                  <span className="font-medium">{c.label}</span>
                  <span className="text-[10px] text-muted-foreground truncate ml-auto">{c.hint}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => onInputChange(e.target.value, e.target.selectionStart)}
            onKeyUp={e => onInputChange((e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart)}
            onKeyDown={e => {
              if (e.key === "Escape") { setMention(null); setSlash(null); return; }
              if (mention && mentionMatches.length > 0) {
                if (e.key === "ArrowDown") { e.preventDefault(); setMentionIdx(i => (i + 1) % mentionMatches.length); return; }
                if (e.key === "ArrowUp")   { e.preventDefault(); setMentionIdx(i => (i - 1 + mentionMatches.length) % mentionMatches.length); return; }
                if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(mentionMatches[mentionIdx]); return; }
              }
              if (slash && slashMatches.length > 0) {
                if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx(i => (i + 1) % slashMatches.length); return; }
                if (e.key === "ArrowUp")   { e.preventDefault(); setSlashIdx(i => (i - 1 + slashMatches.length) % slashMatches.length); return; }
                if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickSlash(slashMatches[slashIdx]); return; }
              }
              if (e.key === "Enter" && !e.shiftKey && !mention && !slash) { e.preventDefault(); void send(); }
            }}
            placeholder="Pergunte ao agente... @ anexa arquivos · / dispara ações"
            rows={2}
            className="flex-1 resize-none bg-background border border-border rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-primary/50"
          />

          <Button size="sm" onClick={send} disabled={streaming || !input.trim()} className="h-8 px-2">
            {streaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>
      </div>
    </div>
  );
}

// =========================
// MINI KANBAN (drag-drop entre colunas + log de contexto)
// =========================
function MiniKanban({ board, onChange, onReset, log }: {
  board: BoardCol[];
  onChange: (next: BoardCol[], logEntry?: string) => void;
  onReset: () => void;
  log: string[];
}) {
  const [drag, setDrag] = useState<{ cardId: string; fromCol: string } | null>(null);
  const [editing, setEditing] = useState<{ colId: string; cardId: string } | null>(null);
  const [editVal, setEditVal] = useState("");
  const [addingIn, setAddingIn] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [showLog, setShowLog] = useState(false);

  const now = () => new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  function moveCard(cardId: string, fromCol: string, toCol: string) {
    if (fromCol === toCol) return;
    let title = "";
    const next = board.map(c => {
      if (c.id === fromCol) {
        const card = c.cards.find(k => k.id === cardId);
        if (card) title = card.title;
        return { ...c, cards: c.cards.filter(k => k.id !== cardId) };
      }
      return c;
    }).map(c => {
      if (c.id === toCol) {
        const card = board.find(b => b.id === fromCol)?.cards.find(k => k.id === cardId);
        return card ? { ...c, cards: [...c.cards, card] } : c;
      }
      return c;
    });
    const fromT = board.find(b => b.id === fromCol)?.title || fromCol;
    const toT = board.find(b => b.id === toCol)?.title || toCol;
    onChange(next, `[${now()}] "${title}" movido de ${fromT} → ${toT}`);
  }

  function addCard(colId: string) {
    const t = newTitle.trim();
    if (!t) { setAddingIn(null); return; }
    const card: BoardCard = { id: crypto.randomUUID(), title: t };
    const next = board.map(c => c.id === colId ? { ...c, cards: [...c.cards, card] } : c);
    const colT = board.find(b => b.id === colId)?.title || colId;
    onChange(next, `[${now()}] card criado "${t}" em ${colT}`);
    setNewTitle(""); setAddingIn(null);
  }

  function saveEdit() {
    if (!editing) return;
    const t = editVal.trim();
    if (!t) { setEditing(null); return; }
    let old = "";
    const next = board.map(c => c.id === editing.colId
      ? { ...c, cards: c.cards.map(k => {
          if (k.id === editing.cardId) { old = k.title; return { ...k, title: t }; }
          return k;
        }) }
      : c);
    onChange(next, old !== t ? `[${now()}] card renomeado "${old}" → "${t}"` : undefined);
    setEditing(null);
  }

  function delCard(colId: string, cardId: string) {
    let title = "";
    const next = board.map(c => c.id === colId
      ? { ...c, cards: c.cards.filter(k => { if (k.id === cardId) title = k.title; return k.id !== cardId; }) }
      : c);
    const colT = board.find(b => b.id === colId)?.title || colId;
    onChange(next, `[${now()}] card removido "${title}" de ${colT}`);
  }

  function renameColumn(colId: string, title: string) {
    const t = title.trim();
    if (!t) return;
    let old = "";
    const next = board.map(c => { if (c.id === colId) { old = c.title; return { ...c, title: t }; } return c; });
    onChange(next, old !== t ? `[${now()}] coluna renomeada "${old}" → "${t}"` : undefined);
  }

  return (
    <div className="p-2 h-full flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <p className="text-[10px] text-muted-foreground flex-1">
          Arraste cards entre colunas. Cada movimento vira contexto do agente.
        </p>
        <button onClick={() => setShowLog(v => !v)}
          className="text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-secondary text-muted-foreground">
          <History className="w-3 h-3" /> Log ({log.length})
        </button>
        <button onClick={onReset} className="text-[10px] text-muted-foreground hover:text-destructive">Reset</button>
      </div>

      {showLog && (
        <div className="bg-secondary/40 border border-border rounded-md p-2 max-h-[110px] overflow-y-auto text-[10px] font-mono space-y-0.5">
          {log.length === 0 && <p className="text-muted-foreground">Sem atividade ainda.</p>}
          {[...log].reverse().map((l, i) => <p key={i} className="text-foreground/80">{l}</p>)}
        </div>
      )}

      <div className="flex-1 min-h-0 flex gap-2 overflow-x-auto pb-2">
        {board.map(col => (
          <div
            key={col.id}
            onDragOver={e => e.preventDefault()}
            onDrop={() => { if (drag) { moveCard(drag.cardId, drag.fromCol, col.id); setDrag(null); } }}
            className="min-w-[180px] w-[180px] shrink-0 bg-secondary/30 border border-border rounded-lg flex flex-col"
          >
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border">
              <input
                defaultValue={col.title}
                onBlur={e => renameColumn(col.id, e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className="flex-1 text-[11px] font-semibold bg-transparent focus:outline-none focus:bg-background/60 rounded px-1"
              />
              <span className="text-[10px] text-muted-foreground">{col.cards.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
              {col.cards.map(card => (
                <div
                  key={card.id}
                  draggable
                  onDragStart={() => setDrag({ cardId: card.id, fromCol: col.id })}
                  onDragEnd={() => setDrag(null)}
                  className="group bg-card border border-border rounded-md p-1.5 cursor-grab active:cursor-grabbing hover:border-primary/40 transition-colors"
                >
                  {editing?.cardId === card.id ? (
                    <Input
                      autoFocus value={editVal}
                      onChange={e => setEditVal(e.target.value)}
                      onBlur={saveEdit}
                      onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(null); }}
                      className="h-6 text-[11px] py-0"
                    />
                  ) : (
                    <div className="flex items-start gap-1">
                      <GripVertical className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
                      <p className="text-[11px] leading-snug flex-1 break-words">{card.title}</p>
                      <button onClick={() => { setEditing({ colId: col.id, cardId: card.id }); setEditVal(card.title); }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-foreground">
                        <Pencil className="w-2.5 h-2.5" />
                      </button>
                      <button onClick={() => delCard(col.id, card.id)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {addingIn === col.id ? (
                <div className="space-y-1">
                  <Input
                    autoFocus value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    onBlur={() => addCard(col.id)}
                    onKeyDown={e => { if (e.key === "Enter") addCard(col.id); if (e.key === "Escape") { setNewTitle(""); setAddingIn(null); } }}
                    placeholder="Título do card…"
                    className="h-7 text-[11px]"
                  />
                </div>
              ) : (
                <button onClick={() => setAddingIn(col.id)}
                  className="w-full flex items-center gap-1 px-1.5 py-1 rounded text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground">
                  <Plus className="w-3 h-3" /> Novo card
                </button>
              )}
            </div>
          </div>
        ))}

        <button
          onClick={() => {
            const t = window.prompt("Nome da coluna");
            if (!t?.trim()) return;
            const next = [...board, { id: crypto.randomUUID(), title: t.trim(), cards: [] }];
            onChange(next, `[${now()}] coluna criada "${t.trim()}"`);
          }}
          className="min-w-[140px] w-[140px] shrink-0 border border-dashed border-border rounded-lg flex items-center justify-center text-[11px] text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
        >
          <Plus className="w-3.5 h-3.5 mr-1" /> Coluna
        </button>
      </div>
    </div>
  );
}

// =========================
// QuickTaskDialog — cria tarefa no Kanban do cliente via slash /tarefa
// =========================
function QuickTaskDialog({ draft, clientId, clientName, onClose, onCreated }: {
  draft: { raw: string; where: "notes"|"script"; insertAt: number; tokenLen: number };
  clientId: string | null;
  clientName: string | null;
  onClose: () => void;
  onCreated: (summary: string) => void;
}) {
  const { toast } = useToast();
  const [raw, setRaw] = useState(draft.raw);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<"low"|"medium"|"high"|"urgent">("medium");
  const [assigneeName, setAssigneeName] = useState("");
  const [dueISO, setDueISO] = useState("");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [staff, setStaff] = useState<{ id: string; full_name: string | null; email: string }[]>([]);
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Reparse shorthand quando raw muda
  useEffect(() => {
    const p = parseTaskShorthand(raw);
    setTitle(p.title);
    setPriority(p.priority);
    if (p.assigneeName) setAssigneeName(p.assigneeName);
    if (p.dueISO) setDueISO(p.dueISO);
  }, [raw]);

  // Carrega projetos do cliente + staff atribuível
  useEffect(() => {
    (async () => {
      if (!clientId) return;
      const { data: ps } = await supabase
        .from("projects")
        .select("id,name,created_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });
      const list = (ps || []).map((p: any) => ({ id: p.id, name: p.name }));
      setProjects(list);
      if (list.length && !projectId) setProjectId(list[0].id);

      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["admin", "design", "traffic", "manager"] as any);
      const ids = Array.from(new Set((roles || []).map((r: any) => r.user_id)));
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles").select("id,full_name,email").in("id", ids);
        setStaff((profs || []) as any);
      }
    })();
  }, [clientId]);

  // Auto-match assignee por nome
  useEffect(() => {
    if (!assigneeName || !staff.length) return;
    const q = assigneeName.toLowerCase();
    const hit = staff.find(s => (s.full_name || s.email).toLowerCase().includes(q));
    if (hit) setAssigneeId(hit.id);
  }, [assigneeName, staff]);

  async function submit() {
    if (!title.trim()) { toast({ title: "Título obrigatório", variant: "destructive" }); return; }
    if (!projectId) { toast({ title: "Selecione um projeto", variant: "destructive" }); return; }
    setSaving(true);
    const { error } = await supabase.from("tasks").insert({
      project_id: projectId,
      title: title.trim().slice(0, 200),
      priority,
      status: "backlog",
      assigned_to: assigneeId || null,
      due_date: dueISO || null,
      source: "studio",
    } as any);
    setSaving(false);
    if (error) { toast({ title: "Erro ao criar tarefa", description: error.message, variant: "destructive" }); return; }
    const who = staff.find(s => s.id === assigneeId);
    const parts = [
      title.trim(),
      priority !== "medium" && `!${priority}`,
      who && `@${who.full_name || who.email.split("@")[0]}`,
      dueISO && `📅 ${dueISO}`,
    ].filter(Boolean).join(" ");
    toast({ title: "Tarefa criada no Kanban", description: parts });
    onCreated(parts);
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            Nova tarefa {clientName ? `· ${clientName}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2.5">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Atalho</label>
            <Input value={raw} onChange={e => setRaw(e.target.value)}
              placeholder="Editar hook !alta @maria 15/07"
              className="h-8 text-[12px] font-mono" autoFocus />
            <p className="text-[9px] text-muted-foreground mt-1">
              <code>!alta/!media/!baixa/!urgente</code> · <code>@nome</code> · <code>15/07</code>, <code>hoje</code>, <code>+3d</code>
            </p>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Título</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} className="h-8 text-[12px]" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Projeto</label>
              <select value={projectId} onChange={e => setProjectId(e.target.value)}
                className="w-full h-8 bg-background border border-border rounded-md px-2 text-[12px]">
                {projects.length === 0 && <option value="">— sem projeto —</option>}
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Prioridade</label>
              <select value={priority} onChange={e => setPriority(e.target.value as any)}
                className="w-full h-8 bg-background border border-border rounded-md px-2 text-[12px]">
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Responsável</label>
              <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)}
                className="w-full h-8 bg-background border border-border rounded-md px-2 text-[12px]">
                <option value="">— ninguém —</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Prazo</label>
              <Input type="date" value={dueISO} onChange={e => setDueISO(e.target.value)} className="h-8 text-[12px]" />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button size="sm" onClick={submit} disabled={saving || !title.trim() || !projectId}>
            {saving ? "Criando…" : "Criar tarefa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PersonaDialog({ open, onOpenChange, active, scopeLevel, clientId, clientName, folderPath, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  active: { gpt_url: string | null; gpt_name: string | null; client_id: string | null; folder_path: string | null } | null;
  scopeLevel: "folder" | "client" | "global" | "none";
  clientId: string | null;
  clientName: string | null;
  folderPath: string;
  onSaved: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [url, setUrl] = useState(active?.gpt_url || "");
  const [loading, setLoading] = useState(false);
  type Scope = "global" | "client" | "folder";
  const defaultScope: Scope = clientId ? (folderPath ? "folder" : "client") : "global";
  const [scope, setScope] = useState<Scope>(defaultScope);
  useEffect(() => {
    setUrl(active?.gpt_url || "");
    setScope(clientId ? (folderPath ? "folder" : "client") : "global");
  }, [active, open, clientId, folderPath]);

  const bodyScope = () => ({
    client_id: scope === "global" ? null : clientId,
    folder_path: scope === "folder" ? folderPath : null,
  });

  async function importGpt() {
    if (!/^https?:\/\/.+/i.test(url)) {
      toast({ title: "Link inválido", description: "Cole o link público do seu GPT (chatgpt.com/g/...).", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("workspace-agent-import", { body: { url, ...bodyScope() } });
      if (error || (data as any)?.error) {
        toast({ title: "Falhou", description: (data as any)?.error || error?.message || "erro", variant: "destructive" });
        return;
      }
      const d = data as any;
      await onSaved();
      toast({ title: "Persona salva", description: d.name ? `"${d.name}" ativa neste escopo.` : "Persona salva." });
      onOpenChange(false);
    } finally { setLoading(false); }
  }

  async function clearPersona() {
    setLoading(true);
    try {
      await supabase.functions.invoke("workspace-agent-import", { body: { clear: true, ...bodyScope() } });
      await onSaved();
      setUrl("");
      toast({ title: "Persona removida", description: "Voltando ao escopo superior." });
      onOpenChange(false);
    } finally { setLoading(false); }
  }

  const scopeLabel = scope === "folder" ? `Pasta atual · /${folderPath || "raiz"}`
    : scope === "client" ? `Cliente · ${clientName || "atual"}`
    : "Global (todos os workspaces)";
  const activeScopeLabel = scopeLevel === "folder" ? "pasta atual"
    : scopeLevel === "client" ? "cliente atual"
    : scopeLevel === "global" ? "global" : "nenhum";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Bot className="w-4 h-4 text-primary" /> Persona do agente
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Cole o link público do <b>Custom GPT</b>. A persona é salva no <b>escopo escolhido</b> e sobrescreve os mais amplos: pasta &gt; cliente &gt; global.
          </p>

          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Aplicar em</label>
            <div className="grid grid-cols-3 gap-1">
              {(["folder", "client", "global"] as Scope[]).map(s => {
                const disabled = (s !== "global" && !clientId) || (s === "folder" && !folderPath);
                return (
                  <button key={s} type="button" disabled={disabled}
                    onClick={() => setScope(s)}
                    className={cn("text-[10px] px-2 py-1.5 rounded border transition",
                      scope === s ? "bg-primary text-primary-foreground border-primary" : "bg-secondary/40 border-border hover:bg-secondary",
                      disabled && "opacity-40 cursor-not-allowed")}>
                    {s === "folder" ? "📁 Pasta" : s === "client" ? "👤 Cliente" : "🌐 Global"}
                  </button>
                );
              })}
            </div>
            <div className="text-[10px] text-muted-foreground pt-0.5">{scopeLabel}</div>
          </div>

          <Input value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder="https://chatgpt.com/g/g-xxxxxxxx-nome-do-gpt" className="text-xs" />

          {active?.gpt_name && (
            <div className="text-[11px] flex items-center gap-1.5 text-primary">
              <Check className="w-3 h-3" /> Em uso agora: <b>{active.gpt_name}</b>
              <span className="text-muted-foreground">({activeScopeLabel})</span>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          {active && ((scope === "folder" && active.folder_path === folderPath && active.client_id === clientId)
            || (scope === "client" && active.client_id === clientId && !active.folder_path)
            || (scope === "global" && !active.client_id && !active.folder_path)) && (
            <Button variant="ghost" size="sm" onClick={clearPersona} disabled={loading}>
              Remover deste escopo
            </Button>
          )}
          <Button size="sm" onClick={importGpt} disabled={loading || !url}>
            {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Sparkles className="w-3 h-3 mr-1" />}
            Carregar persona
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
