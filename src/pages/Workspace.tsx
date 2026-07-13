import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
  ContextMenuSeparator, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
} from "@/components/ui/context-menu";
import {
  Folder, FolderPlus, Upload, ChevronRight, FileText, FileImage, Film,
  Archive, Trash2, Send, Download, ExternalLink, Users as UsersIcon, Globe2,
  Search, Grid2X2, List, Loader2, MoreVertical, Pencil, FolderInput, ArrowLeft,
  ChevronDown, Check, X as XIcon, Wand2, Link2, Copy,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { downloadFile, openFile } from "@/lib/fileActions";
import { useWorkspaceUploads } from "@/hooks/useWorkspaceUploads";
import { UploadProgressPanel } from "@/components/workspace/UploadProgressPanel";
import { TemplatePicker } from "@/components/workspace/TemplatePicker";
import { WorkspaceTemplate, TplNode } from "@/lib/workspaceTemplates";
import { Sparkles } from "lucide-react";
import { StudioPanel } from "@/components/workspace/StudioPanel";

type Node = {
  id: string; parent_id: string | null; scope: "global" | "client";
  client_id: string | null; kind: "folder" | "file"; name: string;
  mime: string | null; size_bytes: number | null; storage_path: string | null;
  duration_sec: number | null; sort_index: number; sent_for_approval_file_id: string | null;
  created_by: string | null; created_at: string;
  // virtual nodes derived from public.files (linked, not stored in workspace_nodes)
  __virtual?: boolean;
  __external_url?: string | null;
  __file_id?: string | null;
  __approval_status?: string | null;
};

const VIRT_PREFIX = "virt:";
const isVirt = (id: string | null | undefined) => !!id && id.startsWith(VIRT_PREFIX);


const iconFor = (n: Node) => {
  if (n.kind === "folder") return Folder;
  const m = n.mime || "";
  if (m.startsWith("image/")) return FileImage;
  if (m.startsWith("video/")) return Film;
  if (m.includes("zip") || m.includes("rar")) return Archive;
  return FileText;
};

type MediaKind = "image" | "video" | "audio" | "doc" | "other";
function kindOf(n: Node): MediaKind {
  if (n.kind === "folder") return "other";
  const m = (n.mime || "").toLowerCase();
  const name = (n.name || "").toLowerCase();
  if (m.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/.test(name)) return "image";
  if (m.startsWith("video/") || /\.(mp4|mov|webm|mkv|avi|m4v)$/.test(name)) return "video";
  if (m.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|flac)$/.test(name)) return "audio";
  if (m.includes("pdf") || /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv)$/.test(name)) return "doc";
  return "other";
}
const KIND_META: Record<MediaKind, { label: string; color: string; gradient: string; accent: string }> = {
  image: { label: "Imagens",    color: "text-blue-400",   gradient: "from-blue-500/25 via-blue-500/10 to-transparent",     accent: "text-blue-300" },
  video: { label: "Vídeos",     color: "text-purple-400", gradient: "from-purple-500/25 via-fuchsia-500/10 to-transparent", accent: "text-purple-300" },
  audio: { label: "Áudios",     color: "text-pink-400",   gradient: "from-pink-500/25 via-rose-500/10 to-transparent",     accent: "text-pink-300" },
  doc:   { label: "Documentos", color: "text-amber-400",  gradient: "from-amber-500/25 via-orange-500/10 to-transparent",  accent: "text-amber-300" },
  other: { label: "Outros",     color: "text-muted-foreground", gradient: "from-secondary/50 via-secondary/20 to-transparent", accent: "text-muted-foreground" },
};
function extOf(name: string) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name || "");
  return m ? m[1].toUpperCase() : "";
}

// Smart auto-tagging: detects content role beyond raw mime.
type SmartTag = "carrossel" | "video-ready" | "static" | "material" | "audio" | "doc" | "other";
const SMART_TAGS: { key: SmartTag; label: string; hint: string }[] = [
  { key: "carrossel",   label: "Carrossel",     hint: "Sequências de imagens" },
  { key: "static",      label: "Estático",      hint: "Peças únicas" },
  { key: "video-ready", label: "Vídeo pronto",  hint: "Reels / edits finais" },
  { key: "material",    label: "Materiais",     hint: "Brutos e fontes" },
  { key: "doc",         label: "Documentos",    hint: "PDFs, textos, planilhas" },
  { key: "audio",       label: "Áudios",        hint: "Trilhas e locuções" },
  { key: "other",       label: "Outros",        hint: "" },
];
function tagOf(n: Node, siblings?: Node[]): SmartTag {
  if (n.kind === "folder") return "other";
  const k = kindOf(n);
  const name = (n.name || "").toLowerCase();
  const path = (n.storage_path || "").toLowerCase();
  const ctx = `${name} ${path}`;
  const isFinal = /(final|pronto|entrega|export|reels?|story|stories|post|edit|feed|approved|aprovad)/i.test(ctx);
  const isRaw   = /(bruto|raw|material|fonte|source|assets?|captur|crua?|original)/i.test(ctx);

  if (k === "audio") return "audio";
  if (k === "doc")   return "doc";
  if (k === "video") return isRaw && !isFinal ? "material" : "video-ready";
  if (k === "image") {
    if (/(carrossel|carousel|slide|slides?)/i.test(ctx)) return "carrossel";
    // Sibling heuristic: multiple images sharing a numeric suffix pattern
    if (siblings && siblings.length) {
      const base = name.replace(/[-_ ]?\(?\d{1,3}\)?\.[a-z0-9]+$/i, "");
      if (base && base !== name) {
        const family = siblings.filter(s =>
          s.kind === "file" && kindOf(s) === "image" &&
          (s.name || "").toLowerCase().startsWith(base) && s.id !== n.id
        );
        if (family.length >= 1) return "carrossel";
      }
    }
    if (isRaw && !isFinal) return "material";
    return "static";
  }
  return "other";
}

const SUGGEST_BY_TAG: Record<SmartTag, string> = {
  carrossel: "Carrossel",
  "video-ready": "Vídeos prontos",
  material: "Brutos",
  static: "Estáticos",
  doc: "Documentos",
  audio: "Áudios",
  other: "Novos arquivos",
};
function suggestFolderName(n: Node): string {
  if (n.kind === "folder") return `${n.name} (grupo)`;
  const tag = tagOf(n);
  const base = SUGGEST_BY_TAG[tag] || "Novos arquivos";
  // Try to enrich with a filename stem: "Reels_Marca_01.mp4" → "Reels Marca"
  const raw = (n.name || "").replace(/\.[a-z0-9]{1,5}$/i, "");
  const stem = raw
    .replace(/[-_]+/g, " ")
    .replace(/\s?\(?\d{1,3}\)?\s*$/,"")
    .trim();
  if (stem && stem.length >= 3 && stem.length <= 32 && !/^[0-9\s]+$/.test(stem)) {
    return `${base}: ${stem}`;
  }
  return base;
}




function virtFileNode(f: any, clientId: string): Node {
  return {
    id: `${VIRT_PREFIX}file:${f.id}`,
    parent_id: null, scope: "client", client_id: clientId,
    kind: "file", name: f.file_name,
    mime: f.file_type || null, size_bytes: null, storage_path: null,
    duration_sec: null, sort_index: 0,
    sent_for_approval_file_id: f.approval_status && f.approval_status !== "none" ? f.id : null,
    created_by: f.uploaded_by || null, created_at: f.created_at,
    __virtual: true, __external_url: f.file_url, __file_id: f.id,
    __approval_status: f.approval_status,
  };
}

const fmtSize = (n: number | null) => {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

export default function Workspace() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const isStaff = profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "");

  const [scope, setScope] = useState<"global" | "client">("global");
  const [clientId, setClientId] = useState<string | null>(null);
  const [parentStack, setParentStack] = useState<Node[]>([]);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Node | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [applyingTpl, setApplyingTpl] = useState<string | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const uploads = useWorkspaceUploads();
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [renaming, setRaming] = useState<Node | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Node | null>(null);
  const [moveCreate, setMoveCreate] = useState<{ node: Node; parentId: string | null; parentLabel: string } | null>(null);
  const [moveCreateName, setMoveCreateName] = useState("");
  const [dragOverId, setDragOverId] = useState<string | "root" | null>(null);
  const [dragOverArea, setDragOverArea] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerFilter, setPickerFilter] = useState<"all" | "az" | "za" | "recent">("all");
  const [tagFilter, setTagFilter] = useState<"all" | SmartTag>("all");
  const [sortBy, setSortBy] = useState<"recent" | "old" | "az" | "za">("recent");


  const parent = parentStack[parentStack.length - 1] || null;

  const { data: clients } = useQuery({
    queryKey: ["workspace-clients"],
    queryFn: async () => {
      const { data: roles } = await (supabase as any)
        .from("user_roles").select("user_id").eq("role", "client");
      const ids = (roles || []).map((r: any) => r.user_id);
      if (!ids.length) return [];
      const { data } = await (supabase as any)
        .from("profiles").select("id, full_name, company_name")
        .in("id", ids).is("deleted_at", null).order("company_name");
      return data || [];
    },
    enabled: isStaff,
  });

  const { data: nodes, isLoading } = useQuery({
    queryKey: ["workspace-nodes", scope, clientId, parent?.id || null],
    queryFn: async () => {
      let q: any = (supabase as any).from("workspace_nodes").select("*").eq("scope", scope);
      if (scope === "client") q = q.eq("client_id", clientId!);
      q = parent ? q.eq("parent_id", parent.id) : q.is("parent_id", null);
      q = q.order("kind", { ascending: true }).order("sort_index", { ascending: true }).order("name", { ascending: true });
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as Node[];
    },
    enabled: isStaff && (scope === "global" || !!clientId),
    staleTime: 30_000,
    placeholderData: (prev: any) => prev,
  });


  // Full folder list of current scope (for "Move to..." menu)
  const { data: allFolders } = useQuery({
    queryKey: ["workspace-folders", scope, clientId],
    queryFn: async () => {
      let q: any = (supabase as any).from("workspace_nodes").select("id, parent_id, name")
        .eq("scope", scope).eq("kind", "folder");
      if (scope === "client") q = q.eq("client_id", clientId!);
      const { data } = await q;
      return (data || []) as { id: string; parent_id: string | null; name: string }[];
    },
    enabled: isStaff && (scope === "global" || !!clientId),
    staleTime: 60_000,
  });


  const folderPaths = useMemo(() => {
    const map = new Map<string, string>();
    const byId = new Map((allFolders || []).map(f => [f.id, f]));
    const build = (id: string): string => {
      if (map.has(id)) return map.get(id)!;
      const f = byId.get(id); if (!f) return "";
      const p = f.parent_id ? build(f.parent_id) + " / " + f.name : f.name;
      map.set(id, p); return p;
    };
    (allFolders || []).forEach(f => build(f.id));
    return map;
  }, [allFolders]);

  useEffect(() => { setParentStack([]); setSelected(null); }, [scope, clientId]);

  // Existing client files (from public.files) — merged as virtual folders/files
  const { data: clientFiles } = useQuery({
    queryKey: ["workspace-client-files", clientId],
    queryFn: async () => {
      if (!clientId) return [];
      const { data } = await (supabase as any)
        .from("files")
        .select("id, file_name, file_url, file_type, folder, approval_status, created_at, uploaded_by")
        .eq("client_id", clientId)
        .is("parent_file_id", null)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: isStaff && scope === "client" && !!clientId,
    staleTime: 60_000,
    placeholderData: (prev: any) => prev,
  });


  // Build virtual nodes for current view (root or inside a virtual folder)
  const virtualNodes: Node[] = useMemo(() => {
    if (scope !== "client" || !clientId || !clientFiles?.length) return [];
    const currentVirtId = parent?.id;
    const insideVirtFolder = currentVirtId && currentVirtId.startsWith(VIRT_PREFIX + "folder:");
    // At root of client scope → show virtual folders per distinct `folder` value + orphan files
    if (!parent) {
      const folders = new Map<string, number>();
      const orphans: any[] = [];
      for (const f of clientFiles as any[]) {
        const fld = (f.folder || "").trim();
        if (fld) folders.set(fld, (folders.get(fld) || 0) + 1);
        else orphans.push(f);
      }
      const nodes: Node[] = [];
      Array.from(folders.entries()).sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, count]) => {
        nodes.push({
          id: `${VIRT_PREFIX}folder:${name}`,
          parent_id: null, scope: "client", client_id: clientId,
          kind: "folder", name: `${name} (${count})`,
          mime: null, size_bytes: null, storage_path: null, duration_sec: null,
          sort_index: 0, sent_for_approval_file_id: null,
          created_by: null, created_at: new Date().toISOString(),
          __virtual: true,
        });
      });
      orphans.forEach((f) => nodes.push(virtFileNode(f, clientId)));
      return nodes;
    }
    if (insideVirtFolder) {
      const folderName = currentVirtId.substring((VIRT_PREFIX + "folder:").length);
      return (clientFiles as any[])
        .filter((f) => (f.folder || "").trim() === folderName)
        .map((f) => virtFileNode(f, clientId));
    }
    return [];
  }, [clientFiles, scope, clientId, parent]);

  const filtered = useMemo(() => {
    const merged: Node[] = [
      ...(virtualNodes || []),
      ...((nodes || []).filter((n) => !(parent?.id && parent.id.startsWith(VIRT_PREFIX)))),
    ];
    // Dedup by name (real workspace_nodes win over virtual with same name)
    const seen = new Set<string>();
    const out: Node[] = [];
    for (const n of [...(nodes || []), ...virtualNodes]) {
      const key = `${n.kind}:${n.name.replace(/ \(\d+\)$/, "")}`;
      if (parent?.id?.startsWith(VIRT_PREFIX)) { out.push(n); continue; }
      if (seen.has(key) && n.__virtual) continue;
      seen.add(key); out.push(n);
    }
    const base = parent?.id?.startsWith(VIRT_PREFIX) ? merged : out;
    const s = search.trim().toLowerCase();
    let res = s ? base.filter(n => n.name.toLowerCase().includes(s)) : base;
    if (tagFilter !== "all") res = res.filter(n => n.kind === "folder" || tagOf(n, base) === tagFilter);
    // Sort: folders always pinned first
    const key = (n: Node) => (n.name || "").toLowerCase();
    const t = (n: Node) => new Date(n.created_at || 0).getTime();
    res = [...res].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      if (sortBy === "az") return key(a).localeCompare(key(b));
      if (sortBy === "za") return key(b).localeCompare(key(a));
      if (sortBy === "old") return t(a) - t(b);
      return t(b) - t(a); // recent
    });
    return res;
  }, [nodes, virtualNodes, search, parent, tagFilter, sortBy]);

  // Category counts for smart chips (by SmartTag)
  const tagCounts = useMemo(() => {
    const src = parent?.id?.startsWith(VIRT_PREFIX)
      ? [...(virtualNodes || [])]
      : [...(nodes || []), ...(virtualNodes || [])];
    const c: Record<SmartTag, number> = { carrossel: 0, static: 0, "video-ready": 0, material: 0, doc: 0, audio: 0, other: 0 };
    for (const n of src) if (n.kind === "file") c[tagOf(n, src)]++;
    return c;
  }, [nodes, virtualNodes, parent]);


  // Batch-prefetch signed URLs for image + video files visible in current view (for covers).
  useEffect(() => {
    const list = (filtered || []).filter(n =>
      n.kind === "file" && !n.__virtual && n.storage_path && !signedUrls[n.storage_path!]
    );
    const imgTargets = list.filter(n => kindOf(n) === "image").slice(0, 60);
    const vidTargets = list.filter(n => kindOf(n) === "video").slice(0, 24);
    if (!imgTargets.length && !vidTargets.length) return;
    let alive = true;
    (async () => {
      const jobs: Promise<any>[] = [];
      if (imgTargets.length) {
        jobs.push((supabase.storage.from("workspace") as any).createSignedUrls(
          imgTargets.map(n => n.storage_path!), 3600,
          { transform: { width: 400, quality: 70, resize: "cover" } }
        ));
      }
      if (vidTargets.length) {
        jobs.push(supabase.storage.from("workspace").createSignedUrls(
          vidTargets.map(n => n.storage_path!), 3600
        ));
      }
      const results = await Promise.all(jobs);
      if (!alive) return;
      setSignedUrls(prev => {
        const next = { ...prev };
        for (const r of results) {
          for (const row of (r?.data as any[] | undefined) || []) {
            if (row?.signedUrl && row?.path) next[row.path] = row.signedUrl;
          }
        }
        return next;
      });
    })();
    return () => { alive = false; };
  }, [filtered]);

  const coverFor = (n: Node): string | null => {
    if (n.kind !== "file") return null;
    const k = kindOf(n);
    if (k !== "image" && k !== "video") return null;
    if (n.__virtual) return n.__external_url || null;
    if (n.storage_path && signedUrls[n.storage_path]) return signedUrls[n.storage_path];
    return null;
  };





  async function signedUrl(path: string) {
    if (signedUrls[path]) return signedUrls[path];
    const { data } = await supabase.storage.from("workspace").createSignedUrl(path, 3600);
    if (data?.signedUrl) {
      setSignedUrls(p => ({ ...p, [path]: data.signedUrl }));
      return data.signedUrl;
    }
    return "";
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["workspace-nodes"] });
    qc.invalidateQueries({ queryKey: ["workspace-folders"] });
    qc.invalidateQueries({ queryKey: ["workspace-client-files"] });
    qc.invalidateQueries({ queryKey: ["files"] });
  }

  async function urlFor(n: Node): Promise<string> {
    if (n.__virtual) return n.__external_url || "";
    if (n.storage_path) return signedUrl(n.storage_path);
    return "";
  }

  async function createFolder() {
    if (!newFolderName.trim() || !user) return;
    const { error } = await supabase.from("workspace_nodes").insert({
      name: newFolderName.trim(), kind: "folder", scope,
      client_id: scope === "client" ? clientId : null,
      parent_id: parent?.id || null, created_by: user.id,
    });
    if (error) { toast({ title: "Erro ao criar pasta", description: error.message, variant: "destructive" }); return; }
    setNewFolderName(""); setNewFolderOpen(false);
    invalidate();
  }

  async function applyTemplate(tpl: WorkspaceTemplate) {
    if (!user) return;
    if (tpl.scope === "global" && scope !== "global") {
      toast({ title: "Template exclusivo da agência", description: "Alterne para o contexto Global para aplicar.", variant: "destructive" });
      return;
    }
    setApplyingTpl(tpl.id);
    try {
      // Load existing folder names at the target parent to avoid duplicates
      const { data: existing } = await supabase
        .from("workspace_nodes")
        .select("name")
        .eq("scope", scope)
        .eq("kind", "folder")
        .is("parent_id", parent?.id || null as any);
      const existingNames = new Set((existing || []).map((r: any) => r.name.toLowerCase()));

      let created = 0;
      const insertTree = async (nodes: TplNode[], parentId: string | null, skipCheck = false) => {
        for (const n of nodes) {
          let id: string | null = null;
          if (!skipCheck && !parentId && existingNames.has(n.name.toLowerCase())) {
            // Reuse existing top-level folder if present
            const { data: found } = await supabase
              .from("workspace_nodes")
              .select("id")
              .eq("scope", scope)
              .eq("kind", "folder")
              .is("parent_id", parent?.id || null as any)
              .ilike("name", n.name)
              .maybeSingle();
            id = (found as any)?.id || null;
          }
          if (!id) {
            const { data, error } = await supabase.from("workspace_nodes").insert({
              name: n.name, kind: "folder", scope,
              client_id: scope === "client" ? clientId : null,
              parent_id: parentId, created_by: user.id,
            }).select("id").single();
            if (error) throw error;
            id = (data as any).id;
            created++;
          }
          if (n.children?.length && id) await insertTree(n.children, id, true);
        }
      };
      await insertTree(tpl.tree, parent?.id || null);
      toast({ title: "Template aplicado", description: `${created} pastas criadas.` });
      setTemplateOpen(false);
      invalidate();
    } catch (e: any) {
      toast({ title: "Erro ao aplicar template", description: e.message, variant: "destructive" });
    } finally {
      setApplyingTpl(null);
    }
  }

  // Pipeline destinos por SmartTag. Nomes alinhados ao template "Pipeline Vídeo e Áudio".
  const PIPELINE_TARGETS: Record<SmartTag, string | null> = {
    material:      "1. Brutos",
    audio:         "2. Trilhas e SFX",
    "video-ready": "3. Edição",
    carrossel:     "Carrosséis",
    static:        "Estáticos",
    doc:           "Documentos",
    other:         null,
  };
  function pipelineTargetFor(n: Node, siblings: Node[]): string | null {
    const tag = tagOf(n, siblings);
    // Vídeos "final/pronto/entrega" vão para "4. Final" em vez de Edição
    if (tag === "video-ready") {
      const ctx = `${n.name || ""} ${n.storage_path || ""}`.toLowerCase();
      if (/(final|pronto|entrega|export|approved|aprovad|v\s*final|vf\b)/i.test(ctx)) return "4. Final";
    }
    return PIPELINE_TARGETS[tag];
  }

  async function autoOrganize() {
    if (!user || organizing) return;
    if (scope === "client" && !clientId) {
      toast({ title: "Selecione um cliente", variant: "destructive" });
      return;
    }
    // Só organiza nós reais do nível atual (não virtuais, não subpastas).
    const source = (nodes || []).filter(n => n.kind === "file" && !n.__virtual);
    if (!source.length) {
      toast({ title: "Nada para organizar", description: "Sem arquivos soltos neste nível." });
      return;
    }
    setOrganizing(true);
    try {
      // Agrupa por destino
      const groups = new Map<string, Node[]>();
      let skipped = 0;
      for (const f of source) {
        const dest = pipelineTargetFor(f, source);
        if (!dest) { skipped++; continue; }
        if (!groups.has(dest)) groups.set(dest, []);
        groups.get(dest)!.push(f);
      }
      if (!groups.size) {
        toast({ title: "Nada classificável", description: "Arquivos não se encaixam no pipeline." });
        return;
      }
      // Resolve/cria pastas destino no nível atual
      const parentId = parent?.id || null;
      const { data: existing } = await supabase
        .from("workspace_nodes")
        .select("id, name")
        .eq("scope", scope)
        .eq("kind", "folder")
        .is("parent_id", parentId as any);
      const byName = new Map<string, string>();
      for (const r of (existing || []) as any[]) byName.set((r.name || "").toLowerCase(), r.id);

      let created = 0;
      const folderIds = new Map<string, string>();
      for (const name of groups.keys()) {
        const existingId = byName.get(name.toLowerCase());
        if (existingId) { folderIds.set(name, existingId); continue; }
        const { data, error } = await supabase.from("workspace_nodes").insert({
          name, kind: "folder", scope,
          client_id: scope === "client" ? clientId : null,
          parent_id: parentId, created_by: user.id,
        }).select("id").single();
        if (error) throw error;
        folderIds.set(name, (data as any).id);
        created++;
      }

      // Move em lote
      let moved = 0;
      for (const [dest, items] of groups.entries()) {
        const destId = folderIds.get(dest);
        if (!destId) continue;
        const ids = items.map(i => i.id);
        const { error } = await supabase.from("workspace_nodes")
          .update({ parent_id: destId }).in("id", ids);
        if (error) throw error;
        moved += ids.length;
      }
      toast({
        title: "Organização concluída",
        description: `${moved} arquivo(s) movido(s), ${created} pasta(s) criada(s)${skipped ? `, ${skipped} ignorado(s)` : ""}`,
      });
      invalidate();
    } catch (e: any) {
      toast({ title: "Erro ao organizar", description: e.message, variant: "destructive" });
    } finally {
      setOrganizing(false);
    }
  }


  // Ensures the destination parent is always a real workspace_nodes UUID.
  // If uploading inside a virtual folder (grouping of public.files.folder),
  // materialize a real folder with the same name at the client root so
  // Postgres never receives a "virt:..." string as parent_id.
  async function resolveRealParentId(rawParent: string | null | undefined): Promise<string | null> {
    if (!rawParent) return null;
    if (!isVirt(rawParent)) return rawParent;
    if (!rawParent.startsWith(VIRT_PREFIX + "folder:")) return null;
    if (scope !== "client" || !clientId) return null;
    const folderName = rawParent.substring((VIRT_PREFIX + "folder:").length).trim();
    if (!folderName) return null;
    const { data: existing } = await supabase
      .from("workspace_nodes")
      .select("id")
      .eq("scope", "client")
      .eq("client_id", clientId)
      .eq("kind", "folder")
      .is("parent_id", null)
      .ilike("name", folderName)
      .maybeSingle();
    if ((existing as any)?.id) return (existing as any).id as string;
    const { data: created, error } = await supabase.from("workspace_nodes").insert({
      name: folderName, kind: "folder", scope: "client",
      client_id: clientId, parent_id: null, created_by: user?.id ?? null,
    }).select("id").single();
    if (error || !created) throw error || new Error("Falha ao criar pasta");
    return (created as any).id as string;
  }

  async function handleUpload(files: FileList | null, targetFolderId?: string | null) {
    if (!files || !files.length || !user) return;
    const rawParent = targetFolderId !== undefined ? targetFolderId : (parent?.id || null);
    let destParent: string | null;
    try {
      destParent = await resolveRealParentId(rawParent);
    } catch (e: any) {
      toast({ title: "Erro ao preparar pasta", description: e?.message || "Tente novamente.", variant: "destructive" });
      return;
    }
    uploads.enqueue({
      files: Array.from(files),
      scope,
      clientId,
      parentId: destParent,
      userId: user.id,
      onDone: () => invalidate(),
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }


  async function performDelete(n: Node) {
    // Virtual folder (grouping of files.folder) — clear folder field on those files
    if (n.__virtual && n.kind === "folder") {
      const folderName = n.id.substring((VIRT_PREFIX + "folder:").length);
      await (supabase as any).from("files").update({ folder: null })
        .eq("client_id", clientId).eq("folder", folderName);
      setSelected(null); setConfirmDelete(null);
      toast({ title: "Pasta virtual removida", description: "Os arquivos permanecem em Arquivos." });
      invalidate(); return;
    }
    // Virtual file — delete from public.files
    if (n.__virtual && n.kind === "file" && n.__file_id) {
      await (supabase as any).from("files").delete().eq("id", n.__file_id);
      setSelected(null); setConfirmDelete(null);
      toast({ title: "Excluído" });
      invalidate(); return;
    }
    if (n.kind === "folder") {
      const collected: string[] = [];
      const stack = [n.id];
      while (stack.length) {
        const pid = stack.pop()!;
        const { data: children } = await (supabase as any).from("workspace_nodes")
          .select("id, kind, storage_path").eq("parent_id", pid);
        for (const c of children || []) {
          if (c.kind === "folder") stack.push(c.id);
          else if (c.storage_path) collected.push(c.storage_path);
        }
      }
      if (collected.length) await supabase.storage.from("workspace").remove(collected);
    } else if (n.storage_path) {
      await supabase.storage.from("workspace").remove([n.storage_path]);
    }
    await supabase.from("workspace_nodes").delete().eq("id", n.id);
    setSelected(null); setConfirmDelete(null);
    toast({ title: "Excluído" });
    invalidate();
  }

  async function renameNode() {
    if (!renaming || !renameValue.trim()) return;
    if (renaming.__virtual) {
      if (renaming.kind === "file" && renaming.__file_id) {
        await (supabase as any).from("files").update({ file_name: renameValue.trim() }).eq("id", renaming.__file_id);
      } else if (renaming.kind === "folder") {
        const oldName = renaming.id.substring((VIRT_PREFIX + "folder:").length);
        await (supabase as any).from("files").update({ folder: renameValue.trim() })
          .eq("client_id", clientId).eq("folder", oldName);
      }
      setRaming(null); setRenameValue(""); invalidate(); return;
    }
    const { error } = await supabase.from("workspace_nodes")
      .update({ name: renameValue.trim() }).eq("id", renaming.id);
    if (error) { toast({ title: "Erro ao renomear", description: error.message, variant: "destructive" }); return; }
    setRaming(null); setRenameValue("");
    invalidate();
  }

  // Check target isn't descendant of source folder
  function isDescendant(sourceId: string, targetId: string | null): boolean {
    if (!targetId) return false;
    if (sourceId === targetId) return true;
    const byId = new Map((allFolders || []).map(f => [f.id, f]));
    let cur = byId.get(targetId);
    while (cur) {
      if (cur.id === sourceId) return true;
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return false;
  }

  async function moveNode(n: Node, targetParentId: string | null) {
    if (n.__virtual) {
      // Virtual file: change files.folder to match target virtual folder or clear
      if (n.kind === "file" && n.__file_id) {
        let newFolder: string | null = null;
        if (targetParentId && targetParentId.startsWith(VIRT_PREFIX + "folder:")) {
          newFolder = targetParentId.substring((VIRT_PREFIX + "folder:").length);
        }
        await (supabase as any).from("files").update({ folder: newFolder }).eq("id", n.__file_id);
        toast({ title: "Movido" }); invalidate(); return;
      }
      toast({ title: "Ação não suportada", description: "Pastas virtuais não podem ser movidas.", variant: "destructive" });
      return;
    }
    if (targetParentId && isVirt(targetParentId)) {
      toast({ title: "Destino inválido", description: "Não é possível mover para pastas de Arquivos.", variant: "destructive" });
      return;
    }
    if (n.kind === "folder" && isDescendant(n.id, targetParentId)) {
      toast({ title: "Movimento inválido", description: "Não pode mover para dentro de si mesma.", variant: "destructive" });
      return;
    }
    if (n.parent_id === targetParentId) return;
    const { error } = await supabase.from("workspace_nodes")
      .update({ parent_id: targetParentId }).eq("id", n.id);
    if (error) { toast({ title: "Erro ao mover", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Movido" });
    invalidate();
  }

  async function createFolderAndMove() {
    if (!moveCreate || !user || !moveCreateName.trim()) return;
    const { node, parentId } = moveCreate;
    if (node.__virtual) {
      toast({ title: "Ação não suportada", description: "Itens de Arquivos não podem ser movidos para novas pastas.", variant: "destructive" });
      setMoveCreate(null); setMoveCreateName(""); return;
    }
    const { data, error } = await supabase.from("workspace_nodes").insert({
      name: moveCreateName.trim(), kind: "folder", scope,
      client_id: scope === "client" ? clientId : null,
      parent_id: parentId, created_by: user.id,
    }).select("id").single();
    if (error || !data) {
      toast({ title: "Erro ao criar pasta", description: error?.message, variant: "destructive" });
      return;
    }
    const newId = (data as any).id as string;
    const { error: mvErr } = await supabase.from("workspace_nodes")
      .update({ parent_id: newId }).eq("id", node.id);
    if (mvErr) { toast({ title: "Pasta criada, mas falhou ao mover", description: mvErr.message, variant: "destructive" }); }
    else toast({ title: "Pasta criada e item movido" });
    setMoveCreate(null); setMoveCreateName("");
    invalidate();
  }

  async function sendToApproval(n: Node) {
    if (!user || n.kind !== "file" || !n.storage_path) return;
    if (scope !== "client" || !clientId) {
      toast({ title: "Selecione um cliente", description: "Aprovação é enviada em contexto de cliente.", variant: "destructive" });
      return;
    }
    try {
      const { data: blobData, error: dlErr } = await supabase.storage.from("workspace").download(n.storage_path);
      if (dlErr) throw dlErr;
      const newKey = `${clientId}/${crypto.randomUUID()}-${n.name}`;
      const { error: upErr } = await supabase.storage.from("files").upload(newKey, blobData, {
        contentType: n.mime || undefined, upsert: false,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("files").getPublicUrl(newKey);
      const { data: fileRow, error: insErr } = await supabase.from("files").insert({
        file_name: n.name, file_url: pub.publicUrl, file_type: n.mime || "application/octet-stream",
        file_size: n.size_bytes || 0, uploaded_by: user.id, client_id: clientId,
        approval_status: "pending", folder: "materiais",
      }).select().single();
      if (insErr) throw insErr;
      await supabase.from("workspace_nodes").update({ sent_for_approval_file_id: fileRow.id }).eq("id", n.id);
      toast({ title: "Enviado para aprovação" });
      invalidate();
      qc.invalidateQueries({ queryKey: ["files"] });
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
  }

  // DnD handlers
  function onDragStartNode(e: React.DragEvent, n: Node) {
    e.dataTransfer.setData("application/x-ws-node", n.id);
    e.dataTransfer.effectAllowed = "move";
  }
  function onDragOverFolder(e: React.DragEvent, folderId: string | "root") {
    if (e.dataTransfer.types.includes("application/x-ws-node") || e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = e.dataTransfer.types.includes("Files") ? "copy" : "move";
      setDragOverId(folderId);
    }
  }
  async function onDropFolder(e: React.DragEvent, folderId: string | null) {
    e.preventDefault(); setDragOverId(null); setDragOverArea(false);
    const nodeId = e.dataTransfer.getData("application/x-ws-node");
    if (nodeId) {
      const src = (nodes || []).find(x => x.id === nodeId);
      if (src) await moveNode(src, folderId);
      return;
    }
    if (e.dataTransfer.files?.length) {
      await handleUpload(e.dataTransfer.files, folderId);
    }
  }

  function renderActionsMenu(n: Node) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
          <button className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground">
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
          {n.kind === "folder" && (
            <DropdownMenuItem onSelect={() => setParentStack([...parentStack, n])}>
              <Folder className="w-3.5 h-3.5 mr-2" /> Abrir
            </DropdownMenuItem>
          )}
          {n.kind === "file" && (
            <DropdownMenuItem onSelect={() => setSelected(n)}>
              <ExternalLink className="w-3.5 h-3.5 mr-2" /> Visualizar
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => { setRaming(n); setRenameValue(n.name); }}>
            <Pencil className="w-3.5 h-3.5 mr-2" /> Renomear
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput className="w-3.5 h-3.5 mr-2" /> Mover para
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto w-64">
              {!n.__virtual && (
                <>
                  <DropdownMenuItem onSelect={() => { setMoveCreate({ node: n, parentId: null, parentLabel: "Raiz" }); setMoveCreateName(suggestFolderName(n)); }}>
                    <FolderPlus className="w-3.5 h-3.5 mr-2 text-primary" /> Nova pasta na raiz…
                  </DropdownMenuItem>
                  {parent && (
                    <DropdownMenuItem onSelect={() => { setMoveCreate({ node: n, parentId: parent.id, parentLabel: parent.name }); setMoveCreateName(suggestFolderName(n)); }}>
                      <FolderPlus className="w-3.5 h-3.5 mr-2 text-primary" /> Nova pasta em “{parent.name}”…
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onSelect={() => moveNode(n, null)}>
                <Globe2 className="w-3.5 h-3.5 mr-2" /> Raiz
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {(allFolders || [])
                .filter(f => f.id !== n.id && !(n.kind === "folder" && isDescendant(n.id, f.id)))
                .sort((a, b) => (folderPaths.get(a.id) || "").localeCompare(folderPaths.get(b.id) || ""))
                .map(f => (
                  <DropdownMenuItem key={f.id} onSelect={() => moveNode(n, f.id)}>
                    <Folder className="w-3.5 h-3.5 mr-2 text-primary" />
                    <span className="truncate">{folderPaths.get(f.id) || f.name}</span>
                  </DropdownMenuItem>
                ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirmDelete(n)} className="text-destructive focus:text-destructive">
            <Trash2 className="w-3.5 h-3.5 mr-2" /> Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  async function copyLink(n: Node) {
    try {
      const url = await urlFor(n);
      if (!url) throw new Error("Sem link disponível");
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copiado" });
    } catch (e: any) {
      toast({ title: "Não foi possível copiar", description: e?.message, variant: "destructive" });
    }
  }

  async function shareInbox(n: Node) {
    if (n.kind !== "folder" || n.__virtual) return;
    try {
      // Buscar token existente ou gerar novo
      const { data: current } = await (supabase as any)
        .from("workspace_nodes").select("inbox_token").eq("id", n.id).maybeSingle();
      let token = current?.inbox_token as string | null;
      if (!token) {
        token = crypto.randomUUID();
        const { error } = await supabase.from("workspace_nodes")
          .update({ inbox_token: token } as any).eq("id", n.id);
        if (error) throw error;
      }
      const url = `${window.location.origin}/inbox/${token}`;
      await navigator.clipboard.writeText(url);
      toast({
        title: "Link de upload copiado",
        description: "Qualquer pessoa com este link pode enviar arquivos para " + n.name,
      });
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message, variant: "destructive" });
    }
  }


  function renderContextMenu(n: Node, children: React.ReactNode) {
    const isFolder = n.kind === "folder";
    const canApprove = !isFolder && !n.__virtual && !!n.storage_path && scope === "client" && !!clientId;
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {isFolder ? (
            <>
              <ContextMenuItem onSelect={() => setParentStack([...parentStack, n])}>
                <Folder className="w-3.5 h-3.5 mr-2" /> Abrir
              </ContextMenuItem>
              {!n.__virtual && (
                <ContextMenuItem onSelect={() => shareInbox(n)}>
                  <Link2 className="w-3.5 h-3.5 mr-2" /> Compartilhar link de upload
                </ContextMenuItem>
              )}
            </>
          ) : (
            <>
              <ContextMenuItem onSelect={() => setSelected(n)}>
                <ExternalLink className="w-3.5 h-3.5 mr-2" /> Visualizar
              </ContextMenuItem>
              <ContextMenuItem onSelect={async () => openFile(await urlFor(n))}>
                <ExternalLink className="w-3.5 h-3.5 mr-2" /> Abrir em nova aba
              </ContextMenuItem>
              <ContextMenuItem onSelect={async () => downloadFile(await urlFor(n), n.name)}>
                <Download className="w-3.5 h-3.5 mr-2" /> Baixar
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => copyLink(n)}>
                <Link2 className="w-3.5 h-3.5 mr-2" /> Copiar link
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => { setRaming(n); setRenameValue(n.name); }}>
            <Pencil className="w-3.5 h-3.5 mr-2" /> Renomear
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <FolderInput className="w-3.5 h-3.5 mr-2" /> Mover para
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="max-h-72 overflow-y-auto w-64">
              {!n.__virtual && (
                <>
                  <ContextMenuItem onSelect={() => { setMoveCreate({ node: n, parentId: null, parentLabel: "Raiz" }); setMoveCreateName(suggestFolderName(n)); }}>
                    <FolderPlus className="w-3.5 h-3.5 mr-2 text-primary" /> Nova pasta na raiz…
                  </ContextMenuItem>
                  {parent && (
                    <ContextMenuItem onSelect={() => { setMoveCreate({ node: n, parentId: parent.id, parentLabel: parent.name }); setMoveCreateName(suggestFolderName(n)); }}>
                      <FolderPlus className="w-3.5 h-3.5 mr-2 text-primary" /> Nova pasta em “{parent.name}”…
                    </ContextMenuItem>
                  )}
                  <ContextMenuSeparator />
                </>
              )}
              <ContextMenuItem onSelect={() => moveNode(n, null)}>
                <Globe2 className="w-3.5 h-3.5 mr-2" /> Raiz
              </ContextMenuItem>
              <ContextMenuSeparator />
              {(allFolders || [])
                .filter(f => f.id !== n.id && !(n.kind === "folder" && isDescendant(n.id, f.id)))
                .sort((a, b) => (folderPaths.get(a.id) || "").localeCompare(folderPaths.get(b.id) || ""))
                .map(f => (
                  <ContextMenuItem key={f.id} onSelect={() => moveNode(n, f.id)}>
                    <Folder className="w-3.5 h-3.5 mr-2 text-primary" />
                    <span className="truncate">{folderPaths.get(f.id) || f.name}</span>
                  </ContextMenuItem>
                ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          {canApprove && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => sendToApproval(n)}>
                <Send className="w-3.5 h-3.5 mr-2" /> Enviar para aprovação
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => setConfirmDelete(n)} className="text-destructive focus:text-destructive">
            <Trash2 className="w-3.5 h-3.5 mr-2" /> Excluir
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }



  if (!isStaff) {
    return <div className="p-8 text-center text-muted-foreground">Acesso restrito à equipe.</div>;
  }

  const rootDropActive = dragOverArea && dragOverId === null;

  const filteredClients = useMemo(() => {
    const list = [...(clients || [])] as any[];
    const q = pickerQuery.trim().toLowerCase();
    let out = q ? list.filter(c => ((c.company_name || c.full_name || "").toLowerCase().includes(q))) : list;
    if (pickerFilter === "az") out = [...out].sort((a, b) => (a.company_name || a.full_name || "").localeCompare(b.company_name || b.full_name || ""));
    else if (pickerFilter === "za") out = [...out].sort((a, b) => (b.company_name || b.full_name || "").localeCompare(a.company_name || a.full_name || ""));
    return out;
  }, [clients, pickerQuery, pickerFilter]);

  const currentClient = (clients || []).find((c: any) => c.id === clientId) as any;
  const contextLabel = scope === "global"
    ? "Global (Agência)"
    : currentClient ? (currentClient.company_name || currentClient.full_name) : "Selecionar cliente";

  return (
    <div className="flex h-full min-h-0 flex-col animate-fade-in md:block md:h-auto md:max-w-[1400px] md:mx-auto md:px-6 md:pt-20 md:pb-8">
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-background/95 pb-3 md:mb-5 md:border-b-0 md:bg-transparent md:pb-0">
        <div className="min-w-0">
          <h1 className="text-lg md:text-2xl font-bold tracking-tight">Workspace</h1>
          <p className="hidden md:block text-xs text-muted-foreground mt-1">Drive interno da equipe. Arraste para mover, solte arquivos para enviar</p>
        </div>
        {/* Context switcher: collapsed picker with search + filters */}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-2 px-3 h-10 rounded-xl border border-border bg-card hover:border-primary/40 transition-colors min-w-[160px] max-w-[220px] md:max-w-[320px]">
              {scope === "global" ? <Globe2 className="w-4 h-4 text-primary shrink-0" /> : <Folder className="w-4 h-4 text-primary shrink-0" />}
              <span className="text-sm truncate flex-1 text-left">{contextLabel}</span>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[320px] max-w-[calc(100vw-1rem)] p-0 max-h-[75vh] overflow-hidden flex flex-col">
            <div className="p-2 border-b border-border">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input autoFocus value={pickerQuery} onChange={e => setPickerQuery(e.target.value)} placeholder="Buscar cliente..." className="h-8 pl-8 text-xs" />
              </div>
              <div className="flex items-center gap-1 mt-2">
                {[
                  { k: "all", label: "Padrão" },
                  { k: "az", label: "A-Z" },
                  { k: "za", label: "Z-A" },
                ].map((f) => (
                  <button
                    key={f.k}
                    onClick={() => setPickerFilter(f.k as any)}
                    className={cn("px-2 py-1 text-[10px] rounded-md border transition-colors",
                      pickerFilter === f.k ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}
                  >{f.label}</button>
                ))}
              </div>
            </div>
            <div className="p-1">
              <button
                onClick={() => { setScope("global"); setClientId(null); setPickerOpen(false); }}
                className={cn("w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm transition-colors",
                  scope === "global" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50")}
              >
                <Globe2 className="w-4 h-4" /> Global (Agência)
                {scope === "global" && <Check className="w-3.5 h-3.5 ml-auto" />}
              </button>
            </div>
            <div className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <UsersIcon className="w-3 h-3" /> Clientes {filteredClients.length > 0 && <span className="text-muted-foreground/60">({filteredClients.length})</span>}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-1">
              {filteredClients.map((c: any) => {
                const active = scope === "client" && clientId === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => { setScope("client"); setClientId(c.id); setPickerOpen(false); }}
                    className={cn("w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] transition-colors",
                      active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50")}
                  >
                    <Folder className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate flex-1">{c.company_name || c.full_name}</span>
                    {active && <Check className="w-3.5 h-3.5" />}
                  </button>
                );
              })}
              {!filteredClients.length && (
                <p className="text-xs text-muted-foreground px-3 py-4 text-center">Nenhum cliente encontrado</p>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 gap-4 overflow-hidden md:overflow-visible">
        {/* Main */}
        <main className="min-h-0 min-w-0 flex flex-col md:block md:space-y-4">
          {/* Breadcrumb + actions */}
          <div className="shrink-0 flex flex-wrap items-center gap-2 justify-between py-3 md:py-0">
            <div className="flex w-full items-center gap-1 overflow-x-auto text-sm scrollbar-hidden md:w-auto md:flex-wrap md:overflow-visible min-w-0">
              {parent && (
                <button onClick={() => setParentStack(parentStack.slice(0, -1))}
                  className="p-1 rounded hover:bg-secondary text-muted-foreground mr-1"><ArrowLeft className="w-3.5 h-3.5" /></button>
              )}
              <button
                onClick={() => setParentStack([])}
                onDragOver={(e) => onDragOverFolder(e, "root")}
                onDragLeave={() => setDragOverId(null)}
                onDrop={(e) => onDropFolder(e, null)}
                className={cn("text-muted-foreground hover:text-foreground truncate px-2 py-1 rounded",
                  dragOverId === "root" && "bg-primary/10 text-primary ring-1 ring-primary/40")}
              >
                {scope === "global"
                  ? "Global"
                  : (clients?.find((c: any) => c.id === clientId)?.company_name || clients?.find((c: any) => c.id === clientId)?.full_name || "Cliente")}
              </button>
              {parentStack.map((n, i) => (
                <span key={n.id} className="flex items-center gap-1 min-w-0">
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <button
                    className="text-foreground hover:text-primary truncate max-w-[180px]"
                    onClick={() => setParentStack(parentStack.slice(0, i + 1))}
                  >{n.name}</button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-nowrap w-full overflow-x-auto scrollbar-hidden sm:w-auto sm:flex-wrap sm:overflow-visible">
              <div className="relative flex-1 sm:flex-none min-w-[140px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..." className="h-9 sm:h-8 pl-8 w-full sm:w-[180px] text-xs" />
              </div>
              <div className="flex rounded-md border border-border overflow-hidden">
                <button onClick={() => setView("grid")} className={cn("p-2 sm:p-1.5", view === "grid" ? "bg-secondary text-foreground" : "text-muted-foreground")}>
                  <Grid2X2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setView("list")} className={cn("p-2 sm:p-1.5", view === "list" ? "bg-secondary text-foreground" : "text-muted-foreground")}>
                  <List className="w-3.5 h-3.5" />
                </button>
              </div>
              <Button size="sm" variant="outline" onClick={() => setNewFolderOpen(true)} className="gap-1.5 h-9 sm:h-8 px-2 sm:px-3">
                <FolderPlus className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Pasta</span>
              </Button>
              <Button size="sm" variant="outline" onClick={() => setTemplateOpen(true)} className="gap-1.5 h-9 sm:h-8 px-2 sm:px-3">
                <Sparkles className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Template</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={autoOrganize}
                disabled={organizing}
                title="Move os arquivos deste nível para pastas do pipeline com base no nome e tipo"
                className="gap-1.5 h-9 sm:h-8 px-2 sm:px-3"
              >
                {organizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">Auto-organizar</span>
              </Button>
              <Button size="sm" onClick={() => fileInputRef.current?.click()} className="gap-1.5 h-9 sm:h-8 px-2 sm:px-3 ml-auto sm:ml-0 shrink-0">
                <Upload className="w-3.5 h-3.5" />
                Upload
              </Button>
              <input ref={fileInputRef} type="file" multiple hidden onChange={e => handleUpload(e.target.files)} />
            </div>

          </div>

          {/* Smart tag chips + sort */}
          <div className="shrink-0 flex flex-nowrap md:flex-wrap items-center gap-1.5 mb-3 overflow-x-auto scrollbar-hidden pb-1 md:overflow-visible md:pb-0">
            <button
              onClick={() => setTagFilter("all")}
              className={cn(
                "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
                tagFilter === "all"
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
              )}
            >
              Todos <span className="opacity-60">{(nodes?.length || 0) + (virtualNodes?.length || 0)}</span>
            </button>
            {SMART_TAGS.filter(t => t.key !== "other" || tagCounts.other > 0).map(t => (
              <button
                key={t.key}
                onClick={() => setTagFilter(t.key)}
                title={t.hint}
                className={cn(
                  "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
                  tagFilter === t.key
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
                )}
              >
                {t.label} <span className="opacity-60">{tagCounts[t.key]}</span>
              </button>
            ))}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {([
                ["recent", "Recentes"],
                ["old", "Antigos"],
                ["az", "A–Z"],
                ["za", "Z–A"],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setSortBy(k)}
                  className={cn(
                    "px-2 py-1 rounded-md text-[10px] font-mono uppercase tracking-wider border transition-colors",
                    sortBy === k
                      ? "bg-secondary border-primary/30 text-foreground"
                      : "bg-transparent border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>




          {/* Drop zone wrapper */}
          <div
            onDragEnter={(e) => { if (e.dataTransfer.types.includes("Files")) { setDragOverArea(true); } }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("application/x-ws-node")) {
                e.preventDefault();
                if (!dragOverId) setDragOverArea(true);
              }
            }}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) setDragOverArea(false);
            }}
            onDrop={(e) => { if (!dragOverId || dragOverId === "root") onDropFolder(e, parent?.id || null); }}
            className={cn("relative flex-1 min-h-0 overflow-y-auto rounded-xl transition-all md:overflow-visible px-0.5 pb-[max(1rem,env(safe-area-inset-bottom))]",
              rootDropActive && "ring-2 ring-primary/50 bg-primary/5")}
            style={{ overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}

          >
            {rootDropActive && (
              <div className="absolute inset-0 rounded-xl bg-primary/10 border-2 border-dashed border-primary/50 flex items-center justify-center pointer-events-none z-10">
                <p className="text-sm font-medium text-primary">Solte para enviar aqui</p>
              </div>
            )}

            {scope === "client" && !clientId ? (
              <div className="text-center py-16 text-sm text-muted-foreground">Selecione um cliente na barra lateral.</div>
            ) : isLoading ? (
              <div className="text-center py-16 text-sm text-muted-foreground">Carregando...</div>
            ) : !filtered.length ? (
              <div className="text-center py-16 text-sm text-muted-foreground">
                <Folder className="w-8 h-8 mx-auto mb-2 opacity-40" />
                Pasta vazia. Arraste arquivos aqui, envie ou crie uma subpasta.
              </div>
            ) : view === "grid" ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 pb-3 md:pb-0">
                {filtered.map(n => {
                  const Icon = iconFor(n);
                  const isFolder = n.kind === "folder";
                  const dragActive = dragOverId === n.id && isFolder;
                  const cover = coverFor(n);
                  const k = kindOf(n);
                  return (
                    <div key={n.id}>
                    {renderContextMenu(n, (
                    <div
                      draggable
                      onDragStart={(e) => onDragStartNode(e, n)}
                      onDragOver={(e) => isFolder && onDragOverFolder(e, n.id)}
                      onDragLeave={() => isFolder && setDragOverId(null)}
                      onDrop={(e) => isFolder && onDropFolder(e, n.id)}
                      onClick={() => isFolder ? setParentStack([...parentStack, n]) : setSelected(n)}
                      className={cn(
                        "group relative rounded-xl border bg-card hover:border-primary/40 transition-all overflow-hidden flex flex-col cursor-pointer aspect-square",
                        dragActive ? "border-primary bg-primary/10 ring-2 ring-primary/40" : "border-border"
                      )}
                    >
                      <div className="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                        {renderActionsMenu(n)}
                      </div>
                      {n.sent_for_approval_file_id && (
                        <span className="absolute top-1.5 left-1.5 z-10 text-[9px] px-1.5 py-0.5 rounded-full bg-warning/15 text-warning backdrop-blur">↗ aprovação</span>
                      )}
                      <div className={cn(
                        "flex-1 flex items-center justify-center w-full relative overflow-hidden",
                        !cover && `bg-gradient-to-br ${isFolder ? "from-primary/20 via-primary/5 to-transparent" : KIND_META[k].gradient}`
                      )}>
                        {cover ? (
                          k === "video" ? (
                            <>
                              <video src={cover} className="absolute inset-0 w-full h-full object-cover" muted playsInline preload="metadata" />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent flex items-center justify-center">
                                <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                                  <Film className="w-5 h-5 text-black" />
                                </div>
                              </div>
                            </>
                          ) : (
                            <img src={cover} alt={n.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                          )
                        ) : (
                          <>
                            {/* Decorative pattern */}
                            <div className="absolute inset-0 opacity-[0.07]" style={{
                              backgroundImage: "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
                              backgroundSize: "14px 14px"
                            }} />
                            <div className="relative flex flex-col items-center gap-2">
                              <Icon className={cn("w-12 h-12 drop-shadow-sm", isFolder ? "text-primary" : KIND_META[k].color)} />
                              {!isFolder && extOf(n.name) && (
                                <span className={cn(
                                  "text-[9px] font-mono font-semibold tracking-wider px-2 py-0.5 rounded-full border bg-background/60 backdrop-blur",
                                  KIND_META[k].accent, "border-current/30"
                                )}>
                                  {extOf(n.name)}
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                      <div className="px-2.5 py-1.5 border-t border-border/60 bg-card/95 backdrop-blur">
                        <p className="text-[11px] font-medium text-foreground truncate">{n.name}</p>
                        {!isFolder && (
                          <p className="text-[10px] text-muted-foreground truncate">
                            {KIND_META[k].label} · {fmtSize(n.size_bytes)}
                          </p>
                        )}
                      </div>

                    </div>
                    ))}
                    </div>
                  );
                })}
              </div>

            ) : (
              <div className="rounded-xl border border-border bg-card divide-y divide-border">
                {filtered.map(n => {
                  const Icon = iconFor(n);
                  const isFolder = n.kind === "folder";
                  const dragActive = dragOverId === n.id && isFolder;
                  return (
                    <div key={n.id}>
                    {renderContextMenu(n, (
                    <div
                      draggable
                      onDragStart={(e) => onDragStartNode(e, n)}
                      onDragOver={(e) => isFolder && onDragOverFolder(e, n.id)}
                      onDragLeave={() => isFolder && setDragOverId(null)}
                      onDrop={(e) => isFolder && onDropFolder(e, n.id)}
                      onClick={() => isFolder ? setParentStack([...parentStack, n]) : setSelected(n)}
                      className={cn("w-full flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/40 transition-colors cursor-pointer",
                        dragActive && "bg-primary/10 ring-1 ring-primary/40")}
                    >
                      <Icon className={cn("w-4 h-4 shrink-0", isFolder ? "text-primary" : "text-muted-foreground")} />
                      <span className="flex-1 text-[13px] truncate">{n.name}</span>
                      {!isFolder && <span className="text-[11px] text-muted-foreground">{fmtSize(n.size_bytes)}</span>}
                      {n.sent_for_approval_file_id && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-warning/15 text-warning">aprovação</span>}
                      {renderActionsMenu(n)}
                    </div>
                    ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Preview drawer */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-3xl p-0 gap-0 flex flex-col max-h-[90vh]">
          <DialogHeader className="px-5 pt-4 pb-3 border-b border-border">
            <DialogTitle className="truncate pr-8 text-sm">{selected?.name}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <FilePreview node={selected} getUrl={urlFor} />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={async () => openFile(await urlFor(selected))} className="gap-1.5">
                  <ExternalLink className="w-3.5 h-3.5" /> Abrir
                </Button>
                <Button size="sm" variant="outline" onClick={async () => downloadFile(await urlFor(selected), selected.name)} className="gap-1.5">
                  <Download className="w-3.5 h-3.5" /> Baixar
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setRaming(selected); setRenameValue(selected.name); }} className="gap-1.5">
                  <Pencil className="w-3.5 h-3.5" /> Renomear
                </Button>
                {scope === "client" && !selected.__virtual && !selected.sent_for_approval_file_id && (
                  <Button size="sm" onClick={() => sendToApproval(selected)} className="gap-1.5 bg-primary">
                    <Send className="w-3.5 h-3.5" /> Enviar para aprovação
                  </Button>
                )}
                {selected.__virtual && (
                  <span className="text-[11px] text-muted-foreground">De Arquivos {selected.__approval_status && selected.__approval_status !== "none" ? `· ${selected.__approval_status}` : ""}</span>
                )}
                {selected.sent_for_approval_file_id && (
                  <span className="text-[11px] text-warning">Já enviado para aprovação</span>
                )}
                <div className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(selected)} className="gap-1.5 text-destructive hover:text-destructive">
                  <Trash2 className="w-3.5 h-3.5" /> Excluir
                </Button>
              </div>
              <div className="text-[11px] text-muted-foreground grid grid-cols-2 gap-2 pt-2 border-t border-border">
                <div>Tipo: {selected.mime || "—"}</div>
                <div>Tamanho: {fmtSize(selected.size_bytes)}</div>
                <div>Criado: {new Date(selected.created_at).toLocaleString("pt-BR")}</div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* New folder */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nova pasta</DialogTitle></DialogHeader>
          <Input autoFocus value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
            placeholder="Nome da pasta" onKeyDown={e => e.key === "Enter" && createFolder()} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>Cancelar</Button>
            <Button onClick={createFolder} disabled={!newFolderName.trim()}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New folder + move */}
      <Dialog open={!!moveCreate} onOpenChange={(o) => { if (!o) { setMoveCreate(null); setMoveCreateName(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nova pasta e mover</DialogTitle>
            <DialogDescription>
              Criar em <span className="text-foreground font-medium">{moveCreate?.parentLabel}</span> e mover “{moveCreate?.node.name}” para dentro.
            </DialogDescription>
          </DialogHeader>
          <Input autoFocus value={moveCreateName} onChange={e => setMoveCreateName(e.target.value)}
            onFocus={e => e.currentTarget.select()}
            placeholder="Nome da pasta" onKeyDown={e => e.key === "Enter" && createFolderAndMove()} />
          <p className="text-[11px] text-muted-foreground -mt-1">Sugestão automática. Edite à vontade.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMoveCreate(null); setMoveCreateName(""); }}>Cancelar</Button>
            <Button onClick={createFolderAndMove} disabled={!moveCreateName.trim()}>Criar e mover</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRaming(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Renomear</DialogTitle></DialogHeader>
          <Input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => e.key === "Enter" && renameNode()} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRaming(null)}>Cancelar</Button>
            <Button onClick={renameNode} disabled={!renameValue.trim()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm delete */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir {confirmDelete?.kind === "folder" ? "pasta" : "arquivo"}?</DialogTitle>
            <DialogDescription>
              {confirmDelete?.kind === "folder"
                ? <>A pasta <b>{confirmDelete?.name}</b> e todo seu conteúdo serão removidos permanentemente.</>
                : <>O arquivo <b>{confirmDelete?.name}</b> será removido permanentemente.</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => confirmDelete && performDelete(confirmDelete)}>Excluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TemplatePicker
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        scope={scope}
        onApply={applyTemplate}
        applying={applyingTpl}
      />

      <UploadProgressPanel
        items={uploads.items}
        onCancel={uploads.cancel}
        onRetry={uploads.retry}
        onDismiss={uploads.dismiss}
        onClearDone={uploads.clearDone}
      />

      <StudioPanel
        contextKey={`${scope}:${clientId || "-"}:${parent?.id || "root"}`}
        contextLabel={`${contextLabel}${parent ? ` › ${parent.name}` : ""}`}
        clientId={clientId || null}
        clientName={contextLabel}
        folderId={parent?.id || null}
        folderPath={parentStack.length ? parentStack.map(n => n.name).join("/") : "raiz"}

        availableFiles={(filtered || []).map(n => ({
          id: n.id, name: n.name, kind: n.kind,
          url: n.__virtual ? n.__external_url : (n.storage_path ? signedUrls[n.storage_path] : null),
          meta: n.__virtual ? "sistema" : n.mime || null,
        }))}
        onOpenFile={(id) => {
          const found = (filtered || []).find(n => n.id === id);
          if (found) found.kind === "folder" ? setParentStack([...parentStack, found]) : setSelected(found);
        }}
      />
    </div>
  );
}

function FilePreview({ node, getUrl }: { node: Node; getUrl: (n: Node) => Promise<string> }) {
  const [url, setUrl] = useState("");
  useEffect(() => { getUrl(node).then(setUrl); }, [node.id]);
  if (!url) return <div className="h-64 flex items-center justify-center text-xs text-muted-foreground">Carregando preview...</div>;
  const m = node.mime || "";
  if (m.startsWith("image/")) return <img src={url} alt={node.name} className="max-h-[60vh] mx-auto rounded-lg" />;
  if (m.startsWith("video/")) return <video src={url} controls className="w-full max-h-[60vh] rounded-lg bg-black" preload="metadata" />;
  if (m.startsWith("audio/")) return <audio src={url} controls className="w-full" />;
  if (m === "application/pdf") return <iframe src={url} className="w-full h-[60vh] rounded-lg border border-border" />;
  return <div className="h-40 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
    <FileText className="w-8 h-8 opacity-40" /> Sem preview disponível. Use "Abrir" ou "Baixar".
  </div>;
}
