import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import AprendizadoDoAgente from "@/components/agentes/AprendizadoDoAgente";
import { acaoDoAnexo, type AcaoDoAgente, type PedidoDaAcao, type RespostaDaAcao } from "@/lib/agentes/acoesDoAgente";
import { esquecerRegraAprendida, guardarRegraAprendida } from "@/lib/agentes/aprendizadoDoLancador";
import { useQueryClient } from "@tanstack/react-query";

import {
  NotebookPen, Brain, Sparkles, ChevronDown, Minus, X, Plus,
  Trash2, GitBranch, ExternalLink, Copy, Wand2, FileText, Link2, MessageSquare,
  Bot, Send, Loader2, History, Paperclip, File as FileIcon, Folder as FolderIcon,
  Columns3, Pencil, GripVertical, Settings, Check, Minimize2, Maximize2, ClipboardPaste,
  Download, Radio, Zap, ArrowRight, ArrowLeft, Globe2, ChevronRight, RefreshCw, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { recordMemory } from "@/lib/clientMemory";
import { useIsMobile } from "@/hooks/use-mobile";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import aceleriqLogo from "@/assets/logo-aceleriq-640.png";
import { APP_PUBLIC_URL } from "@/lib/publicUrl";
import { imagemParaOcr, pareceImagem } from "@/lib/imagemParaOcr";
import { mensagemDaFuncao } from "@/lib/fileUrls";
import {
  AjudaRecolhida, SeletorCompacto, Secao, RegiaoRolavel, CampoDeFormulario, GrupoDeCampos, EstadoVazio, Carregando, EstadoDeErro,
  botao, campo, campoTexto, superficie, texto, etiqueta, foco, useEstadoDaTela, lerEstadoDaTela, gravarEstadoDaTela,
} from "@/components/sistema";
import { CabecalhoDoAgente, MensagensDoAgente, CompositorDoAgente } from "@/components/sistema/PainelDoAgente";
import { CaminhoDoTexto } from "@/components/agentes/CaminhoPronto";
// Núcleo comum dos agentes (09/10): a resposta gravada sai em balões, com quadros conferidos e fontes clicáveis.
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import { Ditado } from "@/components/mesa/Ditado";
import { NotesPreview } from "./NotesPreview";


/**
 * Studio flutuante: Contexto, Notas e GPT externo.
 * Persistência por contexto (scope + clientId + parentId) no localStorage.
 * Suporta @mention para vincular arquivos do view atual.
 */

const PREPRO_GPT = "https://chatgpt.com/g/g-6a4e9158529c8191a937cee536c18c9f-prepro-director-gpt";
const WORKSPACE_AGENT_URL = `${String(import.meta.env.VITE_SUPABASE_URL).replace(/\/$/, "")}/functions/v1/workspace-agent`;
const APP_PUBLIC_HOST = new URL(APP_PUBLIC_URL).hostname;

type FileRef = { id: string; name: string; kind: "file" | "folder"; url?: string | null; meta?: string | null };

type Mode = "context" | "notes" | "gpt";
const MODOS: Mode[] = ["context", "notes", "gpt"];


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
  // Modo interno e aba do editor no celular ficam lembrados (sair e voltar mantém).
  const [mode, setMode] = useEstadoDaTela<Mode>("workspace:estudio:modo", "context", {
    validar: (v) => typeof v === "string" && (MODOS as string[]).indexOf(v) >= 0,
  });
  const isMobile = useIsMobile();
  const [mobileNotesTab, setMobileNotesTab] = useEstadoDaTela<"editor" | "preview">("workspace:estudio:notas-aba", "editor", {
    validar: (v) => v === "editor" || v === "preview",
  });
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
  const [projects, setProjects] = useState<{ id: string; name: string; client_id?: string | null }[]>([]);
  const [projectClient, setProjectClient] = useState<{ id: string; name: string } | null>(null);
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
      let q = supabase.from("projects").select("id, name, client_id").order("created_at", { ascending: false }).limit(50);
      if (clientId) q = q.eq("client_id", clientId);
      const { data } = await q;
      if (!cancel) setProjects((data as any) || []);
    })();
    return () => { cancel = true; };
  }, [clientId]);

  // Resolve o cliente do projeto selecionado (usado quando o usuário está em
  // escopo "Global" mas escolhe um projeto: o agente precisa herdar o cliente).
  useEffect(() => {
    let cancel = false;
    if (!projectId) { setProjectClient(null); return; }
    const local = projects.find(p => p.id === projectId);
    (async () => {
      let cid = local?.client_id || null;
      if (!cid) {
        const { data } = await supabase.from("projects").select("client_id").eq("id", projectId).maybeSingle();
        cid = (data as any)?.client_id || null;
      }
      if (!cid) { if (!cancel) setProjectClient(null); return; }
      const { data: prof } = await supabase.from("profiles").select("id, full_name, company_name").eq("id", cid).maybeSingle();
      if (cancel) return;
      const name = (prof as any)?.company_name || (prof as any)?.full_name || "Cliente";
      setProjectClient({ id: cid, name });
    })();
    return () => { cancel = true; };
  }, [projectId, projects]);

  const effectiveClientId = clientId || projectClient?.id || null;
  const effectiveClientName = clientName || projectClient?.name || contextLabel;
  const activeProjectName = projects.find(p => p.id === projectId)?.name || null;
  const scopeChipLabel = activeProjectName
    ? `${projectClient?.name || clientName || contextLabel} › ${activeProjectName}`
    : contextLabel;


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
        const r = await fetch(WORKSPACE_AGENT_URL, {
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
        const r = await fetch(WORKSPACE_AGENT_URL, {
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

    // Publicar o documento entra na história do cliente.
    //
    // O Studio era uma ilha: escrevia contexto rico e nada disso chegava à
    // Central, ao ritual ou ao MCP. Um documento publicado é a decisão mais
    // deliberada que se toma aqui — é o que merece virar memória, e não cada
    // tecla digitada. O primeiro parágrafo vira o resumo lido pela IA.
    if (effectiveClientId) {
      const primeiraLinha = String(notesNow || "")
        .split("\n")
        .map((l) => l.replace(/^#+\s*/, "").trim())
        .find((l) => l.length > 3) || "Documento do Studio";
      await recordMemory({
        clientId: effectiveClientId,
        projectId: projectId || null,
        kind: "nota",
        title: next ? `Documento publicado: ${primeiraLinha.slice(0, 120)}` : `Documento despublicado: ${primeiraLinha.slice(0, 120)}`,
        content: String(notesNow || "").slice(0, 4000),
        source: "studio",
        tags: ["studio", "documento"],
        metadata: { published: next, project_id: projectId || null },
      });
    }

    toast({ title: next ? "Documento publicado" : "Publicação removida", description: next ? "O cliente já vê a versão ao vivo na aba Documento." : "O cliente não vê mais este documento." });
  }

  const [pdfPreview, setPdfPreview] = useState<string | null>(null);
  function downloadPDF() {
    const logoUrl = new URL(aceleriqLogo, window.location.origin).href;
    const html = renderBrandedDoc(state.notes || "(vazio)", clientName || "AcelerIQ", projects.find(p => p.id === projectId)?.name || contextLabel, logoUrl);
    setPdfPreview(html);
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
    // HEIC (foto de iPhone) vira JPG no navegador quando ele consegue abrir;
    // senão o erro já diz o que fazer, sem ida ao servidor.
    const dataUrl = await imagemParaOcr(file);
    const { data, error } = await supabase.functions.invoke("workspace-ocr", { body: { image: dataUrl } });
    // O motivo real vem no corpo da resposta (o SDK só diz "non-2xx").
    if (error) throw new Error(await mensagemDaFuncao(error, "OCR falhou"));
    if ((data as any)?.error) throw new Error(String((data as any).error));
    return (data as any)?.text || "";
  }

  async function handleImageFile(file: File) {
    if (!pareceImagem(file)) return;
    setOcrBusy(true);
    toast({ title: "Analisando imagem…", description: "Extraindo texto com o provedor de IA configurado." });
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
        type="button"
        onClick={() => { setOpen(true); setMinimized(false); }}
        className={cn(
          "fixed bottom-4 left-1/2 z-40 hidden h-10 -translate-x-1/2 items-center rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground shadow-lg transition-colors hover:bg-primary/90 md:flex",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
        title="Abrir o Studio"
        aria-label="Abrir o Studio"
      >
        <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" /> Studio
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
  // Sem min()/dvh em classe (Safari 11): altura relativa com teto em px dá o mesmo resultado.
  const dockSize = isFull
    ? ""
    : minimized
      ? "h-[52px] sm:w-[280px]"
      : dock === "bc"
        ? "h-[72vh] max-h-[620px] sm:w-[96vw] sm:max-w-[880px]"
        : "h-[78vh] max-h-[680px] sm:w-[96vw] sm:max-w-[480px]";

  const opcoesDeModo = [
    { valor: "context", rotulo: "Contexto", icone: isMobile ? undefined : <Brain className="h-3.5 w-3.5" /> },
    { valor: "notes", rotulo: "Notas", icone: isMobile ? undefined : <NotebookPen className="h-3.5 w-3.5" /> },
    { valor: "gpt", rotulo: "GPT", icone: isMobile ? undefined : <ExternalLink className="h-3.5 w-3.5" /> },
  ];
  const posicoesDeDock: Array<{ valor: "bl" | "bc" | "br"; rotulo: string; simbolo: string }> = [
    { valor: "bl", rotulo: "Encostar à esquerda", simbolo: "◧" },
    { valor: "bc", rotulo: "Centralizar embaixo", simbolo: "▬" },
    { valor: "br", rotulo: "Encostar à direita", simbolo: "◨" },
  ];
  const statusDaSincronia =
    docSyncing === "saving" ? "Salvando" : docSyncing === "saved" ? "Sincronizado" : docSyncing === "error" ? "Erro ao salvar" : "Sincronia automática";


  const comandosDasNotas = slashMenu?.where === "notes"
    ? buildSlashCommands({ clientName, folderPath, contextLabel }).filter(c => c.label.toLowerCase().includes(slashMenu.q.toLowerCase()) || c.key.includes(slashMenu.q.toLowerCase()))
    : [];
  const aoDigitarNasNotas = {
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => handleTextChange("notes", e.target.value, e.target.selectionStart),
    onKeyUp: (e: React.KeyboardEvent<HTMLTextAreaElement>) => handleTextChange("notes", (e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart),
    onClick: (e: React.MouseEvent<HTMLTextAreaElement>) => handleTextChange("notes", (e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart),
    onPaste: onNotesPaste,
  };
  const classeDoEditor = cn(
    "block h-full w-full min-w-0 resize-none rounded-md border border-input bg-background px-4 py-3 font-sans text-[14px] leading-[1.8] text-foreground placeholder:text-muted-foreground transition-colors",
    foco,
  );

  return (
    <div
      aria-label="Studio"
      className={cn(
        "fixed bg-card border-border shadow-2xl flex flex-col overflow-hidden transition-all",
        isMobile && isFull ? "z-[120]" : "z-40",
        isFull ? "rounded-none border-t" : "rounded-lg border",
        dockPos, dockSize
      )}
      style={
        isMobile && isFull
          ? {
              top: "calc(env(safe-area-inset-top) + 72px)",
              bottom: "calc(env(safe-area-inset-bottom) + 96px)",
            }
          : undefined
      }
    >
      {/* Cabeçalho fixo: nome e "?", os modos (3: segmentado), posição e minimizar. */}
      <div className="flex h-[52px] min-w-0 shrink-0 items-center border-b border-border px-2 sm:h-12 sm:px-3">
        {isMobile && !minimized ? (
          <button type="button" onClick={() => setOpen(false)} aria-label="Voltar" title="Voltar" className={cn(botao.icone, "-ml-1 mr-1 h-9 w-9 text-foreground")}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <span className="mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden="true">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
        )}
        <h2 className={cn("mr-1 shrink-0 text-[14px] font-semibold leading-5 text-foreground", isMobile && !minimized && "sr-only")}>Studio</h2>
        {!minimized && (
          <AjudaRecolhida rotulo="O que é o Studio" className="mr-2">
            Contexto: converse com o agente; as notas do projeto são a memória dele. Notas: o editor, com / para estruturar, @ para anexar arquivo, imagem colada vira texto e link de vídeo vira player. GPT: copia o contexto para o GPT externo e traz a resposta de volta.
          </AjudaRecolhida>
        )}
        <div className="flex min-w-0 flex-1 justify-center">
          {!minimized && (
            <SeletorCompacto
              opcoes={opcoesDeModo}
              valor={mode}
              onEscolher={(v) => setMode(v as Mode)}
              rotulo="Modo do Studio"
              modo="segmentado"
              larguraTotal={isMobile}
            />
          )}
        </div>
        <div className="ml-2 flex shrink-0 items-center">
          {!minimized && !isMobile && (
            <>
              <div role="group" aria-label="Posição do Studio" className="mr-1 inline-flex h-8 items-center rounded-md bg-muted p-0.5">
                {posicoesDeDock.map((p) => (
                  <button
                    key={p.valor}
                    type="button"
                    onClick={() => setDock(p.valor)}
                    aria-pressed={dock === p.valor}
                    aria-label={p.rotulo}
                    title={p.rotulo}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded text-[11px] transition-colors",
                      dock === p.valor ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      foco,
                    )}
                  >
                    <span aria-hidden="true">{p.simbolo}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setDock(isFull ? "bc" : "full")}
                aria-pressed={isFull}
                aria-label={isFull ? "Sair da tela cheia (Esc)" : "Tela cheia"}
                title={isFull ? "Sair da tela cheia (Esc)" : "Tela cheia"}
                className={cn(botao.icone, isFull && "bg-muted text-foreground")}
              >
                {isFull ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setMinimized(m => !m)}
            aria-label={minimized ? "Expandir" : "Minimizar"}
            title={minimized ? "Expandir" : "Minimizar"}
            className={cn(botao.icone, "h-9 w-9 sm:h-8 sm:w-8")}
          >
            {minimized ? <ChevronDown className="h-4 w-4 rotate-180" aria-hidden="true" /> : <Minus className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          {/* Linha de contexto: escopo, projeto vinculado e as ações do documento. Sem caixa dentro de caixa. */}
          <div className="flex min-w-0 shrink-0 flex-wrap items-center border-b border-border px-2 py-1 sm:px-3">
            <div className="mr-2 flex min-w-0 max-w-full items-center py-0.5">
              <Globe2 className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 truncate text-[12.5px] font-medium text-foreground sm:max-w-[300px]" title={scopeChipLabel}>
                {scopeChipLabel}
              </span>
              <button
                type="button"
                onClick={() => { try { window.dispatchEvent(new CustomEvent("studio:pull-context")); } catch {} toast({ title: "Contexto atualizado", description: "Recarreguei os dados do escopo." }); }}
                aria-label="Puxar contexto"
                title="Puxar contexto (recarregar os dados do escopo)"
                className={cn(botao.icone, "ml-1 h-7 w-7")}
              >
                <Brain className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={async () => {
                  const project = projects.find(p => p.id === projectId)?.name;
                  const payload = `${contextLabel}${project ? ` › ${project}` : ""}`;
                  try { await navigator.clipboard.writeText(payload); toast({ title: "Contexto copiado", description: payload }); } catch { /* ignore */ }
                }}
                aria-label="Copiar o caminho do contexto"
                title="Copiar o caminho do contexto para colar em outro lugar"
                className={cn(botao.icone, "h-7 w-7")}
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            <div className="relative mr-2 min-w-0 flex-1 py-0.5 sm:w-[220px] sm:flex-none">
              <FolderIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <select
                value={projectId ?? ""}
                onChange={e => setProjectId(e.target.value || null)}
                aria-label="Projeto vinculado"
                title="Vincule um projeto para publicar e espelhar ao cliente"
                className={cn(campo, "appearance-none truncate pl-8 pr-7")}
              >
                <option value="">Sem projeto</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            </div>

            {projectId && (
              <span
                className={cn("hidden h-7 w-5 shrink-0 items-center justify-center sm:flex",
                  docSyncing === "saving" && "text-amber-500",
                  docSyncing === "saved" && "text-primary",
                  docSyncing === "error" && "text-destructive",
                  docSyncing === "idle" && "text-muted-foreground")}
                title={statusDaSincronia}
                role="status"
              >
                <span className="sr-only">{statusDaSincronia}</span>
                {docSyncing === "saving" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                {docSyncing === "saved" && <Check className="h-3 w-3" aria-hidden="true" />}
                {docSyncing === "error" && <X className="h-3 w-3" aria-hidden="true" />}
              </span>
            )}

            <div className="ml-auto flex shrink-0 items-center py-0.5 [&>*+*]:ml-0.5">
              <button
                type="button"
                onClick={() => setAutoFix(v => !v)}
                aria-pressed={autoFix}
                aria-label={`Organizar sozinho: ${autoFix ? "ligado" : "desligado"}`}
                title={`Organizar sozinho ${autoFix ? "ligado" : "desligado"}`}
                className={cn(botao.icone, autoFix && "bg-primary/10 text-primary hover:text-primary")}
              >
                {reflowBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
              <button
                type="button"
                onClick={togglePublish}
                aria-pressed={docPublished}
                aria-label={docPublished ? "Publicado ao vivo (tirar a publicação)" : "Publicar para o cliente"}
                title={docPublished ? "Publicado ao vivo" : "Publicar para o cliente"}
                className={cn(botao.icone, docPublished && "bg-primary/10 text-primary hover:text-primary")}
              >
                <Radio className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button type="button" onClick={downloadPDF} aria-label="Exportar PDF" title="Exportar PDF" className={botao.icone}>
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

            {mode === "context" && (
              <div className="grid h-full min-h-0 lg:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)]">
                <section aria-label="Agente" className="min-h-0 min-w-0 overflow-hidden">
                  <AgentChat
                    clientId={effectiveClientId}
                    clientName={effectiveClientName}
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
                        const r = await fetch(WORKSPACE_AGENT_URL, {
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

                <aside aria-label="Notas do projeto" className="hidden min-h-0 min-w-0 flex-col overflow-hidden border-l border-border lg:flex">
                  <div className="flex min-w-0 shrink-0 items-center border-b border-border px-3 py-2">
                    <NotebookPen className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <h3 className="min-w-0 truncate text-[13px] font-semibold leading-5 text-foreground">Notas do projeto</h3>
                    <AjudaRecolhida rotulo="Sobre as notas do projeto" className="ml-1.5">
                      O agente usa este conteúdo como memória de trabalho. Use / para estruturar e @ para anexar arquivos.
                    </AjudaRecolhida>
                    <button type="button" onClick={() => setMode("notes")} className={cn(botao.discreto, "ml-auto h-8")}>
                      Abrir editor
                    </button>
                  </div>
                  <div className="relative min-h-0 flex-1 p-3">
                    <textarea
                      ref={notesRef}
                      value={state.notes}
                      {...aoDigitarNasNotas}
                      aria-label="Notas do projeto"
                      placeholder="Decisões, respostas e próximos passos."
                      className={cn(classeDoEditor, "min-h-[280px]")}
                    />
                    {mentionQuery?.where === "notes" && mentionMatches.length > 0 && <MentionList items={mentionMatches} onPick={insertMention} />}
                    {slashMenu?.where === "notes" && <SlashList items={comandosDasNotas} onPick={insertSlash} />}
                  </div>
                </aside>
              </div>
            )}
            {mode === "notes" && (
              <div className="flex h-full min-h-0 flex-col">
                <input ref={imageInputRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void handleImageFile(f); e.target.value = ""; }} />

                {isMobile && (
                  <div className="shrink-0 border-b border-border px-3 py-2">
                    <SeletorCompacto
                      opcoes={[{ valor: "editor", rotulo: "Notas" }, { valor: "preview", rotulo: "Preview" }]}
                      valor={mobileNotesTab}
                      onEscolher={(v) => setMobileNotesTab(v as "editor" | "preview")}
                      rotulo="Ver"
                      modo="segmentado"
                      larguraTotal
                    />
                  </div>
                )}

                <div className={cn(
                  "grid min-h-0 flex-1",
                  isMobile ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2"
                )}>
                  <section
                    aria-label="Notas de trabalho"
                    className={cn(
                      "flex min-h-0 min-w-0 flex-col overflow-hidden",
                      isMobile && mobileNotesTab !== "editor" && "hidden"
                    )}
                  >
                    <div className="flex min-w-0 shrink-0 items-center border-b border-border px-3 py-2">
                      <NotebookPen className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <h3 className="min-w-0 truncate text-[13px] font-semibold leading-5 text-foreground">Notas de trabalho</h3>
                      <AjudaRecolhida rotulo="Comandos das notas" className="ml-1.5">
                        / abre os comandos, @ anexa um arquivo da pasta, imagem colada vira texto e link de vídeo colado vira player.
                      </AjudaRecolhida>
                      {ocrBusy && (
                        <span className="ml-3 inline-flex shrink-0 items-center text-[12px] text-primary" role="status">
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" /> Lendo a imagem
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setState(s => ({ ...s, notes: (s.notes ? s.notes.replace(/\n?@help\n?/g, "") : "") + "\n@help\n" }))}
                        className={cn(botao.discreto, "ml-auto h-8")}
                        title="Mostrar o guia de comandos dentro da nota"
                      >
                        Guia
                      </button>
                    </div>
                    <div className="relative min-h-0 flex-1 p-3">
                      <textarea
                        ref={notesRef}
                        value={state.notes}
                        {...aoDigitarNasNotas}
                        aria-label="Notas de trabalho"
                        placeholder="Escreva ou cole o material aqui."
                        className={cn(classeDoEditor, "overflow-y-auto sm:min-h-[360px]")}
                      />
                      {mentionQuery?.where === "notes" && mentionMatches.length > 0 && (
                        <MentionList items={mentionMatches} onPick={insertMention} />
                      )}
                      {slashMenu?.where === "notes" && <SlashList items={comandosDasNotas} onPick={insertSlash} />}
                    </div>
                  </section>

                  <aside
                    aria-label="Documento estruturado"
                    className={cn(
                      "flex min-h-0 min-w-0 flex-col overflow-hidden md:border-l md:border-border",
                      isMobile && mobileNotesTab !== "preview" && "hidden"
                    )}
                  >
                    <div className="flex min-w-0 shrink-0 items-center border-b border-border px-3 py-2">
                      <FileText className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <h3 className="min-w-0 truncate text-[13px] font-semibold leading-5 text-foreground">Documento</h3>
                      <AjudaRecolhida rotulo="Sobre o documento" className="ml-1.5">
                        Preview das notas: marque as caixas, veja vídeos e o Kanban vivo. Publicado, é isto que o cliente vê na aba Documento.
                      </AjudaRecolhida>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
                      {state.notes.trim().length > 0 ? (
                        <NotesPreview
                          src={state.notes}
                          clientId={clientId ?? null}
                          clientName={clientName ?? null}
                          onChange={(next) => setState(s => ({ ...s, notes: next }))}
                        />
                      ) : (
                        <EstadoVazio compacto titulo="Nada para mostrar." descricao="O preview aparece conforme você escreve." />
                      )}
                    </div>

                    {!!state.mentions.length && (
                      <div className="flex shrink-0 flex-wrap border-t border-border px-3 pb-1 pt-2" aria-label="Arquivos citados">
                        {state.mentions.map(m => (
                          <button key={m.id} type="button" onClick={() => onOpenFile?.(m.id)}
                            className={cn(etiqueta, "mb-1 mr-1 max-w-full bg-primary/10 text-primary hover:bg-primary/20", foco)}>
                            <Link2 className="mr-1 h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                            <span className="truncate">{m.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {(enrichBusy || enrichData) && (
                      <div className="shrink-0 space-y-2 border-t border-border px-3 py-2.5">
                        <p className={cn(texto.rotulo, "flex items-center text-primary")}>
                          <Zap className="mr-1 h-3 w-3" aria-hidden="true" /> Sugestões do agente{enrichBusy && ": lendo"}
                        </p>
                        {enrichData?.suggestion && <p className="text-[12px] leading-5 text-foreground/85">{enrichData.suggestion}</p>}
                        <div className="-mb-1 flex flex-wrap">
                          {enrichData?.checklist?.length ? (
                            <button type="button" onClick={acceptEnrichChecklist} className={cn(botao.secundario, "mb-1 mr-1 h-8 text-[12px]")}>
                              Adicionar checklist ({enrichData.checklist.length})
                            </button>
                          ) : null}
                          {enrichData?.next_actions?.length ? (
                            <button type="button" onClick={acceptEnrichActions} className={cn(botao.secundario, "mb-1 mr-1 h-8 text-[12px]")}>
                              Adicionar ações ({enrichData.next_actions.length})
                            </button>
                          ) : null}
                          {enrichData && !enrichData.checklist?.length && !enrichData.next_actions?.length && (
                            <span className={cn(texto.auxiliar, "mb-1")}>Sem sugestões novas.</span>
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
      {pdfPreview && (
        <PdfPreviewModal html={pdfPreview} onClose={() => setPdfPreview(null)} />
      )}
    </div>
  );
}

function PdfPreviewModal({ html, onClose }: { html: string; onClose: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const doPrint = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try { win.focus(); win.print(); } catch {}
  };
  const doDownload = () => {
    // Download real (Blob → anchor). Funciona em mobile onde window.print() falha.
    try {
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `aceleriq-documento-${Date.now()}.html`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch {}
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    // Trava scroll do body enquanto o modal está aberto
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const content = (
    <div className="fixed inset-0 z-[200] flex flex-col bg-background" style={{
      paddingTop: "env(safe-area-inset-top)",
      paddingBottom: "env(safe-area-inset-bottom)",
    }}>
      <div className="flex h-14 min-w-0 shrink-0 items-center justify-between border-b border-border bg-card px-2 sm:px-3">
        <button type="button" onClick={onClose} className={cn(botao.discreto, "text-foreground")}>
          <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" /> Voltar
        </button>
        <h2 className="mx-2 hidden min-w-0 flex-1 truncate text-center text-[13px] font-semibold sm:block">Pré-visualização do PDF</h2>
        <div className="flex shrink-0 items-center [&>*+*]:ml-2">
          <button type="button" onClick={doDownload} className={botao.secundario}>
            <Download className="mr-1.5 h-4 w-4" aria-hidden="true" /> Salvar
          </button>
          <button type="button" onClick={doPrint} className={botao.primario}>
            <Download className="mr-1.5 h-4 w-4" aria-hidden="true" /> Imprimir
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden bg-neutral-200 dark:bg-neutral-900 flex justify-center p-0 sm:p-4">
        <iframe
          ref={iframeRef}
          srcDoc={html}
          title="PDF preview"
          className="w-full max-w-[820px] h-full bg-white border-0 shadow-2xl rounded-none sm:rounded-md"
        />
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}


// ── PDF branded AcelerIQ (via window.print) ──
function renderBrandedDoc(md: string, clientName: string, projectName: string, logoUrl?: string) {
  const html = mdToHtml(md);
  const date = new Date().toLocaleDateString("pt-BR");
  const time = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/>
<title>${escapeHtml(projectName)} · AcelerIQ</title>
<meta name="viewport" content="width=794, initial-scale=1, viewport-fit=cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 20mm 18mm 22mm 18mm; }
  @page :first { margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #ececec; color: #0D0D0D; font-family: 'Outfit', -apple-system, sans-serif; font-size: 12.5px; line-height: 1.6; }
  body { display: flex; flex-direction: column; align-items: center; padding: 12px 0; }

  /* Scrollbar minimalista */
  html { scrollbar-width: thin; scrollbar-color: #b4b4b4 transparent; }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #c4c4c4; border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
  ::-webkit-scrollbar-thumb:hover { background: #9a9a9a; background-clip: padding-box; }

  /* Folha A4 branca centralizada (preview) */
  .sheet {
    width: 210mm; min-height: 297mm; background: #fff;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05), 0 10px 30px rgba(0,0,0,0.10);
    margin: 0 auto 14px; padding: 20mm 18mm; overflow: hidden;
  }
  .sheet.cover { padding: 0; overflow: hidden; }

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

  .content { width: 100%; }

  @media print {
    html, body { background: #fff; padding: 0; display: block; }
    .sheet { width: auto; min-height: 0; box-shadow: none; margin: 0; padding: 0; overflow: visible; }
    .sheet.cover { padding: 0; }
  }

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

<section class="sheet cover">
  <div class="cover-page">
    <div>
      ${logoUrl
        ? `<img src="${escapeHtml(logoUrl)}" alt="AcelerIQ" style="height:72px;width:auto;display:block;margin-bottom:8px;" />`
        : `<div class="brand">aceler<span class="dot">iq</span></div>`}
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
  </div>
</section>

<section class="sheet">
  <div class="doc-header">
    ${logoUrl
      ? `<img src="${escapeHtml(logoUrl)}" alt="AcelerIQ" style="height:32px;width:auto;" />`
      : `<div class="brand">aceler<span class="dot">iq</span></div>`}
    <div class="crumbs">${escapeHtml(clientName)} · ${escapeHtml(projectName)} · ${date}</div>
  </div>

  <div class="content">
${html}
  </div>

  <div class="doc-footer"><span>${APP_PUBLIC_HOST}</span><span>Confidencial · ${date}</span></div>
</section>
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

function MentionList({ items, onPick }: { items: FileRef[]; onPick: (f: FileRef) => void }) {
  return (
    <div className="absolute bottom-2 left-2 right-2 z-10 max-h-[240px] overflow-y-auto overscroll-contain rounded-md border border-border bg-popover shadow-xl" aria-label="Arquivos para anexar">
      {items.map(f => (
        <button key={f.id} type="button" onClick={() => onPick(f)}
          className="flex w-full min-w-0 items-center px-3 py-1.5 text-left text-[12.5px] hover:bg-muted">
          <FileText className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 truncate">{f.name}</span>
        </button>
      ))}
    </div>
  );
}

function SlashList({ items, onPick }: { items: SlashCmd[]; onPick: (c: SlashCmd) => void }) {
  if (!items.length) return null;
  return (
    <div className="absolute bottom-2 left-2 right-2 z-10 max-h-[240px] overflow-y-auto overscroll-contain rounded-md border border-border bg-popover shadow-xl">
      <p className={cn(texto.rotulo, "border-b border-border px-3 py-1.5")}>Comandos</p>
      {items.map(c => (
        <button key={c.key} type="button" onClick={() => onPick(c)}
          className="flex w-full min-w-0 items-center px-3 py-1.5 text-left text-[12.5px] hover:bg-muted">
          <Sparkles className="mr-2 h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
          <span className="shrink-0 font-medium">{c.label}</span>
          <span className="ml-auto min-w-0 truncate pl-2 text-[11px] text-muted-foreground">{c.hint}</span>
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
type AgentMsg = {
  id: string; role: "user" | "assistant" | "system"; content: string; created_at: string;
  /** Frente AG3: anexos da resposta (cartão da ação no Workspace, "Aprendi" e "Segui"). */
  meta?: { anexos?: unknown[] } | null;
  /** A ação chegou feita agora (execução direta): o cartão pode ir sozinho. */
  recemFeita?: boolean;
};

/** Frente AG3: as ações do agente do Workspace guardadas na mensagem. */
function acoesDaMensagemDoWorkspace(m: AgentMsg): AcaoDoAgente[] {
  const anexos = m.meta && Array.isArray(m.meta.anexos) ? m.meta.anexos : [];
  return anexos.map(acaoDoAnexo).filter((a): a is AcaoDoAgente => !!a);
}

/** Frente AG3: Confirmar, Cancelar, Parar e Desfazer do cartão do Workspace (a função confere o dono da conversa). */
async function pedidoDaAcaoDoWorkspace(mensagemId: string, acaoId: string, pedido: PedidoDaAcao): Promise<RespostaDaAcao> {
  const corpo: Record<string, unknown> = { acao: pedido === "desfazer" ? "desfazer_acao_agente" : "executar_acao_agente", mensagem_id: mensagemId, acao_id: acaoId };
  if (pedido === "descartar") corpo.descartar = true;
  if (pedido === "parar") corpo.parar = true;
  const { data, error } = await supabase.functions.invoke("workspace-agent", { body: corpo });
  if (error) {
    let mensagem = "";
    try {
      const ctx = (error as { context?: { clone?: () => Response } }).context;
      const j = ctx && typeof ctx.clone === "function" ? await ctx.clone().json() : null;
      mensagem = j && typeof j.mensagem === "string" ? j.mensagem : "";
    } catch { mensagem = ""; }
    throw new Error(mensagem || "Não foi possível agora. Tente de novo.");
  }
  const d = (data || {}) as RespostaDaAcao & { error?: string; mensagem?: string };
  if (d.error) throw new Error(d.mensagem || "Não foi possível agora. Tente de novo.");
  return d;
}

function GroupedThreadList({
  threads, activeId, currentClientId, currentFolderPath, clientNameMap, onSelect, onDelete,
}: {
  threads: AgentThread[];
  activeId: string | null;
  currentClientId: string | null;
  currentFolderPath: string | null;
  clientNameMap: Record<string, string>;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  // Estado de colapso persistente por (cliente, pasta)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("studio:threadGroups") || "{}"); } catch { return {}; }
  });
  const persist = (next: Record<string, boolean>) => {
    setCollapsed(next);
    try { localStorage.setItem("studio:threadGroups", JSON.stringify(next)); } catch {}
  };
  const toggle = (k: string) => persist({ ...collapsed, [k]: !collapsed[k] });

  // Agrupa: cliente → pasta/projeto
  const byClient = new Map<string, { name: string; folders: Map<string, AgentThread[]> }>();
  for (const t of threads) {
    const cid = t.client_id || "_global";
    const cname = t.client_id ? (clientNameMap[t.client_id] || "Cliente") : "Global";
    if (!byClient.has(cid)) byClient.set(cid, { name: cname, folders: new Map() });
    const bucket = byClient.get(cid)!;
    const fkey = t.folder_path || "_root";
    if (!bucket.folders.has(fkey)) bucket.folders.set(fkey, []);
    bucket.folders.get(fkey)!.push(t);
  }
  // Cliente atual primeiro
  const orderedClients = Array.from(byClient.entries()).sort(([a], [b]) => {
    if (a === (currentClientId || "_global")) return -1;
    if (b === (currentClientId || "_global")) return 1;
    return byClient.get(a)!.name.localeCompare(byClient.get(b)!.name);
  });

  if (!threads.length) {
    return (
      <div className="min-h-0 flex-1 p-2">
        <EstadoVazio compacto titulo="Nenhuma conversa ainda." />
      </div>
    );
  }

  return (
    <RegiaoRolavel modo="sempre" sobre="cartao" rotulo="Lista de conversas" memoria="workspace:estudio:conversas">
      {orderedClients.map(([cid, group]) => {
        const clientKey = `c:${cid}`;
        const clientCollapsed = collapsed[clientKey] === true;
        const totalInClient = Array.from(group.folders.values()).reduce((n, arr) => n + arr.length, 0);
        return (
          <div key={cid} className="border-b border-border last:border-b-0">
            <button
              type="button"
              onClick={() => toggle(clientKey)}
              aria-expanded={!clientCollapsed}
              className={cn("flex w-full min-w-0 items-center px-2 py-1.5 text-left hover:bg-muted", foco)}>
              <ChevronRight className={cn("mr-1.5 h-3 w-3 shrink-0 text-muted-foreground transition-transform", !clientCollapsed && "rotate-90")} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">{group.name}</span>
              <span className="ml-1.5 shrink-0 text-[11px] tabular-nums text-muted-foreground">{totalInClient}</span>
            </button>
            {!clientCollapsed && Array.from(group.folders.entries())
              .sort(([a], [b]) => (a === "_root" ? -1 : b === "_root" ? 1 : a.localeCompare(b)))
              .map(([fkey, list]) => {
                const folderKey = `f:${cid}:${fkey}`;
                const folderCollapsed = collapsed[folderKey] === true;
                const label = fkey === "_root" ? "Geral" : `/${fkey}`;
                return (
                  <div key={fkey}>
                    <button
                      type="button"
                      onClick={() => toggle(folderKey)}
                      aria-expanded={!folderCollapsed}
                      className={cn("flex w-full min-w-0 items-center py-1 pl-4 pr-2 text-left hover:bg-muted", foco)}>
                      <ChevronRight className={cn("mr-1.5 h-3 w-3 shrink-0 text-muted-foreground transition-transform", !folderCollapsed && "rotate-90")} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">{label}</span>
                      <span className="ml-1.5 shrink-0 text-[11px] tabular-nums text-muted-foreground">{list.length}</span>
                    </button>
                    {!folderCollapsed && list.map(t => (
                      <div key={t.id}
                        className={cn("group flex min-w-0 items-center border-l-2 py-1 pl-7 pr-1 hover:bg-muted",
                          activeId === t.id ? "border-primary bg-muted" : "border-transparent")}>
                        <button
                          type="button"
                          onClick={() => onSelect(t.id)}
                          aria-current={activeId === t.id ? "true" : undefined}
                          className={cn("flex min-w-0 flex-1 items-center rounded-sm py-0.5 text-left", foco)}
                        >
                          <MessageSquare className="mr-1.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate text-[12px]">{t.title}</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onDelete(t.id); }}
                          aria-label={`Apagar a conversa ${t.title}`}
                          title="Apagar a conversa"
                          className={cn("ml-1 shrink-0 rounded p-1 text-muted-foreground hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100", foco)}>
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
          </div>
        );
      })}
    </RegiaoRolavel>
  );
}


function GptPanel({ clientName, folderPath, availableFiles, notes, script, onAppendToNotes }: {
  clientName: string | null;
  folderPath: string;
  availableFiles: FileRef[];
  notes: string;
  script: string;
  onAppendToNotes: (text: string) => void;
}) {
  const { toast } = useToast();
  // Rascunho da resposta colada: sair e voltar mantém.
  const [pasted, setPasted] = useEstadoDaTela<string>("workspace:estudio:gpt-retorno", "", { validar: (v) => typeof v === "string" });

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
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 sm:py-4">
      <Secao
        titulo="GPT externo"
        descricao={<span className="block truncate">{clientName || "Contexto global"} · /{folderPath || "raiz"}</span>}
        ajuda="Copia o contexto do Studio (notas, roteiro e arquivos da pasta) e abre o Prepro Director GPT. Cole a resposta dele abaixo para mandar às Notas."
        acao={
          <>
            <button type="button" onClick={copyContext} className={cn(botao.secundario, "h-8")} title="Copiar contexto para usar no GPT">
              <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Copiar
            </button>
            <button type="button" onClick={openGpt} className={cn(botao.primario, "h-8")} title="Abrir o GPT externo com o contexto copiado">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Abrir GPT
            </button>
          </>
        }
      >
        {/* Uma rolagem só (a do modo GPT): o contexto não rola por dentro. Nasce recolhido
            (o "Copiar" já leva tudo) para a resposta do GPT ficar à vista; a setinha mostra. */}
        <Secao
          titulo="Contexto preparado"
          nivel={3}
          recolhidaDeInicio
          resumo={`${availableFiles.length} ${availableFiles.length === 1 ? "arquivo" : "arquivos"}${notes?.trim() ? " · notas" : ""}${script?.trim() ? " · roteiro" : ""}`}
        >
          <pre className={cn(superficie.poco, "whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-foreground/80")}>
            {contextText}
          </pre>
        </Secao>
      </Secao>

      <Secao divisoria className="mt-5" titulo="Retorno do GPT" nivel={3}>
        <CampoDeFormulario rotulo="Resposta do GPT" apoio="Vai para o fim das Notas.">
          <textarea
            value={pasted}
            onChange={e => setPasted(e.target.value)}
            placeholder="Cole aqui a resposta do GPT externo."
            className={cn(campoTexto, "min-h-[180px] resize-y")}
          />
        </CampoDeFormulario>
        <div className="mt-3 flex items-center justify-end [&>*+*]:ml-2">
          <button
            type="button"
            onClick={() => setPasted("")}
            disabled={!pasted.trim()}
            className={botao.discreto}
          >
            Limpar
          </button>
          <button
            type="button"
            onClick={() => {
              if (!pasted.trim()) return;
              onAppendToNotes(pasted);
              setPasted("");
              toast({ title: "Enviado para Notas", description: "Resposta adicionada ao documento." });
            }}
            disabled={!pasted.trim()}
            className={botao.primario}
          >
            <ArrowRight className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Enviar para Notas
          </button>
        </div>
      </Secao>
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
  // Rascunho do campo, por cliente: sair e voltar (ou minimizar o Studio) mantém o texto.
  const [input, setInput] = useEstadoDaTela<string>(`workspace:estudio:rascunho:${clientId || "global"}`, "", { validar: (v) => typeof v === "string" });
  const [streaming, setStreaming] = useState(false);
  // Conversa lida (esqueleto só na primeira carga de cada conversa) e erro de leitura.
  const [carregadoPara, setCarregadoPara] = useState<string | null>(null);
  const [erroMsgs, setErroMsgs] = useState(false);
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
  // Modal iframe para abrir links dentro do chat (sem sair da conversa)
  const [linkPreview, setLinkPreview] = useState<string | null>(null);
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
  const [clientNameMap, setClientNameMap] = useState<Record<string, string>>({});
  useEffect(() => { void loadThreads(); }, [clientId, folderPath, threadScope]);
  async function loadThreads() {
    // Carrega TODAS as conversas visíveis (staff enxerga tudo por RLS) para
    // que o painel lateral consiga agrupar por cliente e projeto/pasta.
    // Frente AG3: só as conversas de quem está logado. Antes vinham as dos colegas (RLS de staff) e
    // enviar numa delas dava "Thread inválida" e a mensagem sumia.
    const { data: sessaoAtual } = await supabase.auth.getSession();
    const uid = sessaoAtual.session?.user?.id;
    if (!uid) return;
    const { data } = await supabase.from("workspace_agent_threads")
      .select("id,title,updated_at,client_id,folder_path")
      .eq("user_id", uid)
      .order("updated_at", { ascending: false })
      .limit(200);
    const list = (data as AgentThread[]) || [];
    setThreads(list);
    // Resolve nomes de cliente para os agrupadores
    const cids = Array.from(new Set(list.map(t => t.client_id).filter(Boolean))) as string[];
    if (cids.length) {
      const { data: profs } = await supabase.from("profiles")
        .select("id,full_name,company_name").in("id", cids);
      const map: Record<string, string> = {};
      (profs || []).forEach((p: any) => { map[p.id] = p.company_name || p.full_name || "Cliente"; });
      setClientNameMap(map);
    }
    // Restaura a última thread do escopo atual, se possível.
    const scoped = list.filter(t => (clientId ? t.client_id === clientId : !t.client_id));
    if (!scoped.length && !list.length) { setActiveId(null); return; }
    let restored: string | null = null;
    try { restored = localStorage.getItem(lastThreadKey(clientId, folderPath, threadScope)); } catch {}
    // Fora do escopo aberto não restaura conversa de outro cliente (antes caía em list[0]).
    const preferred = (restored && scoped.find(t => t.id === restored)?.id) || scoped[0]?.id || null;
    setActiveId(preferred);
  }

  // Busca nas conversas (09/10): o título filtra na hora; com 3+ letras, o texto das mensagens também
  // (uma leitura em workspace_agent_messages só das conversas desta pessoa, com espera curta).
  const [buscaNasConversas, setBuscaNasConversas] = useState("");
  const [achadosNoTexto, setAchadosNoTexto] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const termo = buscaNasConversas.trim();
    if (termo.length < 3 || !threads.length) { setAchadosNoTexto(new Set()); return; }
    let vivo = true;
    const espera = window.setTimeout(async () => {
      const { data, error } = await supabase.from("workspace_agent_messages")
        .select("thread_id")
        .in("thread_id", threads.map((t) => t.id))
        .ilike("content", `%${termo.replace(/[%_]/g, " ")}%`)
        .limit(300);
      if (!vivo || error) return;
      setAchadosNoTexto(new Set(((data || []) as { thread_id: string }[]).map((r) => r.thread_id)));
    }, 300);
    return () => { vivo = false; window.clearTimeout(espera); };
  }, [buscaNasConversas, threads]);
  const threadsVisiveis = useMemo(() => {
    const termo = buscaNasConversas.trim().toLowerCase();
    if (termo.length < 2) return threads;
    return threads.filter((t) => (t.title || "").toLowerCase().includes(termo) || achadosNoTexto.has(t.id));
  }, [threads, buscaNasConversas, achadosNoTexto]);

  // Persiste a última thread ativa por (escopo, cliente, pasta) para restaurar ao reabrir
  useEffect(() => {
    if (!activeId) return;
    try { localStorage.setItem(lastThreadKey(clientId, folderPath, threadScope), activeId); } catch {}
  }, [activeId, clientId, folderPath, threadScope]);



  // Frente AG3: conversaAtiva (logo abaixo, a da rolagem) diz a conversa aberta agora: a resposta que chega
  // tarde não cai na conversa errada.
  const qcDoWorkspace = useQueryClient();
  // Depois de organizar pelo agente, a árvore do Workspace relê (mesmas chaves da página).
  const recarregarWorkspace = () => {
    for (const k of ["workspace-nodes", "workspace-index", "workspace-client-files"]) void qcDoWorkspace.invalidateQueries({ queryKey: [k] });
  };
  useEffect(() => { if (activeId) void loadMsgs(activeId); else setMsgs([]); }, [activeId]);
  async function loadMsgs(id: string) {
    setErroMsgs(false);
    const { data, error } = await supabase.from("workspace_agent_messages")
      .select("id,role,content,created_at,meta").eq("thread_id", id).order("created_at", { ascending: true });
    // Leitura lenta de outra conversa não sobrescreve a que está aberta.
    if (conversaAtiva.current !== id) return;
    if (error) setErroMsgs(true);
    restaurarRolagem.current = id;
    setMsgs((data as AgentMsg[]) || []);
    setCarregadoPara(id);
  }
  /** Depois do stream: troca o texto cru pelo gravado (conferido), sem mexer na rolagem nem mostrar erro. */
  async function relerConversaGravada(id: string) {
    const { data, error } = await supabase.from("workspace_agent_messages")
      .select("id,role,content,created_at,meta").eq("thread_id", id).order("created_at", { ascending: true });
    if (error || !data || conversaAtiva.current !== id) return;
    const lista = data as AgentMsg[];
    // Só troca quando a resposta já está gravada (senão fica a da tela).
    if (!lista.length || lista[lista.length - 1].role !== "assistant") return;
    setMsgs(lista);
  }

  // Rolagem com memória por conversa: ao abrir uma conversa volta onde parou;
  // mensagem nova só desce até o fim se a pessoa já estava no fim.
  const coladoNoFim = useRef(true);
  const restaurarRolagem = useRef<string | null>(null);
  const conversaAtiva = useRef<string | null>(activeId);
  conversaAtiva.current = activeId;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const id = restaurarRolagem.current;
    if (id) {
      restaurarRolagem.current = null;
      coladoNoFim.current = true;
      const pos = lerEstadoDaTela<number | null>(`workspace:estudio:rolagem:${id}`, null, (v) => typeof v === "number" && v >= 0);
      if (pos !== null && pos + el.clientHeight < el.scrollHeight - 24) {
        el.scrollTop = pos;
        coladoNoFim.current = false;
        return;
      }
    }
    if (coladoNoFim.current) el.scrollTop = el.scrollHeight;
  }, [msgs, streamBuf]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let espera: number | null = null;
    const aoRolar = () => {
      coladoNoFim.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
      const id = conversaAtiva.current;
      if (!id) return;
      const pos = Math.round(el.scrollTop);
      if (espera !== null) window.clearTimeout(espera);
      espera = window.setTimeout(() => {
        espera = null;
        gravarEstadoDaTela(`workspace:estudio:rolagem:${id}`, pos);
      }, 250);
    };
    el.addEventListener("scroll", aoRolar, { passive: true } as AddEventListenerOptions);
    return () => {
      el.removeEventListener("scroll", aoRolar);
      if (espera !== null) window.clearTimeout(espera);
    };
  }, []);

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
    // Frente AG3: apagar a conversa leva as mensagens junto: confirma e confere se apagou de verdade.
    if (typeof window !== "undefined" && !window.confirm("Apagar esta conversa e todas as mensagens dela?")) return;
    const { data, error } = await supabase.from("workspace_agent_threads").delete().eq("id", id).select("id");
    if (error || !data || !data.length) {
      toast({ title: "Conversa não apagada", description: error?.message || "Você não tem permissão para apagar esta conversa.", variant: "destructive" });
      return;
    }
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
          chunks.push(`## Projetos do cliente (${projects.length})\n${projects.map(p => `- ${p.name} · ${p.status || "-"} · ${p.progress ?? 0}% · ${p.brand || "-"}${p.deadline ? ` · prazo ${p.deadline}` : ""}${p.description ? ` · ${String(p.description).slice(0, 140)}` : ""}`).join("\n")}`);
          const ids = projectId ? [projectId] : projects.map(p => p.id);
          const [taskRes, milRes] = await Promise.all([
            supabase.from("tasks").select("title,status,priority,due_date,description,project_id").in("project_id", ids).order("updated_at", { ascending: false }).limit(80),
            supabase.from("milestones").select("title,status,target_date,description,project_id").in("project_id", ids).order("milestone_order", { ascending: true }).limit(40),
          ]);
          const tasks = (taskRes.data as any[]) || [];
          stats.tasks = tasks.length;
          const opened = tasks.filter(t => t.status !== "done" && t.status !== "concluido").slice(0, 25);
          if (opened.length) chunks.push(`## Tarefas abertas (${opened.length})\n${opened.map(t => `- [${t.status || "-"}${t.priority ? "/" + t.priority : ""}] ${t.title}${t.due_date ? ` · vence ${t.due_date}` : ""}${t.description ? ` · ${String(t.description).slice(0, 120)}` : ""}`).join("\n")}`);
          const mils = (milRes.data as any[]) || [];
          if (mils.length) chunks.push(`## Marcos do projeto\n${mils.map(m => `- [${m.status || "-"}] ${m.title}${m.target_date ? ` · ${m.target_date}` : ""}${m.description ? ` · ${String(m.description).slice(0, 120)}` : ""}`).join("\n")}`);
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
        if (reports.length) chunks.push(`## Relatórios e aprendizados\n${reports.map(r => `- ${r.title || "Relatório"} · ${r.status || "-"}${r.period_start ? ` · ${r.period_start} a ${r.period_end || "-"}` : ""}${r.summary ? ` · ${String(r.summary).slice(0, 180)}` : ""}${r.next_steps ? ` · próximos: ${String(r.next_steps).slice(0, 140)}` : ""}`).join("\n")}`);
        const updates = (updateRes.data as any[]) || [];
        if (updates.length) chunks.push(`## Atualizações recentes do projeto\n${updates.map(u => `- ${u.created_at?.slice(0, 10) || ""} · ${u.update_type || "update"}: ${u.message}`).join("\n")}`);
        const doc = docRes.data as any;
        if (doc?.notes) chunks.push(`## Notas publicadas/Studio do projeto\n${String(doc.notes).slice(0, 3000)}`);
        const vault = (vaultRes.data as any[]) || [];
        if (vault.length) chunks.push(`## Links e sistemas do cliente\n${vault.map(v => `- ${v.category || "item"}: ${v.title}${v.url ? ` · ${v.url}` : ""}${v.username ? ` · usuário: ${v.username}` : ""}${v.notes ? ` · ${String(v.notes).slice(0, 100)}` : ""}`).join("\n")}`);
        setContextStats(stats);
        if (!systemFiles.length && !workspaceNodes.length) {
          chunks.push("## Observação de contexto\nNenhum arquivo foi encontrado para este cliente/projeto nas bases de arquivos do sistema e do Workspace.");
        }
        const contracts = (contractRes.data as any[]) || [];
        if (contracts.length) chunks.push(`## Contratos\n${contracts.map(c => `- ${c.title || c.original_file_name || "Contrato"} · ${c.status || "-"}${c.description ? ` · ${String(c.description).slice(0, 120)}` : ""}`).join("\n")}`);
      }
      if (folderId) {
        const { data: nodes } = await supabase.from("workspace_nodes").select("name,kind,mime").eq("parent_id", folderId).limit(60);
        if (nodes?.length) chunks.push(`## Pasta aberta agora /${folderPath}\n${nodes.map((n: any) => `- ${n.kind === "folder" ? "Pasta" : "Arquivo"}: ${n.name}${n.mime ? ` (${n.mime})` : ""}`).join("\n")}`);
      }
      if (notes?.trim()) chunks.push(`## Notas em construção\n${notes.slice(0, 2000)}`);
      if (script?.trim()) chunks.push(`## Roteiro em construção\n${script.slice(0, 2000)}`);

      const dossier = chunks.join("\n\n") || "(sem dados disponíveis para este escopo)";
      const clientLabel = clientName || "cliente atual";
      const projectLabel = projectId ? "o projeto selecionado" : "o cliente como um todo";
      const scopeSummary = [
        stats.projects ? `${stats.projects} projeto(s)` : null,
        stats.tasks ? `${stats.tasks} tarefa(s)` : null,
        stats.systemFiles ? `${stats.systemFiles} arquivo(s) no sistema` : null,
        stats.workspaceFiles ? `${stats.workspaceFiles} arquivo(s) no workspace` : null,
      ].filter(Boolean).join(" · ") || "base ainda enxuta";
      const prompt = [
        `[MODO ORQUESTRADOR AUTÔNOMO · ${clientLabel}]`,
        `Você é o Diretor de Pré-Produção da AcelerIQ operando sobre ${projectLabel}. Você acabou de ler o dossiê completo (${scopeSummary}). Assuma o comando como se fosse a primeira reunião de kickoff interno da conta.`,
        "",
        "PRINCÍPIOS:",
        `- Fale sempre nomeando ${clientLabel}, o(s) projeto(s), tarefas, briefing, arquivos e datas reais que estão no dossiê. Nunca use frases genéricas do tipo "o cliente" ou "o projeto".`,
        "- Cite pelo nome ao menos 3 evidências concretas do dossiê (arquivo, tarefa, item do briefing, marco, valor do plano, prazo).",
        "- Se algo estiver ausente ou inconsistente, aponte com clareza · não invente.",
        "- Se o pedido pedir dados atuais (mercado, concorrência, notícia, benchmark), diga explicitamente o que buscaria na web e prossiga com a análise do que tem em mãos.",
        "",
        "FORMATO (Markdown limpo, uma ideia por linha, sem emoji, sem asterisco decorativo):",
        "",
        `## Leitura do momento · ${clientLabel}`,
        "2 a 4 linhas descrevendo onde a conta está agora, com base em plano, status de projetos, briefing e últimos entregáveis.",
        "",
        "## Sinais fortes",
        "- 3 pontos objetivos do que já está bom (com nome do arquivo/tarefa/entrega que sustenta cada ponto).",
        "",
        "## Riscos e lacunas",
        "- 3 a 5 pontos do que trava o próximo entregável (tarefas paradas, briefing incompleto, arquivos sem aprovação, prazos vencendo). Nomeie cada evidência.",
        "",
        "## Próximo entregável",
        "1 linha nomeando o artefato mais valioso agora (ex.: 'Roteiro do Reels de lançamento X', 'Storyboard do carrossel Y', 'Briefing revisado do projeto Z').",
        "",
        "## Perguntas para destravar",
        "3 a 5 perguntas numeradas, específicas ao contexto, uma frase cada. Nada genérico.",
        "",
        "A cada resposta minha, avance o plano mantendo esse padrão vivo e adaptado à conta.",
        "",
        "----- DOSSIÊ REAL -----",
        dossier,
      ].join("\n");
      await send(prompt, { displayText: `Analisar contexto completo · ${clientLabel}` });



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
    // Frente AG3: só depois de ler ESTA conversa, sem erro (antes disparava em conversa existente ainda carregando).
    if (carregadoPara !== activeId || erroMsgs) return;
    if (msgs.length > 0) return;
    const key = `studio:autoPulled:${clientId}:${threadScope}:${folderPath || "_root"}:${activeId}`;
    try { if (localStorage.getItem(key)) return; } catch {}
    if (autoPulledRef.current.has(activeId)) return;
    autoPulledRef.current.add(activeId);
    try { localStorage.setItem(key, "1"); } catch {}
    void pullDeepContext({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, activeId, msgs.length, folderPath, threadScope, carregadoPara, erroMsgs]);




  async function send(override?: string, options?: { displayText?: string }) {
    const text = (override ?? input).trim();
    if (!text || streaming) return;

    // ─── Comandos rápidos locais ───
    // /abrir <url>   → abre modal iframe (não envia para o agente)
    // /anexar        → abre o picker de arquivos
    // /web <query>   → segue para o agente (backend força busca)
    const mAbrir = text.match(/^\/abrir\s+(https?:\/\/\S+)/i);
    if (mAbrir) { setLinkPreview(mAbrir[1]); setInput(""); return; }
    if (/^\/anexar\b/i.test(text)) { setPickerOpen(true); setInput(""); return; }


    let tid = activeId;
    if (!tid) {
      const { data: sess } = await supabase.auth.getUser();
      if (!sess.user) return;
      const { data } = await supabase.from("workspace_agent_threads")
        .insert({ user_id: sess.user.id, client_id: clientId, folder_path: folderPath || null, title: (options?.displayText?.trim() || text).slice(0, 60) })
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
    coladoNoFim.current = true;
    setMsgs(m => [...m, { id: crypto.randomUUID(), role: "user", content: visibleText, created_at: new Date().toISOString() }]);
    setStreaming(true); setStreamBuf("");
    // Frente AG3: o que chegou do stream (para não sumir se cair no meio) e se a conversa ainda é esta.
    let parcial = "";
    const naMesmaConversa = () => conversaAtiva.current === tid;

    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch(WORKSPACE_AGENT_URL, {
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
      // Frente AG3: pedido de organizar o Workspace volta em JSON, com o cartão da ação (e o que ele aprendeu).
      if (res.ok && (res.headers.get("content-type") || "").includes("application/json")) {
        const d = await res.json().catch(() => ({})) as { resposta?: string; acao?: unknown; aprendizado?: unknown[]; mensagem_id?: string | null; aviso?: string | null };
        const acao = acaoDoAnexo(d.acao);
        if (naMesmaConversa()) {
          setMsgs(m => [...m, {
            id: d.mensagem_id || crypto.randomUUID(), role: "assistant", content: String(d.resposta || ""), created_at: new Date().toISOString(),
            meta: { anexos: [...(acao && d.mensagem_id ? [acao] : []), ...(Array.isArray(d.aprendizado) ? d.aprendizado : [])] }, recemFeita: true,
          }]);
        }
        if (d.aviso) toast({ title: "Feito, sem Desfazer", description: d.aviso, variant: "destructive" });
        void loadThreads();
        return;
      }
      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => "");
        let msg = t || `HTTP ${res.status}`;
        try {
          const j = JSON.parse(t);
          if (j?.error === "PAYMENT_REQUIRED" || res.status === 402) {
            msg = j?.message || "O provedor de IA recusou a solicitação por limite de uso. Verifique a configuração da conta.";
          } else if (j?.error === "RATE_LIMITED" || res.status === 429) {
            msg = j?.message || "Muitas requisições. Tente novamente em instantes.";
          } else if (j?.message || j?.error) {
            msg = j.message || j.error;
          }
        } catch { /* not json */ }
        throw new Error(msg);
      }
      let aprendizadoDoCabecalho: unknown[] = [];
      try {
        const bruto = res.headers.get("X-Aprendizado");
        if (bruto) { const lido = JSON.parse(decodeURIComponent(bruto)); if (Array.isArray(lido)) aprendizadoDoCabecalho = lido; }
      } catch { /* sem aprendizado */ }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        full += chunk;
        parcial = full;
        if (naMesmaConversa()) setStreamBuf(full);
      }
      parcial = "";
      if (naMesmaConversa()) {
        setMsgs(m => [...m, { id: crypto.randomUUID(), role: "assistant", content: full, created_at: new Date().toISOString(), meta: aprendizadoDoCabecalho.length ? { anexos: aprendizadoDoCabecalho } : null }]);
      }
      setStreamBuf("");
      void loadThreads();
      // Núcleo comum: o servidor grava a versão conferida (quadros que bateram com o OS, pedido ao Hermes);
      // o stream mostrou o texto cru, então a conversa relê o que ficou gravado.
      if (naMesmaConversa()) void relerConversaGravada(tid);
    } catch (e: any) {
      // Frente AG3: nada some. O que o agente já tinha escrito fica na conversa, e o texto e os anexos
      // voltam para o campo quando nada chegou (dá para mandar de novo sem redigitar).
      if (parcial.trim() && naMesmaConversa()) {
        setMsgs(m => [...m, { id: crypto.randomUUID(), role: "assistant", content: `${parcial}\n\n_(resposta interrompida)_`, created_at: new Date().toISOString() }]);
      } else {
        setInput(atual => atual || text);
        setAttached(atual => (atual.length ? atual : currentAttachments));
      }
      setStreamBuf("");
      toast({ title: "Falha no agente", description: e?.message?.slice(0, 200), variant: "destructive" });
    } finally { setStreaming(false); }
  }

  async function abrirGptExterno() {
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
  }

  // Empacota a conversa inteira (mensagens, anexos, mídia, kanban, links e timeline) e manda para as Notas.
  async function enviarConversaParaNotas() {
    if (!onStructureToNotes) return;
    if (!msgs.length) { toast({ title: "Nada para enviar", description: "Comece uma conversa primeiro." }); return; }
    toast({ title: "Empacotando", description: "Reunindo conversa, anexos, mídia, kanban e timeline…" });

    // ─── Cabeçalho ───
    const header = [
      `# Conversa do Studio`,
      `Cliente: ${clientName || "-"} · Pasta: /${folderPath || "raiz"}`,
      `Exportado em ${new Date().toLocaleString("pt-BR")}`,
      "",
    ].join("\n");

    // ─── Diálogo completo ───
    const convo = msgs.map(m => {
      const who = m.role === "user" ? "**Eu**" : "**Agente**";
      return `### ${who}\n\n${(m.content || "").trim()}`;
    }).join("\n\n---\n\n");

    // ─── Anexos com miniaturas / players ───
    const isImg = (s: string) => /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(s) || /^image\//i.test(s);
    const isVid = (s: string) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(s) || /^video\//i.test(s);
    const attsLines = attached.map(a => {
      const url = a.url || "";
      const mime = a.meta || "";
      if (url && (isImg(url) || isImg(mime))) return `- ![${a.name}](${url})\n  [Baixar](${url})`;
      if (url && (isVid(url) || isVid(mime))) return `- 🎬 **${a.name}** · [Reproduzir](${url}) · [Baixar](${url})`;
      if (url) return `- 📎 [${a.name}](${url})`;
      return `- 📎 ${a.name} · ref \`wsfile:${a.id}\``;
    });
    const atts = attsLines.length ? `\n\n---\n\n## Anexos e mídia\n${attsLines.join("\n")}` : "";

    // ─── Kanban do projeto (se houver projectId) ───
    let kanbanBlock = "";
    if (projectId) {
      try {
        const { data: tasks } = await supabase
          .from("tasks")
          .select("title,status,priority,due_date,description,assignee_id")
          .eq("project_id", projectId)
          .order("updated_at", { ascending: false })
          .limit(120);
        const rows = (tasks as any[]) || [];
        if (rows.length) {
          const ids = Array.from(new Set(rows.map(r => r.assignee_id).filter(Boolean)));
          const names: Record<string, string> = {};
          if (ids.length) {
            const { data: profs } = await supabase.from("profiles").select("id,full_name,email").in("id", ids);
            (profs as any[] || []).forEach(p => { names[p.id] = p.full_name || p.email || "-"; });
          }
          const cols: Record<string, any[]> = {};
          rows.forEach(r => { const k = r.status || "sem-status"; (cols[k] ||= []).push(r); });
          const order = ["todo", "doing", "review", "done", "sem-status"];
          const sortedKeys = Object.keys(cols).sort((a, b) => (order.indexOf(a) + 100) - (order.indexOf(b) + 100));
          const colBlocks = sortedKeys.map(k => {
            const items = cols[k].slice(0, 20).map(t => {
              const parts = [`**${t.title}**`];
              if (t.priority) parts.push(`prioridade ${t.priority}`);
              if (t.due_date) parts.push(`prazo ${t.due_date}`);
              if (t.assignee_id && names[t.assignee_id]) parts.push(`resp. ${names[t.assignee_id]}`);
              return `  - ${parts.join(" · ")}${t.description ? `\n    ${String(t.description).slice(0, 140)}` : ""}`;
            }).join("\n");
            return `### Coluna: ${k} (${cols[k].length})\n${items}`;
          }).join("\n\n");
          kanbanBlock = `\n\n---\n\n## Kanban do projeto\n${colBlocks}`;
        }
      } catch { /* ignore */ }
    }

    // ─── Board log do Kanban recente ───
    const boardBlock = boardLog?.length
      ? `\n\n## Atividade recente do Kanban\n${boardLog.slice(0, 20).map(l => `- ${l}`).join("\n")}`
      : "";

    // ─── URLs citados na conversa ───
    const urls = Array.from(new Set((msgs.map(m => m.content).join("\n").match(/https?:\/\/[^\s)]+/g) || [])));
    const links = urls.length ? `\n\n## Links citados na conversa\n${urls.slice(0, 40).map(u => `- ${u}`).join("\n")}` : "";

    // ─── Timeline cronológica: navegação, buscas web (/web, /abrir), decisões, ações do agente ───
    const timelineItems: string[] = [];
    msgs.forEach(m => {
      const ts = m.created_at ? new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "--:--";
      const c = (m.content || "").trim();
      if (!c) return;
      if (m.role === "user") {
        const mWeb = c.match(/^\/web\s+(.+)/i);
        const mAbr = c.match(/^\/abrir\s+(https?:\/\/\S+)/i);
        if (mWeb) { timelineItems.push(`- **${ts}** · 🔎 Busca web: "${mWeb[1].slice(0, 120)}"`); return; }
        if (mAbr) { timelineItems.push(`- **${ts}** · 🌐 Navegou até ${mAbr[1]}`); return; }
        timelineItems.push(`- **${ts}** · 💬 Eu: ${c.slice(0, 160).replace(/\n/g, " ")}`);
      } else {
        const urlsIn = c.match(/https?:\/\/[^\s)]+/g) || [];
        const label = urlsIn.length ? `Agente respondeu com ${urlsIn.length} referência(s)` : `Agente respondeu`;
        timelineItems.push(`- **${ts}** · 🤖 ${label}: ${c.slice(0, 140).replace(/\n/g, " ")}${c.length > 140 ? "…" : ""}`);
      }
    });
    const timeline = timelineItems.length ? `\n\n## Timeline\n${timelineItems.join("\n")}` : "";

    const pkg = header + convo + atts + kanbanBlock + boardBlock + links + timeline;
    onStructureToNotes(pkg);
  }

  const personaDoBotaoGpt = persona.forcedId ? persona.list.find(p => p.id === persona.forcedId) : persona.active;
  const arquivosNoContexto = contextStats ? contextStats.systemFiles + contextStats.workspaceFiles : availableFiles.filter(f => f.kind === "file").length;
  const subpastas = availableFiles.filter(f => f.kind === "folder").length;
  const pastaCurta = folderPath ? folderPath.split("/").slice(-2).join("/") : "";
  const lendoConversa = !!activeId && carregadoPara !== activeId && msgs.length === 0 && !streaming;
  const classeDaResposta = cn(
    "max-w-none text-foreground text-[14px] leading-[1.7] break-words",
    "prose prose-sm prose-invert",
    "prose-p:my-2.5 prose-p:leading-[1.7]",
    "prose-headings:font-semibold prose-headings:tracking-normal prose-headings:text-foreground",
    "prose-h1:text-[15px] prose-h1:mt-5 prose-h1:mb-2 prose-h1:first:mt-0",
    "prose-h2:text-[14.5px] prose-h2:text-primary prose-h2:mt-5 prose-h2:mb-2 prose-h2:first:mt-0",
    "prose-h3:text-[14px] prose-h3:mt-4 prose-h3:mb-1.5",
    "prose-ol:my-2.5 prose-ol:pl-5 prose-ol:space-y-1.5",
    "prose-ul:my-2.5 prose-ul:pl-5 prose-ul:space-y-1.5",
    "prose-li:my-0 prose-li:leading-[1.65] prose-li:marker:text-primary/60",
    "prose-strong:font-semibold prose-strong:text-foreground",
    "prose-code:text-[12.5px] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:bg-muted prose-code:before:content-none prose-code:after:content-none",
    "prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-pre:rounded-md prose-pre:text-[12.5px]",
    "prose-table:my-4 prose-table:text-[13px] prose-th:border prose-th:border-border prose-th:bg-muted prose-th:px-3 prose-th:py-2 prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2",
    "prose-hr:my-4 prose-hr:border-border/50",
    "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
    "prose-blockquote:border-l-2 prose-blockquote:border-primary/40 prose-blockquote:pl-3 prose-blockquote:text-muted-foreground prose-blockquote:not-italic"
  );

  return (
    <div className="relative flex h-full min-h-0 min-w-0">
      {/* Fundo do celular com as conversas abertas por cima */}
      {sidebarOpen && isMobile && (
        <div
          className="absolute inset-0 z-20 bg-background/70 animate-in fade-in"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      {/* Conversas: por cima no celular, coluna no computador */}
      {sidebarOpen && (
        <aside
          aria-label="Conversas"
          className={cn(
            "flex min-h-0 flex-col border-r border-border bg-card",
            isMobile
              ? "absolute inset-y-0 left-0 z-30 w-[78%] max-w-[280px] shadow-2xl animate-in slide-in-from-left"
              : "w-[180px] shrink-0"
          )}
        >
          <div className="flex min-w-0 shrink-0 items-center border-b border-border py-1.5 pl-3 pr-1.5">
            <span className={cn(texto.rotulo, "min-w-0 flex-1 truncate")}>{clientName ? clientName : "Global"}</span>
            <button type="button" onClick={newThread} aria-label="Nova conversa" title="Nova conversa (Alt+N)" className={cn(botao.icone, "h-7 w-7")}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setSidebarOpen(false)} aria-label="Recolher as conversas" title="Recolher (Alt+B / Esc)" className={cn(botao.icone, "h-7 w-7")}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <div className="shrink-0 border-b border-border p-1.5">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                value={buscaNasConversas}
                onChange={(e) => setBuscaNasConversas(e.target.value)}
                placeholder="Buscar conversas"
                aria-label="Buscar nas conversas (título e mensagens)"
                className={cn(campo, "h-7 pl-6 text-[12px]")}
              />
            </label>
          </div>
          {buscaNasConversas.trim().length >= 2 && threadsVisiveis.length === 0 ? (
            <p className="px-3 py-4 text-center text-[12px] text-muted-foreground">Nada encontrado.</p>
          ) : <GroupedThreadList
            threads={threadsVisiveis}
            activeId={activeId}
            currentClientId={clientId ?? null}
            currentFolderPath={folderPath ?? null}
            clientNameMap={clientNameMap}
            onSelect={(id) => { setActiveId(id); if (isMobile) setSidebarOpen(false); }}
            onDelete={(id) => deleteThread(id)}
          />}
        </aside>
      )}

      {/* Casca do agente do sistema: cabeçalho fixo, mensagens rolando por dentro, compositor fixo embaixo. */}
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <CabecalhoDoAgente
          icone={<Bot className="h-4 w-4" />}
          titulo={`Agente de ${label.toLowerCase()}`}
          descricao={`${clientName || "Global"}${pastaCurta ? ` · /${pastaCurta}` : ""} · ${arquivosNoContexto} arq`}
          acoes={
            <>
              <AjudaRecolhida rotulo="Como o agente funciona" className="mr-0.5">
                <span className="block">
                  Converse sobre {clientName || "este escopo"}: ele lê cliente, projetos, tarefas, briefing e a pasta. @ anexa arquivo, / abre as ações, /abrir seguido de um link abre o link aqui e /anexar abre as pastas.
                </span>
                <span className="mt-1.5 block">
                  No contexto: /{folderPath || "raiz"}, {arquivosNoContexto} arquivo(s), {subpastas} subpasta(s){contextStats ? ", base completa" : ""}{notes?.trim() ? ", notas" : ""}{script?.trim() ? ", roteiro" : ""}.
                </span>
                <span className="mt-1.5 block">Atalhos: Alt+↑↓ troca de conversa, Alt+N abre uma nova, Alt+B mostra ou recolhe as conversas.</span>
              </AjudaRecolhida>
              {!sidebarOpen && (
                <button type="button" onClick={() => setSidebarOpen(true)} aria-label="Mostrar conversas" title="Mostrar conversas (Alt+B)" className={botao.icone}>
                  <History className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              {showExternalTools && personaDoBotaoGpt?.gpt_url && (
                <button type="button" onClick={abrirGptExterno} aria-label="Abrir no GPT" title="Copia o contexto e abre este GPT no ChatGPT" className={botao.icone}>
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                onClick={() => pullDeepContext({ silent: false })}
                disabled={pulling || streaming}
                aria-label="Puxar contexto"
                title="Puxar contexto: reunir cliente, projetos, tarefas, briefing e pasta num dossiê"
                className={cn(botao.icone, "text-primary hover:text-primary disabled:opacity-50")}
              >
                {pulling ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Brain className="h-4 w-4" aria-hidden="true" />}
              </button>
              {onStructureToNotes && (
                <button
                  type="button"
                  onClick={enviarConversaParaNotas}
                  aria-label="Enviar a conversa para as Notas"
                  title="Enviar a conversa completa (mensagens, mídia, kanban, links, timeline) para as Notas"
                  className={botao.icone}
                >
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
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
              {showExternalTools && (
                <button type="button" onClick={() => setPersonaOpen(true)} aria-label="Personas do agente" title="Gerenciar personas (adicionar ou remover)" className={botao.icone}>
                  <Settings className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              {/* Com as conversas abertas, o "+" já está no topo delas: um botão só por vez. */}
              {!sidebarOpen && (
                <button type="button" onClick={newThread} aria-label="Nova conversa" title="Nova conversa (Alt+N)" className={botao.icone}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </>
          }
        >
          {showExternalTools ? (
            <select
              value={persona.forcedId || "__auto__"}
              onChange={e => {
                const v = e.target.value;
                setPersona(p => ({ ...p, forcedId: v === "__auto__" ? null : v }));
              }}
              aria-label="Persona do agente"
              className={cn(campo, "sm:max-w-[260px]")}
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
          ) : null}
        </CabecalhoDoAgente>
        {showExternalTools && <PersonaDialog open={personaOpen} onOpenChange={setPersonaOpen}
          list={persona.list}
          clientId={clientId} clientName={clientName} folderPath={folderPath}
          onSaved={reloadPersona} />}

        {/* Mensagens: rolam por dentro, com memória por conversa */}
        <MensagensDoAgente ref={scrollRef} rotulo="Conversa com o agente" className="space-y-5 px-4 py-4 sm:px-5">
          {erroMsgs && (
            <EstadoDeErro
              titulo="Não foi possível ler a conversa."
              acao={
                <button type="button" onClick={() => { if (activeId) void loadMsgs(activeId); }} className={cn(botao.secundario, "h-8")}>
                  Tentar de novo
                </button>
              }
            />
          )}
          {lendoConversa && !erroMsgs && <Carregando rotulo="Lendo a conversa" linhas={3} />}
          {msgs.length === 0 && !streaming && !lendoConversa && !erroMsgs && (
            <div className="mx-auto max-w-sm px-2 py-8 text-center">
              <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
                <Bot className="h-4 w-4" />
              </span>
              {/* Só o título: o que o agente faz está no "?" do cabeçalho. */}
              <p className="text-[14px] font-semibold leading-5 text-foreground">Converse com o agente</p>
            </div>
          )}
          {msgs.map(m => (
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-xl rounded-br-md bg-primary px-3.5 py-2.5 text-[14px] leading-[1.6] text-primary-foreground">
                  {m.content}
                </div>
              </div>
            ) : (
              <article
                key={m.id}
                className={classeDaResposta}
                // Link externo da resposta continua abrindo dentro do chat (como no markdown de antes).
                onClickCapture={(e) => {
                  const a = (e.target as HTMLElement).closest("a");
                  const url = a ? String(a.getAttribute("href") || "") : "";
                  if (a && /^https?:\/\//i.test(url)) { e.preventDefault(); setLinkPreview(url); }
                }}
              >
                <TextoDoAgente texto={m.content} clientId={clientId ?? null} />
                {/* Frente AG (27/09): a área que a resposta citou vira o botão "Abrir" com o cliente. */}
                <CaminhoDoTexto texto={m.content} clientId={clientId} />
                {/* Frente AG3: o que o agente fez ou propõe no Workspace (Confirmar, Parar, Desfazer, Ir para). */}
                {acoesDaMensagemDoWorkspace(m).map((a) => (
                  <CartaoDeAcao
                    key={a.id}
                    acao={a}
                    recemFeita={!!m.recemFeita}
                    titulo="O agente organiza"
                    observacao="Sem custo. Dá para desfazer."
                    onPedido={(pedido) => pedidoDaAcaoDoWorkspace(m.id, a.id, pedido)}
                    onFeito={() => recarregarWorkspace()}
                  />
                ))}
                {clientId && (
                  <AprendizadoDoAgente
                    anexos={m.meta?.anexos}
                    onEsquecer={(id) => esquecerRegraAprendida("workspace-agent", id, { client_id: clientId })}
                    onGuardar={(texto, tipo) => guardarRegraAprendida("workspace-agent", { texto, categoria: tipo }, { client_id: clientId })}
                  />
                )}
              </article>
            )
          ))}

          {streaming && streamBuf && (
            <article className={classeDaResposta}>
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{streamBuf}</ReactMarkdown>
              <span className="ml-0.5 inline-block h-3.5 w-[3px] bg-primary/70 align-middle" aria-hidden="true" />
            </article>
          )}
          {streaming && !streamBuf && (
            <p className="flex items-center text-[12.5px] text-muted-foreground" role="status">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
              Reunindo contexto
            </p>
          )}
        </MensagensDoAgente>

        {/* Compositor fixo: anexos, campo sempre visível, anexar e enviar */}
        <CompositorDoAgente>
          {attached.length > 0 && (
            <div className="-mb-1 flex flex-wrap" aria-label="Anexos da próxima mensagem">
              {attached.map(a => (
                <span key={a.id} className="mb-1 mr-1 inline-flex max-w-full items-center rounded-full bg-primary/10 py-0.5 pl-2 pr-1 text-[11px] text-primary">
                  {a.kind === "folder" ? <FolderIcon className="mr-1 h-3 w-3 shrink-0" aria-hidden="true" /> : <FileIcon className="mr-1 h-3 w-3 shrink-0" aria-hidden="true" />}
                  <span className="max-w-[160px] truncate">{a.name}</span>
                  <button type="button" onClick={() => removeAttached(a.id)} aria-label={`Tirar ${a.name}`} className={cn("ml-1 rounded-full p-0.5 hover:bg-primary/20", foco)}>
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="relative">
            {/* Lista do @: busca por aproximação, setas e Enter */}
            {mention && (
              <div className="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-[260px] overflow-y-auto overscroll-contain rounded-md border border-border bg-popover shadow-xl">
                <div className="flex items-center border-b border-border px-3 py-1.5">
                  <span className={cn(texto.rotulo, "min-w-0 flex-1 truncate")}>Anexar do workspace</span>
                  <span className={cn(texto.auxiliar, "ml-2 shrink-0")}>{mention.q ? `"${mention.q}"` : "digite para filtrar"} · ↑↓ ⏎</span>
                </div>
                {mentionMatches.length === 0 ? (
                  <p className={cn(texto.auxiliar, "px-3 py-3 text-center")}>Nenhum arquivo encontrado.</p>
                ) : mentionMatches.map((f, i) => (
                  <button key={f.id}
                    type="button"
                    onMouseEnter={() => setMentionIdx(i)}
                    onClick={() => pickMention(f)}
                    className={cn("flex w-full min-w-0 items-center px-3 py-1.5 text-left text-[12.5px]",
                      i === mentionIdx ? "bg-primary/15 text-foreground" : "hover:bg-muted")}>
                    {f.kind === "folder"
                      ? <FolderIcon className="mr-2 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
                      : <FileIcon className="mr-2 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
                    <span className="min-w-0 flex-1 truncate">{highlightRanges(f.name, f._ranges)}</span>
                    {f._recent && <span className="ml-2 shrink-0 text-[11px] text-primary/80">recente</span>}
                    <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">
                      {f.kind === "folder" ? "pasta" : "arquivo"}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {/* Lista do /: ações do agente */}
            {slash && slashMatches.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-[240px] overflow-y-auto overscroll-contain rounded-md border border-border bg-popover shadow-xl">
                <p className={cn(texto.rotulo, "border-b border-border px-3 py-1.5")}>Ações do agente</p>
                {slashMatches.map((c, i) => (
                  <button key={c.key}
                    type="button"
                    onMouseEnter={() => setSlashIdx(i)}
                    onClick={() => pickSlash(c)}
                    className={cn("flex w-full min-w-0 items-center px-3 py-1.5 text-left text-[12.5px]",
                      i === slashIdx ? "bg-primary/15" : "hover:bg-muted")}>
                    <Sparkles className="mr-2 h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
                    <span className="shrink-0 font-medium">{c.label}</span>
                    <span className="ml-auto min-w-0 truncate pl-2 text-[11px] text-muted-foreground">{c.hint}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="rounded-lg border border-border bg-background p-2 focus-within:border-primary/60">
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
                aria-label="Mensagem ao agente"
                placeholder="Mensagem ao agente. @ anexa, / abre as ações."
                rows={3}
                className="block max-h-40 min-h-[64px] w-full resize-none border-0 bg-transparent px-1 py-1 text-[13px] leading-[1.55] text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <div className="mt-1 flex min-w-0 items-center">
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" aria-label="Anexar" title="Anexar (arquivo, link, workspace)" className={botao.icone}>
                      <Paperclip className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" side="top" className="w-60 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        const el = inputRef.current;
                        if (!el) return;
                        const caret = el.selectionStart ?? input.length;
                        const next = input.slice(0, caret) + "@" + input.slice(caret);
                        setInput(next);
                        setMention({ q: "", start: caret });
                        setTimeout(() => { el.focus(); el.setSelectionRange(caret + 1, caret + 1); }, 10);
                      }}
                      className="flex w-full min-w-0 items-center rounded px-2 py-2 text-left text-[12.5px] hover:bg-muted"
                    >
                      <Paperclip className="mr-2 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-foreground">Arquivo do workspace</span>
                        <span className="block truncate text-[11px] text-muted-foreground">busca rápida com @</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const url = window.prompt("Cole o link (o agente vai ler o conteúdo):");
                        if (!url) return;
                        const clean = url.trim();
                        if (!/^https?:\/\//i.test(clean)) { alert("URL inválida · use http:// ou https://"); return; }
                        const name = (() => { try { return new URL(clean).hostname.replace(/^www\./, ""); } catch { return "link"; } })();
                        const ref: FileRef = { id: `url-${crypto.randomUUID()}`, name, kind: "file", url: clean };
                        setAttached(prev => [...prev, ref]);
                        setInput(prev => (prev ? prev + " " : "") + clean + " ");
                        setTimeout(() => inputRef.current?.focus(), 10);
                      }}
                      className="flex w-full min-w-0 items-center rounded px-2 py-2 text-left text-[12.5px] hover:bg-muted"
                    >
                      <Link2 className="mr-2 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-foreground">Link externo</span>
                        <span className="block truncate text-[11px] text-muted-foreground">o agente lê o conteúdo</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPickerOpen(true)}
                      className="flex w-full min-w-0 items-center rounded px-2 py-2 text-left text-[12.5px] hover:bg-muted"
                    >
                      <Columns3 className="mr-2 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-foreground">Navegar pastas</span>
                        <span className="block truncate text-[11px] text-muted-foreground">seleção múltipla</span>
                      </span>
                    </button>
                  </PopoverContent>
                </Popover>
                <Ditado valor={input} onChange={setInput} disabled={streaming} className="ml-1" />
                <Button size="sm" onClick={() => send()} disabled={streaming || !input.trim()} aria-label="Enviar" className="ml-auto h-8 shrink-0 px-3">
                  {streaming ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                </Button>
              </div>
            </div>
          </div>
        </CompositorDoAgente>
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

      {/* Janela com o link: abre dentro do chat sem sair da conversa */}
      <Dialog open={!!linkPreview} onOpenChange={(v) => { if (!v) setLinkPreview(null); }}>
        <DialogContent className="flex h-[85vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">Link aberto no chat</DialogTitle>
          <div className="flex min-w-0 items-center border-b border-border px-3 py-2 pr-12">
            <Link2 className="mr-2 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            <span className={cn(texto.auxiliar, "min-w-0 flex-1 truncate")}>{linkPreview}</span>
            <button
              type="button"
              onClick={() => linkPreview && window.open(linkPreview, "_blank", "noopener,noreferrer")}
              className={cn(botao.secundario, "ml-2 h-8")}
              title="Abrir em nova aba (alguns sites bloqueiam a abertura aqui)"
            >Nova aba</button>
            <button type="button" onClick={() => setLinkPreview(null)} className={cn(botao.discreto, "ml-1 h-8")}>Fechar</button>
          </div>
          <iframe
            src={linkPreview || "about:blank"}
            className="w-full flex-1 bg-background"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            referrerPolicy="no-referrer"
            title="Preview de link"
          />
        </DialogContent>
      </Dialog>
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
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 pb-3 pt-4 pr-12 text-left">
          <DialogTitle className="text-[15px]">Anexar ao contexto</DialogTitle>
          <nav aria-label="Caminho" className="-mb-0.5 mt-1 flex min-w-0 flex-wrap items-center text-[12px] text-muted-foreground">
            {crumbs.map((c, i) => (
              <span key={i} className="mb-0.5 flex min-w-0 items-center">
                {i > 0 && <ChevronRight className="mx-0.5 h-3 w-3 shrink-0 opacity-50" aria-hidden="true" />}
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  aria-current={i === crumbs.length - 1 ? "page" : undefined}
                  className={cn("max-w-[180px] truncate rounded hover:text-foreground", foco,
                    i === crumbs.length - 1 ? "font-medium text-foreground" : "")}
                >
                  {c.name}
                </button>
              </span>
            ))}
          </nav>
        </DialogHeader>

        <div className="flex min-w-0 items-center border-b border-border px-4 py-2.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={globalSearch ? "Buscar em todo o workspace" : "Filtrar nesta pasta"}
            placeholder={globalSearch ? "Buscar em todo o workspace..." : "Filtrar nesta pasta..."}
            className={cn(campo, "mr-3 min-w-0 flex-1")}
          />
          <label className="flex shrink-0 cursor-pointer select-none items-center text-[12px] text-muted-foreground">
            <input
              type="checkbox"
              checked={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.checked)}
              className="mr-1.5 accent-primary"
            />
            Buscar em tudo
          </label>
        </div>

        <div className="flex min-w-0 items-center justify-between border-b border-border px-4 py-2 text-[12px] text-muted-foreground">
          <button
            type="button"
            onClick={toggleAllVisible}
            disabled={filtered.length === 0}
            className={cn("flex items-center rounded hover:text-foreground disabled:opacity-40", foco)}
          >
            <span className={cn("mr-1.5 flex h-3.5 w-3.5 items-center justify-center rounded border border-border",
              allVisibleChecked ? "border-primary bg-primary" : "bg-background")} aria-hidden="true">
              {allVisibleChecked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
            </span>
            {allVisibleChecked ? "Desmarcar visíveis" : "Selecionar visíveis"}
          </button>
          <span className="tabular-nums" role="status">{selected.size} selecionado(s)</span>
        </div>

        <div className="max-h-[380px] overflow-y-auto overscroll-contain">
          {loading && nodes.length === 0 ? (
            <Carregando rotulo="Carregando a pasta" linhas={5} className="p-4" />
          ) : filtered.length === 0 ? (
            <div className="p-4">
              <EstadoVazio compacto titulo={globalSearch && !query.trim() ? "Digite algo para buscar." : "Pasta vazia."} />
            </div>
          ) : (
            <ul className={cn("divide-y divide-border", loading && "opacity-60")} aria-busy={loading || undefined}>
              {filtered.map(n => {
                const already = alreadyAttachedIds.has(n.id);
                const checked = selected.has(n.id);
                return (
                  <li key={n.id}
                    className={cn("flex min-w-0 items-center px-4 py-1.5 hover:bg-muted",
                      checked && "bg-primary/5")}>
                    <button
                      type="button"
                      onClick={() => toggle(n)}
                      disabled={already}
                      role="checkbox"
                      aria-checked={checked || already}
                      aria-label={already ? `${n.name}: já anexado` : `Selecionar ${n.name}`}
                      title={already ? "Já anexado" : ""}
                      className={cn("mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded border", foco,
                        checked ? "border-primary bg-primary" : "border-border bg-background",
                        already && "cursor-not-allowed opacity-40")}
                    >
                      {(checked || already) && <Check className="h-2.5 w-2.5 text-primary-foreground" aria-hidden="true" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => n.kind === "folder" ? openFolder(n) : toggle(n)}
                      className={cn("flex min-w-0 flex-1 items-center rounded py-0.5 text-left", foco)}
                    >
                      {n.kind === "folder"
                        ? <FolderIcon className="mr-2 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
                        : <FileIcon className="mr-2 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
                      <span className="min-w-0 truncate text-[13px]">{n.name}</span>
                      {n.kind === "folder" && (
                        <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 opacity-40" aria-hidden="true" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="flex-row justify-end border-t border-border px-4 py-3 sm:space-x-0 [&>*+*]:ml-2">
          <button type="button" onClick={() => onOpenChange(false)} className={botao.discreto}>Cancelar</button>
          <button type="button" onClick={confirm} disabled={selected.size === 0} className={botao.primario}>
            Anexar {selected.size > 0 ? `(${selected.size})` : ""}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center pr-6 text-[15px]">
            <span className="min-w-0 truncate">Nova tarefa{clientName ? ` · ${clientName}` : ""}</span>
          </DialogTitle>
        </DialogHeader>

        <GrupoDeCampos>
          <CampoDeFormulario
            largo
            rotulo="Atalho"
            apoio="!alta · @nome · 15/07, hoje, +3d"
            ajuda="Prioridade com !baixa, !media, !alta ou !urgente. Responsável com @nome. Prazo com 15/07, hoje, amanhã ou +3d."
          >
            <input value={raw} onChange={e => setRaw(e.target.value)}
              placeholder="Editar hook !alta @maria 15/07"
              className={cn(campo, "font-mono")} autoFocus />
          </CampoDeFormulario>

          <CampoDeFormulario largo rotulo="Título" obrigatorio>
            <input value={title} onChange={e => setTitle(e.target.value)} className={campo} />
          </CampoDeFormulario>

          <CampoDeFormulario rotulo="Projeto" obrigatorio>
            <select value={projectId} onChange={e => setProjectId(e.target.value)} className={campo}>
              {projects.length === 0 && <option value="">sem projeto</option>}
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Prioridade">
            <select value={priority} onChange={e => setPriority(e.target.value as any)} className={campo}>
              <option value="low">Baixa</option>
              <option value="medium">Média</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </select>
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Responsável">
            <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className={campo}>
              <option value="">ninguém</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
            </select>
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Prazo">
            <input type="date" value={dueISO} onChange={e => setDueISO(e.target.value)} className={campo} />
          </CampoDeFormulario>
        </GrupoDeCampos>

        <DialogFooter className="flex-row justify-end sm:space-x-0 [&>*+*]:ml-2">
          <button type="button" onClick={onClose} disabled={saving} className={botao.discreto}>Cancelar</button>
          <button type="button" onClick={submit} disabled={saving || !title.trim() || !projectId} className={botao.primario}>
            {saving ? "Criando…" : "Criar tarefa"}
          </button>
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
      // Frente AG3: antes dizia "Persona removida" mesmo quando a função recusava.
      const { data, error } = await supabase.functions.invoke("workspace-agent-import", { body: { delete_id: id } });
      if (error || (data as any)?.error) {
        toast({ title: "Persona não removida", description: (data as any)?.error || error?.message || "Tente de novo.", variant: "destructive" });
        return;
      }
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
          <DialogTitle className="flex min-w-0 items-center pr-6 text-[15px]">
            <Bot className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0 truncate">Personas do agente</span>
            <span className="ml-1.5 shrink-0 text-[13px] font-normal tabular-nums text-muted-foreground">{list.length}</span>
            <AjudaRecolhida rotulo="Sobre as personas" className="ml-1.5">
              Adicione quantos Custom GPTs quiser. O roteador interno escolhe qual usar em cada mensagem, ou você trava um pelo seletor no cabeçalho do agente.
            </AjudaRecolhida>
          </DialogTitle>
        </DialogHeader>
        <div className="min-w-0 space-y-4">
          {list.length > 0 ? (
            <ul className="max-h-56 divide-y divide-border overflow-y-auto overscroll-contain" aria-label="Personas">
              {list.map(p => (
                <li key={p.id} className="flex min-w-0 items-center py-2">
                  <span className="mr-2 shrink-0 text-primary/80" aria-hidden="true">
                    {p.folder_path ? <FolderIcon className="h-3.5 w-3.5" /> : p.client_id ? <Bot className="h-3.5 w-3.5" /> : <GitBranch className="h-3.5 w-3.5" />}
                  </span>
                  <div className="mr-2 min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-foreground">{p.gpt_name || "Sem nome"}</p>
                    <p className={cn(texto.auxiliar, "truncate")}>{scopeText(p)} · {p.gpt_description || p.gpt_url}</p>
                  </div>
                  <button type="button" onClick={() => deleteOne(p.id, p.gpt_name)}
                    disabled={loading}
                    className={cn(botao.discreto, "h-8 text-destructive hover:text-destructive")}>
                    Remover
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EstadoVazio compacto titulo="Nenhuma persona ainda." />
          )}

          <GrupoDeCampos titulo="Adicionar persona" colunas={1} className="border-t border-border pt-4">
            <CampoDeFormulario rotulo="Vale para">
              <SeletorCompacto
                opcoes={(["folder", "client", "global"] as Scope[]).map(s => ({
                  valor: s,
                  rotulo: s === "folder" ? "Pasta" : s === "client" ? "Cliente" : "Global",
                  desativada: (s !== "global" && !clientId) || (s === "folder" && !folderPath),
                }))}
                valor={scope}
                onEscolher={(v) => setScope(v as Scope)}
                rotulo="Vale para"
                modo="segmentado"
                larguraTotal
              />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Link do GPT">
              <input value={url} onChange={(e) => setUrl(e.target.value)}
                placeholder="https://chatgpt.com/g/g-xxxxxxxx-nome-do-gpt" className={campo} />
            </CampoDeFormulario>
          </GrupoDeCampos>
        </div>
        <DialogFooter className="flex-row justify-end">
          <button type="button" onClick={importGpt} disabled={loading || !url} className={botao.primario}>
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
            Adicionar persona
          </button>
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
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label="Colar resposta do ChatGPT"
        title="Colar resposta do ChatGPT"
        className={cn(botao.icone, "disabled:cursor-not-allowed disabled:opacity-40")}>
        <ClipboardPaste className="h-4 w-4" aria-hidden="true" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex min-w-0 items-center pr-6 text-[15px]">
              <span className="min-w-0 truncate">Colar resposta do ChatGPT</span>
              <AjudaRecolhida rotulo="Sobre colar a resposta" className="ml-1.5">
                Copie a resposta do seu GPT externo e cole aqui. Ela entra na conversa como mensagem do agente e vira contexto para as próximas.
              </AjudaRecolhida>
            </DialogTitle>
          </DialogHeader>
          <CampoDeFormulario rotulo="Resposta">
            <textarea
              autoFocus
              value={txt}
              onChange={e => setTxt(e.target.value)}
              placeholder="Cole aqui..."
              className={cn(campoTexto, "min-h-[220px] max-h-[50vh] resize-y")}
            />
          </CampoDeFormulario>
          <DialogFooter className="flex-row justify-end sm:space-x-0 [&>*+*]:ml-2">
            <button type="button" onClick={() => setOpen(false)} className={botao.discreto}>Cancelar</button>
            <button type="button" disabled={!txt.trim() || busy} className={botao.primario} onClick={async () => {
              setBusy(true);
              try { await onPaste(txt); setTxt(""); setOpen(false); }
              finally { setBusy(false); }
            }}>
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ClipboardPaste className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
              Importar para conversa
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
