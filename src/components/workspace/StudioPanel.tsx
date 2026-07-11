import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  NotebookPen, Brain, Sparkles, ChevronDown, Minus, X, Plus,
  Trash2, GitBranch, ExternalLink, Copy, Wand2, FileText, Link2, MessageSquare,
  Bot, Send, Loader2, History, Paperclip, File as FileIcon, Folder as FolderIcon,
  Columns3, Pencil, GripVertical, Settings, Check, Minimize2, Maximize2, ClipboardPaste,
  Download, Radio, Zap, ArrowRight, ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import aceleriqLogo from "@/assets/logo-aceleriq.png";


/**
 * Studio flutuante: Contexto, Notas e GPT externo.
 * Persistência por contexto (scope + clientId + parentId) no localStorage.
 * Suporta @mention para vincular arquivos do view atual.
 */

const PREPRO_GPT = "https://chatgpt.com/g/g-6a4e9158529c8191a937cee536c18c9f-prepro-director-gpt";

type FileRef = { id: string; name: string; kind: "file" | "folder"; url?: string | null; meta?: string | null };

type Mode = "context" | "notes" | "gpt";


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

type SlashAction = "createTask" | "openKanban" | "uploadImage" | "insertVideo" | "insertMindmap" | "insertHelp";
type SlashCmd = { key: string; label: string; hint: string; insert: string; action?: SlashAction };


function buildSlashCommands(ctx: { clientName?: string | null; folderPath?: string | null; contextLabel: string }): SlashCmd[] {
  const c = ctx.clientName || ctx.contextLabel || "cliente";
  const pasta = ctx.folderPath || "raiz";
  return [
    { key: "help",     label: "Ajuda · comandos / e @",          hint: "abre o guia inline", insert: "", action: "insertHelp" },
    { key: "ajuda",    label: "Ajuda · comandos / e @",          hint: "abre o guia inline", insert: "", action: "insertHelp" },
    { key: "tarefa",   label: "Nova tarefa (Kanban do projeto)", hint: "título !alta @nome 15/07", insert: "", action: "createTask" },
    { key: "kanban",   label: "Ver Kanban do projeto",           hint: "abre inline com tasks reais", insert: "", action: "openKanban" },
    { key: "imagem",   label: "Imagem OCR",                      hint: "extrai texto da imagem", insert: "", action: "uploadImage" },
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

// Definições canônicas para o painel de ajuda inline (@help)
const SLASH_HELP: Array<{ cmd: string; label: string; desc: string }> = [
  { cmd: "/help",      label: "Ajuda",              desc: "Abre este guia inline com todos os comandos." },
  { cmd: "/tarefa",    label: "Nova tarefa",        desc: "Cria tarefa no Kanban do projeto. Aceita !alta !urgente @nome 15/07 hoje +3d." },
  { cmd: "/kanban",    label: "Kanban inline",      desc: "Insere @kanban vivo: lista, cria e move tasks reais do projeto sem sair da nota." },
  { cmd: "/imagem",    label: "Imagem OCR",         desc: "Envia uma imagem e extrai o texto automaticamente na nota." },
  { cmd: "/video",     label: "Embed de vídeo",     desc: "Cole link YouTube/Vimeo/Drive e renderiza o player inline." },
  { cmd: "/mapa",      label: "Mapa mental",        desc: "Insere estrutura hierárquica em texto (edite os ramos)." },
  { cmd: "/checklist", label: "Checklist",          desc: "Lista com caixinhas [ ] clicáveis no preview." },
  { cmd: "/hook",      label: "Bloco HOOK",         desc: "Template de roteiro 0–3s (fala, imagem, texto em tela)." },
  { cmd: "/desenv",    label: "Bloco DESENV.",      desc: "Template de desenvolvimento (fala, b-roll, sfx)." },
  { cmd: "/cta",       label: "Bloco CTA",          desc: "Template de chamada final." },
  { cmd: "/brief",     label: "Template Briefing",  desc: "Objetivo, público, canal, duração, tom, referências." },
  { cmd: "/cliente",   label: "Cliente atual",      desc: "Insere o nome do cliente ativo." },
  { cmd: "/pasta",     label: "Pasta atual",        desc: "Insere o caminho da pasta ativa." },
];

const MENTION_HELP: Array<{ cmd: string; label: string; desc: string }> = [
  { cmd: "@arquivo",  label: "Arquivo",  desc: "Digite @ + nome: busca fuzzy nos arquivos da pasta e insere link clicável (wsfile)." },
  { cmd: "@kanban",   label: "Kanban",   desc: "Bloco vivo do Kanban do projeto renderizado dentro da nota." },
  { cmd: "@video",    label: "Vídeo",    desc: "Player embutido: @video[nome](url_embed). Colar link gera automaticamente." },
  { cmd: "@help",     label: "Ajuda",    desc: "Renderiza este painel de ajuda inline no ponto onde estiver escrito." },
];


const MINDMAP_TEMPLATE = `\n## Mapa Mental\n- Ideia central\n  - Ramo 1\n    - Detalhe\n    - Detalhe\n  - Ramo 2\n    - Detalhe\n  - Ramo 3\n`;

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



// Parser inline: "Editar hook !alta @maria 15/07" para { title, priority, assigneeName, dueISO }
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
  const [dock, setDock] = useState<"br" | "bl" | "bc" | "full">(() => {
    const v = localStorage.getItem("studio_dock_v3") as any;
    // migração: laterais antigas viram centralizado
    if (!v || v === "br" || v === "bl") return "bc";
    return v;
  });
  const [mode, setMode] = useState<Mode>("context");
  const isMobile = useIsMobile();
  const [mobileNotesTab, setMobileNotesTab] = useState<"editor" | "preview">("editor");
  // Mobile: só reseta o estado UMA vez (primeira detecção). Reset a cada mudança
  // deixava o Studio fechando sozinho quando o evento "studio:open" chegava durante o mount.
  const mobileResetRef = useRef(false);
  useEffect(() => {
    if (!isMobile || mobileResetRef.current) return;
    mobileResetRef.current = true;
    // Se houver um open pendente (disparado antes do mount), respeita-o.
    const pending = (window as any).__studioOpenPending === true;
    if (!pending) {
      setOpen(false);
      setMinimized(false);
      try { localStorage.setItem("studio_open", "0"); localStorage.setItem("studio_min", "0"); } catch {}
    } else {
      (window as any).__studioOpenPending = false;
      setOpen(true);
      setMinimized(false);
    }
  }, [isMobile]);
  useEffect(() => { try { localStorage.setItem("studio_dock_v3", dock); } catch {} }, [dock]);
  useEffect(() => { try { if (!isMobile) localStorage.setItem("studio_min", minimized ? "1" : "0"); } catch {} }, [minimized, isMobile]);
  // Escape sai da tela cheia. Precisa ficar ANTES de qualquer early return para respeitar as regras de hooks.
  useEffect(() => {
    if (dock !== "full") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDock("bc"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dock]);

  // Global open trigger. Se o listener ainda não montou quando o evento chega
  // (ex.: navegação para /workspace + dispatch imediato), guardamos flag pendente
  // que o mount consome.
  useEffect(() => {
    const openStudio = () => { (window as any).__studioOpenPending = false; setOpen(true); setMinimized(false); };
    window.addEventListener("studio:open", openStudio);
    // Consome flag pendente caso já tenha sido setada antes do listener registrar.
    if ((window as any).__studioOpenPending === true) {
      (window as any).__studioOpenPending = false;
      setOpen(true); setMinimized(false);
    }
    return () => window.removeEventListener("studio:open", openStudio);
  }, []);


  const [state, setState] = useState<StudioState>(() => loadState(contextKey));

  const notesRef = useRef<HTMLTextAreaElement>(null);
  const scriptRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<{ where: "notes" | "script"; q: string; start: number } | null>(null);
  const [slashMenu, setSlashMenu] = useState<{ where: "notes" | "script"; q: string; start: number } | null>(null);
  const [taskDraft, setTaskDraft] = useState<{ raw: string; where: "notes"|"script"; insertAt: number; tokenLen: number } | null>(null);

  // reload state when context changes
  useEffect(() => { setState(loadState(contextKey)); }, [contextKey]);
  useEffect(() => { saveState(contextKey, state); }, [contextKey, state]);
  useEffect(() => { if (!isMobile) localStorage.setItem("studio_open", open ? "1" : "0"); }, [open, isMobile]);
  useEffect(() => { if (!isMobile) localStorage.setItem("studio_min", minimized ? "1" : "0"); }, [minimized, isMobile]);
  useEffect(() => { localStorage.setItem("studio_dock_v2", dock); }, [dock]);

  // Sinaliza ao HelpButton (e outros overlays) que o Studio está aberto em tela cheia mobile,
  // para que sumam da tela e não sobreponham o input/enviar.
  useEffect(() => {
    const active = open && !minimized;
    if (active) document.body.dataset.studioOpen = "1";
    else delete document.body.dataset.studioOpen;
    return () => { delete document.body.dataset.studioOpen; };
  }, [open, minimized]);

  // ── Fordista: linkagem com projeto + publicação + PDF ──
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectId, setProjectId] = useState<string | null>(() => {
    try { return localStorage.getItem(`studio_project_v1:${contextKey}`) || null; } catch { return null; }
  });
  const [docPublished, setDocPublished] = useState(false);
  const [docSyncing, setDocSyncing] = useState<"idle"|"saving"|"saved"|"error">("idle");
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [enrichData, setEnrichData] = useState<{ checklist: string[]; next_actions: string[]; suggestion: string } | null>(null);

  useEffect(() => { setProjectId(localStorage.getItem(`studio_project_v1:${contextKey}`) || null); }, [contextKey]);
  useEffect(() => {
    try {
      if (projectId) localStorage.setItem(`studio_project_v1:${contextKey}`, projectId);
      else localStorage.removeItem(`studio_project_v1:${contextKey}`);
    } catch {}
  }, [projectId, contextKey]);

  // Lista de projetos do cliente atual (ou todos se global)
  useEffect(() => {
    let cancel = false;
    (async () => {
      let q = supabase.from("projects").select("id, name").order("created_at", { ascending: false }).limit(50);
      if (clientId) q = q.eq("client_id", clientId);
      const { data } = await q;
      if (!cancel) setProjects((data as any) || []);
    })();
    return () => { cancel = true; };
  }, [clientId]);

  // ── Sincronização bidirecional em tempo real ──
  // Refs internas para evitar loops entre save e realtime e preservar edições locais
  // quando um enrich/publish/edição remota chega no meio do fluxo.
  const uidRef = useRef<string | null>(null);
  const lastSavedNotesRef = useRef<string>("");     // último conteúdo confirmado no servidor
  const lastRemoteAtRef = useRef<string>("");        // updated_at do último snapshot remoto aplicado
  const isTypingRef = useRef<boolean>(false);        // true enquanto usuário digita (limpo após debounce)
  const notesContentRef = useRef<string>(state.notes);
  useEffect(() => { notesContentRef.current = state.notes; }, [state.notes]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      uidRef.current = data?.user?.id || null;
    })();
  }, []);

  // Carga inicial + assinatura realtime por projeto
  useEffect(() => {
    if (!projectId) {
      setDocPublished(false);
      lastSavedNotesRef.current = "";
      lastRemoteAtRef.current = "";
      return;
    }
    let cancel = false;
    (async () => {
      const { data } = await supabase.from("studio_docs")
        .select("notes, published, updated_at, updated_by")
        .eq("project_id", projectId).maybeSingle();
      if (cancel || !data) return;
      const remoteNotes = ((data as any).notes || "") as string;
      setDocPublished(!!(data as any).published);
      lastSavedNotesRef.current = remoteNotes;
      lastRemoteAtRef.current = (data as any).updated_at || "";
      // Hidrata local quando ele estiver vazio ou o remoto for mais recente e local ainda não foi tocado
      if (remoteNotes && (!notesContentRef.current.trim() || notesContentRef.current === "")) {
        setState(s => ({ ...s, notes: remoteNotes }));
      }
    })();

    const ch = supabase
      .channel(`studio_docs:${projectId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "studio_docs", filter: `project_id=eq.${projectId}` },
        (payload) => {
          const row = (payload.new as any) || (payload.old as any);
          if (!row) return;
          // Ignora eco do próprio usuário (evita loop)
          if (row.updated_by && row.updated_by === uidRef.current) {
            lastSavedNotesRef.current = row.notes || "";
            lastRemoteAtRef.current = row.updated_at || lastRemoteAtRef.current;
            setDocPublished(!!row.published);
            return;
          }
          // Só aplica se snapshot é mais novo que o já visto
          if (row.updated_at && row.updated_at <= lastRemoteAtRef.current) return;
          lastRemoteAtRef.current = row.updated_at || lastRemoteAtRef.current;
          setDocPublished(!!row.published);
          const remoteNotes = (row.notes || "") as string;
          // Preserva edições locais não salvas: só sobrescreve se local == último salvo
          if (remoteNotes && remoteNotes !== notesContentRef.current && !isTypingRef.current
              && notesContentRef.current === lastSavedNotesRef.current) {
            lastSavedNotesRef.current = remoteNotes;
            setState(s => ({ ...s, notes: remoteNotes }));
          } else if (remoteNotes && remoteNotes !== notesContentRef.current && notesContentRef.current !== lastSavedNotesRef.current) {
            // Conflito: mantém edição local, avisa
            toast({ title: "Edição remota detectada", description: "Sua versão local foi preservada. Recarregue para ver a remota." });
          }
        })
      .subscribe();
    return () => { cancel = true; supabase.removeChannel(ch); };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced upsert das notas -> studio_docs (só quando houve mudança real)
  useEffect(() => {
    if (!projectId) return;
    if (state.notes === lastSavedNotesRef.current) { setDocSyncing("idle"); return; }
    isTypingRef.current = true;
    setDocSyncing("saving");
    const t = setTimeout(async () => {
      const notesToSave = state.notes;
      const { data, error } = await supabase.from("studio_docs").upsert({
        project_id: projectId,
        notes: notesToSave,
        published: docPublished,
        updated_by: uidRef.current,
        updated_at: new Date().toISOString(),
      } as any, { onConflict: "project_id" }).select("updated_at").maybeSingle();
      if (!error) {
        lastSavedNotesRef.current = notesToSave;
        if (data?.updated_at) lastRemoteAtRef.current = data.updated_at as string;
      }
      isTypingRef.current = false;
      setDocSyncing(error ? "error" : "saved");
      if (!error) setTimeout(() => setDocSyncing("idle"), 1200);
    }, 1200);
    return () => clearTimeout(t);
  }, [state.notes, projectId, docPublished]);

  // Auto-enrich (debounce 2.5s após parar de digitar; só se tiver >120 chars)
  useEffect(() => {
    if (!state.notes || state.notes.trim().length < 120) { setEnrichData(null); return; }
    const t = setTimeout(async () => {
      setEnrichBusy(true);
      try {
        const { data: sess } = await supabase.auth.getSession();
        const tok = sess?.session?.access_token;
        if (!tok) return;
        const url = `https://gicbrgagstyvbaaumprj.supabase.co/functions/v1/workspace-agent`;
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
          body: JSON.stringify({ mode: "enrich", text: state.notes.slice(-4000), context: { client_name: clientName, folder_path: folderPath } }),
        });
        if (r.ok) {
          const j = await r.json();
          setEnrichData(j?.data || null);
        }
      } finally { setEnrichBusy(false); }
    }, 2500);
    return () => clearTimeout(t);
  }, [state.notes, clientName, folderPath]);

  // ── Auto-correção (REFLOW) em tempo real ──
  // Reorganiza headline/subheadline, completa checklist e ajusta racional/ações
  // sem sobrescrever o que o usuário está digitando. Só aplica quando o textarea
  // está sem foco (usuário terminou o bloco) e o resultado diverge do já aplicado.
  const [autoFix, setAutoFix] = useState<boolean>(() => {
    try { return localStorage.getItem("studio_autofix") !== "0"; } catch { return true; }
  });
  const [reflowBusy, setReflowBusy] = useState(false);
  const [reflowAt, setReflowAt] = useState<string>("");
  const lastReflowInputRef = useRef<string>("");
  const lastReflowOutputRef = useRef<string>("");
  useEffect(() => { try { localStorage.setItem("studio_autofix", autoFix ? "1" : "0"); } catch {} }, [autoFix]);

  useEffect(() => {
    if (!autoFix) return;
    const txt = state.notes || "";
    if (txt.trim().length < 80) return;
    if (txt === lastReflowInputRef.current) return;
    const t = setTimeout(async () => {
      // Não aplica se o usuário ainda está com foco no textarea
      const focused = typeof document !== "undefined" && document.activeElement === notesRef.current;
      if (focused) return;
      setReflowBusy(true);
      try {
        const { data: sess } = await supabase.auth.getSession();
        const tok = sess?.session?.access_token;
        if (!tok) return;
        const url = `https://gicbrgagstyvbaaumprj.supabase.co/functions/v1/workspace-agent`;
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
          body: JSON.stringify({ mode: "reflow", text: txt.slice(0, 8000), context: { client_name: clientName, folder_path: folderPath } }),
        });
        if (!r.ok) return;
        const j = await r.json();
        const md = String(j?.markdown || "").trim();
        if (!md || md === lastReflowOutputRef.current) return;
        // Se o textarea ganhou foco enquanto rodava, aborta pra não quebrar a digitação
        if (document.activeElement === notesRef.current) return;
        // Só aplica se o texto ainda for o mesmo que enviamos (nada mudou no meio)
        if (notesContentRef.current !== txt) return;
        lastReflowInputRef.current = md;
        lastReflowOutputRef.current = md;
        setState(s => ({ ...s, notes: md }));
        setReflowAt(new Date().toISOString());
      } finally { setReflowBusy(false); }
    }, 3500);
    return () => clearTimeout(t);
  }, [state.notes, autoFix, clientName, folderPath]);


  async function togglePublish() {
    if (!projectId) { toast({ title: "Vincule um projeto primeiro", description: "Selecione o projeto no topo do Studio para publicar.", variant: "destructive" }); return; }
    const next = !docPublished;
    setDocPublished(next);
    // Persistência imediata: garante que o cliente veja na hora
    const notesNow = notesContentRef.current;
    const { data, error } = await supabase.from("studio_docs").upsert({
      project_id: projectId,
      notes: notesNow,
      published: next,
      updated_by: uidRef.current,
      updated_at: new Date().toISOString(),
    } as any, { onConflict: "project_id" }).select("updated_at").maybeSingle();
    if (error) {
      setDocPublished(!next);
      toast({ title: "Falha ao publicar", description: error.message, variant: "destructive" });
      return;
    }
    lastSavedNotesRef.current = notesNow;
    if (data?.updated_at) lastRemoteAtRef.current = data.updated_at as string;
    toast({ title: next ? "Documento publicado" : "Publicação removida", description: next ? "O cliente já vê a versão ao vivo na aba Documento." : "O cliente não vê mais este documento." });
  }

  function downloadPDF() {
    const html = renderBrandedDoc(state.notes || "(vazio)", clientName || "AcelerIQ", projects.find(p => p.id === projectId)?.name || contextLabel);
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) { toast({ title: "Bloqueado", description: "Habilite pop-ups pra imprimir o PDF." }); return; }
    w.document.open(); w.document.write(html); w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 500);
  }

  function acceptEnrichChecklist() {
    if (!enrichData?.checklist?.length) return;
    const block = "\n\n## Checklist sugerido\n" + enrichData.checklist.map(i => `- [ ] ${i}`).join("\n") + "\n";
    setState(s => ({ ...s, notes: (s.notes || "") + block }));
    setEnrichData(null);
  }
  function acceptEnrichActions() {
    if (!enrichData?.next_actions?.length) return;
    const block = "\n\n## Próximas ações\n" + enrichData.next_actions.map((i, idx) => `${idx + 1}. ${i}`).join("\n") + "\n";
    setState(s => ({ ...s, notes: (s.notes || "") + block }));
    setEnrichData(null);
  }



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
      insertAtCaret(`\n> **Imagem, texto extraído:**\n${text.split("\n").map(l => `> ${l}`).join("\n")}\n`);
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

    if (cmd.action === "openKanban") {
      // Insere um bloco vivo de kanban embutido nas notas (renderizado inline pelo preview)
      const block = `\n@kanban\n`;
      if (where === "notes") setState(s => ({ ...s, notes: before + block + after }));
      else setState(s => ({ ...s, script: before + block + after }));
      setSlashMenu(null);
      return;
    }
    if (cmd.action === "insertHelp") {
      const block = `\n@help\n`;
      if (where === "notes") setState(s => ({ ...s, notes: before + block + after }));
      else setState(s => ({ ...s, script: before + block + after }));
      setSlashMenu(null);
      return;
    }

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
      ...state.mentions.map(m => `- ${m.name}${m.url ? `: ${m.url}` : ""}`),
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
        className="hidden md:flex fixed bottom-4 left-1/2 -translate-x-1/2 z-40 h-11 px-4 rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90 items-center gap-2 text-sm font-medium"
        title="Abrir Studio (notas, mapa mental, roteiro)"
      >
        <Sparkles className="w-4 h-4" /> Studio
      </button>
    );
  }

  const isFull = dock === "full" || (isMobile && !minimized);

  const dockPos = isFull
    ? (isMobile
        ? "left-2 right-2"
        : "top-[64px] left-0 right-0 bottom-0 sm:top-[72px]")
    : dock === "br" ? "left-2 right-2 bottom-[calc(env(safe-area-inset-bottom)+72px)] sm:left-auto sm:right-4 sm:bottom-4"
    : dock === "bl" ? "left-2 right-2 bottom-[calc(env(safe-area-inset-bottom)+72px)] sm:right-auto sm:left-4 sm:bottom-4"
    :                 "left-2 right-2 bottom-[calc(env(safe-area-inset-bottom)+72px)] sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:bottom-4";
  const dockSize = isFull
    ? ""
    : minimized
      ? "h-[52px] sm:w-[280px]"
      : dock === "bc"
        ? "h-[min(72dvh,620px)] max-h-[calc(100dvh-80px)] sm:w-[min(96vw,880px)] sm:h-[min(72vh,620px)] sm:max-h-none"
        : "h-[min(78dvh,680px)] max-h-[calc(100dvh-80px)] sm:w-[min(96vw,480px)] sm:h-[min(78vh,680px)] sm:max-h-none";


  return (
    <div
      className={cn(
        "fixed bg-card border-border shadow-2xl flex flex-col overflow-hidden transition-all",
        isMobile && isFull ? "z-[120]" : "z-40",
        isFull ? "rounded-none border-t" : "rounded-2xl border",
        dockPos, dockSize
      )}
      style={
        isMobile && isFull
          ? {
              top: "calc(env(safe-area-inset-top) + 80px)",
              bottom: "calc(env(safe-area-inset-bottom) + 72px)",
            }
          : undefined
      }
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 h-[52px] border-b border-border shrink-0 bg-gradient-to-b from-secondary/60 to-secondary/20 backdrop-blur">
        {isMobile && !minimized ? (
          <button
            onClick={() => setOpen(false)}
            title="Voltar"
            className="flex items-center justify-center h-9 w-9 -ml-1 rounded-md hover:bg-secondary text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        ) : (
          <div className="w-6 h-6 rounded-lg bg-primary/15 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight truncate">Studio</p>
          {!minimized && <p className="text-[10px] text-muted-foreground truncate">{contextLabel}</p>}
        </div>
        {!minimized && !isMobile && (
          <div className="flex items-center gap-0.5 mr-1 border border-border rounded-md p-0.5 bg-background/60">
            <button onClick={() => setDock("bl")} title="Dock esquerda"
              className={cn("hidden sm:block px-1.5 py-0.5 rounded text-[10px]", dock === "bl" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}>◧</button>
            <button onClick={() => setDock("bc")} title="Centralizar embaixo"
              className={cn("hidden sm:block px-1.5 py-0.5 rounded text-[10px]", dock === "bc" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}>▬</button>
            <button onClick={() => setDock("br")} title="Dock direita"
              className={cn("hidden sm:block px-1.5 py-0.5 rounded text-[10px]", dock === "br" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}>◨</button>

            <button onClick={() => setDock(isFull ? "bc" : "full")} title={isFull ? "Sair da tela cheia (Esc)" : "Tela cheia"}
              className={cn("px-1.5 py-0.5 rounded flex items-center", isFull ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}>
              {isFull ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            </button>
          </div>
        )}
        {isFull && !minimized && !isMobile && (
          <button onClick={() => setDock("bc")} title="Sair da tela cheia (Esc)"
            className="flex items-center gap-1 px-2 py-1 mr-1 rounded-md bg-primary/10 hover:bg-primary/20 text-primary text-[10px] font-medium border border-primary/30">
            <Minimize2 className="w-3 h-3" /> Sair
          </button>
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
          <div className="flex items-center justify-center gap-2 px-3 pt-2 border-b border-border shrink-0 bg-background/40">
            {[
              { k: "context", icon: Brain,       label: "Contexto" },
              { k: "notes",   icon: NotebookPen, label: "Notas" },
              { k: "gpt",     icon: ExternalLink, label: "GPT" },
            ].map(t => {
              const active = mode === t.k;
              const Icon = t.icon;
              return (
                <button key={t.k} onClick={() => setMode(t.k as Mode)}
                  className={cn("flex items-center gap-2 px-5 py-2 rounded-t-lg text-[12.5px] font-medium border-b-2 -mb-px transition-colors",
                    active ? "border-primary text-foreground bg-secondary/30" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/20")}>
                  <Icon className="w-4 h-4" /> {t.label}
                </button>
              );
            })}
          </div>

          {/* Fordista bar: Projeto · Publicar · PDF */}
          <div className="flex flex-wrap items-center justify-center gap-2 px-4 py-2 border-b border-border bg-muted/25 shrink-0 text-[12px]">

            <span className="text-muted-foreground shrink-0">Projeto</span>
            <select
              value={projectId ?? ""}
              onChange={e => setProjectId(e.target.value || null)}
              className="bg-background border border-border rounded-md px-2 py-1 text-[12px] w-[min(360px,52vw)]"
              title="Vincule um projeto para publicar/espelhar ao cliente"
            >
              <option value="">sem projeto</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {projectId && (
              <span className={cn("text-[10px] flex items-center gap-1 shrink-0",
                docSyncing === "saving" && "text-amber-500",
                docSyncing === "saved" && "text-primary",
                docSyncing === "error" && "text-destructive",
                docSyncing === "idle" && "text-muted-foreground")}>
                {docSyncing === "saving" && <Loader2 className="w-3 h-3 animate-spin" />}
                {docSyncing === "saved" && <Check className="w-3 h-3" />}
                {docSyncing === "error" && <X className="w-3 h-3" />}
                {docSyncing === "saving" ? "salvando" : docSyncing === "saved" ? "sincronizado" : docSyncing === "error" ? "erro" : "auto-sync"}
              </span>
            )}
            <button
              onClick={() => setAutoFix(v => !v)}
              title="Auto-correção: reorganiza headline, checklist e ações quando você pausa"
              className={cn("px-2 py-[3px] rounded flex items-center gap-1 text-[10px] font-medium border shrink-0",
                autoFix ? "border-primary/60 text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground")}
            >
              {reflowBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
              Auto-fix {autoFix ? "on" : "off"}
            </button>
              <div className="flex items-center gap-1 shrink-0 sm:ml-2">
              <button onClick={togglePublish}
                className={cn("px-2 py-1 rounded flex items-center gap-1 text-[10px] font-medium border",
                  docPublished ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground")}
                title={docPublished ? "Publicado: cliente vê ao vivo" : "Publicar para o cliente"}>
                <Radio className="w-3 h-3" />{docPublished ? "Ao vivo" : "Publicar"}
              </button>
              <button onClick={downloadPDF}
                className="px-2 py-1 rounded flex items-center gap-1 text-[10px] font-medium border border-border text-muted-foreground hover:text-foreground"
                title="Exportar PDF com marca AcelerIQ">
                <Download className="w-3 h-3" /> PDF
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">

            {mode === "context" && (
              <div className="grid h-full min-h-0 gap-3 p-3 lg:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)]">
                <section className="min-h-0 overflow-hidden rounded-xl border border-border bg-background/65">
                  <AgentChat
                    clientId={clientId ?? null}
                    clientName={clientName ?? null}
                    projectId={projectId}
                    folderId={folderId ?? null}
                    folderPath={folderPath ?? contextLabel}
                    availableFiles={availableFiles}
                    notes={state.notes}
                    script={state.script}
                    boardLog={state.boardLog}
                    label="Contexto"
                    showExternalTools={false}
                    onAttachToNotes={(picks) => {
                      if (!picks?.length) return;
                      setState(s => {
                        const cur = s.notes || "";
                        const heading = "## Links e anexos";
                        const newLines = picks
                          .map(p => `- [${p.name}](wsfile:${p.id})`)
                          .filter(line => !cur.includes(line));
                        if (!newLines.length) return s;
                        let next: string;
                        if (cur.includes(heading)) {
                          const idx = cur.indexOf(heading);
                          const after = cur.indexOf("\n## ", idx + heading.length);
                          const insertAt = after === -1 ? cur.length : after;
                          const block = cur.slice(idx, insertAt).replace(/\s+$/, "") + "\n" + newLines.join("\n") + "\n";
                          next = cur.slice(0, idx) + block + cur.slice(insertAt);
                        } else {
                          const sep = cur ? (cur.endsWith("\n") ? "\n" : "\n\n") : "";
                          next = cur + sep + heading + "\n" + newLines.join("\n") + "\n";
                        }
                        return { ...s, notes: next };
                      });
                      toast({ title: "Anexos adicionados", description: `${picks.length} item(ns) enviado(s) para contexto e Notas.` });
                    }}
                    onStructureToNotes={async (sourceText) => {
                      const raw = (sourceText || state.notes || `Cliente: ${clientName || "-"} · Pasta: /${folderPath || "-"}`).trim();
                      try {
                        const { data: sess } = await supabase.auth.getSession();
                        const tok = sess?.session?.access_token; if (!tok) return;
                        toast({ title: "Estruturando", description: "O agente está montando o documento executivo." });
                        const r = await fetch(`https://gicbrgagstyvbaaumprj.supabase.co/functions/v1/workspace-agent`, {
                          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
                          body: JSON.stringify({ mode: "structure", text: raw, context: { client_name: clientName, folder_path: folderPath } }),
                        });
                        if (!r.ok) throw new Error(String(r.status));
                        const j = await r.json();
                        const md = j?.markdown || "";
                        if (md) { setState(s => ({ ...s, notes: md })); toast({ title: "Notas atualizadas", description: "Documento pronto para complementar." }); }
                      } catch (e: any) { toast({ title: "Falha ao estruturar", description: e?.message || "erro", variant: "destructive" }); }
                    }}
                  />
                </section>

                <aside className="min-h-0 hidden lg:flex flex-col overflow-hidden rounded-xl border border-border bg-card/45">
                  <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                    <NotebookPen className="h-4 w-4 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-foreground">Notas do projeto</p>
                      <p className="truncate text-[11px] text-muted-foreground">O agente usa este conteúdo como memória de trabalho.</p>
                    </div>
                    <button onClick={() => setMode("notes")} className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground">
                      Abrir editor
                    </button>
                  </div>
                  <div className="relative min-h-0 flex-1 p-3">
                    <textarea
                      ref={notesRef}
                      value={state.notes}
                      onChange={e => handleTextChange("notes", e.target.value, e.target.selectionStart)}
                      onKeyUp={e => handleTextChange("notes", (e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart)}
                      onClick={e => handleTextChange("notes", (e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart)}
                      onPaste={onNotesPaste}
                      placeholder="Anote decisões, respostas e próximos passos. Use / para estruturar e @ para anexar arquivos."
                      className="h-full min-h-[280px] w-full resize-none rounded-lg border border-border bg-background/75 p-5 font-sans text-[14px] leading-[1.85] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
                    />
                    {mentionQuery?.where === "notes" && mentionMatches.length > 0 && <MentionList items={mentionMatches} onPick={insertMention} />}
                    {slashMenu?.where === "notes" && (
                      <SlashList
                        items={buildSlashCommands({ clientName, folderPath, contextLabel }).filter(c => c.label.toLowerCase().includes(slashMenu.q.toLowerCase()) || c.key.includes(slashMenu.q.toLowerCase()))}
                        onPick={insertSlash}
                      />
                    )}
                  </div>
                </aside>
              </div>
            )}
            {mode === "notes" && (
              <div className="h-full min-h-0 overflow-hidden p-3 sm:p-4 flex flex-col gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <input ref={imageInputRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void handleImageFile(f); e.target.value = ""; }} />

                {isMobile && (
                  <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-background/60 p-1 text-[12px]">
                    <button
                      onClick={() => setMobileNotesTab("editor")}
                      className={cn("py-1.5 rounded-md font-medium transition-colors", mobileNotesTab === "editor" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                    >Notas</button>
                    <button
                      onClick={() => setMobileNotesTab("preview")}
                      className={cn("py-1.5 rounded-md font-medium transition-colors", mobileNotesTab === "preview" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                    >Preview</button>
                  </div>
                )}

                <div className={cn(
                  "grid flex-1 min-h-0 gap-3",
                  isMobile ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2"
                )}>
                  <section className={cn(
                    "min-h-0 flex flex-col overflow-hidden rounded-xl border border-border bg-background/70",
                    isMobile && mobileNotesTab !== "editor" && "hidden"
                  )}>
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[10px] text-muted-foreground shrink-0">
                      <NotebookPen className="h-3.5 w-3.5 text-primary" />
                      <span className="font-medium text-foreground/80">Notas de trabalho</span>
                      <span className="hidden sm:inline">/ comandos · @ arquivos · imagem ou link de vídeo</span>
                      {ocrBusy && <span className="ml-auto text-primary flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> OCR</span>}
                      <button
                        onClick={() => setState(s => ({ ...s, notes: (s.notes ? s.notes.replace(/\n?@help\n?/g, "") : "") + "\n@help\n" }))}
                        className="ml-auto text-[10px] px-2 py-1 rounded-md border border-border hover:bg-secondary text-muted-foreground hover:text-foreground"
                        title="Mostrar guia de comandos inline"
                      >Ajuda</button>
                    </div>
                    <div className="relative flex-1 min-h-0 p-3">
                      <textarea
                        ref={notesRef}
                        value={state.notes}
                        onChange={e => handleTextChange("notes", e.target.value, e.target.selectionStart)}
                        onKeyUp={e => handleTextChange("notes", (e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart)}
                        onClick={e => handleTextChange("notes", (e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart)}
                        onPaste={onNotesPaste}
                        placeholder="Escreva ou cole o material aqui. Use / para estruturar e @ para anexar arquivos."
                        className="h-full w-full resize-none overflow-y-auto rounded-lg border border-border bg-card/70 p-4 sm:p-5 font-sans text-[14px] leading-[1.7] sm:leading-[1.8] text-foreground placeholder:text-muted-foreground/60 transition-colors focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10 sm:min-h-[360px]"
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
                  </section>

                  <aside className={cn(
                    "min-h-0 flex flex-col overflow-hidden rounded-xl border border-border bg-card/50",
                    isMobile && mobileNotesTab !== "preview" && "hidden"
                  )}>
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2 shrink-0">
                      <FileText className="h-3.5 w-3.5 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium text-foreground/85">Documento estruturado</p>
                        <p className="truncate text-[10px] text-muted-foreground">Preview, chips e publicação no mesmo fluxo.</p>
                      </div>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto p-4">
                      {state.notes.trim().length > 0 ? (
                        <NotesPreview
                          src={state.notes}
                          clientId={clientId ?? null}
                          clientName={clientName ?? null}
                          onChange={(next) => setState(s => ({ ...s, notes: next }))}
                        />
                      ) : (
                        <div className="flex h-full min-h-[220px] items-center justify-center rounded-lg border border-dashed border-border text-center text-[12px] leading-relaxed text-muted-foreground">
                          O preview aparece aqui conforme você escreve.
                        </div>
                      )}
                    </div>

                    {!!state.mentions.length && (
                      <div className="flex flex-wrap gap-1 border-t border-border px-3 py-2">
                        {state.mentions.map(m => (
                          <button key={m.id} onClick={() => onOpenFile?.(m.id)}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-1">
                            <Link2 className="w-2.5 h-2.5" /> {m.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {(enrichBusy || enrichData) && (
                      <div className="border-t border-border bg-background/60 p-3 space-y-2">
                        <div className="text-[10px] uppercase tracking-wider text-primary flex items-center gap-1">
                          <Zap className="w-3 h-3" /> Enriquecimento{enrichBusy && " em andamento"}
                        </div>
                        {enrichData?.suggestion && <div className="text-[11px] leading-relaxed text-foreground/80">{enrichData.suggestion}</div>}
                        <div className="flex flex-wrap gap-1">
                          {enrichData?.checklist?.length ? (
                            <button onClick={acceptEnrichChecklist} className="text-[10px] px-2 py-1 rounded-md bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30">
                              Adicionar checklist ({enrichData.checklist.length})
                            </button>
                          ) : null}
                          {enrichData?.next_actions?.length ? (
                            <button onClick={acceptEnrichActions} className="text-[10px] px-2 py-1 rounded-md bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30">
                              Adicionar ações ({enrichData.next_actions.length})
                            </button>
                          ) : null}
                          {enrichData && !enrichData.checklist?.length && !enrichData.next_actions?.length && (
                            <span className="text-[10px] text-muted-foreground">sem sugestões novas</span>
                          )}
                        </div>
                      </div>
                    )}
                  </aside>
                </div>
              </div>
            )}

            {mode === "gpt" && (
              <GptPanel
                clientName={clientName ?? null}
                folderPath={folderPath ?? contextLabel}
                availableFiles={availableFiles}
                notes={state.notes}
                script={state.script}
                onAppendToNotes={(text) => {
                  setState(s => ({ ...s, notes: `${s.notes || ""}${s.notes?.trim() ? "\n\n" : ""}${text.trim()}\n` }));
                  setMode("notes");
                }}
              />
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
      {/* KanbanInlineDialog removido: agora o /kanban insere @kanban no texto e vira bloco vivo no preview */}
    </div>
  );
}

// ── PDF branded AcelerIQ (via window.print) ──
function renderBrandedDoc(md: string, clientName: string, projectName: string) {
  const html = mdToHtml(md);
  const date = new Date().toLocaleDateString("pt-BR");
  const time = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/>
<title>${escapeHtml(projectName)} · AcelerIQ</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 20mm 16mm 22mm 16mm; }
  @page :first { margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; color: #0D0D0D; font-family: 'Outfit', -apple-system, sans-serif; font-size: 12.5px; line-height: 1.6; }

  .cover-page {
    height: 297mm; width: 210mm; padding: 28mm 22mm; background: #0D0D0D; color: #fff;
    display: flex; flex-direction: column; justify-content: space-between;
    page-break-after: always; break-after: page;
  }
  .cover-page .brand { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px; letter-spacing: -0.02em; }
  .cover-page .brand .dot { color: #00FF66; }
  .cover-page .rule { height: 3px; width: 64px; background: #00FF66; margin: 24px 0 18px; }
  .cover-page h1 { font-size: 42px; line-height: 1.05; letter-spacing: -0.03em; margin: 0 0 12px; font-weight: 600; }
  .cover-page .kicker { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #00FF66; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 8px; }
  .cover-page .subtitle { font-size: 14px; color: #a3a3a3; max-width: 480px; }
  .cover-page .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 32px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #a3a3a3; border-top: 1px solid #262626; padding-top: 18px; }
  .cover-page .meta strong { display: block; color: #fff; font-weight: 500; font-size: 12.5px; margin-top: 3px; font-family: 'Outfit', sans-serif; }

  .doc-header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0D0D0D; padding-bottom: 10px; margin-bottom: 20px; }
  .doc-header .brand { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 14px; }
  .doc-header .brand .dot { color: #00FF66; }
  .doc-header .crumbs { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #737373; text-transform: uppercase; letter-spacing: 0.1em; text-align: right; }

  .content { max-width: 178mm; margin: 0 auto; }

  h1 { font-size: 26px; letter-spacing: -0.02em; margin: 8px 0 12px; font-weight: 600; page-break-after: avoid; break-after: avoid-page; page-break-inside: avoid; break-inside: avoid; }
  h2 {
    font-size: 17px; margin: 28px 0 10px; font-weight: 600; letter-spacing: -0.01em;
    padding: 6px 0 6px 12px; border-left: 3px solid #00FF66;
    page-break-after: avoid; break-after: avoid-page; page-break-inside: avoid; break-inside: avoid;
  }
  h3 { font-size: 13.5px; margin: 18px 0 6px; font-weight: 600; color: #171717; page-break-after: avoid; break-after: avoid-page; page-break-inside: avoid; break-inside: avoid; }
  /* truque: puxa o primeiro bloco após o heading para não ficar heading sozinho no fim da página */
  h2 + *, h3 + * { page-break-before: avoid; break-before: avoid; }
  p { margin: 6px 0; orphans: 3; widows: 3; word-wrap: break-word; overflow-wrap: anywhere; }
  strong { font-weight: 600; }
  em { color: #404040; }

  /* Sessão longa: pode quebrar; apenas pequenas caixas (.keep) resistem à quebra */
  .section { margin-bottom: 6px; }
  .keep { page-break-inside: avoid; break-inside: avoid; }

  ul, ol { padding-left: 20px; margin: 6px 0; }
  li { margin: 3px 0; page-break-inside: avoid; break-inside: avoid; }
  li > p { margin: 0; }

  ul.check { list-style: none; padding-left: 0; border: 1px solid #e5e5e5; border-radius: 6px; padding: 10px 14px; background: #fafafa; page-break-inside: avoid; break-inside: avoid; }
  ul.check.long { page-break-inside: auto; break-inside: auto; }
  ul.check li { padding: 3px 0; display: flex; gap: 8px; align-items: flex-start; }
  ul.check li::before {
    content: ""; display: inline-block; width: 12px; height: 12px; min-width: 12px;
    border: 1.5px solid #0D0D0D; border-radius: 2px; margin-top: 4px; background: #fff;
  }
  ul.check li.done::before { background: #00FF66; border-color: #00FF66; }
  ul.check li.done { color: #737373; text-decoration: line-through; }

  code { background: #f4f4f5; padding: 1px 5px; border-radius: 4px; font-size: 11px; font-family: 'JetBrains Mono', monospace; word-break: break-all; }
  pre { background: #0D0D0D; color: #fafafa; padding: 12px 14px; border-radius: 6px; font-size: 11px; font-family: 'JetBrains Mono', monospace; white-space: pre-wrap; word-break: break-word; page-break-inside: auto; break-inside: auto; }
  pre code { background: transparent; color: inherit; padding: 0; }
  blockquote {
    margin: 10px 0; padding: 8px 14px; border-left: 3px solid #d4d4d8;
    color: #525252; font-style: italic; background: #fafafa; page-break-inside: avoid; break-inside: avoid;
  }
  hr { border: 0; border-top: 1px dashed #d4d4d8; margin: 22px 0; }

  /* Tabelas fluidas com cabeçalho repetido em cada página */
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 11.5px; page-break-inside: auto; break-inside: auto; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  th, td { border: 1px solid #e5e5e5; padding: 6px 8px; text-align: left; vertical-align: top; word-wrap: break-word; overflow-wrap: anywhere; }
  th { background: #f4f4f5; font-weight: 600; }
  table.compact th, table.compact td { padding: 4px 6px; font-size: 10.5px; }

  @media print {
    .doc-footer { position: fixed; bottom: 8mm; left: 16mm; right: 16mm; font-size: 9.5px; color: #737373; font-family: 'JetBrains Mono', monospace; display: flex; justify-content: space-between; border-top: 1px solid #e5e5e5; padding-top: 5px; }
    body { -webkit-print-color-adjust: exact; }
    a { color: inherit; text-decoration: none; }
  }
</style></head><body>

<section class="cover-page">
  <div>
    <div class="brand">aceler<span class="dot">iq</span></div>
    <div class="rule"></div>
    <div class="kicker">Documento executivo</div>
    <h1>${escapeHtml(projectName)}</h1>
    <div class="subtitle">Registro consolidado do trabalho estratégico e criativo entregue pela AcelerIQ.</div>
  </div>
  <div class="meta">
    <div>Cliente<strong>${escapeHtml(clientName)}</strong></div>
    <div>Projeto<strong>${escapeHtml(projectName)}</strong></div>
    <div>Emissão<strong>${date} · ${time}</strong></div>
    <div>Confidencialidade<strong>Uso interno / cliente</strong></div>
  </div>
</section>

<div class="doc-header">
  <div class="brand">aceler<span class="dot">iq</span></div>
  <div class="crumbs">${escapeHtml(clientName)} · ${escapeHtml(projectName)} · ${date}</div>
</div>

<div class="content">
${html}
</div>

<div class="doc-footer"><span>aceleriq.online</span><span>Confidencial · ${date}</span></div>
</body></html>`;
}

function escapeHtml(s: string) { return s.replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]!)); }

function mdToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inList: "ul" | "ol" | "check" | null = null;
  let checkBuf: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];

  const inline = (s: string) => s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s.,;:!?)]|$)/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\[@([^\]]+)\]\(wsfile:[^)]+\)/g, '<strong>@$1</strong>');

  const flushChecklist = () => {
    if (!checkBuf.length) return;
    // Checklist grande (>8 itens) libera quebra pra evitar overflow numa página
    const cls = checkBuf.length > 8 ? "check long" : "check";
    out.push(`<ul class="${cls}">${checkBuf.join("")}</ul>`);
    checkBuf = [];
  };
  const closeList = () => {
    if (inList === "check") { flushChecklist(); inList = null; return; }
    if (inList) { out.push(`</${inList}>`); inList = null; }
  };

  // Detecta e consome tabela GFM começando em i. Retorna [html, linhasConsumidas].
  const tryTable = (i: number): [string, number] | null => {
    const head = lines[i];
    const sep = lines[i + 1];
    if (!head || !sep) return null;
    if (!/^\s*\|.+\|\s*$/.test(head)) return null;
    if (!/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(sep)) return null;
    const parseRow = (row: string) =>
      row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
    const cols = parseRow(head);
    const aligns = parseRow(sep).map(s => s.startsWith(":") && s.endsWith(":") ? "center" : s.endsWith(":") ? "right" : "left");
    const rows: string[][] = [];
    let j = i + 2;
    while (j < lines.length && /^\s*\|.+\|\s*$/.test(lines[j])) {
      rows.push(parseRow(lines[j]));
      j++;
    }
    const compact = cols.length >= 5 ? " compact" : "";
    const thead = `<thead><tr>${cols.map((c, k) => `<th style="text-align:${aligns[k] || "left"}">${inline(escapeHtml(c))}</th>`).join("")}</tr></thead>`;
    const tbody = `<tbody>${rows.map(r => `<tr>${r.map((c, k) => `<td style="text-align:${aligns[k] || "left"}">${inline(escapeHtml(c))}</td>`).join("")}</tr>`).join("")}</tbody>`;
    return [`<table class="doc-table${compact}">${thead}${tbody}</table>`, j - i];
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    // fenced code
    if (/^```/.test(raw)) {
      if (inCode) {
        out.push(`<pre><code>${codeBuf.map(c => c.replace(/</g,"&lt;")).join("\n")}</code></pre>`);
        codeBuf = []; inCode = false;
      } else {
        closeList(); inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }

    // tabelas
    const tbl = tryTable(i);
    if (tbl) { closeList(); out.push(tbl[0]); i += tbl[1] - 1; continue; }

    const l = raw;
    if (/^#\s+/.test(l)) {
      closeList();
      out.push(`<h1>${inline(escapeHtml(l.replace(/^#\s+/, "")))}</h1>`);
    } else if (/^##\s+/.test(l)) {
      closeList();
      out.push(`<h2>${inline(escapeHtml(l.replace(/^##\s+/, "")))}</h2>`);
    } else if (/^###\s+/.test(l)) {
      closeList();
      out.push(`<h3>${inline(escapeHtml(l.replace(/^###\s+/, "")))}</h3>`);
    } else if (/^\s*-\s+\[( |x|X)\]\s+/.test(l)) {
      if (inList && inList !== "check") closeList();
      inList = "check";
      const done = /\[(x|X)\]/.test(l);
      const text = l.replace(/^\s*-\s+\[( |x|X)\]\s+/, "");
      checkBuf.push(`<li class="${done ? "done" : ""}"><span>${inline(escapeHtml(text))}</span></li>`);
    } else if (/^\s*-\s+/.test(l)) {
      if (inList !== "ul") { closeList(); out.push("<ul>"); inList = "ul"; }
      out.push(`<li>${inline(escapeHtml(l.replace(/^\s*-\s+/, "")))}</li>`);
    } else if (/^\s*\d+\.\s+/.test(l)) {
      if (inList !== "ol") { closeList(); out.push("<ol>"); inList = "ol"; }
      out.push(`<li>${inline(escapeHtml(l.replace(/^\s*\d+\.\s+/, "")))}</li>`);
    } else if (/^>\s?/.test(l)) {
      closeList();
      out.push(`<blockquote>${inline(escapeHtml(l.replace(/^>\s?/, "")))}</blockquote>`);
    } else if (/^---+$/.test(l.trim())) {
      closeList();
      out.push("<hr/>");
    } else if (l.trim() === "") {
      closeList();
      out.push("");
    } else if (/^@kanban\s*$/.test(l.trim())) {
      closeList();
      out.push(`<blockquote><strong>Kanban vivo</strong> disponível na versão online do documento.</blockquote>`);
    } else if (/^@video\[([^\]]*)\]\((https?:[^)]+)\)/.test(l.trim())) {
      const m = l.trim().match(/^@video\[([^\]]*)\]\((https?:[^)]+)\)/)!;
      closeList();
      out.push(`<blockquote><strong>Vídeo:</strong> ${escapeHtml(m[1] || "assistir")} · <a href="${m[2]}">${escapeHtml(m[2])}</a></blockquote>`);
    } else {
      closeList();
      out.push(`<p>${inline(escapeHtml(l))}</p>`);
    }
  }
  closeList();
  if (inCode) out.push(`<pre><code>${codeBuf.map(c => c.replace(/</g,"&lt;")).join("\n")}</code></pre>`);
  return out.join("\n");
}

export function NotesPreview({ src, clientId, clientName, onChange }: { src: string; clientId?: string | null; clientName?: string | null; onChange?: (next: string) => void }) {
  const lines = src.split("\n");
  const toggleAt = (idx: number) => {
    if (!onChange) return;
    const copy = [...lines];
    const m = copy[idx]?.match(/^(\s*)- \[( |x|X)\] (.+)$/);
    if (!m) return;
    const checked = m[2].toLowerCase() === "x";
    copy[idx] = `${m[1]}- [${checked ? " " : "x"}] ${m[3]}`;
    onChange(copy.join("\n"));
  };
  const out: React.ReactNode[] = [];
  lines.forEach((raw, i) => {
    // bloco kanban inline (funcional, dentro do texto)
    if (raw.trim() === "@kanban") {
      out.push(<InlineKanbanBlock key={i} clientId={clientId ?? null} clientName={clientName ?? null} />);
      return;
    }
    if (raw.trim() === "@help") {
      out.push(<InlineHelpBlock key={i} />);
      return;
    }

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
    // checkbox — clicável quando onChange existe
    const cb = raw.match(/^(\s*)- \[( |x|X)\] (.+)$/);
    if (cb) {
      const checked = cb[2].toLowerCase() === "x";
      out.push(
        <button
          key={i}
          type="button"
          onClick={() => toggleAt(i)}
          className="flex items-start gap-2 text-[13px] py-1 w-full text-left bg-transparent border-0 hover:bg-secondary/40 rounded px-1 -mx-1 cursor-pointer touch-manipulation"
          style={{ paddingLeft: cb[1].length * 6 + 4 }}
        >
          <span className={cn("mt-[3px] w-4 h-4 border rounded-sm flex items-center justify-center shrink-0", checked ? "bg-primary border-primary" : "border-muted-foreground/50")}>
            {checked && <Check className="w-3 h-3 text-primary-foreground" />}
          </span>
          <span className={checked ? "line-through text-muted-foreground" : "text-foreground"}>{cb[3]}</span>
        </button>
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

// Guia inline de comandos / e @ renderizado dentro das notas quando existir "@help" numa linha.
function InlineHelpBlock() {
  const [tab, setTab] = useState<"slash" | "at">("slash");
  const items = tab === "slash" ? SLASH_HELP : MENTION_HELP;
  return (
    <div className="my-2 rounded-lg border border-primary/30 bg-primary/5 overflow-hidden">
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-primary/20 bg-primary/10">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
          <Sparkles className="w-3 h-3" /> Guia de comandos
        </div>
        <div className="flex items-center gap-0.5 border border-border rounded p-0.5 bg-background/60">
          <button
            onClick={() => setTab("slash")}
            className={cn("px-1.5 py-0.5 rounded text-[10px]", tab === "slash" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}
          >/ comandos</button>
          <button
            onClick={() => setTab("at")}
            className={cn("px-1.5 py-0.5 rounded text-[10px]", tab === "at" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}
          >@ menções</button>
        </div>
      </div>
      <div className="p-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[260px] overflow-y-auto">
        {items.map(it => (
          <div key={it.cmd} className="rounded-md border border-border bg-background/60 p-2">
            <div className="flex items-center gap-1.5 mb-0.5">
              <code className="text-[11px] font-mono font-semibold text-primary">{it.cmd}</code>
              <span className="text-[10px] text-muted-foreground">{it.label}</span>
            </div>
            <p className="text-[10.5px] leading-snug text-muted-foreground">{it.desc}</p>
          </div>
        ))}
      </div>
      <div className="px-2.5 py-1.5 border-t border-primary/20 bg-primary/5 text-[10px] text-muted-foreground">
        Dica: cole imagens (OCR automático) e links de vídeo (embed automático). Use <b>Alt+↑/↓</b> para alternar conversas do agente.
      </div>
    </div>
  );
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
                          Mover para {c.title}
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

// Bloco Kanban vivo embutido no fluxo das Notas.
function InlineKanbanBlock({ clientId, clientName }: { clientId: string | null; clientName: string | null }) {
  type Task = { id: string; title: string; status: string; priority: string | null; due_date: string | null; project_id: string };
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; field: "priority" | "due" } | null>(null);

  // Persistência da escolha de projeto por cliente
  const projStorageKey = clientId ? `studio.kanban.pid.${clientId}` : null;

  // 1) Carrega projetos do cliente
  useEffect(() => {
    if (!clientId) { setProjects([]); setProjectId(null); setTasks([]); return; }
    (async () => {
      const { data } = await supabase.from("projects").select("id, name").eq("client_id", clientId).order("created_at", { ascending: false });
      const list = (data || []) as Array<{ id: string; name: string }>;
      setProjects(list);
      const saved = projStorageKey ? localStorage.getItem(projStorageKey) : null;
      const nextPid = list.find(p => p.id === saved)?.id || list[0]?.id || null;
      setProjectId(nextPid);
    })();
  }, [clientId, projStorageKey]);

  // 2) Carrega tasks + realtime do projeto ativo
  useEffect(() => {
    if (!projectId) { setTasks([]); return; }
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("tasks")
        .select("id, title, status, priority, due_date, project_id")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (!cancel) { setTasks((data || []) as Task[]); setLoading(false); }
    })();
    const ch = supabase.channel(`ws-kanban-${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `project_id=eq.${projectId}` }, (payload) => {
        setTasks(cur => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as Task;
            if (cur.some(t => t.id === row.id)) return cur;
            return [row, ...cur];
          }
          if (payload.eventType === "UPDATE") {
            const row = payload.new as Task;
            return cur.map(t => t.id === row.id ? { ...t, ...row } : t);
          }
          if (payload.eventType === "DELETE") {
            const row = payload.old as Task;
            return cur.filter(t => t.id !== row.id);
          }
          return cur;
        });
      })
      .subscribe();
    return () => { cancel = true; supabase.removeChannel(ch); };
  }, [projectId]);

  const cols: Array<{ key: string; title: string }> = [
    { key: "todo", title: "A fazer" },
    { key: "doing", title: "Em andamento" },
    { key: "review", title: "Revisão" },
    { key: "done", title: "Feito" },
  ];

  async function patch(taskId: string, changes: Partial<Task>) {
    setTasks(cur => cur.map(t => t.id === taskId ? { ...t, ...changes } : t));
    const { error } = await supabase.from("tasks").update(changes as any).eq("id", taskId);
    if (error) { toast({ title: "Falha ao salvar", description: error.message, variant: "destructive" }); void reload(); }
  }

  async function reload() {
    if (!projectId) return;
    const { data } = await supabase.from("tasks")
      .select("id, title, status, priority, due_date, project_id")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    setTasks((data || []) as Task[]);
  }

  async function quickAdd() {
    const title = newTitle.trim();
    if (!title || !projectId) return;
    const { data, error } = await supabase.from("tasks")
      .insert({ project_id: projectId, title, status: "todo", priority: "medium" })
      .select("id, title, status, priority, due_date, project_id")
      .single();
    if (!error && data) { setTasks(cur => [data as Task, ...cur]); setNewTitle(""); }
    else if (error) toast({ title: "Erro ao criar tarefa", description: error.message, variant: "destructive" });
  }

  function onDrop(colKey: string) {
    if (!dragId) return;
    const t = tasks.find(x => x.id === dragId);
    setDragId(null); setDropCol(null);
    if (!t || t.status === colKey) return;
    void patch(dragId, { status: colKey });
  }

  return (
    <div className="my-3 border border-border rounded-lg bg-secondary/20 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-secondary/40 text-[11px]">
        <Columns3 className="w-3.5 h-3.5 text-primary" />
        <span className="font-semibold">Kanban</span>
        <span className="text-muted-foreground truncate">· {clientName || "cliente"}</span>
        {projects.length > 1 ? (
          <select
            value={projectId ?? ""}
            onChange={e => { const v = e.target.value || null; setProjectId(v); if (v && projStorageKey) localStorage.setItem(projStorageKey, v); }}
            className="ml-1 h-6 px-1.5 rounded border border-border bg-background text-[10.5px] max-w-[160px]"
          >
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : projects[0] && (
          <span className="text-muted-foreground truncate">/ {projects[0].name}</span>
        )}
        <button onClick={() => void reload()} className="ml-auto text-[10px] px-2 py-0.5 rounded border border-border hover:bg-secondary text-muted-foreground" title="Recarregar">↻</button>
      </div>
      {!clientId ? (
        <p className="p-3 text-[11px] text-muted-foreground">Selecione um cliente no Workspace para ver o Kanban.</p>
      ) : loading ? (
        <div className="p-4 flex items-center justify-center text-muted-foreground text-[11px]"><Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> carregando…</div>
      ) : !projectId ? (
        <p className="p-3 text-[11px] text-muted-foreground">Este cliente ainda não tem projeto ativo.</p>
      ) : (
        <>
          <div className="flex items-center gap-1 px-2 pt-2">
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void quickAdd(); } }}
              placeholder="+ nova tarefa (Enter)"
              className="flex-1 h-7 px-2 rounded border border-border bg-background text-[11px] focus:outline-none focus:border-primary/50" />
            <button onClick={() => void quickAdd()} disabled={!newTitle.trim()} className="h-7 px-2 rounded bg-primary text-primary-foreground text-[10px] disabled:opacity-40">Add</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-2">
            {cols.map(col => (
              <div
                key={col.key}
                onDragOver={e => { e.preventDefault(); setDropCol(col.key); }}
                onDragLeave={() => setDropCol(cur => cur === col.key ? null : cur)}
                onDrop={() => onDrop(col.key)}
                className={cn(
                  "rounded-md p-1.5 space-y-1 transition-colors min-h-[80px]",
                  dropCol === col.key ? "bg-primary/10 ring-1 ring-primary/40" : "bg-background/60"
                )}
              >
                <div className="text-[9px] uppercase font-semibold text-muted-foreground px-1 flex items-center justify-between">
                  <span>{col.title}</span>
                  <span className="opacity-60">{tasks.filter(t => t.status === col.key).length}</span>
                </div>
                {tasks.filter(t => t.status === col.key).map(t => (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => { setDragId(null); setDropCol(null); }}
                    className={cn(
                      "bg-card rounded p-1.5 border border-border text-[10.5px] space-y-1 cursor-grab active:cursor-grabbing",
                      dragId === t.id && "opacity-50"
                    )}
                  >
                    <div className="font-medium leading-snug">{t.title}</div>
                    <div className="flex items-center gap-1 flex-wrap text-[9px] text-muted-foreground">
                      {editing?.id === t.id && editing.field === "priority" ? (
                        <select
                          autoFocus
                          value={t.priority ?? "medium"}
                          onChange={e => { void patch(t.id, { priority: e.target.value }); setEditing(null); }}
                          onBlur={() => setEditing(null)}
                          className="h-5 px-1 rounded border border-border bg-background text-[9px]"
                        >
                          <option value="low">low</option>
                          <option value="medium">medium</option>
                          <option value="high">high</option>
                          <option value="urgent">urgent</option>
                        </select>
                      ) : (
                        <button
                          onClick={() => setEditing({ id: t.id, field: "priority" })}
                          className={cn("px-1 py-0.5 rounded hover:opacity-80",
                            t.priority === "urgent" ? "bg-destructive/20 text-destructive" :
                            t.priority === "high" ? "bg-amber-500/20 text-amber-600" :
                            t.priority === "low" ? "bg-secondary" : "bg-secondary")}
                          title="Alterar prioridade"
                        >{t.priority || "medium"}</button>
                      )}
                      {editing?.id === t.id && editing.field === "due" ? (
                        <input
                          autoFocus
                          type="date"
                          defaultValue={t.due_date ?? ""}
                          onBlur={e => { const v = e.target.value || null; if (v !== t.due_date) void patch(t.id, { due_date: v }); setEditing(null); }}
                          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(null); }}
                          className="h-5 px-1 rounded border border-border bg-background text-[9px]"
                        />
                      ) : (
                        <button
                          onClick={() => setEditing({ id: t.id, field: "due" })}
                          className="px-1 py-0.5 rounded border border-dashed border-border/60 hover:bg-secondary"
                          title="Definir prazo"
                        >{t.due_date ? `Prazo ${t.due_date}` : "Prazo"}</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="px-3 py-1.5 border-t border-border bg-secondary/30 text-[9.5px] text-muted-foreground">
            Arraste os cards entre colunas · clique em prioridade/prazo para editar · alterações salvas em tempo real
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

function GptPanel({ clientName, folderPath, availableFiles, notes, script, onAppendToNotes }: {
  clientName: string | null;
  folderPath: string;
  availableFiles: FileRef[];
  notes: string;
  script: string;
  onAppendToNotes: (text: string) => void;
}) {
  const { toast } = useToast();
  const [pasted, setPasted] = useState("");

  const contextText = useMemo(() => [
    `# CONTEXTO ACELERIQ · ${clientName || "Global"}${folderPath ? " · /" + folderPath : ""}`,
    notes?.trim() ? `\n## NOTAS\n${notes.slice(0, 5000)}` : "",
    script?.trim() ? `\n## ROTEIRO\n${script.slice(0, 3000)}` : "",
    availableFiles.length ? `\n## ARQUIVOS\n${availableFiles.slice(0, 40).map(f => `- ${f.kind === "folder" ? "Pasta" : "Arquivo"}: ${f.name}`).join("\n")}` : "",
    "\n## ORDEM DE TRABALHO\nUse o contexto do sistema, preserve a estrutura das notas e devolva uma resposta pronta para colar no Studio.",
  ].filter(Boolean).join("\n"), [availableFiles, clientName, folderPath, notes, script]);

  const copyContext = async () => {
    try {
      await navigator.clipboard.writeText(contextText);
      toast({ title: "Contexto copiado", description: "Abra o GPT e cole o contexto." });
    } catch {
      toast({ title: "Não foi possível copiar", description: "Copie manualmente pelo bloco de contexto.", variant: "destructive" });
    }
  };

  const openGpt = async () => {
    await copyContext();
    window.open(PREPRO_GPT, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Agente GPT</div>
          <div className="text-sm font-semibold truncate">{clientName || "Contexto global"}</div>
          <div className="text-[10px] text-muted-foreground truncate">/{folderPath || "raiz"}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={copyContext}
            className="px-2 py-1 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-secondary flex items-center gap-1"
            title="Copiar contexto para usar no GPT"
          >
            <Copy className="w-3 h-3" /> Copiar
          </button>
          <button
            onClick={openGpt}
            className="px-2 py-1 rounded border border-primary/30 bg-primary/10 text-primary text-[10px] hover:bg-primary/20 flex items-center gap-1"
            title="Abrir GPT externo com o contexto copiado"
          >
            <ExternalLink className="w-3 h-3" /> Abrir GPT
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background overflow-hidden">
        <div className="px-2 py-1.5 border-b border-border bg-secondary/30 text-[10px] font-medium text-muted-foreground flex items-center gap-1">
          <Brain className="w-3 h-3" /> Contexto preparado
        </div>
        <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words p-3 text-[10.5px] leading-relaxed text-foreground/80 font-mono">
          {contextText}
        </pre>
      </div>

      <div className="rounded-lg border border-border bg-background overflow-hidden">
        <div className="px-2 py-1.5 border-b border-border bg-secondary/30 text-[10px] font-medium text-muted-foreground flex items-center gap-1">
          <ClipboardPaste className="w-3 h-3" /> Retorno do GPT
        </div>
        <div className="p-2 space-y-2">
          <textarea
            value={pasted}
            onChange={e => setPasted(e.target.value)}
            placeholder="Cole aqui a resposta do GPT externo para enviar às Notas."
            className="w-full min-h-[180px] resize-y bg-background border border-border rounded-md p-2 text-[12px] leading-relaxed focus:outline-none focus:border-primary/50"
          />
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={() => setPasted("")}
              disabled={!pasted.trim()}
              className="px-2 py-1 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-40"
            >
              Limpar
            </button>
            <button
              onClick={() => {
                if (!pasted.trim()) return;
                onAppendToNotes(pasted);
                setPasted("");
                toast({ title: "Enviado para Notas", description: "Resposta adicionada ao documento." });
              }}
              disabled={!pasted.trim()}
              className="px-2 py-1 rounded border border-primary/30 bg-primary/10 text-primary text-[10px] hover:bg-primary/20 disabled:opacity-40 flex items-center gap-1"
            >
              <ArrowRight className="w-3 h-3" /> Enviar para Notas
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentChat({ clientId, clientName, projectId, folderId, folderPath, availableFiles, notes, script, boardLog, onStructureToNotes, onAttachToNotes, label = "Contexto", showExternalTools = true }: {
  clientId: string | null; clientName: string | null; projectId?: string | null; folderId: string | null; folderPath: string;
  availableFiles: FileRef[]; notes: string; script: string; boardLog?: string[];
  onStructureToNotes?: (sourceText?: string) => void | Promise<void>;
  onAttachToNotes?: (picks: FileRef[]) => void;
  label?: string;
  showExternalTools?: boolean;
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
  type PersonaRow = { id: string; gpt_url: string | null; gpt_name: string | null; gpt_description?: string | null; client_id: string | null; folder_path: string | null };
  const [persona, setPersona] = useState<{ list: PersonaRow[]; active: PersonaRow | null; scopeLevel: "folder" | "client" | "global" | "none"; forcedId: string | null; lastUsedName: string | null }>({
    list: [], active: null, scopeLevel: "none", forcedId: null, lastUsedName: null,
  });
  async function reloadPersona() {
    const { data } = await supabase.from("workspace_agent_personas")
      .select("id,gpt_url,gpt_name,gpt_description,client_id,folder_path");
    const rows = (data || []) as PersonaRow[];
    // Filtra o que é visível no escopo atual (global + cliente + pasta)
    const list = rows.filter(r => {
      if (!r.client_id && !r.folder_path) return true;
      if (clientId && r.client_id === clientId && !r.folder_path) return true;
      if (clientId && r.client_id === clientId && folderPath && r.folder_path === folderPath) return true;
      return false;
    });
    // "active" = mais específica (retrocompat p/ botão GPT quando não há override)
    const pick = (fn: (r: PersonaRow) => boolean) => list.find(fn) || null;
    let active: PersonaRow | null = null;
    let level: "folder" | "client" | "global" | "none" = "none";
    if (clientId && folderPath) { active = pick(r => r.client_id === clientId && r.folder_path === folderPath); if (active) level = "folder"; }
    if (!active && clientId) { active = pick(r => r.client_id === clientId && !r.folder_path); if (active) level = "client"; }
    if (!active) { active = pick(r => !r.client_id && !r.folder_path); if (active) level = "global"; }
    setPersona(p => ({ ...p, list, active, scopeLevel: level, forcedId: p.forcedId && list.some(x => x.id === p.forcedId) ? p.forcedId : null }));
  }
  useEffect(() => { void reloadPersona(); }, [clientId, folderPath]);

  // @ e / no composer do agente
  const [mention, setMention] = useState<{ q: string; start: number } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [slash, setSlash] = useState<{ q: string; start: number } | null>(null);
  const [slashIdx, setSlashIdx] = useState(0);
  // arquivos anexados à próxima mensagem (sincronizam com @ do input)
  const [attached, setAttached] = useState<FileRef[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
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
    { key: "checklist", label: "Checklist de pipeline", hint: "brutos até publicado",    prompt: "Gere um checklist de pipeline personalizado para este projeto (Brutos, Trilhas/SFX, Edição, Final e Publicado)." },
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

  // Atalhos de teclado: Alt+↑/↓ alterna threads, Alt+N nova, Alt+B toggle sidebar, Esc fecha overlay mobile
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      if (e.key === "Escape" && isMobile && sidebarOpen) { setSidebarOpen(false); return; }
      if (!e.altKey || typing) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!threads.length) return;
        const idx = Math.max(0, threads.findIndex(t => t.id === activeId));
        const next = e.key === "ArrowDown" ? (idx + 1) % threads.length : (idx - 1 + threads.length) % threads.length;
        setActiveId(threads[next].id);
      } else if (e.key.toLowerCase() === "n") {
        e.preventDefault(); void newThread();
      } else if (e.key.toLowerCase() === "b") {
        e.preventDefault(); setSidebarOpen(o => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [threads, activeId, isMobile, sidebarOpen]);

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




  // Fuzzy: retorna { score, ranges }. Score maior = melhor.
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

  const [pulling, setPulling] = useState(false);
  const [contextStats, setContextStats] = useState<{ systemFiles: number; workspaceFiles: number; projects: number; tasks: number } | null>(null);
  const autoPulledRef = useRef<Set<string>>(new Set());
  async function pullDeepContext(opts: { silent?: boolean } = {}) {
    if (streaming || pulling) return;
    setPulling(true);
    if (!opts.silent) toast({ title: "Preparando contexto", description: "Reunindo dados do cliente, projetos e pasta." });
    try {
      const chunks: string[] = [];
      const stats = { systemFiles: 0, workspaceFiles: 0, projects: 0, tasks: 0 };
      if (clientId) {
        const [profRes, projRes, briefRes, contractRes, fileRes, workspaceRes, reportRes, updateRes, docRes, vaultRes] = await Promise.all([
          supabase.from("profiles").select("full_name,company_name,phone,email,plan_name,plan_value,plan_status,brand,client_type").eq("id", clientId).maybeSingle(),
          supabase.from("projects").select("id,name,status,progress,description,brand,scope,objectives,deadline,created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(12),
          supabase.from("briefings").select("id,responses,submitted,required,created_at,project_id").eq("client_id", clientId).order("created_at", { ascending: false }).limit(3),
          supabase.from("contracts").select("id,title,description,status,original_file_name,project_id,created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(5),
          supabase.from("files").select("id,file_name,file_url,file_type,folder,approval_status,caption,carousel_text,description,created_at,project_id,parent_file_id").eq("client_id", clientId).order("created_at", { ascending: false }).limit(180),
          supabase.from("workspace_nodes").select("id,name,kind,mime,size_bytes,storage_path,parent_id,created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(180),
          supabase.from("reports").select("title,summary,highlights,next_steps,status,period_start,period_end,project_id,created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(6),
          supabase.from("updates").select("message,update_type,project_id,created_at").in("project_id", projectId ? [projectId] : ["00000000-0000-0000-0000-000000000000"]).limit(projectId ? 25 : 0),
          projectId ? supabase.from("studio_docs").select("notes,published,updated_at").eq("project_id", projectId).maybeSingle() : Promise.resolve({ data: null } as any),
          supabase.from("client_vault").select("category,title,url,username,notes,created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(20),
        ]);
        const prof = profRes.data as any;
        if (prof) chunks.push(`## Cliente\n- Nome: ${prof.full_name || "-"}\n- Empresa: ${prof.company_name || "-"}\n- Tipo: ${prof.client_type || "-"}\n- Marca: ${prof.brand || "-"}\n- Plano: ${prof.plan_name || "-"} · R$ ${prof.plan_value || 0}\n- Status: ${prof.plan_status || "-"}\n- Contato: ${prof.email || "-"} · ${prof.phone || "-"}`);
        const projects = (projRes.data as any[]) || [];
        stats.projects = projects.length;
        const activeProject = projectId ? projects.find(p => p.id === projectId) : null;
        if (activeProject) chunks.push(`## Projeto selecionado\n- Nome: ${activeProject.name}\n- Status: ${activeProject.status || "-"}\n- Progresso: ${activeProject.progress ?? 0}%\n- Prazo: ${activeProject.deadline || "-"}\n- Escopo: ${activeProject.scope || "-"}\n- Objetivos: ${activeProject.objectives || "-"}\n- Descrição: ${activeProject.description || "-"}`);
        if (projects.length) {
          chunks.push(`## Projetos do cliente (${projects.length})\n${projects.map(p => `- ${p.name} · ${p.status || "-"} · ${p.progress ?? 0}% · ${p.brand || "-"}${p.deadline ? ` · prazo ${p.deadline}` : ""}${p.description ? ` — ${String(p.description).slice(0, 140)}` : ""}`).join("\n")}`);
          const ids = projectId ? [projectId] : projects.map(p => p.id);
          const [taskRes, milRes] = await Promise.all([
            supabase.from("tasks").select("title,status,priority,due_date,description,project_id").in("project_id", ids).order("updated_at", { ascending: false }).limit(80),
            supabase.from("milestones").select("title,status,target_date,description,project_id").in("project_id", ids).order("milestone_order", { ascending: true }).limit(40),
          ]);
          const tasks = (taskRes.data as any[]) || [];
          stats.tasks = tasks.length;
          const opened = tasks.filter(t => t.status !== "done" && t.status !== "concluido").slice(0, 25);
          if (opened.length) chunks.push(`## Tarefas abertas (${opened.length})\n${opened.map(t => `- [${t.status || "-"}${t.priority ? "/" + t.priority : ""}] ${t.title}${t.due_date ? ` · vence ${t.due_date}` : ""}${t.description ? ` — ${String(t.description).slice(0, 120)}` : ""}`).join("\n")}`);
          const mils = (milRes.data as any[]) || [];
          if (mils.length) chunks.push(`## Marcos do projeto\n${mils.map(m => `- [${m.status || "-"}] ${m.title}${m.target_date ? ` · ${m.target_date}` : ""}${m.description ? ` — ${String(m.description).slice(0, 120)}` : ""}`).join("\n")}`);
        }
        const briefs = (briefRes.data as any[]) || [];
        briefs.forEach((brief, idx) => {
          if (!brief?.responses) return;
          const ansStr = typeof brief.responses === "string" ? brief.responses : JSON.stringify(brief.responses, null, 2);
          chunks.push(`## Briefing ${idx + 1}${brief.project_id === projectId ? " do projeto" : ""}\n- Enviado: ${brief.submitted ? "sim" : "não"}\n- Obrigatório: ${brief.required ? "sim" : "não"}\n${ansStr.slice(0, 2600)}`);
        });
        const systemFiles = ((fileRes.data as any[]) || []).filter(f => !projectId || !f.project_id || f.project_id === projectId);
        stats.systemFiles = systemFiles.length;
        if (systemFiles.length) {
          const grouped = systemFiles.slice(0, 120).map(f => `- ${f.file_name}${f.folder ? ` · pasta ${f.folder}` : ""}${f.file_type ? ` · ${f.file_type}` : ""}${f.approval_status ? ` · ${f.approval_status}` : ""}${f.caption ? ` · legenda: ${String(f.caption).slice(0, 100)}` : ""}${f.description ? ` · descrição: ${String(f.description).slice(0, 100)}` : ""}${f.carousel_text ? ` · carrossel: ${String(f.carousel_text).slice(0, 140)}` : ""}`).join("\n");
          chunks.push(`## Arquivos do cliente no sistema (${systemFiles.length})\n${grouped}`);
        }
        const workspaceNodes = ((workspaceRes.data as any[]) || []);
        stats.workspaceFiles = workspaceNodes.filter(n => n.kind === "file").length;
        if (workspaceNodes.length) {
          chunks.push(`## Arquivos do Workspace (${workspaceNodes.length})\n${workspaceNodes.slice(0, 120).map(n => `- ${n.kind === "folder" ? "Pasta" : "Arquivo"}: ${n.name}${n.mime ? ` · ${n.mime}` : ""}${n.size_bytes ? ` · ${Math.round(Number(n.size_bytes) / 1024)}KB` : ""}`).join("\n")}`);
        }
        const reports = (reportRes.data as any[]) || [];
        if (reports.length) chunks.push(`## Relatórios e aprendizados\n${reports.map(r => `- ${r.title || "Relatório"} · ${r.status || "-"}${r.period_start ? ` · ${r.period_start} a ${r.period_end || "-"}` : ""}${r.summary ? ` — ${String(r.summary).slice(0, 180)}` : ""}${r.next_steps ? ` · próximos: ${String(r.next_steps).slice(0, 140)}` : ""}`).join("\n")}`);
        const updates = (updateRes.data as any[]) || [];
        if (updates.length) chunks.push(`## Atualizações recentes do projeto\n${updates.map(u => `- ${u.created_at?.slice(0, 10) || ""} · ${u.update_type || "update"}: ${u.message}`).join("\n")}`);
        const doc = docRes.data as any;
        if (doc?.notes) chunks.push(`## Notas publicadas/Studio do projeto\n${String(doc.notes).slice(0, 3000)}`);
        const vault = (vaultRes.data as any[]) || [];
        if (vault.length) chunks.push(`## Links e sistemas do cliente\n${vault.map(v => `- ${v.category || "item"}: ${v.title}${v.url ? ` · ${v.url}` : ""}${v.username ? ` · usuário: ${v.username}` : ""}${v.notes ? ` — ${String(v.notes).slice(0, 100)}` : ""}`).join("\n")}`);
        setContextStats(stats);
        if (!systemFiles.length && !workspaceNodes.length) {
          chunks.push("## Observação de contexto\nNenhum arquivo foi encontrado para este cliente/projeto nas bases de arquivos do sistema e do Workspace.");
        }
        const contracts = (contractRes.data as any[]) || [];
        if (contracts.length) chunks.push(`## Contratos\n${contracts.map(c => `- ${c.title || c.original_file_name || "Contrato"} · ${c.status || "-"}${c.description ? ` — ${String(c.description).slice(0, 120)}` : ""}`).join("\n")}`);
      }
      if (folderId) {
        const { data: nodes } = await supabase.from("workspace_nodes").select("name,kind,mime").eq("parent_id", folderId).limit(60);
        if (nodes?.length) chunks.push(`## Pasta aberta agora /${folderPath}\n${nodes.map((n: any) => `- ${n.kind === "folder" ? "Pasta" : "Arquivo"}: ${n.name}${n.mime ? ` (${n.mime})` : ""}`).join("\n")}`);
      }
      if (notes?.trim()) chunks.push(`## Notas em construção\n${notes.slice(0, 2000)}`);
      if (script?.trim()) chunks.push(`## Roteiro em construção\n${script.slice(0, 2000)}`);

      const dossier = chunks.join("\n\n") || "(sem dados disponíveis para este escopo)";
      const prompt = [
        "[MODO ORQUESTRADOR · AUTO-CONTEXTO]",
        "Você é o Orquestrador de Pré-Produção da AcelerIQ. O sistema já leu tudo do cliente, projetos, tasks, briefing, contratos e pasta atual. Assuma o comando.",
        "",
        "Regras de formatação (obrigatórias):",
        "- Responda em Markdown limpo, com hierarquia clara.",
        "- Use títulos de seção com '## ' (exatamente como abaixo). Nada de MAIÚSCULAS soltas nem asteriscos avulsos.",
        "- Sem emojis, sem cumprimento, sem repetir o dossiê, sem enrolação.",
        "- Frases curtas. Uma ideia por linha. Deixe uma linha em branco entre parágrafos e antes/depois de cada lista.",
        "- Listas numeradas com '1. ', '2. ', '3. '. Listas simples com '- '.",
        "- Pode usar **negrito** só para destacar 1 a 2 termos por seção. Nada de itálico decorativo.",
        "",
        "Entregue exatamente esta estrutura, nesta ordem:",
        "",
        "## Diagnóstico",
        "Até 3 linhas sobre onde o cliente está e o que trava o avanço.",
        "",
        "## Lacunas críticas",
        "Lista numerada das informações que faltam para destravar o próximo entregável.",
        "",
        "## Perguntas para você responder",
        "Entre 3 e 5 perguntas numeradas, diretas, uma frase cada, priorizadas pelo impacto no próximo passo.",
        "",
        "## Próximo entregável sugerido",
        "Uma linha nomeando o artefato concreto (roteiro, checklist, briefing revisado, plano de gravação, storyboard, etc.).",
        "",
        "A cada resposta minha, refine o plano e avance para a próxima etapa mantendo essa mesma estrutura.",
        "",
        "----- DOSSIÊ -----",
        dossier,
      ].join("\n");
      await send(prompt, { displayText: "Analisar contexto completo do cliente e do projeto" });

    } catch (e: any) {
      if (!opts.silent) toast({ title: "Falha ao preparar contexto", description: e?.message || "erro", variant: "destructive" });
    } finally {
      setPulling(false);
    }
  }

  // Auto-puxa contexto UMA vez por escopo (persistido em localStorage), somente quando
  // já existe uma thread ativa vazia. Sem thread ainda, aguardamos ação explícita do
  // usuário no botão "Puxar contexto" — evita loop de criação de conversas ao alternar abas.
  useEffect(() => {
    if (!clientId) return;
    if (streaming || pulling) return;
    if (!activeId) return;
    if (msgs.length > 0) return;
    const key = `studio:autoPulled:${clientId}:${threadScope}:${folderPath || "_root"}:${activeId}`;
    try { if (localStorage.getItem(key)) return; } catch {}
    if (autoPulledRef.current.has(activeId)) return;
    autoPulledRef.current.add(activeId);
    try { localStorage.setItem(key, "1"); } catch {}
    void pullDeepContext({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, activeId, msgs.length, folderPath, threadScope]);




  async function send(override?: string, options?: { displayText?: string }) {
    const text = (override ?? input).trim();
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
    // Preserva anexos no conteúdo da mensagem e mantém referências no histórico da thread
    const attachBlock = attached.length
      ? `\n\n---\nAnexos:\n${attached.map(a => `- [${a.name}](wsfile:${a.id})${a.url ? ` (${a.url})` : ""}`).join("\n")}`
      : "";
    const finalText = text + attachBlock;
    const visibleText = (options?.displayText?.trim() || text) + attachBlock;
    const currentAttachments = attached;
    setInput("");
    setAttached([]);
    setMsgs(m => [...m, { id: crypto.randomUUID(), role: "user", content: visibleText, created_at: new Date().toISOString() }]);
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
          display_message: visibleText,
          persona_id: persona.forcedId || undefined,
          context: {
            client_id: clientId,
            client_name: clientName,
            project_id: projectId,
            folder_id: folderId,
            folder_path: folderPath,
            notes: boardLog && boardLog.length
              ? `${notes}\n\n---\n## Atividade do Kanban (últimas ${boardLog.length})\n${boardLog.map(l => `- ${l}`).join("\n")}`
              : notes,
            script,
            attachments: currentAttachments.map(f => ({ id: f.id, name: f.name, kind: f.kind, url: f.url })),
            folder_contents: {
              subfolders: availableFiles.filter(f => f.kind === "folder").slice(0, 30).map(f => ({ id: f.id, name: f.name })),
              files: availableFiles.filter(f => f.kind === "file").slice(0, 40).map(f => ({ id: f.id, name: f.name, url: f.url })),
              total: availableFiles.length,
            },
            files: availableFiles.slice(0, 20).map(f => ({ name: f.name, url: f.url })),
          },
        }),
      });
      // Captura qual persona foi escolhida pelo roteador
      try {
        const usedName = res.headers.get("X-Persona-Name");
        if (usedName) setPersona(p => ({ ...p, lastUsedName: decodeURIComponent(usedName) }));
      } catch { /* ignore */ }
      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => "");
        let msg = t || `HTTP ${res.status}`;
        try {
          const j = JSON.parse(t);
          if (j?.error === "PAYMENT_REQUIRED" || res.status === 402) {
            msg = j?.message || "Créditos do Lovable AI esgotados. Adicione créditos nas configurações de uso.";
          } else if (j?.error === "RATE_LIMITED" || res.status === 429) {
            msg = j?.message || "Muitas requisições. Tente novamente em instantes.";
          } else if (j?.message || j?.error) {
            msg = j.message || j.error;
          }
        } catch { /* not json */ }
        throw new Error(msg);
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
    <div className="flex h-full min-h-0 relative">
      {/* Backdrop mobile */}
      {sidebarOpen && isMobile && (
        <div
          className="absolute inset-0 bg-background/70 backdrop-blur-sm z-20 animate-in fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      {/* Sidebar de threads (overlay no mobile, inline no desktop) */}
      {sidebarOpen && (
        <aside
          className={cn(
            "border-r border-border bg-background flex flex-col min-h-0",
            isMobile
              ? "absolute inset-y-0 left-0 z-30 w-[78%] max-w-[280px] shadow-2xl animate-in slide-in-from-left"
              : "w-[180px] shrink-0 bg-background/60"
          )}
        >
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-secondary/30">
            <MessageSquare className="w-3 h-3 text-muted-foreground" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex-1 truncate">
              {clientName ? clientName : "Global"}
            </span>
            <button onClick={newThread} className="p-1 rounded hover:bg-secondary text-muted-foreground" title="Nova conversa (Alt+N)">
              <Plus className="w-3 h-3" />
            </button>
            <button onClick={() => setSidebarOpen(false)} className="p-1 rounded hover:bg-secondary text-muted-foreground" title="Recolher (Alt+B / Esc)">
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
                onClick={() => { setActiveId(t.id); if (isMobile) setSidebarOpen(false); }}>
                <div className="flex items-center gap-1">
                  <MessageSquare className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="text-[11px] truncate flex-1">{t.title}</span>
                  <button onClick={(e) => { e.stopPropagation(); deleteThread(t.id); }}
                    className={cn("p-0.5 hover:text-destructive", isMobile ? "opacity-70" : "opacity-0 group-hover:opacity-100")}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                {threadScope === "client" && t.folder_path && (
                  <span className="text-[9px] text-muted-foreground/70 truncate pl-4">/{t.folder_path}</span>
                )}
              </div>
            ))}
          </div>
          <div className="px-2 py-1 border-t border-border text-[9px] text-muted-foreground/70 hidden md:block">
            Alt+↑↓ alternar · Alt+N nova · Alt+B recolher
          </div>
        </aside>
      )}


      <div className="flex flex-col h-full flex-1 min-w-0">
        {/* Header: cliente + toggle sidebar + nova */}
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-secondary/30">
          {!sidebarOpen && (
            <button onClick={() => setSidebarOpen(true)}
              className="p-1 rounded hover:bg-secondary text-muted-foreground" title="Mostrar conversas (Alt+B)">
              <History className="w-3 h-3" />
            </button>
          )}
          <Bot className="w-3.5 h-3.5 text-primary" />
          <span className="text-[10px] font-medium text-foreground/80 truncate">
            {clientName ? `${label} · ${clientName}` : `${label} · Global`}
            {folderPath && <span className="text-muted-foreground"> · /{folderPath.split("/").slice(-2).join("/")}</span>}
          </span>

          {/* Seletor de persona: Auto ou manual */}
          <div className="flex-1 flex items-center justify-end gap-1">
            {showExternalTools && (
              <select
                value={persona.forcedId || "__auto__"}
                onChange={e => {
                  const v = e.target.value;
                  setPersona(p => ({ ...p, forcedId: v === "__auto__" ? null : v }));
                }}
                className="max-w-[180px] text-[10px] h-6 rounded border border-border bg-background px-1.5 text-foreground/90 focus:outline-none focus:ring-1 focus:ring-primary"
                title={persona.forcedId ? "Persona travada manualmente" : "Auto: o roteador escolhe conforme sua pergunta"}>
                <option value="__auto__">
                  Auto{persona.lastUsedName ? ` · usado: ${persona.lastUsedName}` : persona.list.length ? ` (${persona.list.length})` : ""}
                </option>
                {persona.list.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.gpt_name || "Sem nome"} {p.folder_path ? "· Pasta" : p.client_id ? "· Cliente" : "· Global"}
                  </option>
                ))}
              </select>
            )}

            {showExternalTools && (persona.forcedId ? persona.list.find(p => p.id === persona.forcedId) : persona.active)?.gpt_url && (
              <button
                onClick={async () => {
                  const active = persona.forcedId ? persona.list.find(p => p.id === persona.forcedId) : persona.active;
                  if (!active?.gpt_url) return;
                  const lastAssistant = [...msgs].reverse().find(m => m.role === "assistant")?.content || "";
                  const lastUser = [...msgs].reverse().find(m => m.role === "user")?.content || "";
                  const ctx = [
                    `# CONTEXTO ACELERIQ · ${clientName || "Global"}${folderPath ? " · /" + folderPath : ""}`,
                    notes ? `\n## NOTAS\n${notes.slice(0, 3000)}` : "",
                    script ? `\n## ROTEIRO\n${script.slice(0, 3000)}` : "",
                    availableFiles.length ? `\n## ARQUIVOS DA PASTA\n${availableFiles.slice(0, 30).map(f => `- ${f.kind === "folder" ? "Pasta" : "Arquivo"}: ${f.name}`).join("\n")}` : "",
                    lastUser ? `\n## ÚLTIMA PERGUNTA\n${lastUser}` : "",
                    lastAssistant ? `\n## RASCUNHO DO AGENTE INTERNO\n${lastAssistant}` : "",
                    `\n---\nUse este contexto para responder no padrão do seu GPT. A resposta será colada de volta no Studio.`,
                  ].filter(Boolean).join("\n");
                  try { await navigator.clipboard.writeText(ctx); toast({ title: "Contexto copiado", description: "Cole no ChatGPT que abrirá agora." }); } catch { /* ignore */ }
                  window.open(active.gpt_url, "_blank", "noopener,noreferrer");
                }}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30"
                title="Copia contexto e abre este GPT no ChatGPT">
                <ExternalLink className="w-3 h-3" /> GPT
              </button>
            )}
            <button
              onClick={() => pullDeepContext({ silent: false })}
              disabled={pulling || streaming}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 disabled:opacity-50"
              title="Reunir cliente, projetos, tasks, briefing e pasta em um dossiê e pedir diagnóstico ao agente"
            >
              {pulling ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
              Puxar contexto
            </button>
            {onStructureToNotes && (
              <button
                onClick={() => {
                  const lastAssistant = [...msgs].reverse().find(m => m.role === "assistant")?.content?.trim() || "";
                  if (!lastAssistant) { toast({ title: "Nada para enviar", description: "Peça uma análise ao agente primeiro." }); return; }
                  onStructureToNotes(lastAssistant);
                }}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30"
                title="Envia a última resposta do agente estruturada para as Notas"
              >
                <ArrowRight className="w-3 h-3" /> Enviar às Notas
              </button>
            )}




            {showExternalTools && <PasteBackButton
              disabled={!activeId}
              onPaste={async (text) => {
                if (!activeId || !text.trim()) return;
                const active = persona.forcedId ? persona.list.find(p => p.id === persona.forcedId) : persona.active;
                const { data: inserted, error } = await supabase.from("workspace_agent_messages")
                  .insert({ thread_id: activeId, role: "assistant", content: `**[Colado do ChatGPT · ${active?.gpt_name || "GPT externo"}]**\n\n${text.trim()}` })
                  .select("id, role, content, created_at").single();
                if (error) { toast({ title: "Erro ao colar", description: error.message, variant: "destructive" }); return; }
                if (inserted) setMsgs(m => [...m, inserted as AgentMsg]);
                toast({ title: "Resposta importada", description: "Adicionada à conversa como mensagem do agente." });
              }}
            />}
            {showExternalTools && <button onClick={() => setPersonaOpen(true)}
              className="p-1 rounded hover:bg-secondary text-muted-foreground" title="Gerenciar personas (adicionar / remover)">
              <Settings className="w-3 h-3" />
            </button>}
            <button onClick={newThread}
              className="p-1 rounded hover:bg-secondary text-muted-foreground" title="Nova conversa">
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>
        {showExternalTools && <PersonaDialog open={personaOpen} onOpenChange={setPersonaOpen}
          list={persona.list}
          clientId={clientId} clientName={clientName} folderPath={folderPath}
          onSaved={reloadPersona} />}
        {/* Chip de contexto auto por pasta */}
        <div className="px-2 py-1 border-b border-border bg-background/60 flex flex-wrap items-center gap-1 text-[9px] text-muted-foreground">
          <span className="px-1.5 py-0.5 rounded bg-secondary/60 text-foreground/70 flex items-center gap-1"><FolderIcon className="w-2.5 h-2.5" />/{folderPath || "raiz"}</span>
          <span className="px-1.5 py-0.5 rounded bg-secondary/40 flex items-center gap-1"><FileIcon className="w-2.5 h-2.5" />{contextStats ? contextStats.systemFiles + contextStats.workspaceFiles : availableFiles.filter(f=>f.kind==="file").length} arq</span>
          <span className="px-1.5 py-0.5 rounded bg-secondary/40 flex items-center gap-1"><FolderIcon className="w-2.5 h-2.5" />{availableFiles.filter(f=>f.kind==="folder").length} sub</span>
          {contextStats && <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary flex items-center gap-1"><Brain className="w-2.5 h-2.5" />base completa</span>}
          {notes?.trim() && <span className="px-1.5 py-0.5 rounded bg-secondary/40 flex items-center gap-1"><NotebookPen className="w-2.5 h-2.5" />notas</span>}
          {script?.trim() && <span className="px-1.5 py-0.5 rounded bg-secondary/40 flex items-center gap-1"><FileText className="w-2.5 h-2.5" />roteiro</span>}
          <span className="ml-auto opacity-60">contexto auto</span>
        </div>


      {/* Mensagens */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-5 space-y-5">
        {msgs.length === 0 && !streaming && (
          <div className="max-w-md mx-auto text-center py-10 space-y-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              O orquestrador vai reunir contexto de <span className="text-foreground font-medium">{clientName || "este escopo"}</span> e devolver diagnóstico e perguntas.
            </p>
          </div>
        )}
        {msgs.map(m => (
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-md px-3.5 py-2 text-[12.5px] leading-[1.55] bg-primary text-primary-foreground whitespace-pre-wrap break-words shadow-sm">
                {m.content}
              </div>
            </div>
          ) : (
            <article
              key={m.id}
              className={cn(
                "max-w-[68ch] text-foreground text-[13px] leading-[1.7] break-words",
                "prose prose-sm prose-invert max-w-none",
                "prose-p:my-2.5 prose-p:leading-[1.7]",
                "prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-foreground",
                "prose-h1:text-[11px] prose-h1:uppercase prose-h1:tracking-[0.14em] prose-h1:text-primary prose-h1:mt-5 prose-h1:mb-2 prose-h1:first:mt-0",
                "prose-h2:text-[11px] prose-h2:uppercase prose-h2:tracking-[0.14em] prose-h2:text-primary prose-h2:mt-5 prose-h2:mb-2 prose-h2:first:mt-0",
                "prose-h3:text-[12px] prose-h3:uppercase prose-h3:tracking-[0.12em] prose-h3:text-muted-foreground prose-h3:mt-4 prose-h3:mb-1.5",
                "prose-ol:my-2.5 prose-ol:pl-5 prose-ol:space-y-1.5",
                "prose-ul:my-2.5 prose-ul:pl-5 prose-ul:space-y-1.5",
                "prose-li:my-0 prose-li:leading-[1.65] prose-li:marker:text-primary/60",
                "prose-strong:font-semibold prose-strong:text-foreground",
                "prose-code:text-[11.5px] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:bg-secondary/60 prose-code:before:content-none prose-code:after:content-none",
                "prose-pre:bg-secondary/60 prose-pre:border prose-pre:border-border prose-pre:rounded-lg prose-pre:text-[11.5px]",
                "prose-table:my-4 prose-table:text-[12px] prose-th:border prose-th:border-border prose-th:bg-secondary/50 prose-th:px-3 prose-th:py-2 prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2",
                "prose-hr:my-4 prose-hr:border-border/50",
                "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
                "prose-blockquote:border-l-2 prose-blockquote:border-primary/40 prose-blockquote:pl-3 prose-blockquote:text-muted-foreground prose-blockquote:not-italic"
              )}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{m.content}</ReactMarkdown>
            </article>
          )
        ))}

        {streaming && streamBuf && (
          <article className="max-w-[68ch] text-foreground text-[13px] leading-[1.7] break-words prose prose-sm prose-invert max-w-none prose-p:my-2.5 prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-[11px] prose-h1:uppercase prose-h1:tracking-[0.14em] prose-h1:text-primary prose-h2:text-[11px] prose-h2:uppercase prose-h2:tracking-[0.14em] prose-h2:text-primary prose-ol:pl-5 prose-ol:space-y-1.5 prose-ul:pl-5 prose-ul:space-y-1.5 prose-li:leading-[1.65] prose-li:marker:text-primary/60">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{streamBuf}</ReactMarkdown>
            <span className="inline-block w-[3px] h-3.5 bg-primary/70 ml-0.5 align-middle animate-pulse" />
          </article>
        )}
        {streaming && !streamBuf && (
          <div className="flex items-center gap-2 text-muted-foreground text-[11.5px]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/50 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary"></span>
            </span>
            reunindo contexto
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
          {/* Popover @ arquivos: busca fuzzy + navegação por teclado */}
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
            placeholder="Converse com o agente. @ anexa arquivo · / dispara ação · cole um link que ele lê"
            rows={2}
            className="flex-1 resize-none bg-background border border-border rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-primary/50"
          />

          <div className="flex flex-col gap-1">
            <button
              type="button"
              title="Anexar arquivo ou pasta do workspace"
              onClick={() => {
                const el = inputRef.current;
                if (!el) return;
                const caret = el.selectionStart ?? input.length;
                const next = input.slice(0, caret) + "@" + input.slice(caret);
                setInput(next);
                setMention({ q: "", start: caret });
                setTimeout(() => { el.focus(); el.setSelectionRange(caret + 1, caret + 1); }, 10);
              }}
              className="h-[18px] w-8 flex items-center justify-center rounded border border-border bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground"
            >
              <Paperclip className="w-3 h-3" />
            </button>
            <button
              type="button"
              title="Anexar link (o agente lê o conteúdo)"
              onClick={() => {
                const url = window.prompt("Cole o link (o agente vai ler o conteúdo):");
                if (!url) return;
                const clean = url.trim();
                if (!/^https?:\/\//i.test(clean)) { alert("URL inválida — use http:// ou https://"); return; }
                const name = (() => { try { return new URL(clean).hostname.replace(/^www\./, ""); } catch { return "link"; } })();
                const ref: FileRef = { id: `url-${crypto.randomUUID()}`, name, kind: "file", url: clean };
                setAttached(prev => [...prev, ref]);
                setInput(prev => (prev ? prev + " " : "") + clean + " ");
                setTimeout(() => inputRef.current?.focus(), 10);
              }}
              className="h-[18px] w-8 flex items-center justify-center rounded border border-border bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground"
            >
              <Link2 className="w-3 h-3" />
            </button>
            <button
              type="button"
              title="Navegar pastas e anexar vários arquivos"
              onClick={() => setPickerOpen(true)}
              className="h-[18px] w-8 flex items-center justify-center rounded border border-border bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground"
            >
              <Columns3 className="w-3 h-3" />
            </button>
          </div>

          <Button size="sm" onClick={() => send()} disabled={streaming || !input.trim()} className="h-8 px-2">
            {streaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>
      </div>

      <AttachPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        clientId={clientId}
        rootFolderId={folderId}
        rootLabel={clientName ? `${clientName}${folderPath ? ` / ${folderPath}` : ""}` : "Workspace"}
        alreadyAttachedIds={new Set(attached.map(a => a.id))}
        onConfirm={(picks) => {
          // 1) Contexto do agente: mescla anexos sem duplicar.
          setAttached(prev => {
            const seen = new Set(prev.map(p => p.id));
            const merged = [...prev];
            for (const p of picks) if (!seen.has(p.id)) { merged.push(p); seen.add(p.id); }
            return merged;
          });
          picks.forEach(p => pushRecent(p.id));

          // 2) Notas: delega ao parent para injetar refs em "## Links e anexos".
          if (picks.length) onAttachToNotes?.(picks);
        }}
      />
    </div>
  );
}

// =========================
// ATTACH PICKER — navegar pastas + busca + múltipla seleção
// =========================
type PickerNode = { id: string; name: string; kind: "folder" | "file"; parent_id: string | null; mime?: string | null };
type Crumb = { id: string | null; name: string };

function AttachPicker({
  open, onOpenChange, clientId, rootFolderId, rootLabel, alreadyAttachedIds, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId?: string | null;
  rootFolderId?: string | null;
  rootLabel: string;
  alreadyAttachedIds: Set<string>;
  onConfirm: (picks: FileRef[]) => void;
}) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: rootFolderId ?? null, name: rootLabel }]);
  const currentId = crumbs[crumbs.length - 1].id;
  const [nodes, setNodes] = useState<PickerNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Map<string, PickerNode>>(new Map());
  const [globalSearch, setGlobalSearch] = useState(false);

  useEffect(() => {
    if (open) {
      setCrumbs([{ id: rootFolderId ?? null, name: rootLabel }]);
      setSelected(new Map());
      setQuery("");
      setGlobalSearch(false);
    }
  }, [open, rootFolderId, rootLabel]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      let q = supabase.from("workspace_nodes")
        .select("id,name,kind,parent_id,mime")
        .order("kind", { ascending: true })
        .order("name", { ascending: true })
        .limit(400);
      if (clientId) q = q.eq("client_id", clientId); else q = q.is("client_id", null);
      if (globalSearch && query.trim()) {
        q = q.ilike("name", `%${query.trim()}%`);
      } else if (currentId) {
        q = q.eq("parent_id", currentId);
      } else {
        q = q.is("parent_id", null);
      }
      const { data } = await q;
      if (!cancelled) setNodes((data ?? []) as PickerNode[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, clientId, currentId, globalSearch, query]);

  const filtered = useMemo(() => {
    if (globalSearch) return nodes;
    const s = query.trim().toLowerCase();
    if (!s) return nodes;
    return nodes.filter(n => n.name.toLowerCase().includes(s));
  }, [nodes, query, globalSearch]);

  const visibleSelectableIds = filtered.map(n => n.id);
  const allVisibleChecked = visibleSelectableIds.length > 0 && visibleSelectableIds.every(id => selected.has(id));

  function toggle(n: PickerNode) {
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(n.id)) next.delete(n.id); else next.set(n.id, n);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelected(prev => {
      const next = new Map(prev);
      if (allVisibleChecked) filtered.forEach(n => next.delete(n.id));
      else filtered.forEach(n => next.set(n.id, n));
      return next;
    });
  }
  function openFolder(n: PickerNode) {
    if (n.kind !== "folder") return;
    setCrumbs(prev => [...prev, { id: n.id, name: n.name }]);
    setQuery("");
    setGlobalSearch(false);
  }
  function goTo(idx: number) {
    setCrumbs(prev => prev.slice(0, idx + 1));
    setQuery("");
    setGlobalSearch(false);
  }
  function confirm() {
    const picks: FileRef[] = Array.from(selected.values()).map(n => ({
      id: n.id, name: n.name, kind: n.kind, url: null, meta: n.mime ?? null,
    }));
    onConfirm(picks);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2 border-b border-border">
          <DialogTitle className="text-sm font-medium">Anexar arquivos ao contexto</DialogTitle>
          <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground mt-1">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronDown className="w-3 h-3 -rotate-90 opacity-50" />}
                <button
                  onClick={() => goTo(i)}
                  className={cn("hover:text-foreground truncate max-w-[180px]",
                    i === crumbs.length - 1 ? "text-foreground font-medium" : "")}
                >
                  {c.name}
                </button>
              </span>
            ))}
          </div>
        </DialogHeader>

        <div className="px-4 py-2 border-b border-border flex items-center gap-2">
          <div className="relative flex-1">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={globalSearch ? "Buscar em todo o workspace..." : "Filtrar nesta pasta..."}
              className="h-8 text-[12px] pl-2"
            />
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.checked)}
              className="accent-primary"
            />
            Buscar em tudo
          </label>
        </div>

        <div className="px-4 py-2 flex items-center justify-between text-[11px] text-muted-foreground border-b border-border">
          <button
            onClick={toggleAllVisible}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 hover:text-foreground disabled:opacity-40"
          >
            <span className={cn("w-3.5 h-3.5 rounded border border-border flex items-center justify-center",
              allVisibleChecked ? "bg-primary border-primary" : "bg-background")}>
              {allVisibleChecked && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
            </span>
            {allVisibleChecked ? "Desmarcar visíveis" : "Selecionar visíveis"}
          </button>
          <span>{selected.size} selecionado(s)</span>
        </div>

        <div className="max-h-[380px] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-[11px] text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> carregando
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-[11px] text-muted-foreground">
              {globalSearch && !query.trim() ? "Digite algo para buscar." : "Pasta vazia."}
            </div>
          ) : (
            <ul>
              {filtered.map(n => {
                const already = alreadyAttachedIds.has(n.id);
                const checked = selected.has(n.id);
                return (
                  <li key={n.id}
                    className={cn("flex items-center gap-2 px-4 py-1.5 border-b border-border/40 hover:bg-secondary/40",
                      checked && "bg-primary/5")}>
                    <button
                      onClick={() => toggle(n)}
                      disabled={already}
                      title={already ? "Já anexado" : ""}
                      className={cn("w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0",
                        checked ? "bg-primary border-primary" : "bg-background border-border",
                        already && "opacity-40 cursor-not-allowed")}
                    >
                      {(checked || already) && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                    </button>
                    <button
                      onClick={() => n.kind === "folder" ? openFolder(n) : toggle(n)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    >
                      {n.kind === "folder"
                        ? <FolderIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        : <FileIcon className="w-3.5 h-3.5 text-primary shrink-0" />}
                      <span className="truncate text-[12px]">{n.name}</span>
                      {n.kind === "folder" && (
                        <ChevronDown className="w-3 h-3 -rotate-90 opacity-40 ml-auto" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="px-4 py-3 border-t border-border">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button size="sm" onClick={confirm} disabled={selected.size === 0}>
            Anexar {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    onChange(next, `[${now()}] "${title}" movido de ${fromT} para ${toT}`);
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
    onChange(next, old !== t ? `[${now()}] card renomeado "${old}" para "${t}"` : undefined);
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
    onChange(next, old !== t ? `[${now()}] coluna renomeada "${old}" para "${t}"` : undefined);
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
// QuickTaskDialog cria tarefa no Kanban do cliente via slash /tarefa
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
      dueISO && `Prazo ${dueISO}`,
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
                {projects.length === 0 && <option value="">sem projeto</option>}
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
                <option value="">ninguém</option>
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

function PersonaDialog({ open, onOpenChange, list, clientId, clientName, folderPath, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  list: { id: string; gpt_url: string | null; gpt_name: string | null; gpt_description?: string | null; client_id: string | null; folder_path: string | null }[];
  clientId: string | null;
  clientName: string | null;
  folderPath: string;
  onSaved: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  type Scope = "global" | "client" | "folder";
  const defaultScope: Scope = clientId ? (folderPath ? "folder" : "client") : "global";
  const [scope, setScope] = useState<Scope>(defaultScope);
  useEffect(() => { setScope(clientId ? (folderPath ? "folder" : "client") : "global"); }, [open, clientId, folderPath]);

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
      setUrl("");
      toast({ title: "Persona adicionada", description: d.name ? `"${d.name}" pronta pro roteador.` : "Persona salva." });
    } finally { setLoading(false); }
  }

  async function deleteOne(id: string, name: string | null) {
    setLoading(true);
    try {
      await supabase.functions.invoke("workspace-agent-import", { body: { delete_id: id } });
      await onSaved();
      toast({ title: "Persona removida", description: name || undefined });
    } finally { setLoading(false); }
  }

  const scopeText = (p: { client_id: string | null; folder_path: string | null }) =>
    p.folder_path ? `/${p.folder_path}` : p.client_id ? "cliente" : "global";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Bot className="w-4 h-4 text-primary" /> Personas do agente ({list.length})
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Adicione quantos Custom GPTs quiser. O <b>roteador interno</b> escolhe qual usar em cada mensagem, ou você trava manualmente pelo seletor no cabeçalho.
          </p>

          {/* Lista */}
          {list.length > 0 && (
            <div className="max-h-56 overflow-y-auto space-y-1.5 rounded-md border border-border bg-background/40 p-2">
              {list.map(p => (
                <div key={p.id} className="flex items-start gap-2 text-[11px] p-1.5 rounded hover:bg-secondary/40">
                  <span className="pt-0.5 text-primary/80">
                    {p.folder_path ? <FolderIcon className="w-3.5 h-3.5" /> : p.client_id ? <Bot className="w-3.5 h-3.5" /> : <GitBranch className="w-3.5 h-3.5" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground/90 truncate">{p.gpt_name || "Sem nome"}</div>
                    <div className="text-muted-foreground text-[10px] truncate">{scopeText(p)} · {p.gpt_description || p.gpt_url}</div>
                  </div>
                  <button onClick={() => deleteOne(p.id, p.gpt_name)}
                    disabled={loading}
                    className="text-[10px] text-destructive/70 hover:text-destructive px-1.5 py-0.5 rounded hover:bg-destructive/10">
                    Remover
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Nova */}
          <div className="space-y-2 pt-1 border-t border-border">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Adicionar nova persona</label>
            <div className="grid grid-cols-3 gap-1">
              {(["folder", "client", "global"] as Scope[]).map(s => {
                const disabled = (s !== "global" && !clientId) || (s === "folder" && !folderPath);
                return (
                  <button key={s} type="button" disabled={disabled} onClick={() => setScope(s)}
                    className={cn("text-[10px] px-2 py-1.5 rounded border transition",
                      scope === s ? "bg-primary text-primary-foreground border-primary" : "bg-secondary/40 border-border hover:bg-secondary",
                      disabled && "opacity-40 cursor-not-allowed")}>
                    {s === "folder" ? "Pasta" : s === "client" ? "Cliente" : "Global"}
                  </button>
                );
              })}
            </div>
            <Input value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://chatgpt.com/g/g-xxxxxxxx-nome-do-gpt" className="text-xs" />
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" onClick={importGpt} disabled={loading || !url}>
            {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Sparkles className="w-3 h-3 mr-1" />}
            Adicionar persona
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasteBackButton({ onPaste, disabled }: { onPaste: (text: string) => void | Promise<void>; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [txt, setTxt] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="p-1 rounded hover:bg-secondary text-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed"
        title="Colar resposta do ChatGPT">
        <ClipboardPaste className="w-3 h-3" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">Colar resposta do ChatGPT</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              Copie a resposta do seu GPT externo e cole abaixo. Ela entra na conversa como mensagem do agente e vira contexto para as próximas.
            </p>
            <textarea
              autoFocus
              value={txt}
              onChange={e => setTxt(e.target.value)}
              placeholder="Cole aqui..."
              className="w-full min-h-[220px] max-h-[50vh] rounded-md border border-border bg-background px-3 py-2 text-[12px] leading-relaxed resize-y"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button size="sm" disabled={!txt.trim() || busy} onClick={async () => {
              setBusy(true);
              try { await onPaste(txt); setTxt(""); setOpen(false); }
              finally { setBusy(false); }
            }}>
              {busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <ClipboardPaste className="w-3 h-3 mr-1" />}
              Importar para conversa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
