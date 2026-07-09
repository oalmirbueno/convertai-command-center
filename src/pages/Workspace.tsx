import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Folder, FolderPlus, Upload, ChevronRight, FileText, FileImage, Film,
  Archive, Trash2, Send, Download, ExternalLink, Users as UsersIcon, Globe2,
  Search, Grid2X2, List, X, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadFile, openFile } from "@/lib/fileActions";

type Node = {
  id: string; parent_id: string | null; scope: "global" | "client";
  client_id: string | null; kind: "folder" | "file"; name: string;
  mime: string | null; size_bytes: number | null; storage_path: string | null;
  duration_sec: number | null; sort_index: number; sent_for_approval_file_id: string | null;
  created_by: string | null; created_at: string;
};

const iconFor = (n: Node) => {
  if (n.kind === "folder") return Folder;
  const m = n.mime || "";
  if (m.startsWith("image/")) return FileImage;
  if (m.startsWith("video/")) return Film;
  if (m.includes("zip") || m.includes("rar")) return Archive;
  return FileText;
};

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
  const [uploading, setUploading] = useState(0);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parent = parentStack[parentStack.length - 1] || null;

  // Clients list (for client scope)
  const { data: clients } = useQuery({
    queryKey: ["workspace-clients"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles").select("id, full_name, company_name")
        .eq("role", "client").order("full_name");
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

  useEffect(() => { setParentStack([]); setSelected(null); }, [scope, clientId]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return nodes || [];
    return (nodes || []).filter(n => n.name.toLowerCase().includes(s));
  }, [nodes, search]);

  async function signedUrl(path: string) {
    if (signedUrls[path]) return signedUrls[path];
    const { data } = await supabase.storage.from("workspace").createSignedUrl(path, 3600);
    if (data?.signedUrl) {
      setSignedUrls(p => ({ ...p, [path]: data.signedUrl }));
      return data.signedUrl;
    }
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
    qc.invalidateQueries({ queryKey: ["workspace-nodes"] });
  }

  async function handleUpload(files: FileList | null) {
    if (!files || !files.length || !user) return;
    setUploading(files.length);
    let ok = 0;
    for (const file of Array.from(files)) {
      try {
        const ext = file.name.split(".").pop() || "bin";
        const key = `${scope}/${scope === "client" ? clientId : "global"}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("workspace").upload(key, file, {
          cacheControl: "3600", upsert: false, contentType: file.type || undefined,
        });
        if (upErr) throw upErr;
        const { error: insErr } = await supabase.from("workspace_nodes").insert({
          name: file.name, kind: "file", scope,
          client_id: scope === "client" ? clientId : null,
          parent_id: parent?.id || null, mime: file.type || null,
          size_bytes: file.size, storage_path: key, created_by: user.id,
        });
        if (insErr) throw insErr;
        ok++;
      } catch (e: any) {
        toast({ title: `Falha em ${file.name}`, description: e.message, variant: "destructive" });
      }
    }
    setUploading(0);
    if (ok) toast({ title: `${ok} arquivo(s) enviado(s)` });
    qc.invalidateQueries({ queryKey: ["workspace-nodes"] });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function removeNode(n: Node) {
    if (!confirm(`Excluir "${n.name}"?`)) return;
    if (n.kind === "file" && n.storage_path) {
      await supabase.storage.from("workspace").remove([n.storage_path]);
    }
    await supabase.from("workspace_nodes").delete().eq("id", n.id);
    setSelected(null);
    qc.invalidateQueries({ queryKey: ["workspace-nodes"] });
  }

  async function sendToApproval(n: Node) {
    if (!user || n.kind !== "file" || !n.storage_path) return;
    if (scope !== "client" || !clientId) {
      toast({ title: "Selecione um cliente", description: "Aprovação é enviada em contexto de cliente.", variant: "destructive" });
      return;
    }
    try {
      // Copy from workspace bucket to files bucket
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
      qc.invalidateQueries({ queryKey: ["workspace-nodes"] });
      qc.invalidateQueries({ queryKey: ["files"] });
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
  }

  if (!isStaff) {
    return <div className="p-8 text-center text-muted-foreground">Acesso restrito à equipe.</div>;
  }

  return (
    <div className="pt-20 pb-8 px-4 md:px-6 max-w-[1400px] mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Workspace</h1>
          <p className="text-xs text-muted-foreground mt-1">Drive interno da equipe · vídeos, docs e materiais operacionais</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* Sidebar */}
        <aside className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-2">
            <button
              onClick={() => { setScope("global"); setClientId(null); }}
              className={cn("w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                scope === "global" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50")}
            >
              <Globe2 className="w-4 h-4" /> Global (Agência)
            </button>
          </div>
          <div className="rounded-xl border border-border bg-card p-2">
            <div className="flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <UsersIcon className="w-3 h-3" /> Clientes
            </div>
            <div className="max-h-[420px] overflow-y-auto">
              {(clients || []).map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => { setScope("client"); setClientId(c.id); }}
                  className={cn("w-full text-left flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] transition-colors truncate",
                    scope === "client" && clientId === c.id
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50")}
                >
                  <Folder className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{c.company_name || c.full_name}</span>
                </button>
              ))}
              {(!clients || !clients.length) && (
                <p className="text-xs text-muted-foreground px-3 py-2">Nenhum cliente</p>
              )}
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="space-y-4 min-w-0">
          {/* Breadcrumb + actions */}
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="flex items-center gap-1 text-sm flex-wrap min-w-0">
              <button onClick={() => setParentStack([])} className="text-muted-foreground hover:text-foreground truncate">
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
              <Button size="sm" onClick={() => fileInputRef.current?.click()} className="gap-1.5 h-8" disabled={uploading > 0}>
                {uploading > 0 ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {uploading > 0 ? `Enviando ${uploading}...` : "Upload"}
              </Button>
              <input ref={fileInputRef} type="file" multiple hidden onChange={e => handleUpload(e.target.files)} />
            </div>
          </div>

          {scope === "client" && !clientId ? (
            <div className="text-center py-16 text-sm text-muted-foreground">Selecione um cliente na barra lateral.</div>
          ) : isLoading ? (
            <div className="text-center py-16 text-sm text-muted-foreground">Carregando...</div>
          ) : !filtered.length ? (
            <div className="text-center py-16 text-sm text-muted-foreground">
              <Folder className="w-8 h-8 mx-auto mb-2 opacity-40" />
              Pasta vazia. Envie arquivos ou crie uma subpasta.
            </div>
          ) : view === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {filtered.map(n => {
                const Icon = iconFor(n);
                return (
                  <button
                    key={n.id}
                    onClick={() => n.kind === "folder" ? setParentStack([...parentStack, n]) : setSelected(n)}
                    className="group relative rounded-xl border border-border bg-card hover:border-primary/40 hover:bg-secondary/30 transition-all p-3 text-left flex flex-col items-center gap-2 aspect-square"
                  >
                    <div className="flex-1 flex items-center justify-center w-full">
                      <Icon className={cn("w-10 h-10", n.kind === "folder" ? "text-primary" : "text-muted-foreground")} />
                    </div>
                    <p className="text-[11px] font-medium text-foreground truncate w-full text-center">{n.name}</p>
                    {n.kind === "file" && <p className="text-[10px] text-muted-foreground">{fmtSize(n.size_bytes)}</p>}
                    {n.sent_for_approval_file_id && (
                      <span className="absolute top-1.5 right-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-warning/15 text-warning">↗ aprovação</span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card divide-y divide-border">
              {filtered.map(n => {
                const Icon = iconFor(n);
                return (
                  <button
                    key={n.id}
                    onClick={() => n.kind === "folder" ? setParentStack([...parentStack, n]) : setSelected(n)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/40 transition-colors text-left"
                  >
                    <Icon className={cn("w-4 h-4 shrink-0", n.kind === "folder" ? "text-primary" : "text-muted-foreground")} />
                    <span className="flex-1 text-[13px] truncate">{n.name}</span>
                    {n.kind === "file" && <span className="text-[11px] text-muted-foreground">{fmtSize(n.size_bytes)}</span>}
                    {n.sent_for_approval_file_id && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-warning/15 text-warning">aprovação</span>}
                  </button>
                );
              })}
            </div>
          )}
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
              <FilePreview node={selected} getUrl={signedUrl} />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={async () => openFile(await signedUrl(selected.storage_path!))} className="gap-1.5">
                  <ExternalLink className="w-3.5 h-3.5" /> Abrir
                </Button>
                <Button size="sm" variant="outline" onClick={async () => downloadFile(await signedUrl(selected.storage_path!), selected.name)} className="gap-1.5">
                  <Download className="w-3.5 h-3.5" /> Baixar
                </Button>
                {scope === "client" && !selected.sent_for_approval_file_id && (
                  <Button size="sm" onClick={() => sendToApproval(selected)} className="gap-1.5 bg-primary">
                    <Send className="w-3.5 h-3.5" /> Enviar para aprovação
                  </Button>
                )}
                {selected.sent_for_approval_file_id && (
                  <span className="text-[11px] text-warning">Já enviado para aprovação</span>
                )}
                <div className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => removeNode(selected)} className="gap-1.5 text-destructive hover:text-destructive">
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
    </div>
  );
}

function FilePreview({ node, getUrl }: { node: Node; getUrl: (p: string) => Promise<string> }) {
  const [url, setUrl] = useState("");
  useEffect(() => { if (node.storage_path) getUrl(node.storage_path).then(setUrl); }, [node.id]);
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
