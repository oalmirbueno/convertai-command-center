import { useState, useRef } from "react";
import { Loader2, Upload, FileText, Trash2, Sparkles, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { gravarCopiasSemEsperar } from "@/lib/miniaturas";
import { createFileRecord } from "@/lib/fileRecordActions";
import { useQueryClient } from "@tanstack/react-query";
import { useClients } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { CampoDeFormulario, JanelaCentral, botao, campo, campoTexto, juntar, texto } from "@/components/sistema";
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
            gravarCopiasSemEsperar("files", path, file, { nome: file.name, mime: file.type });
            await createFileRecord({
              file_name: file.name,
              file_url: `files://${path}`,
              file_type: "strategic",
              folder: "estrategicos",
              client_id: clientId,
              project_id: data.project_id,
              uploaded_by: user!.id,
              storage_bucket: "files",
              storage_path: path,
              visibility: "internal",
              approval_status: "none",
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
    <JanelaCentral
      aberta={open}
      onMudar={(v) => { if (!v && !isProcessing) onClose(); }}
      largura="md"
      icone={<Sparkles className="h-4 w-4 text-primary" />}
      titulo="Gerar Projeto via IA"
      ajuda="A IA lê os documentos e as anotações e monta o projeto: nome, escopo, marcos, tarefas iniciais e prazo estimado."
      rotuloDaAjuda="O que a IA gera"
      fecharNoFundo={!isProcessing}
      rodape={
        <div className="flex justify-end space-x-2">
          <button type="button" onClick={onClose} disabled={isProcessing} className={botao.secundario}>
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={isProcessing || !clientId || (!content.trim() && files.length === 0)} className={botao.primario}>
            {isProcessing ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Processando...
              </>
            ) : (
              <>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                Gerar Projeto com IA
              </>
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Andamento */}
        {isProcessing && (
          <div className="space-y-2.5 rounded-md bg-accent-soft p-3.5" role="status">
            <div className="flex items-center">
              {step === "done" ? (
                <CheckCircle2 className="mr-2.5 h-4 w-4 shrink-0 text-success" />
              ) : (
                <Loader2 className="mr-2.5 h-4 w-4 shrink-0 animate-spin text-primary" />
              )}
              <p className="min-w-0 text-[13px] font-medium leading-5 text-foreground">{stepLabels[step]}</p>
            </div>
            <Progress value={progress} className="h-1.5" />
            <p className={texto.auxiliar}>
              {files.length > 0 ? `${files.length} documento(s) sendo processado(s)` : "Processando anotações"}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <CampoDeFormulario rotulo="Cliente" obrigatorio>
            <select value={clientId} onChange={e => setClientId(e.target.value)} disabled={isProcessing} className={campo}>
              <option value="">Selecionar...</option>
              {(clients || []).map((c: any) => <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>)}
            </select>
          </CampoDeFormulario>

          <CampoDeFormulario rotulo="Tipo de Projeto">
            <select value={projectType} onChange={e => setProjectType(e.target.value)} disabled={isProcessing} className={campo}>
              {PROJECT_TYPES.map(t => <option key={t} value={t}>{typeLabels[t]}</option>)}
            </select>
          </CampoDeFormulario>
        </div>

        {/* Documentos */}
        <div className="space-y-2">
          <p className={texto.rotulo}>
            Documentos <span className="tabular-nums">({files.length}/{MAX_FILES})</span>
          </p>
          <input ref={fileRef} type="file" accept={ACCEPTED_FORMATS} onChange={handleFileChange} multiple className="hidden" />
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => !isProcessing && fileRef.current?.click()}
            className={juntar(
              "flex min-h-[84px] cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-border p-4 text-center transition-colors",
              isProcessing ? "cursor-not-allowed opacity-50" : "hover:border-primary/50 hover:bg-accent-soft/50"
            )}
          >
            <Upload className="h-4 w-4 text-muted-foreground" />
            <p className={juntar(texto.auxiliar, "mt-1.5")}>
              Arraste ou clique para adicionar PDFs, .md, .txt
            </p>
          </div>

          {files.length > 0 && (
            <ul className="divide-y divide-border/60">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center py-2">
                  <FileText className="mr-2.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium leading-5 text-foreground">{f.name}</p>
                    <p className="text-[11px] leading-4 tabular-nums text-muted-foreground">{formatFileSize(f.size)}</p>
                  </div>
                  {!isProcessing && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); removeFile(i); }} aria-label={`Remover ${f.name}`}
                      className={juntar(botao.icone, "ml-2 h-7 w-7 hover:text-destructive")}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <CampoDeFormulario rotulo="Anotações de Reunião" obrigatorio={files.length === 0}>
          <textarea value={content} onChange={e => setContent(e.target.value)} rows={6}
            disabled={isProcessing}
            placeholder="Cole aqui suas anotações, transcrições, pontos discutidos..."
            className={juntar(campoTexto, "resize-none")} />
        </CampoDeFormulario>
      </div>
    </JanelaCentral>
  );
}
