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
  Folder, FolderPlus, Upload, ChevronRight, FileText, FileImage, Film,
  Archive, Trash2, Send, Download, ExternalLink, Users as UsersIcon, Globe2,
  Search, Grid2X2, List, Loader2, MoreVertical, Pencil, FolderInput, ArrowLeft,
  ChevronDown, Check, X as XIcon,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { downloadFile, openFile } from "@/lib/fileActions";
import { useWorkspaceUploads } from "@/hooks/useWorkspaceUploads";
import { UploadProgressPanel } from "@/components/workspace/UploadProgressPanel";

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
const KIND_META: Record<MediaKind, { label: string; color: string }> = {
  image: { label: "Imagens", color: "text-blue-400" },
  video: { label: "Vídeos", color: "text-purple-400" },
  audio: { label: "Áudios", color: "text-pink-400" },
  doc:   { label: "Documentos", color: "text-amber-400" },
  other: { label: "Outros", color: "text-muted-foreground" },
};

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
  const [newFolderName, setNewFolderName] = useState("");
  const uploads = useWorkspaceUploads();
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [renaming, setRaming] = useState<Node | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Node | null>(null);
  const [dragOverId, setDragOverId] = useState<string | "root" | null>(null);
  const [dragOverArea, setDragOverArea] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerFilter, setPickerFilter] = useState<"all" | "az" | "za" | "recent">("all");
  const [kindFilter, setKindFilter] = useState<"all" | MediaKind>("all");


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
    if (!s) return base;
    return base.filter(n => n.name.toLowerCase().includes(s));
  }, [nodes, virtualNodes, search, parent]);


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

  async function handleUpload(files: FileList | null, targetFolderId?: string | null) {
    if (!files || !files.length || !user) return;
    const destParent = targetFolderId !== undefined ? targetFolderId : (parent?.id || null);
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
    <div className="pt-20 pb-8 px-4 md:px-6 max-w-[1400px] mx-auto animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Workspace</h1>
          <p className="text-xs text-muted-foreground mt-1">Drive interno da equipe · arraste para mover, solte arquivos para enviar</p>
        </div>
        {/* Context switcher: collapsed picker with search + filters */}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-2 px-3 h-10 rounded-xl border border-border bg-card hover:border-primary/40 transition-colors min-w-[220px] max-w-[320px]">
              {scope === "global" ? <Globe2 className="w-4 h-4 text-primary shrink-0" /> : <Folder className="w-4 h-4 text-primary shrink-0" />}
              <span className="text-sm truncate flex-1 text-left">{contextLabel}</span>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[320px] p-0">
            <div className="p-2 border-b border-border">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input autoFocus value={pickerQuery} onChange={e => setPickerQuery(e.target.value)} placeholder="Buscar cliente..." className="h-8 pl-8 text-xs" />
              </div>
              <div className="flex items-center gap-1 mt-2">
                {[
                  { k: "all", label: "Padrão" },
                  { k: "az", label: "A→Z" },
                  { k: "za", label: "Z→A" },
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
              <UsersIcon className="w-3 h-3" /> Clientes {filteredClients.length > 0 && <span className="text-muted-foreground/60">· {filteredClients.length}</span>}
            </div>
            <div className="max-h-[320px] overflow-y-auto p-1">
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

      <div className="grid grid-cols-1 gap-4">
        {/* Main */}
        <main className="space-y-4 min-w-0">
          {/* Breadcrumb + actions */}
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="flex items-center gap-1 text-sm flex-wrap min-w-0">
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
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..." className="h-8 pl-8 w-[180px] text-xs" />
              </div>
              <div className="flex rounded-md border border-border overflow-hidden">
                <button onClick={() => setView("grid")} className={cn("p-1.5", view === "grid" ? "bg-secondary text-foreground" : "text-muted-foreground")}>
                  <Grid2X2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setView("list")} className={cn("p-1.5", view === "list" ? "bg-secondary text-foreground" : "text-muted-foreground")}>
                  <List className="w-3.5 h-3.5" />
                </button>
              </div>
              <Button size="sm" variant="outline" onClick={() => setNewFolderOpen(true)} className="gap-1.5 h-8">
                <FolderPlus className="w-3.5 h-3.5" /> Pasta
              </Button>
              <Button size="sm" onClick={() => fileInputRef.current?.click()} className="gap-1.5 h-8">
                <Upload className="w-3.5 h-3.5" />
                Upload
              </Button>
              <input ref={fileInputRef} type="file" multiple hidden onChange={e => handleUpload(e.target.files)} />
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
            className={cn("relative rounded-xl transition-all",
              rootDropActive && "ring-2 ring-primary/50 bg-primary/5")}
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
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {filtered.map(n => {
                  const Icon = iconFor(n);
                  const isFolder = n.kind === "folder";
                  const dragActive = dragOverId === n.id && isFolder;
                  return (
                    <div
                      key={n.id}
                      draggable
                      onDragStart={(e) => onDragStartNode(e, n)}
                      onDragOver={(e) => isFolder && onDragOverFolder(e, n.id)}
                      onDragLeave={() => isFolder && setDragOverId(null)}
                      onDrop={(e) => isFolder && onDropFolder(e, n.id)}
                      onClick={() => isFolder ? setParentStack([...parentStack, n]) : setSelected(n)}
                      className={cn(
                        "group relative rounded-xl border bg-card hover:border-primary/40 hover:bg-secondary/30 transition-all p-3 flex flex-col items-center gap-2 aspect-square cursor-pointer",
                        dragActive ? "border-primary bg-primary/10 ring-2 ring-primary/40" : "border-border"
                      )}
                    >
                      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {renderActionsMenu(n)}
                      </div>
                      <div className="flex-1 flex items-center justify-center w-full">
                        <Icon className={cn("w-10 h-10", isFolder ? "text-primary" : "text-muted-foreground")} />
                      </div>
                      <p className="text-[11px] font-medium text-foreground truncate w-full text-center">{n.name}</p>
                      {!isFolder && <p className="text-[10px] text-muted-foreground">{fmtSize(n.size_bytes)}</p>}
                      {n.sent_for_approval_file_id && (
                        <span className="absolute top-1.5 left-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-warning/15 text-warning">↗ aprovação</span>
                      )}
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
                    <div
                      key={n.id}
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
                  <span className="text-[11px] text-muted-foreground">📎 De Arquivos {selected.__approval_status && selected.__approval_status !== "none" ? `· ${selected.__approval_status}` : ""}</span>
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

      <UploadProgressPanel
        items={uploads.items}
        onCancel={uploads.cancel}
        onRetry={uploads.retry}
        onDismiss={uploads.dismiss}
        onClearDone={uploads.clearDone}
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
