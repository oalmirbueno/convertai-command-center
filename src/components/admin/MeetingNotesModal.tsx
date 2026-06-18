import { useState, useRef } from "react";
import { X, Loader2, CalendarIcon, Upload, FileText, Trash2, Sparkles, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useClients } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { Progress } from "@/components/ui/progress";

const PROJECT_TYPES = ["social_media", "trafego", "automacao", "site", "evento", "outro"];
const typeLabels: Record<string, string> = {
  social_media: "Social Media", trafego: "Tráfego", automacao: "Automação",
  site: "Site / Landing Page", evento: "Evento", outro: "Outro",
};

const ACCEPTED_FORMATS = ".pdf,.md,.txt,.doc,.docx";
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
const MAX_FILES = 10;

interface Props { open: boolean; onClose: () => void; }

// Extract text from a file on the client side
async function extractFileText(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";

  if (["md", "txt"].includes(ext)) {
    return await file.text();
  }

  if (ext === "pdf") {
    // Convert PDF to base64, send raw — the edge function will get the text
    // For now, we read as text (works for text-based PDFs)
    // For complex PDFs, we'll pass the raw text content
    try {
      const text = await file.text();
      // If it looks like a real PDF (binary), we extract what we can
      if (text.startsWith("%PDF")) {
        // Extract readable strings from PDF binary
        const readable = text.replace(/[^\x20-\x7E\n\r\táàãâéêíóôõúçÁÀÃÂÉÊÍÓÔÕÚÇ]/g, " ")
          .replace(/\s{3,}/g, "\n")
          .trim();
        return readable.slice(0, 50000); // Limit size
      }
      return text.slice(0, 50000);
    } catch {
      return `[Não foi possível extrair texto de: ${file.name}]`;
    }
  }

  // For doc/docx, try reading as text
  try {
    const text = await file.text();
    const readable = text.replace(/[^\x20-\x7E\n\r\táàãâéêíóôõúçÁÀÃÂÉÊÍÓÔÕÚÇ]/g, " ")
      .replace(/\s{3,}/g, "\n")
      .trim();
    return readable.slice(0, 50000);
  } catch {
    return `[Não foi possível extrair texto de: ${file.name}]`;
  }
}

type ProcessingStep = "idle" | "extracting" | "analyzing" | "creating" | "done" | "error";

const stepLabels: Record<ProcessingStep, string> = {
  idle: "",
  extracting: "Extraindo texto dos documentos...",
  analyzing: "IA analisando e organizando o plano do projeto...",
  creating: "Criando projeto, marcos e tarefas...",
  done: "Projeto criado com sucesso!",
  error: "Erro no processamento",
};

export default function MeetingNotesModal({ open, onClose }: Props) {
  const { user } = useAuth();
  const { data: clients } = useClients();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [clientId, setClientId] = useState("");
  const [projectType, setProjectType] = useState("social_media");
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [step, setStep] = useState<ProcessingStep>("idle");
  const [progress, setProgress] = useState(0);

  if (!open) return null;

  const isProcessing = !["idle", "done", "error"].includes(step);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []);
    addFiles(newFiles);
    if (fileRef.current) fileRef.current.value = "";
  };

  const addFiles = (newFiles: File[]) => {
    const valid: File[] = [];
    for (const f of newFiles) {
      if (f.size > MAX_FILE_SIZE) {
        toast.error(`${f.name} é muito grande (máx 2GB)`);
        continue;
      }
      if (files.length + valid.length >= MAX_FILES) {
        toast.error(`Máximo de ${MAX_FILES} arquivos`);
        break;
      }
      valid.push(f);
    }
    if (valid.length) setFiles(prev => [...prev, ...valid]);
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files);
    addFiles(droppedFiles);
  };

  const handleSave = async () => {
    if (!clientId) { toast.error("Selecione um cliente"); return; }
    if (!content.trim() && files.length === 0) { toast.error("Adicione conteúdo ou documentos"); return; }

    setStep("extracting");
    setProgress(10);

    try {
      // Step 1: Extract text from files
      const fileTexts: { name: string; text: string }[] = [];
      for (let i = 0; i < files.length; i++) {
        const text = await extractFileText(files[i]);
        fileTexts.push({ name: files[i].name, text });
        setProgress(10 + Math.round((i + 1) / files.length * 25));
      }

      setStep("analyzing");
      setProgress(40);

      // Step 2: Send to AI edge function
      const { data, error } = await supabase.functions.invoke("process-meeting-notes", {
        body: {
          content: content.trim(),
          fileTexts,
          clientId,
          projectType,
        },
      });

      if (error) throw new Error(error.message || "Erro ao processar");
      if (data?.error) throw new Error(data.error);

      setStep("creating");
      setProgress(85);

      // Step 3: Upload original files to storage
      if (files.length > 0 && data?.project_id) {
        for (const file of files) {
          const ext = file.name.split(".").pop();
          const path = `${clientId}/estrategicos/${data.project_id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
          const { error: uploadErr } = await supabase.storage.from("files").upload(path, file);
          if (!uploadErr) {
            const { data: urlData } = supabase.storage.from("files").getPublicUrl(path);
            await supabase.from("files").insert({
              file_name: file.name,
              file_url: urlData.publicUrl,
              file_type: "strategic",
              folder: "estrategicos",
              client_id: clientId,
              project_id: data.project_id,
              uploaded_by: user!.id,
            });
          }
        }
      }

      setProgress(100);
      setStep("done");

      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });

      toast.success("Projeto criado com sucesso pela IA!", {
        description: data?.plan?.project_name || "",
      });

      setTimeout(() => {
        onClose();
        resetForm();
        navigate("/kanban");
      }, 1500);

    } catch (err: any) {
      console.error("Meeting notes error:", err);
      setStep("error");
      toast.error(err.message || "Erro ao processar documentos");
      setTimeout(() => setStep("idle"), 2000);
    }
  };

  const resetForm = () => {
    setClientId("");
    setProjectType("social_media");
    setContent("");
    setFiles([]);
    setStep("idle");
    setProgress(0);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={isProcessing ? undefined : onClose} />
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-[580px] mx-4 animate-in fade-in zoom-in-[0.96] duration-200 flex flex-col max-h-[90vh]"
        style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Gerar Projeto via IA</h2>
          </div>
          <button onClick={isProcessing ? undefined : onClose}
            className={cn("text-muted-foreground hover:text-foreground transition-colors bg-transparent border-none p-1", isProcessing && "opacity-30 cursor-not-allowed")}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          {/* Processing overlay */}
          {isProcessing && (
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                {step === "done" ? (
                  <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
                ) : (
                  <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
                )}
                <p className="text-sm font-medium text-foreground">{stepLabels[step]}</p>
              </div>
              <Progress value={progress} className="h-1.5" />
              <p className="text-[11px] text-muted-foreground">
                {files.length > 0 ? `${files.length} documento(s) sendo processado(s)` : "Processando anotações"}
              </p>
            </div>
          )}

          {/* Client */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Cliente *</label>
            <select value={clientId} onChange={e => setClientId(e.target.value)} disabled={isProcessing}
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50">
              <option value="">Selecionar...</option>
              {(clients || []).map((c: any) => <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>)}
            </select>
          </div>

          {/* Project type */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Tipo de Projeto</label>
            <select value={projectType} onChange={e => setProjectType(e.target.value)} disabled={isProcessing}
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50">
              {PROJECT_TYPES.map(t => <option key={t} value={t}>{typeLabels[t]}</option>)}
            </select>
          </div>

          {/* File uploads */}
          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Documentos ({files.length}/{MAX_FILES})
            </label>
            <input ref={fileRef} type="file" accept={ACCEPTED_FORMATS} onChange={handleFileChange} multiple className="hidden" />
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => !isProcessing && fileRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors min-h-[80px]",
                isProcessing ? "opacity-50 cursor-not-allowed border-border" : "border-border hover:border-primary/40 hover:bg-primary/5"
              )}
            >
              <Upload className="w-5 h-5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground text-center">
                Arraste ou clique para adicionar PDFs, .md, .txt
              </p>
            </div>

            {/* File list */}
            {files.length > 0 && (
              <div className="space-y-1.5 max-h-[150px] overflow-y-auto">
                {files.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="flex items-center gap-2 bg-secondary/60 rounded-lg px-3 py-2">
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{f.name}</p>
                      <p className="text-[10px] text-muted-foreground">{formatFileSize(f.size)}</p>
                    </div>
                    {!isProcessing && (
                      <button onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                        className="text-muted-foreground hover:text-destructive transition-colors bg-transparent border-none p-0.5 cursor-pointer">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Manual notes */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Anotações de Reunião {files.length === 0 && "*"}
            </label>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={6}
              disabled={isProcessing}
              placeholder="Cole aqui suas anotações, transcrições, pontos discutidos..."
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors resize-none disabled:opacity-50" />
          </div>

          <div className="bg-secondary/50 rounded-lg p-3">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              <Sparkles className="w-3 h-3 inline mr-1 text-primary" />
              A IA vai analisar todos os documentos e anotações para gerar automaticamente:
              nome do projeto, escopo detalhado, marcos, tarefas iniciais e prazo estimado.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-end gap-3 shrink-0">
          <button onClick={onClose} disabled={isProcessing}
            className="px-4 py-2 rounded-[10px] text-[13px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border border-border disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={isProcessing || !clientId || (!content.trim() && files.length === 0)}
            className="px-5 py-2 rounded-[10px] text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 flex items-center gap-2">
            {isProcessing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Processando...
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                Gerar Projeto com IA
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
