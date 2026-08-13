import { useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "@/components/shared/confirmDialog";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useProjects } from "@/hooks/useSupabaseData";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  ChevronDown, Check, X as XIcon, Wand2, Link2, Copy, RefreshCw, AlertCircle,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { downloadFile, openFile } from "@/lib/fileActions";
import { FILE_FOLDERS, FILE_TYPES } from "@/lib/fileMetadata";
import {
  handoffWorkspaceFileToFiles,
  suggestedFileType,
} from "@/lib/workspaceFileHandoff";
import { useWorkspaceUploads } from "@/hooks/useWorkspaceUploads";
import { UploadProgressPanel } from "@/components/workspace/UploadProgressPanel";
import { TemplatePicker } from "@/components/workspace/TemplatePicker";
import { WorkspaceTemplate, TplNode } from "@/lib/workspaceTemplates";
import { Sparkles } from "lucide-react";
import { StudioPanel } from "@/components/workspace/StudioPanel";
import FilePreviewContent from "@/components/shared/FilePreviewContent";
import SharedCarouselSlider from "@/components/shared/CarouselSlider";
import { fileExtension, isCarouselAssetGroup, mediaKindFromFile, resolveFileUrl, storageRefFromFile, useResolvedFileUrl } from "@/lib/fileUrls";

type Node = {
  id: string; parent_id: string | null; scope: "global" | "client";
  client_id: string | null; kind: "folder" | "file"; name: string;
  mime: string | null; size_bytes: number | null; storage_path: string | null;
  duration_sec: number | null; sort_index: number; sent_for_approval_file_id: string | null;
  created_by: string | null; created_at: string;
  inbox_scan_status?: "pending" | "clean" | "blocked" | null;
  // virtual nodes derived from public.files (linked, not stored in workspace_nodes)
  __virtual?: boolean;
  __external_url?: string | null;
  __file_id?: string | null;
  __storage_bucket?: string | null;
  __storage_path?: string | null;
  __mime_type?: string | null;
  __extension?: string | null;
  __approval_status?: string | null;
  __agency_approval_status?: string | null;
  __visibility?: string | null;
  __carousel_count?: number;
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
  const k = mediaKindFromFile(n.name, n.__external_url || undefined, n.__mime_type || n.mime, n.__extension);
  if (k === "image" || k === "video" || k === "audio") return k;
  if (k === "pdf" || k === "office") return "doc";
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
  return fileExtension(name).toUpperCase();
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




function virtFileNode(f: any, clientId: string, carouselCount = 0): Node {
  // Normalize `file_type` — legacy rows may store a bare extension ("mp4")
  // instead of a full MIME. Fall back to extension inference so kindOf and
  // FilePreview recognize videos/images correctly.
  const rawType = (f.mime_type || f.file_type || "").toLowerCase();
  let mime: string | null = rawType || null;
  if (mime && !mime.includes("/")) {
    if (["mp4","mov","webm","mkv","m4v"].includes(mime)) mime = `video/${mime}`;
    else if (["png","jpg","jpeg","gif","webp","avif","svg"].includes(mime)) mime = `image/${mime === "jpg" ? "jpeg" : mime}`;
    else if (["mp3","wav","ogg","m4a","flac"].includes(mime)) mime = `audio/${mime}`;
    else if (mime === "pdf") mime = "application/pdf";
  }
  return {
    id: `${VIRT_PREFIX}file:${f.id}`,
    parent_id: null, scope: "client", client_id: clientId,
    kind: "file", name: f.file_name,
    mime, size_bytes: f.size_bytes || null, storage_path: null,
    duration_sec: null, sort_index: 0,
    sent_for_approval_file_id:
      (f.agency_approval_status && f.agency_approval_status !== "not_requested")
        || (f.approval_status && f.approval_status !== "none")
        ? f.id
        : null,
    created_by: f.uploaded_by || null, created_at: f.created_at,
    __virtual: true, __external_url: f.file_url, __file_id: f.id,
    __storage_bucket: f.storage_bucket || null,
    __storage_path: f.storage_path || null,
    __mime_type: f.mime_type || null,
    __extension: f.extension || null,
    __approval_status: f.approval_status,
    __agency_approval_status: f.agency_approval_status,
    __visibility: f.visibility,
    __carousel_count: carouselCount,
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
  const confirmDialog = useConfirm();
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const isStaff = profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "");
  const { data: projects } = useProjects();

  // Single atomic navigation state — prevents context mixing when switching
  // scope, client, or folder. Every transition goes through `nav.*` setters
  // that reset dependent slices in the same render (no useEffect race).
  type NavState = { scope: "global" | "client"; clientId: string | null; stack: Node[] };
  const [navState, setNavState] = useState<NavState>({ scope: "global", clientId: null, stack: [] });
  const { scope, clientId, stack: parentStack } = navState;
  const parent = parentStack[parentStack.length - 1] || null;
  const navToken = `${scope}::${clientId || "-"}::${parent?.id || "-"}`;

  const nav = useMemo(() => ({
    setScope: (s: "global" | "client") =>
      setNavState((prev) => (prev.scope === s ? prev : { scope: s, clientId: s === "global" ? null : prev.clientId, stack: [] })),
    setClient: (id: string | null) =>
      setNavState((prev) => ({ scope: id ? "client" : "global", clientId: id, stack: [] })),
    push: (node: Node) =>
      setNavState((prev) => ({ ...prev, stack: [...prev.stack, node] })),
    pop: () =>
      setNavState((prev) => ({ ...prev, stack: prev.stack.slice(0, -1) })),
    jumpTo: (index: number) =>
      setNavState((prev) => ({ ...prev, stack: prev.stack.slice(0, index + 1) })),
    reset: () => setNavState((prev) => ({ ...prev, stack: [] })),
  }), []);

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
  // Separate cache for small thumbnail URLs (image transform). Keeping full-res
  // URLs distinct in `signedUrls` ensures the preview modal never renders the
  // downscaled cover instead of the actual file.
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  const [renaming, setRaming] = useState<Node | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Node | null>(null);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [cleaningFolders, setCleaningFolders] = useState(false);
  const [deletingNode, setDeletingNode] = useState(false);
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
  const [handoffNode, setHandoffNode] = useState<Node | null>(null);
  const [handoffName, setHandoffName] = useState("");
  const [handoffFolder, setHandoffFolder] = useState("materiais");
  const [handoffType, setHandoffType] = useState("outro");
  const [handoffProject, setHandoffProject] = useState("none");
  const [handoffSaving, setHandoffSaving] = useState(false);

  // Close selection whenever context changes — avoids acting on a stale node.
  useEffect(() => {
    setSelected(null);
    setHandoffNode(null);
  }, [navToken]);


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

  // O banco devolve no maximo 1000 linhas por chamada. Sem paginar, um acervo
  // grande "perde" nos em silencio - pastas e arquivos sumiam do indice.
  const fetchAllRows = async (buildQuery: (from: number, to: number) => any) => {
    const pageSize = 1000;
    const rows: any[] = [];
    for (let page = 0; page < 30; page += 1) {
      const from = page * pageSize;
      const { data, error } = await buildQuery(from, from + pageSize - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return rows;
  };

  const {
    data: nodes,
    isLoading,
    isError: workspaceReadFailed,
    error: workspaceReadError,
    refetch: refetchWorkspace,
    isFetching: refreshingWorkspace,
  } = useQuery({
    queryKey: ["workspace-nodes", scope, clientId, parent?.id || null],
    queryFn: async () => {
      if (parent?.id && isVirt(parent.id)) return [] as Node[];
      let q: any = (supabase as any).from("workspace_nodes").select("*").eq("scope", scope);
      if (scope === "client") q = q.eq("client_id", clientId!);
      q = parent ? q.eq("parent_id", parent.id) : q.is("parent_id", null);
      q = q.order("kind", { ascending: true }).order("sort_index", { ascending: true }).order("name", { ascending: true });
      const rows = await fetchAllRows((from, to) => q.range(from, to));
      return rows as Node[];
    },
    enabled: isStaff && (scope === "global" || !!clientId),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });


  // Full scope index supports move menus and detects linked descendants before
  // destructive actions. It is read-only and does not duplicate file objects.
  const { data: workspaceIndex } = useQuery({
    queryKey: ["workspace-index", scope, clientId],
    queryFn: async () => {
      let q: any = (supabase as any)
        .from("workspace_nodes")
        .select("id, parent_id, name, kind, storage_path, sent_for_approval_file_id")
        .eq("scope", scope);
      if (scope === "client") q = q.eq("client_id", clientId!);
      q = q.order("id", { ascending: true });
      const rows = await fetchAllRows((from, to) => q.range(from, to));
      return rows as Array<{
        id: string;
        parent_id: string | null;
        name: string;
        kind: "folder" | "file";
        storage_path: string | null;
        sent_for_approval_file_id: string | null;
      }>;
    },
    enabled: isStaff && (scope === "global" || !!clientId),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  const allFolders = useMemo(
    () => (workspaceIndex || []).filter((node) => node.kind === "folder"),
    [workspaceIndex],
  );

  /**
   * Quantos itens existem dentro de cada pasta (contando a árvore inteira).
   * É isso que faz a pasta fantasma aparecer: antes uma pasta vazia era
   * visualmente idêntica a uma pasta cheia, e ninguém sabia qual limpar.
   */
  const folderItemCounts = useMemo(() => {
    const childrenByParent = new Map<string, string[]>();
    const kindById = new Map<string, "folder" | "file">();
    for (const node of workspaceIndex || []) {
      kindById.set(node.id, node.kind);
      if (!node.parent_id) continue;
      const siblings = childrenByParent.get(node.parent_id) || [];
      siblings.push(node.id);
      childrenByParent.set(node.parent_id, siblings);
    }

    const totals = new Map<string, number>();
    const countOf = (id: string, guard: Set<string>): number => {
      if (totals.has(id)) return totals.get(id)!;
      if (guard.has(id)) return 0; // ciclo impossível no banco, mas seguro
      guard.add(id);
      let total = 0;
      for (const childId of childrenByParent.get(id) || []) {
        total += kindById.get(childId) === "folder" ? countOf(childId, guard) : 1;
      }
      totals.set(id, total);
      return total;
    };

    for (const node of workspaceIndex || []) {
      if (node.kind === "folder") countOf(node.id, new Set());
    }
    return totals;
  }, [workspaceIndex]);

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

  // (Stack reset happens atomically inside nav.setScope/setClient.)

  // Existing client files (from public.files) — merged as virtual folders/files
  const {
    data: clientFiles,
    isError: clientFilesReadFailed,
    error: clientFilesReadError,
    refetch: refetchClientFiles,
    isFetching: refreshingClientFiles,
  } = useQuery({
    queryKey: ["workspace-client-files", clientId],
    queryFn: async () => {
      if (!clientId) return [] as any[];
      // Fetch all files (parents + carousel children) so we can group carousels
      // and show every slide inside the preview.
      // Paginado em blocos de 1000: era a única consulta sem paginação aqui, e
      // acima desse limite o acervo do cliente aparecia pela metade. O erro
      // continua subindo na hora, para a falha ser visível e nunca silenciosa.
      const pageSize = 1000;
      const rows: any[] = [];
      for (let page = 0; page < 30; page += 1) {
        const from = page * pageSize;
        const { data, error } = await (supabase as any)
          .from("staff_files_secure")
          .select("id, file_name, file_url, file_type, mime_type, extension, storage_bucket, storage_path, folder, approval_status, agency_approval_status, visibility, created_at, uploaded_by, parent_file_id, size_bytes")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < pageSize) break;
      }
      return rows;
    },
    enabled: isStaff && scope === "client" && !!clientId,
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  // Group carousel children by parent for fast preview rendering
  const virtChildrenMap = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const f of (clientFiles as any[]) || []) {
      if (f.parent_file_id) {
        const arr = map.get(f.parent_file_id) || [];
        arr.push(f);
        map.set(f.parent_file_id, arr);
      }
    }
    return map;
  }, [clientFiles]);
  const virtChildIds = useMemo(() => {
    const s = new Set<string>();
    for (const f of (clientFiles as any[]) || []) if (f.parent_file_id) s.add(f.id);
    return s;
  }, [clientFiles]);

  const workspaceStoragePaths = useMemo(
    () => new Set(
      (workspaceIndex || [])
        .filter((node) => node.kind === "file" && node.storage_path)
        .map((node) => node.storage_path as string),
    ),
    [workspaceIndex],
  );

  const linkedWorkspacePaths = useMemo(
    () => new Set(
      ((clientFiles as any[]) || [])
        .filter((file) => file.storage_bucket === "workspace" && file.storage_path)
        .map((file) => file.storage_path as string),
    ),
    [clientFiles],
  );

  const blockedWorkspaceDeleteIds = useMemo(() => {
    const blocked = new Set<string>();
    const byId = new Map((workspaceIndex || []).map((node) => [node.id, node]));
    for (const node of workspaceIndex || []) {
      const isLinked = !!node.sent_for_approval_file_id
        || (!!node.storage_path && linkedWorkspacePaths.has(node.storage_path));
      if (!isLinked) continue;
      let current: typeof node | undefined = node;
      while (current) {
        if (blocked.has(current.id)) break;
        blocked.add(current.id);
        current = current.parent_id ? byId.get(current.parent_id) : undefined;
      }
    }
    return blocked;
  }, [workspaceIndex, linkedWorkspacePaths]);


  // Build virtual nodes for current view (root or inside a virtual folder)
  const virtualNodes: Node[] = useMemo(() => {
    if (scope !== "client" || !clientId || !clientFiles?.length) return [];
    // Exclude carousel children — they render only inside the parent's preview.
    const parents = (clientFiles as any[]).filter((f) => {
      if (f.parent_file_id) return false;
      return !(
        f.storage_bucket === "workspace"
        && f.storage_path
        && workspaceStoragePaths.has(f.storage_path)
      );
    });
    const currentVirtId = parent?.id;
    const insideVirtFolder = currentVirtId && currentVirtId.startsWith(VIRT_PREFIX + "folder:");
    if (!parent) {
      const folders = new Map<string, number>();
      const orphans: any[] = [];
      for (const f of parents) {
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
      orphans.forEach((f) => {
        const children = virtChildrenMap.get(f.id) || [];
        nodes.push(virtFileNode(f, clientId, isCarouselAssetGroup(f, children) ? children.length : 0));
      });
      return nodes;
    }
    if (insideVirtFolder) {
      const folderName = currentVirtId.substring((VIRT_PREFIX + "folder:").length);
      return parents
        .filter((f) => (f.folder || "").trim() === folderName)
        .map((f) => {
          const children = virtChildrenMap.get(f.id) || [];
          return virtFileNode(f, clientId, isCarouselAssetGroup(f, children) ? children.length : 0);
        });
    }
    return [];
  }, [clientFiles, scope, clientId, parent, workspaceStoragePaths, virtChildrenMap]);

  const filtered = useMemo(() => {
    const candidates = parent?.id?.startsWith(VIRT_PREFIX)
      ? [...virtualNodes]
      : [...(nodes || []), ...virtualNodes];
    // Keep homonyms. Collapse only the exact same row/object identity, with
    // real Workspace nodes winning over their virtual Files projection.
    const seen = new Set<string>();
    const base: Node[] = [];
    for (const node of candidates) {
      const bucket = node.__virtual ? node.__storage_bucket : "workspace";
      const path = node.__virtual ? node.__storage_path : node.storage_path;
      const identity = path
        ? `object:${bucket || "external"}:${path}`
        : `row:${node.id}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      base.push(node);
    }

    // Pastas duplicadas com o mesmo nome no mesmo nível (herança da versão que
    // recriava pasta a cada clique): mostra só a que tem conteúdo. Nada é
    // apagado - a vazia continua no banco, apenas sai da frente.
    const bestFolderByName = new Map<string, Node>();
    for (const node of base) {
      if (node.kind !== "folder" || node.__virtual) continue;
      const key = (node.name || "").trim().toLowerCase();
      const current = bestFolderByName.get(key);
      if (!current) {
        bestFolderByName.set(key, node);
        continue;
      }
      const currentCount = folderItemCounts.get(current.id) || 0;
      const candidateCount = folderItemCounts.get(node.id) || 0;
      if (candidateCount > currentCount) bestFolderByName.set(key, node);
    }
    const deduped = base.filter((node) => {
      if (node.kind !== "folder" || node.__virtual) return true;
      const key = (node.name || "").trim().toLowerCase();
      return bestFolderByName.get(key)?.id === node.id;
    });

    const s = search.trim().toLowerCase();
    let res = s ? deduped.filter(n => n.name.toLowerCase().includes(s)) : deduped;
    if (tagFilter !== "all") res = res.filter(n => n.kind === "folder" || tagOf(n, deduped) === tagFilter);
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
  }, [nodes, virtualNodes, search, parent, tagFilter, sortBy, folderItemCounts]);

  /** Pastas deste nível sem NENHUM arquivo dentro, em nenhuma subpasta. */
  const emptyFoldersHere = useMemo(
    () =>
      (nodes || []).filter(
        (node) => node.kind === "folder" && (folderItemCounts.get(node.id) || 0) === 0,
      ),
    [nodes, folderItemCounts],
  );

  /**
   * Limpeza de pasta fantasma. Só remove pasta com zero itens na árvore toda,
   * então é impossível perder conteúdo aqui.
   */
  async function cleanupEmptyFolders() {
    if (cleaningFolders || emptyFoldersHere.length === 0) return;
    setCleaningFolders(true);
    try {
      const ids = emptyFoldersHere.map((node) => node.id);
      const { error } = await supabase.from("workspace_nodes").delete().in("id", ids);
      if (error) throw error;
      toast({
        title: "Pastas vazias removidas",
        description: `${ids.length} pasta(s) sem conteúdo saíram da lista.`,
      });
      setConfirmCleanup(false);
      invalidate();
    } catch (e: any) {
      toast({
        title: "Não foi possível limpar",
        description: e?.message || "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setCleaningFolders(false);
    }
  }

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
      n.kind === "file" && !n.__virtual && n.storage_path && !isInboxQuarantined(n)
    );
    const imgTargets = list.filter(n => kindOf(n) === "image" && !coverUrls[n.storage_path!]).slice(0, 60);
    const vidTargets = list.filter(n => kindOf(n) === "video" && !signedUrls[n.storage_path!]).slice(0, 24);
    if (!imgTargets.length && !vidTargets.length) return;
    let alive = true;
    (async () => {
      const jobs: Promise<any>[] = [];
      if (imgTargets.length) {
        jobs.push((supabase.storage.from("workspace") as any).createSignedUrls(
          imgTargets.map(n => n.storage_path!), 3600,
          { transform: { width: 400, quality: 70, resize: "cover" } }
        ).then((r: any) => ({ kind: "cover", data: r?.data })));
      }
      if (vidTargets.length) {
        jobs.push(supabase.storage.from("workspace").createSignedUrls(
          vidTargets.map(n => n.storage_path!), 3600
        ).then((r: any) => ({ kind: "full", data: r?.data })));
      }
      const results = await Promise.all(jobs);
      if (!alive) return;
      const coverPatch: Record<string, string> = {};
      const fullPatch: Record<string, string> = {};
      for (const r of results as any[]) {
        for (const row of (r?.data as any[] | undefined) || []) {
          if (!row?.signedUrl || !row?.path) continue;
          if (r.kind === "cover") coverPatch[row.path] = row.signedUrl;
          else fullPatch[row.path] = row.signedUrl;
        }
      }
      if (Object.keys(coverPatch).length) setCoverUrls(prev => ({ ...prev, ...coverPatch }));
      if (Object.keys(fullPatch).length) setSignedUrls(prev => ({ ...prev, ...fullPatch }));
    })();
    return () => { alive = false; };
  }, [filtered, coverUrls, signedUrls]);

  const coverFor = (n: Node): string | null => {
    if (n.kind !== "file") return null;
    const k = kindOf(n);
    if (k !== "image" && k !== "video") return null;
    if (n.__virtual) return null;
    if (isInboxQuarantined(n)) return null;
    if (!n.storage_path) return null;
    if (k === "image") return coverUrls[n.storage_path] || signedUrls[n.storage_path] || null;
    return signedUrls[n.storage_path] || null;
  };





  async function signedUrl(path: string) {
    if (signedUrls[path]) return signedUrls[path];
    const { data, error } = await supabase.storage.from("workspace").createSignedUrl(path, 3600);
    if (error) throw error;
    if (data?.signedUrl) {
      setSignedUrls(p => ({ ...p, [path]: data.signedUrl }));
      return data.signedUrl;
    }
    throw new Error("URL do arquivo indisponível.");
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["workspace-nodes"] });
    qc.invalidateQueries({ queryKey: ["workspace-index"] });
    qc.invalidateQueries({ queryKey: ["workspace-client-files"] });
    qc.invalidateQueries({ queryKey: ["all-files"] });
    qc.invalidateQueries({ queryKey: ["files"] });
  }

  async function urlFor(n: Node): Promise<string> {
    if (n.__virtual) {
      return resolveFileUrl({ fileUrl: n.__external_url, storageBucket: n.__storage_bucket, storagePath: n.__storage_path });
    }
    if (n.storage_path) return signedUrl(n.storage_path);
    throw new Error("Arquivo sem origem de armazenamento.");
  }

  async function openNodeFile(n: Node) {
    if (isInboxQuarantined(n)) {
      toast({
        title: "Arquivo externo em quarentena",
        description: "Baixe e verifique o arquivo antes de liberar preview ou abertura.",
        variant: "destructive",
      });
      return;
    }
    try {
      const url = await urlFor(n);
      if (!url) throw new Error("URL do arquivo indisponível.");
      openFile(url);
    } catch (e: any) {
      toast({ title: "Não foi possível abrir", description: e?.message || "Tente novamente.", variant: "destructive" });
    }
  }

  async function downloadNodeFile(n: Node) {
    try {
      const url = await urlFor(n);
      if (!url) throw new Error("URL do arquivo indisponível.");
      await downloadFile(url, n.name, {
        allowNavigationFallback: !isInboxQuarantined(n),
      });
    } catch (e: any) {
      toast({ title: "Não foi possível baixar", description: e?.message || "Tente novamente.", variant: "destructive" });
    }
  }

  async function removeStoredObjects(rows: Array<{ file_url?: string | null; storage_bucket?: string | null; storage_path?: string | null }>) {
    const byBucket = new Map<string, Set<string>>();
    for (const row of rows) {
      const ref = storageRefFromFile({ fileUrl: row.file_url, storageBucket: row.storage_bucket, storagePath: row.storage_path });
      if (!ref) continue;
      if (!byBucket.has(ref.bucket)) byBucket.set(ref.bucket, new Set());
      byBucket.get(ref.bucket)!.add(ref.path);
    }
    await Promise.all(Array.from(byBucket.entries()).map(async ([bucket, paths]) => {
      if (!paths.size) return;
      await supabase.storage.from(bucket).remove(Array.from(paths));
    }));
  }

  async function deleteFileRecords(rows: any[]) {
    const ids = Array.from(new Set(rows.map((row) => row?.id).filter(Boolean)));
    if (!ids.length) return;
    await removeStoredObjects(rows);
    const { error } = await (supabase as any).from("files").delete().in("id", ids);
    if (error) throw error;
  }

  async function createFolder() {
    if (!newFolderName.trim() || !user) return;
    let parentId: string | null = null;
    try {
      parentId = await resolveRealParentId(parent?.id || null);
      assertRealParent(parentId);
    } catch (e: any) {
      toast({ title: "Erro ao preparar pasta", description: e?.message || "Tente novamente.", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("workspace_nodes").insert({
      name: newFolderName.trim(), kind: "folder", scope,
      client_id: scope === "client" ? clientId : null,
      parent_id: parentId, created_by: user.id,
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
      const parentIdForTpl = parent?.id && !isVirt(parent.id) ? parent.id : null;
      let existingQ: any = supabase
        .from("workspace_nodes")
        .select("name")
        .eq("scope", scope)
        .eq("kind", "folder");
      existingQ = parentIdForTpl ? existingQ.eq("parent_id", parentIdForTpl) : existingQ.is("parent_id", null);
      if (scope === "client") existingQ = existingQ.eq("client_id", clientId!);
      const { data: existing } = await existingQ;
      const existingNames = new Set((existing || []).map((r: any) => r.name.toLowerCase()));

      let created = 0;
      const insertTree = async (nodes: TplNode[], parentId: string | null, skipCheck = false) => {
        for (const n of nodes) {
          let id: string | null = null;
          if (!skipCheck && !parentId && existingNames.has(n.name.toLowerCase())) {
            // Reuse existing top-level folder if present
            let foundQ: any = supabase
              .from("workspace_nodes")
              .select("id")
              .eq("scope", scope)
              .eq("kind", "folder")
              .ilike("name", n.name);
            foundQ = parentIdForTpl ? foundQ.eq("parent_id", parentIdForTpl) : foundQ.is("parent_id", null);
            if (scope === "client") foundQ = foundQ.eq("client_id", clientId!);
            // limit(1): duplicata antiga não pode virar gatilho para criar mais.
            const { data: found } = await foundQ
              .order("created_at", { ascending: true })
              .limit(1);
            id = (found as any)?.[0]?.id || null;
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
      await insertTree(tpl.tree, parentIdForTpl);
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

  // Friendly section names displayed as tag chips → folder mapping.
  const TAG_SECTION_NAME: Record<SmartTag, string | null> = {
    carrossel: "Carrossel",
    "video-ready": "Vídeos prontos",
    material: "Brutos",
    static: "Estáticos",
    doc: "Documentos",
    audio: "Áudios",
    other: null,
  };

  // Click on a smart chip = open (or create) the matching section folder at
  // the current level. This gives clean isolation between contexts and makes
  // uploads consistently land where the user is looking.
  async function enterTagSection(tag: SmartTag) {
    const targetName = TAG_SECTION_NAME[tag];
    if (!targetName) { setTagFilter(tag); return; }
    if (scope === "client" && !clientId) {
      toast({ title: "Selecione um cliente", variant: "destructive" });
      return;
    }
    try {
      const parentId = parent && !isVirt(parent.id) ? parent.id : null;
      // Antes a pasta era criada só por clicar aqui, mesmo que ninguém enviasse
      // nada: era essa a fábrica de pasta fantasma. Agora a seção abre vazia e
      // a pasta de verdade só nasce quando o primeiro arquivo é enviado.
      const existing = await findSectionFolder(targetName, parentId);
      setTagFilter("all");
      nav.push(
        existing ||
          ({
            id: `${VIRT_PREFIX}section:${parentId || "root"}:${targetName}`,
            name: targetName,
            kind: "folder",
            scope,
            client_id: scope === "client" ? clientId : null,
            parent_id: parentId,
          } as unknown as Node),
      );
    } catch (e: any) {
      toast({ title: "Erro ao abrir seção", description: e?.message || "Tente novamente.", variant: "destructive" });
    }
  }

  /**
   * Procura a pasta da seção. Usa limit(1) em vez de maybeSingle porque, se já
   * existirem duas pastas com o mesmo nome (herança da versão antiga), o
   * maybeSingle devolvia erro com dado nulo e o código concluía "não existe" -
   * criando mais uma duplicata a cada clique.
   */
  async function findSectionFolder(name: string, parentId: string | null) {
    let q: any = (supabase as any)
      .from("workspace_nodes")
      .select("*")
      .eq("scope", scope)
      .eq("kind", "folder")
      .ilike("name", name)
      .order("created_at", { ascending: true })
      .limit(1);
    q = parentId ? q.eq("parent_id", parentId) : q.is("parent_id", null);
    if (scope === "client") q = q.eq("client_id", clientId!);
    const { data } = await q;
    return (data && data[0]) || null;
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
      // Resolve/cria pastas destino no nível atual (nunca em tokens virtuais)
      const parentId = parent?.id && !isVirt(parent.id) ? parent.id : null;
      let existingQ: any = supabase
        .from("workspace_nodes")
        .select("id, name")
        .eq("scope", scope)
        .eq("kind", "folder");
      existingQ = parentId ? existingQ.eq("parent_id", parentId) : existingQ.is("parent_id", null);
      if (scope === "client") existingQ = existingQ.eq("client_id", clientId!);
      const { data: existing } = await existingQ;
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


  // Standard materialization: guarantees the destination parent is always a
  // real workspace_nodes UUID (or null for root) before any DB write. Applies
  // to single files, batches, drag-and-drop and programmatic uploads alike.
  // - Real UUIDs pass through untouched.
  // - Virtual folder groupings (public.files.folder) get a matching real folder
  //   materialized at the client root and cached for the session.
  // - Any other virt kind (e.g. virt:file:...) falls back to null (root).
  const materializedFoldersRef = useRef<Map<string, string>>(new Map());
  async function resolveRealParentId(rawParent: string | null | undefined): Promise<string | null> {
    if (!rawParent) return null;
    if (!isVirt(rawParent)) return rawParent;

    // Seção aberta mas ainda sem pasta real: é AGORA, no primeiro envio, que a
    // pasta nasce - e nasce no lugar certo, dentro da pasta onde a pessoa está.
    if (rawParent.startsWith(VIRT_PREFIX + "section:")) {
      const rest = rawParent.substring((VIRT_PREFIX + "section:").length);
      const separator = rest.indexOf(":");
      if (separator < 0) return null;
      const rawParentId = rest.substring(0, separator);
      const sectionName = rest.substring(separator + 1).trim();
      if (!sectionName) return null;
      const sectionParentId = rawParentId === "root" ? null : rawParentId;
      const existing = await findSectionFolder(sectionName, sectionParentId);
      if (existing?.id) return existing.id as string;
      const { data: created, error } = await supabase.from("workspace_nodes").insert({
        name: sectionName, kind: "folder", scope,
        client_id: scope === "client" ? clientId : null,
        parent_id: sectionParentId, created_by: user?.id ?? null,
      }).select("id").single();
      if (error || !created) throw error || new Error("Falha ao criar a pasta da seção");
      invalidate();
      return (created as any).id as string;
    }

    if (!rawParent.startsWith(VIRT_PREFIX + "folder:")) return null;
    if (scope !== "client" || !clientId) return null;
    const folderName = rawParent.substring((VIRT_PREFIX + "folder:").length).trim();
    if (!folderName) return null;
    const cacheKey = `${clientId}::${folderName.toLowerCase()}`;
    const cached = materializedFoldersRef.current.get(cacheKey);
    if (cached) return cached;
    // limit(1) e não maybeSingle: com duas pastas de mesmo nome, o maybeSingle
    // falhava e o código criava uma terceira.
    const { data: existingRows } = await supabase
      .from("workspace_nodes")
      .select("id")
      .eq("scope", "client")
      .eq("client_id", clientId)
      .eq("kind", "folder")
      .is("parent_id", null)
      .ilike("name", folderName)
      .order("created_at", { ascending: true })
      .limit(1);
    const existing = (existingRows as any)?.[0];
    if ((existing as any)?.id) {
      const id = (existing as any).id as string;
      materializedFoldersRef.current.set(cacheKey, id);
      return id;
    }
    const { data: created, error } = await supabase.from("workspace_nodes").insert({
      name: folderName, kind: "folder", scope: "client",
      client_id: clientId, parent_id: null, created_by: user?.id ?? null,
    }).select("id").single();
    if (error || !created) throw error || new Error("Falha ao criar pasta");
    const id = (created as any).id as string;
    materializedFoldersRef.current.set(cacheKey, id);
    invalidate();
    return id;
  }

  // Invariant check — never let a virtual token reach the database.
  function assertRealParent(id: string | null): asserts id is string | null {
    if (id && isVirt(id)) {
      throw new Error(`parent_id inválido (virtual token): ${id}`);
    }
  }

  async function handleUpload(files: FileList | null, targetFolderId?: string | null) {
    if (!files || !files.length || !user) return;
    const rawParent = targetFolderId !== undefined ? targetFolderId : (parent?.id || null);
    let destParent: string | null;
    try {
      destParent = await resolveRealParentId(rawParent);
      assertRealParent(destParent);
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
    if (deletingNode) return;
    if (isWorkspaceDeletionBlocked(n)) {
      toast({
        title: "Arquivo protegido",
        description: "Remova primeiro o vínculo na área Arquivos. O original continuará no Workspace.",
        variant: "destructive",
      });
      setConfirmDelete(null);
      return;
    }
    setDeletingNode(true);
    try {
      if (n.__virtual && n.kind === "folder") {
        const folderName = n.id.substring((VIRT_PREFIX + "folder:").length);
        const parentIds = ((clientFiles as any[]) || [])
          .filter((f) => !f.parent_file_id && (f.folder || "").trim() === folderName)
          .map((f) => f.id);
        if (parentIds.length) {
          const { data, error } = await supabase.functions.invoke("delete-file-assets", {
            body: { target: "files", fileIds: parentIds },
          });
          if (error) throw error;
          if ((data as any)?.error) throw new Error((data as any).error);
        }
      } else if (n.__virtual && n.kind === "file" && n.__file_id) {
        const { data, error } = await supabase.functions.invoke("delete-file-assets", {
          body: { target: "files", fileIds: [n.__file_id] },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
      } else {
        const { data, error } = await supabase.functions.invoke("delete-file-assets", {
          body: { target: "workspace_node", nodeId: n.id },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
      }
      setSelected(null); setConfirmDelete(null);
      toast({ title: "Excluído" });
      invalidate();
    } catch (e: any) {
      toast({ title: "Erro ao excluir", description: e?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setDeletingNode(false);
    }
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

  const clientProjects = useMemo(
    () => ((projects || []) as any[]).filter((project) => project.client_id === clientId),
    [projects, clientId],
  );

  function canSendToFiles(n: Node | null) {
    return !!n
      && !n.__virtual
      && n.kind === "file"
      && !!n.storage_path
      && !isInboxQuarantined(n)
      && scope === "client"
      && !!clientId
      && n.client_id === clientId;
  }

  function isWorkspaceDeletionBlocked(n: Node | null) {
    return !!n && !n.__virtual && blockedWorkspaceDeleteIds.has(n.id);
  }

  function isWorkspaceFileLinked(n: Node | null) {
    return !!n
      && !n.__virtual
      && n.kind === "file"
      && (
        !!n.sent_for_approval_file_id
        || (!!n.storage_path && linkedWorkspacePaths.has(n.storage_path))
      );
  }

  function isInboxQuarantined(n: Node | null) {
    return n?.inbox_scan_status === "pending" || n?.inbox_scan_status === "blocked";
  }

  async function markInboxFileVerified(n: Node) {
    if (n.__virtual || n.inbox_scan_status !== "pending") {
      if (n.inbox_scan_status === "blocked") {
        toast({
          title: "Arquivo bloqueado",
          description: "Um arquivo bloqueado não pode ser liberado pelo navegador.",
          variant: "destructive",
        });
      }
      return;
    }
    const scanProceed = await confirmDialog({
      title: "Liberar este arquivo?",
      description: "Confirme somente depois de verificar o arquivo com uma ferramenta de segurança confiável.",
      confirmLabel: "Liberar arquivo",
    });
    if (!scanProceed) return;
    const { error } = await supabase.rpc("mark_workspace_inbox_scan_clean", {
      p_node_id: n.id,
      p_reference: "Confirmação manual no Workspace",
    });
    if (error) {
      toast({ title: "Não foi possível liberar", description: error.message, variant: "destructive" });
      return;
    }
    setSelected((current) => current?.id === n.id ? { ...current, inbox_scan_status: "clean" } : current);
    toast({ title: "Arquivo marcado como verificado" });
    invalidate();
  }

  function openHandoff(n: Node) {
    if (!canSendToFiles(n)) {
      toast({
        title: "Selecione um arquivo de cliente",
        description: "Arquivos globais continuam somente no Workspace.",
        variant: "destructive",
      });
      return;
    }
    setHandoffNode(n);
    setHandoffName(n.name);
    setHandoffFolder("materiais");
    setHandoffType(suggestedFileType(n.name, n.mime));
    setHandoffProject(
      clientProjects.length === 1 ? clientProjects[0].id : "none",
    );
  }

  async function submitHandoff() {
    if (!handoffNode || !user || !clientId || handoffSaving) return;
    setHandoffSaving(true);
    try {
      const result = await handoffWorkspaceFileToFiles({
        node: handoffNode,
        clientId,
        userId: user.id,
        fileName: handoffName,
        folder: handoffFolder,
        fileType: handoffType,
        projectId: handoffProject === "none" ? null : handoffProject,
      });
      toast({
        title: result.created ? "Enviado para Arquivos" : "Arquivo já sincronizado",
        description: "O conteúdo continua interno. A liberação ao cliente é feita somente em Arquivos.",
      });
      setHandoffNode(null);
      setSelected(null);
      invalidate();
    } catch (error: any) {
      toast({
        title: "Não foi possível enviar para Arquivos",
        description: error?.message || "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setHandoffSaving(false);
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
      const pool = [...(nodes || []), ...(virtualNodes || [])];
      const src = pool.find(x => x.id === nodeId);
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
          <button
            type="button"
            aria-label={`Ações de ${n.name}`}
            className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
          {n.kind === "folder" && (
            <DropdownMenuItem onSelect={() => nav.push(n)}>
              <Folder className="w-3.5 h-3.5 mr-2" /> Abrir
            </DropdownMenuItem>
          )}
          {n.kind === "folder" && !n.__virtual && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Link2 className="w-3.5 h-3.5 mr-2" /> Link de upload
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                <DropdownMenuItem onSelect={() => shareInbox(n)}>
                  <Copy className="w-3.5 h-3.5 mr-2" /> Copiar link ativo
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => shareInbox(n, true)}>
                  <RefreshCw className="w-3.5 h-3.5 mr-2" /> Gerar novo link (7 dias)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => revokeInbox(n)}
                  className="text-destructive focus:text-destructive"
                >
                  <XIcon className="w-3.5 h-3.5 mr-2" /> Revogar link
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {n.kind === "file" && (
            <>
              <DropdownMenuItem onSelect={() => setSelected(n)}>
                <ExternalLink className="w-3.5 h-3.5 mr-2" /> Visualizar
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openNodeFile(n)}>
                <ExternalLink className="w-3.5 h-3.5 mr-2" /> Abrir
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => downloadNodeFile(n)}>
                <Download className="w-3.5 h-3.5 mr-2" /> Baixar
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => copyLink(n)}>
                <Link2 className="w-3.5 h-3.5 mr-2" /> Copiar link
              </DropdownMenuItem>
            </>
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
          {canSendToFiles(n) && (
            <DropdownMenuItem onSelect={() => openHandoff(n)}>
              <Send className="w-3.5 h-3.5 mr-2" /> Enviar para Arquivos
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setConfirmDelete(n)}
            disabled={isWorkspaceDeletionBlocked(n)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" />
            {isWorkspaceDeletionBlocked(n) ? "Remova de Arquivos antes" : "Excluir"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  async function copyLink(n: Node) {
    if (isInboxQuarantined(n)) {
      toast({
        title: "Arquivo externo em quarentena",
        description: "Verifique o arquivo antes de copiar um link de acesso.",
        variant: "destructive",
      });
      return;
    }
    try {
      const url = await urlFor(n);
      if (!url) throw new Error("Sem link disponível");
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copiado" });
    } catch (e: any) {
      toast({ title: "Não foi possível copiar", description: e?.message, variant: "destructive" });
    }
  }

  async function shareInbox(n: Node, rotate = false) {
    if (n.kind !== "folder" || n.__virtual) return;
    try {
      const { data, error } = await supabase.rpc("manage_workspace_inbox_token", {
        p_folder_id: n.id,
        p_action: rotate ? "rotate" : "ensure",
      });
      if (error) throw error;
      const token = (data as { token?: string | null } | null)?.token;
      const expiresAt = (data as { expires_at?: string | null } | null)?.expires_at;
      if (!token || !expiresAt) throw new Error("O link não pôde ser criado.");
      const url = `${window.location.origin}/inbox/${token}`;
      await navigator.clipboard.writeText(url);
      toast({
        title: rotate ? "Novo link de upload copiado" : "Link de upload copiado",
        description: `${rotate ? "O link anterior foi invalidado. " : ""}Válido até ${new Intl.DateTimeFormat("pt-BR", {
          dateStyle: "short",
          timeStyle: "short",
        }).format(new Date(expiresAt))}.`,
      });
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message, variant: "destructive" });
    }
  }

  async function revokeInbox(n: Node) {
    if (n.kind !== "folder" || n.__virtual) return;
    const revokeProceed = await confirmDialog({
      title: "Revogar link de upload?",
      description: `O link atual de “${n.name}” deixa de funcionar imediatamente.`,
      confirmLabel: "Revogar link",
      destructive: true,
    });
    if (!revokeProceed) return;
    try {
      const { error } = await supabase.rpc("manage_workspace_inbox_token", {
        p_folder_id: n.id,
        p_action: "revoke",
      });
      if (error) throw error;
      toast({
        title: "Link de upload revogado",
        description: "O endereço anterior não aceita mais arquivos.",
      });
    } catch (e: any) {
      toast({ title: "Erro ao revogar", description: e?.message, variant: "destructive" });
    }
  }


  function renderContextMenu(n: Node, children: React.ReactNode) {
    const isFolder = n.kind === "folder";
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {isFolder ? (
            <>
              <ContextMenuItem onSelect={() => nav.push(n)}>
                <Folder className="w-3.5 h-3.5 mr-2" /> Abrir
              </ContextMenuItem>
              {!n.__virtual && (
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <Link2 className="w-3.5 h-3.5 mr-2" /> Link de upload
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-56">
                    <ContextMenuItem onSelect={() => shareInbox(n)}>
                      <Copy className="w-3.5 h-3.5 mr-2" /> Copiar link ativo
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => shareInbox(n, true)}>
                      <RefreshCw className="w-3.5 h-3.5 mr-2" /> Gerar novo link (7 dias)
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onSelect={() => revokeInbox(n)}
                      className="text-destructive focus:text-destructive"
                    >
                      <XIcon className="w-3.5 h-3.5 mr-2" /> Revogar link
                    </ContextMenuItem>
                  </ContextMenuSubContent>
                </ContextMenuSub>
              )}
            </>
          ) : (
            <>
              <ContextMenuItem onSelect={() => setSelected(n)}>
                <ExternalLink className="w-3.5 h-3.5 mr-2" /> Visualizar
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => openNodeFile(n)}>
                <ExternalLink className="w-3.5 h-3.5 mr-2" /> Abrir em nova aba
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => downloadNodeFile(n)}>
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
          {canSendToFiles(n) && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => openHandoff(n)}>
                <Send className="w-3.5 h-3.5 mr-2" /> Enviar para Arquivos
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => setConfirmDelete(n)}
            disabled={isWorkspaceDeletionBlocked(n)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" />
            {isWorkspaceDeletionBlocked(n) ? "Remova de Arquivos antes" : "Excluir"}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }



  if (!isStaff) {
    return <div className="p-8 text-center text-muted-foreground">Acesso restrito à equipe.</div>;
  }

  const rootDropActive = dragOverArea && dragOverId === null;

  const filteredClients = (() => {
    const list = [...(clients || [])] as any[];
    const q = pickerQuery.trim().toLowerCase();
    let out = q ? list.filter(c => ((c.company_name || c.full_name || "").toLowerCase().includes(q))) : list;
    if (pickerFilter === "az") out = [...out].sort((a, b) => (a.company_name || a.full_name || "").localeCompare(b.company_name || b.full_name || ""));
    else if (pickerFilter === "za") out = [...out].sort((a, b) => (b.company_name || b.full_name || "").localeCompare(a.company_name || a.full_name || ""));
    return out;
  })();

  const currentClient = (clients || []).find((c: any) => c.id === clientId) as any;
  const contextLabel = scope === "global"
    ? "Global (Agência)"
    : currentClient ? (currentClient.company_name || currentClient.full_name) : "Selecionar cliente";

  return (
    <div className="flex h-full min-h-0 flex-col animate-fade-in md:block md:h-auto md:space-y-6">
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-background/95 pb-3 md:mb-5 md:border-b-0 md:bg-transparent md:pb-0">
        <div className="min-w-0">
          <h1 className="heading-page">Workspace</h1>
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
          <PopoverContent
            align="end"
            collisionPadding={12}
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="w-[320px] max-w-[calc(100vw-1rem)] p-0 max-h-[min(70svh,520px)] overflow-hidden flex flex-col"
          >
            <div className="p-2 border-b border-border">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={pickerQuery} onChange={e => setPickerQuery(e.target.value)} placeholder="Buscar cliente..." className="h-9 md:h-8 pl-8 text-[16px] md:text-xs" />
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
                onClick={() => { nav.setClient(null); setPickerOpen(false); }}
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
                    onClick={() => { nav.setClient(c.id); setPickerOpen(false); }}
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
                <button onClick={() => nav.pop()}
                  className="p-1 rounded hover:bg-secondary text-muted-foreground mr-1"><ArrowLeft className="w-3.5 h-3.5" /></button>
              )}
              <button
                onClick={() => nav.reset()}
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
                    onClick={() => nav.jumpTo(i)}
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
              {emptyFoldersHere.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmCleanup(true)}
                  disabled={cleaningFolders}
                  title="Remove as pastas deste nível que não têm nenhum arquivo dentro"
                  className="gap-1.5 h-9 sm:h-8 px-2 sm:px-3"
                >
                  {cleaningFolders ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  <span className="hidden sm:inline">
                    Limpar vazias ({emptyFoldersHere.length})
                  </span>
                </Button>
              )}
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
                onClick={() => enterTagSection(t.key)}
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

          {scope === "client" && !!clientId && clientFilesReadFailed && (
            <div className="mb-3 flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">Workspace disponível; sincronização com Arquivos temporariamente indisponível.</p>
                <p className="truncate text-muted-foreground">
                  {clientFilesReadError instanceof Error ? clientFilesReadError.message : "Tente atualizar a sincronização."}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0 gap-1.5"
                onClick={() => void refetchClientFiles()}
                disabled={refreshingClientFiles}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshingClientFiles ? "animate-spin" : ""}`} />
                Atualizar
              </Button>
            </div>
          )}

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
            ) : workspaceReadFailed ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-12 text-center">
                <Folder className="mx-auto mb-3 h-8 w-8 text-destructive/70" />
                <p className="text-sm font-medium text-foreground">Não foi possível carregar esta pasta</p>
                <p className="mx-auto mt-1 max-w-lg text-xs text-muted-foreground">
                  A pasta não está vazia. Houve uma falha de leitura
                  {workspaceReadError instanceof Error ? `: ${workspaceReadError.message}` : "."}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-4 gap-1.5"
                  onClick={() => void refetchWorkspace()}
                  disabled={refreshingWorkspace}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshingWorkspace ? "animate-spin" : ""}`} />
                  Tentar novamente
                </Button>
              </div>
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
                      className={cn(
                        "group relative rounded-xl border bg-card hover:border-primary/40 transition-all overflow-hidden flex flex-col cursor-pointer aspect-square",
                        dragActive ? "border-primary bg-primary/10 ring-2 ring-primary/40" : "border-border"
                      )}
                    >
                      <button
                        type="button"
                        aria-label={`${isFolder ? "Abrir pasta" : "Visualizar arquivo"} ${n.name}`}
                        onClick={() => isFolder ? nav.push(n) : setSelected(n)}
                        className="absolute inset-0 z-[1] rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                      />
                        <div className="absolute top-1.5 right-1.5 z-10 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        {renderActionsMenu(n)}
                      </div>
                      {isWorkspaceFileLinked(n) && (
                        <span className="pointer-events-none absolute top-1.5 left-1.5 z-10 text-[9px] px-1.5 py-0.5 rounded-full bg-success/15 text-success backdrop-blur">Em Arquivos</span>
                      )}
                      {isInboxQuarantined(n) && (
                        <span className="pointer-events-none absolute bottom-9 right-1.5 z-10 text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500 backdrop-blur">
                          Quarentena
                        </span>
                      )}
                      {!!n.__carousel_count && n.__carousel_count > 0 && (
                        <span className="pointer-events-none absolute bottom-9 left-1.5 z-10 text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-primary/85 text-primary-foreground shadow">
                          Carrossel · {n.__carousel_count + 1}
                        </span>
                      )}
                      <div className={cn(
                        "flex-1 flex items-center justify-center w-full relative overflow-hidden",
                        !cover && `bg-gradient-to-br ${isFolder ? "from-primary/20 via-primary/5 to-transparent" : KIND_META[k].gradient}`
                      )}>
                        {cover || (n.__virtual && (k === "image" || k === "video")) ? (
                          k === "video" ? (
                            <>
                              <WorkspaceThumb node={n} cover={cover} />

                              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent flex items-center justify-center">
                                <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                                  <Film className="w-5 h-5 text-black" />
                                </div>
                              </div>
                            </>
                          ) : (
                            <WorkspaceThumb node={n} cover={cover} />
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
                        {isFolder ? (
                          <p className="text-[10px] text-muted-foreground truncate">
                            {n.__virtual
                              ? "Seção"
                              : (folderItemCounts.get(n.id) || 0) === 0
                                ? "Vazia"
                                : `${folderItemCounts.get(n.id)} ${
                                    folderItemCounts.get(n.id) === 1 ? "item" : "itens"
                                  }`}
                          </p>
                        ) : (
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
                      className={cn("relative w-full flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/40 transition-colors cursor-pointer",
                        dragActive && "bg-primary/10 ring-1 ring-primary/40")}
                    >
                      <button
                        type="button"
                        aria-label={`${isFolder ? "Abrir pasta" : "Visualizar arquivo"} ${n.name}`}
                        onClick={() => isFolder ? nav.push(n) : setSelected(n)}
                        className="absolute inset-0 z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                      />
                      <Icon className={cn("w-4 h-4 shrink-0", isFolder ? "text-primary" : "text-muted-foreground")} />
                      <span className="flex-1 text-[13px] truncate">{n.name}</span>
                      {!isFolder && <span className="text-[11px] text-muted-foreground">{fmtSize(n.size_bytes)}</span>}
                      {isFolder && !n.__virtual && (
                        <span className="text-[11px] text-muted-foreground">
                          {(folderItemCounts.get(n.id) || 0) === 0
                            ? "Vazia"
                            : `${folderItemCounts.get(n.id)} ${
                                folderItemCounts.get(n.id) === 1 ? "item" : "itens"
                              }`}
                        </span>
                      )}
                      {isInboxQuarantined(n) && <span className="text-[10px] text-amber-500">Quarentena</span>}
                      {isWorkspaceFileLinked(n) && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/15 text-success">Em Arquivos</span>}
                      <div className="relative z-10">
                        {renderActionsMenu(n)}
                      </div>
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
              {isInboxQuarantined(selected) ? (
                <div className="h-64 rounded-xl border border-amber-500/30 bg-amber-500/5 flex flex-col items-center justify-center gap-3 px-6 text-center">
                  <AlertCircle className="h-8 w-8 text-amber-500" />
                  <div>
                    <p className="text-sm font-medium">Arquivo externo em quarentena</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      O preview e a abertura ficam bloqueados até uma verificação de segurança fora do navegador.
                    </p>
                  </div>
                </div>
              ) : selected.__virtual && selected.__file_id && selected.__carousel_count && selected.__carousel_count > 0 ? (
                <SharedCarouselSlider
                  parent={{
                    id: selected.__file_id,
                    file_name: selected.name,
                    file_url: selected.__external_url || "",
                    storage_bucket: selected.__storage_bucket,
                    storage_path: selected.__storage_path,
                    mime_type: selected.__mime_type,
                    extension: selected.__extension,
                  }}
                  initialChildren={virtChildrenMap.get(selected.__file_id) || []}
                />
              ) : (
                <FilePreview node={selected} getUrl={urlFor} />
              )}
              <div className="flex flex-wrap items-center gap-2">
                {!isInboxQuarantined(selected) && (
                  <Button size="sm" variant="outline" onClick={() => openNodeFile(selected)} className="gap-1.5">
                    <ExternalLink className="w-3.5 h-3.5" /> Abrir
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => downloadNodeFile(selected)} className="gap-1.5">
                  <Download className="w-3.5 h-3.5" /> {isInboxQuarantined(selected) ? "Baixar para verificar" : "Baixar"}
                </Button>
                {selected.inbox_scan_status === "pending" && profile?.role === "admin" && (
                  <Button size="sm" variant="outline" onClick={() => markInboxFileVerified(selected)} className="gap-1.5">
                    <Check className="w-3.5 h-3.5" /> Marcar como verificado
                  </Button>
                )}
                {selected.inbox_scan_status === "pending" && profile?.role !== "admin" && (
                  <span className="text-xs text-muted-foreground">
                    Aguardando verificação por um administrador.
                  </span>
                )}
                {selected.inbox_scan_status === "blocked" && (
                  <span className="text-xs text-destructive">
                    Bloqueado: substitua o arquivo ou solicite uma nova verificação.
                  </span>
                )}
                <Button size="sm" variant="outline" onClick={() => { setRaming(selected); setRenameValue(selected.name); }} className="gap-1.5">
                  <Pencil className="w-3.5 h-3.5" /> Renomear
                </Button>
                {canSendToFiles(selected) && (
                  <Button size="sm" onClick={() => openHandoff(selected)} className="gap-1.5">
                    <Send className="w-3.5 h-3.5" /> Enviar para Arquivos
                  </Button>
                )}
                {selected.__virtual && (
                  <span className="text-[11px] text-muted-foreground">De Arquivos {selected.__approval_status && selected.__approval_status !== "none" ? `· ${selected.__approval_status}` : ""}</span>
                )}
                {selected.sent_for_approval_file_id && (
                  <span className="text-[11px] text-success">Já está em Arquivos</span>
                )}
                <div className="flex-1" />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDelete(selected)}
                  disabled={isWorkspaceDeletionBlocked(selected)}
                  title={isWorkspaceDeletionBlocked(selected) ? "Remova o vínculo em Arquivos antes de excluir no Workspace." : undefined}
                  className="gap-1.5 text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Excluir
                </Button>
              </div>
              <div className="text-[11px] text-muted-foreground grid grid-cols-2 gap-2 pt-2 border-t border-border">
                <div>Tipo: {selected.mime || "-"}</div>
                <div>Tamanho: {fmtSize(selected.size_bytes)}</div>
                <div>Criado: {new Date(selected.created_at).toLocaleString("pt-BR")}</div>
                {selected.inbox_scan_status && (
                  <div>Segurança: {selected.inbox_scan_status === "clean" ? "verificado" : "quarentena"}</div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Explicit Workspace → Arquivos handoff. This never requests review or
          exposes content to the client; those gates remain in AdminFiles. */}
      <Dialog
        open={!!handoffNode}
        onOpenChange={(open) => {
          if (!open && !handoffSaving) setHandoffNode(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Enviar para Arquivos</DialogTitle>
            <DialogDescription>
              Cria somente o vínculo interno para {currentClient?.company_name || currentClient?.full_name || "o cliente"}.
              O mesmo objeto físico será reutilizado e nada será liberado ao cliente automaticamente.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="workspace-handoff-name">Nome</Label>
              <Input
                id="workspace-handoff-name"
                value={handoffName}
                onChange={(event) => setHandoffName(event.target.value)}
                disabled={handoffSaving}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label id="workspace-handoff-folder-label">
                  Pasta em Arquivos
                </Label>
                <Select value={handoffFolder} onValueChange={setHandoffFolder} disabled={handoffSaving}>
                  <SelectTrigger aria-labelledby="workspace-handoff-folder-label">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FILE_FOLDERS.map((folder) => (
                      <SelectItem key={folder.id} value={folder.id}>{folder.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label id="workspace-handoff-type-label">Tipo</Label>
                <Select value={handoffType} onValueChange={setHandoffType} disabled={handoffSaving}>
                  <SelectTrigger aria-labelledby="workspace-handoff-type-label">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FILE_TYPES.map((fileType) => (
                      <SelectItem key={fileType} value={fileType}>{fileType}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label id="workspace-handoff-project-label">Projeto</Label>
              <Select value={handoffProject} onValueChange={setHandoffProject} disabled={handoffSaving}>
                <SelectTrigger aria-labelledby="workspace-handoff-project-label">
                  <SelectValue placeholder="Nenhum projeto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum projeto</SelectItem>
                  {clientProjects.map((project: any) => (
                    <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
              Depois do envio, revisão interna e liberação ao cliente continuam disponíveis somente na área Arquivos.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHandoffNode(null)} disabled={handoffSaving}>Cancelar</Button>
            <Button onClick={submitHandoff} disabled={handoffSaving || !handoffName.trim()}>
              {handoffSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {handoffSaving ? "Enviando..." : "Enviar para Arquivos"}
            </Button>
          </DialogFooter>
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
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && !deletingNode && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir {confirmDelete?.kind === "folder" ? "pasta" : "arquivo"}?</DialogTitle>
            <DialogDescription>
              {confirmDelete?.__virtual && confirmDelete.__storage_bucket === "workspace"
                ? <>O vínculo de <b>{confirmDelete.name}</b> em Arquivos será removido. O original continuará no Workspace.</>
                : confirmDelete?.kind === "folder"
                ? <>A pasta <b>{confirmDelete?.name}</b> e todo seu conteúdo serão removidos permanentemente.</>
                : <>O arquivo <b>{confirmDelete?.name}</b> será removido permanentemente.</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={deletingNode}>Cancelar</Button>
            <Button variant="destructive" onClick={() => confirmDelete && performDelete(confirmDelete)} disabled={deletingNode}>
              {deletingNode && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              {deletingNode ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmCleanup} onOpenChange={(o) => !o && !cleaningFolders && setConfirmCleanup(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Limpar pastas vazias?</DialogTitle>
            <DialogDescription>
              {emptyFoldersHere.length} pasta(s) deste nível não têm nenhum arquivo dentro, em
              nenhuma subpasta. Elas serão removidas da lista. Nenhum conteúdo é apagado: pasta com
              qualquer arquivo dentro não entra nesta limpeza.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-secondary/30 p-3">
            {emptyFoldersHere.map((node) => (
              <p key={node.id} className="text-[12px] text-muted-foreground">
                {node.name}
              </p>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCleanup(false)} disabled={cleaningFolders}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={cleanupEmptyFolders} disabled={cleaningFolders}>
              {cleaningFolders && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              {cleaningFolders ? "Limpando..." : "Limpar"}
            </Button>
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
          if (!found) return;
          if (found.kind === "folder") nav.push(found);
          else setSelected(found);
        }}
      />
    </div>
  );
}

function FilePreview({ node, getUrl }: { node: Node; getUrl: (n: Node) => Promise<string> }) {
  const getUrlRef = useRef(getUrl);
  getUrlRef.current = getUrl;
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState<{
    status: "loading" | "ready" | "error";
    url: string;
  }>({ status: "loading", url: "" });
  useEffect(() => {
    let active = true;
    setPreview({ status: "loading", url: "" });
    getUrlRef.current(node)
      .then((url) => {
        if (active) setPreview({ status: "ready", url });
      })
      .catch(() => {
        if (active) setPreview({ status: "error", url: "" });
      });
    return () => {
      active = false;
    };
  }, [node, attempt]);
  if (preview.status === "loading") {
    return <div className="h-64 flex items-center justify-center text-xs text-muted-foreground">Carregando preview...</div>;
  }
  if (preview.status === "error") {
    return (
      <div className="h-64 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
        <span>Não foi possível carregar o preview.</span>
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
          className="font-medium text-foreground underline underline-offset-2"
        >
          Tentar novamente
        </button>
      </div>
    );
  }
  // Delegate to the shared preview which handles images (zoom), PDFs (with
  // fallback UI), audio, video, and external providers (YouTube/Vimeo/Loom/Drive)
  // uniformly. Extension detection covers files uploaded without a mime type.
  return (
    <FilePreviewContent
      fileName={node.name}
      fileUrl={preview.url}
      fileId={node.__file_id || node.id}
      storageBucket={node.__storage_bucket}
      storagePath={node.__storage_path}
      mimeType={node.__mime_type || node.mime}
      extension={node.__extension}
    />
  );
}

function WorkspaceThumb({ node, cover }: { node: Node; cover: string | null }) {
  const ref = storageRefFromFile({ fileUrl: node.__external_url, storageBucket: node.__storage_bucket, storagePath: node.__storage_path });
  const k = kindOf(node);
  const Icon = iconFor(node);
  const { url } = useResolvedFileUrl({
    fileUrl: cover || node.__external_url,
    storageBucket: cover ? null : ref?.bucket,
    storagePath: cover ? null : ref?.path,
    transform: k === "image" ? { width: 640, quality: 72, resize: "cover" } : null,
    expiresIn: 3600,
  });
  if (!url) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-secondary">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }
  if (k === "video") {
    return <video src={`${url}#t=0.1`} className="absolute inset-0 w-full h-full object-cover" muted playsInline preload="none" />;
  }
  return <img src={url} alt={node.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />;
}
