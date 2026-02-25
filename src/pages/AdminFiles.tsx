import { useState, useRef, useCallback } from "react";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useClients, useProjects, useAllFiles } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Upload, FileImage, FileText, Film, Archive, Download, Trash2, FolderOpen, Zap,
} from "lucide-react";
import FilePreviewContent from "@/components/shared/FilePreviewContent";

const FOLDERS = [
  { id: "estrategicos", label: "📁 Estratégicos" },
  { id: "contratos", label: "📁 Contratos" },
  { id: "materiais", label: "📁 Materiais Gráficos" },
  { id: "relatorios", label: "📁 Relatórios" },
  { id: "operacionais", label: "📁 Operacionais" },
];

const FILE_TYPES = ["documento", "contrato", "criativo", "relatório", "estratégico", "outro"];
const ACCEPTED = ".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.pptx,.xlsx,.mp4,.zip";
const MAX_SIZE = 50 * 1024 * 1024;

const fileIcon = (name: string) => {
  const ext = name?.split(".").pop()?.toLowerCase() || "";
  if (["jpg","jpeg","png","gif","webp"].includes(ext)) return FileImage;
  if (["mp4"].includes(ext)) return Film;
  if (["zip"].includes(ext)) return Archive;
  return FileText;
};

const approvalBadge: Record<string, { cls: string; label: string }> = {
  pending: { cls: "bg-warning/10 text-warning", label: "Pendente" },
  approved: { cls: "bg-success/10 text-success", label: "Aprovado" },
  rejected: { cls: "bg-destructive/10 text-destructive", label: "Rejeitado" },
  none: { cls: "bg-muted text-muted-foreground", label: "Sem status" },
};

export default function AdminFiles() {
  const { user } = useAuth();
  const { data: clients, isLoading: loadingClients } = useClients();
  const { data: projects } = useProjects();
  const { data: allFiles, isLoading: loadingFiles } = useAllFiles();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedClient, setSelectedClient] = useState<string>("all");
  const [activeFolder, setActiveFolder] = useState("estrategicos");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload form state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadFolder, setUploadFolder] = useState(activeFolder);
  const [uploadProject, setUploadProject] = useState("");
  const [uploadType, setUploadType] = useState("documento");
  const [uploadApproval, setUploadApproval] = useState(false);
  const [uploadCaption, setUploadCaption] = useState("");
  const [uploadCarousel, setUploadCarousel] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [previewFile, setPreviewFile] = useState<any>(null);

  const isImage = (name: string) => {
    const ext = name?.split(".").pop()?.toLowerCase() || "";
    return ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);
  };
  const isPdf = (name: string) => name?.toLowerCase().endsWith(".pdf");
  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

  const filteredFiles = (allFiles || []).filter((f: any) => {
    if (selectedClient !== "all" && f.client_id !== selectedClient) return false;
    if ((f.folder || "estrategicos") !== activeFolder) return false;
    return true;
  });

  const handleFileSelect = (file: File) => {
    if (file.size > MAX_SIZE) {
      toast({ title: "Arquivo muito grande", description: "Máximo 50MB.", variant: "destructive" });
      return;
    }
    setUploadFile(file);
    setUploadName(file.name);
    setUploadFolder(activeFolder);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [activeFolder]);

  const handleUpload = async () => {
    if (!uploadFile || !user || !selectedClient || selectedClient === "all") {
      toast({ title: "Selecione um cliente", variant: "destructive" });
      return;
    }
    setUploading(true);
    setUploadProgress(10);

    try {
      const ext = uploadFile.name.split(".").pop();
      const path = `${selectedClient}/${Date.now()}.${ext}`;
      setUploadProgress(30);

      const { error: storageError } = await supabase.storage.from("files").upload(path, uploadFile);
      if (storageError) throw storageError;
      setUploadProgress(70);

      const { data: urlData } = supabase.storage.from("files").getPublicUrl(path);

      await supabase.from("files").insert({
        client_id: selectedClient,
        file_name: uploadName || uploadFile.name,
        file_url: urlData.publicUrl,
        file_type: uploadType,
        folder: uploadFolder,
        uploaded_by: user.id,
        project_id: uploadProject === "none" ? null : uploadProject || null,
        approval_status: uploadApproval ? "pending" : "none",
        caption: uploadCaption.trim() || null,
        carousel_text: uploadCarousel.trim() || null,
        description: uploadDescription.trim() || null,
      });
      setUploadProgress(90);

      if (uploadApproval) {
        await supabase.from("notifications").insert({
          user_id: selectedClient,
          message: `Novo arquivo para aprovação: ${uploadName}`,
          notification_type: "approval",
          link: "/aprovacoes",
        });
      }

      if (uploadProject) {
        await supabase.from("updates").insert({
          project_id: uploadProject,
          author_id: user.id,
          message: `Novo arquivo enviado: ${uploadName}`,
          update_type: "creative",
        });
      }

      setUploadProgress(100);
      queryClient.invalidateQueries({ queryKey: ["all-files"] });
      toast({ title: "Arquivo enviado com sucesso" });
      setUploadOpen(false);
      resetUploadForm();
    } catch (err: any) {
      toast({ title: "Erro no upload", description: err.message, variant: "destructive" });
    }
    setUploading(false);
  };

  const resetUploadForm = () => {
    setUploadFile(null);
    setUploadName("");
    setUploadProject("");
    setUploadType("documento");
    setUploadApproval(false);
    setUploadProgress(0);
    setUploadCaption("");
    setUploadCarousel("");
    setUploadDescription("");
  };

  const [confirmDeleteFile, setConfirmDeleteFile] = useState<{ id: string; url: string } | null>(null);

  const handleDelete = async () => {
    if (!confirmDeleteFile) return;
    try {
      const urlParts = confirmDeleteFile.url.split("/files/");
      if (urlParts[1]) {
        await supabase.storage.from("files").remove([urlParts[1]]);
      }
      await supabase.from("files").delete().eq("id", confirmDeleteFile.id);
      queryClient.invalidateQueries({ queryKey: ["all-files"] });
      toast({ title: "Arquivo excluído" });
      setConfirmDeleteFile(null);
    } catch {
      toast({ title: "Erro ao excluir", variant: "destructive" });
    }
  };

  const clientProjects = (projects || []).filter((p: any) =>
    selectedClient === "all" || p.client_id === selectedClient
  );

  // formatDate already defined above

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="heading-page">Arquivos</p>
        <div className="flex items-center gap-3">
          <Select value={selectedClient} onValueChange={setSelectedClient}>
            <SelectTrigger className="w-full sm:w-[220px] bg-card border-border rounded-xl text-sm">
              <SelectValue placeholder="Todos os clientes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os clientes</SelectItem>
              {(clients || []).map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.company_name || c.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Folder tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {FOLDERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setActiveFolder(f.id)}
            className={`px-4 py-2 text-xs uppercase tracking-wide rounded-lg whitespace-nowrap transition-colors ${
              activeFolder === f.id
                ? "text-foreground border-b-2 border-primary bg-secondary/50"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Upload button */}
      <div className="flex justify-end">
        <Button
          onClick={() => { setUploadFolder(activeFolder); setUploadOpen(true); }}
          className="rounded-xl gap-2"
          disabled={selectedClient === "all"}
        >
          <Upload className="w-4 h-4" />
          Upload
        </Button>
      </div>

      {/* File list */}
      {loadingFiles || loadingClients ? (
        <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : filteredFiles.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground flex flex-col items-center gap-2">
          <FolderOpen className="w-8 h-8 text-muted-foreground/40" />
          Nenhum arquivo nesta pasta
        </div>
      ) : (
        <div className="space-y-2 stagger-children">
          {filteredFiles.map((f: any) => {
            const Icon = fileIcon(f.file_name);
            const badge = approvalBadge[f.approval_status] || approvalBadge.none;
            return (
              <div key={f.id} className="bg-card border border-border rounded-xl px-4 py-3 cursor-pointer hover:border-muted-foreground/30 transition-colors"
                onClick={() => setPreviewFile(f)}>
                <div className="flex items-center gap-3">
                  <Icon className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-foreground truncate">
                      {f.file_name}
                      {f.version > 1 && <span className="text-xs text-muted-foreground ml-1">v{f.version}</span>}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {f.project?.name || "—"} • {formatDate(f.created_at)}
                    </p>
                  </div>
                  <div className="hidden md:flex items-center gap-2">
                    <Avatar className="w-5 h-5">
                      <AvatarFallback className="text-[8px] bg-secondary text-secondary-foreground">
                        {f.uploader?.full_name?.charAt(0) || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-[11px] text-muted-foreground">{f.uploader?.full_name}</span>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 hidden sm:inline ${badge.cls}`}>{badge.label}</span>
                  <a href={f.file_url} target="_blank" rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    onClick={(e) => e.stopPropagation()}>
                    <Download className="w-4 h-4" />
                  </a>
                  <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteFile({ id: f.id, url: f.file_url }); }}
                    className="text-muted-foreground hover:text-destructive transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="sm:hidden mt-2 ml-8">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Preview Modal */}
      <Dialog open={!!previewFile} onOpenChange={() => setPreviewFile(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="truncate pr-6">{previewFile?.file_name}</DialogTitle></DialogHeader>
          {previewFile && (
            <div className="space-y-4">
              <FilePreviewContent fileName={previewFile.file_name} fileUrl={previewFile.file_url} />
              <p className="text-xs text-muted-foreground">
                Enviado por {previewFile.uploader?.full_name || "—"} • {formatDate(previewFile.created_at)}
              </p>
              {previewFile.caption && <div><p className="text-[11px] text-muted-foreground uppercase">Legenda</p><p className="text-sm text-foreground">{previewFile.caption}</p></div>}
              {previewFile.carousel_text && <div><p className="text-[11px] text-muted-foreground uppercase">Texto do Carrossel</p><p className="text-sm text-foreground whitespace-pre-wrap">{previewFile.carousel_text}</p></div>}
              {previewFile.description && <div><p className="text-[11px] text-muted-foreground uppercase">Descrição</p><p className="text-sm text-foreground">{previewFile.description}</p></div>}
              <div className="flex items-center gap-2">
                <span className={`text-[11px] px-2.5 py-1 rounded-full ${(approvalBadge[previewFile.approval_status] || approvalBadge.none).cls}`}>
                  {(approvalBadge[previewFile.approval_status] || approvalBadge.none).label}
                </span>
              </div>
              {previewFile.feedback && (
                <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3">
                  <p className="text-[11px] text-muted-foreground mb-0.5">Feedback do cliente:</p>
                  <p className="text-xs text-foreground">{previewFile.feedback}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="flex gap-2">
            {previewFile?.approval_status === "rejected" && previewFile?.project_id && (
              <Button size="sm" variant="outline" className="gap-1 border-warning/50 text-warning hover:bg-warning/10"
                onClick={async () => {
                  await supabase.from("tasks").insert({
                    project_id: previewFile.project_id,
                    title: `Ajustar: ${previewFile.file_name}`,
                    description: `Feedback do cliente:\n${previewFile.feedback || "Sem detalhes"}`,
                    status: "backlog", priority: "high",
                    assigned_to: previewFile.uploaded_by || null,
                  });
                  queryClient.invalidateQueries({ queryKey: ["tasks"] });
                  toast({ title: "Tarefa criada no Kanban!" });
                }}>
                <Zap className="w-3 h-3" /> Criar Tarefa
              </Button>
            )}
            <a href={previewFile?.file_url} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="gap-2"><Download className="w-3.5 h-3.5" /> Baixar</Button>
            </a>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Modal */}
      <Dialog open={uploadOpen} onOpenChange={(o) => { if (!uploading) { setUploadOpen(o); if (!o) resetUploadForm(); } }}>
        <DialogContent className="max-w-lg bg-card border-border max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Upload de Arquivo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto flex-1 pr-1">
            {/* Drag & Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl h-40 flex flex-col items-center justify-center cursor-pointer transition-colors ${
                dragOver ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground"
              }`}
            >
              <Upload className="w-8 h-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                {uploadFile ? uploadFile.name : "Arraste ou clique para selecionar"}
              </p>
              {uploadFile && (
                <p className="text-xs text-muted-foreground mt-1">
                  {(uploadFile.size / 1024 / 1024).toFixed(1)} MB
                </p>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED}
              className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); }}
            />

            <div className="space-y-3">
              <div>
                <Label className="label-sm">Nome do arquivo</Label>
                <Input value={uploadName} onChange={(e) => setUploadName(e.target.value)}
                  className="mt-1 bg-secondary border-border rounded-xl" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="label-sm">Pasta</Label>
                  <Select value={uploadFolder} onValueChange={setUploadFolder}>
                    <SelectTrigger className="mt-1 bg-secondary border-border rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FOLDERS.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="label-sm">Tipo</Label>
                  <Select value={uploadType} onValueChange={setUploadType}>
                    <SelectTrigger className="mt-1 bg-secondary border-border rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FILE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="label-sm">Projeto vinculado (opcional)</Label>
                <Select value={uploadProject} onValueChange={setUploadProject}>
                  <SelectTrigger className="mt-1 bg-secondary border-border rounded-xl"><SelectValue placeholder="Nenhum" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {clientProjects.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="label-sm">Legenda (opcional)</Label>
                <textarea value={uploadCaption} onChange={(e) => setUploadCaption(e.target.value)} rows={2} placeholder="Legenda do post..."
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors resize-none" />
              </div>
              <div>
                <Label className="label-sm">Texto do Carrossel (opcional)</Label>
                <textarea value={uploadCarousel} onChange={(e) => setUploadCarousel(e.target.value)} rows={2} placeholder="Texto para carrossel multi-slide..."
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors resize-none" />
              </div>
              <div>
                <Label className="label-sm">Descrição interna (opcional)</Label>
                <textarea value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} rows={2} placeholder="Notas para o cliente..."
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors resize-none" />
              </div>
              <div className="flex items-center justify-between py-2">
                <Label className="label-sm">Enviar para aprovação do cliente?</Label>
                <Switch checked={uploadApproval} onCheckedChange={setUploadApproval} />
              </div>
            </div>

            {uploading && <Progress value={uploadProgress} className="h-2 rounded-full" />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setUploadOpen(false); resetUploadForm(); }} disabled={uploading}>Cancelar</Button>
            <Button onClick={handleUpload} disabled={!uploadFile || uploading}>
              {uploading ? "Enviando..." : "Enviar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={!!confirmDeleteFile}
        title="Excluir arquivo"
        description="Este arquivo será removido permanentemente do sistema."
        onConfirm={handleDelete}
        onCancel={() => setConfirmDeleteFile(null)}
      />
    </div>
  );
}
