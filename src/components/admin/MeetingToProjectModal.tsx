import { useState, useRef } from "react";
import { X, Loader2, Sparkles, Upload, FileText, Trash2 } from "lucide-react";
import { useClients } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { fireWebhook, webhooks } from "@/lib/webhooks";
import { toast } from "sonner";

const PROJECT_TYPES = [
  "Social Media",
  "Tráfego Pago",
  "Site / Landing Page",
  "Automação",
  "Branding",
  "Evento",
  "Outro",
];

const ACCEPTED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
];

const ACCEPTED_EXTENSIONS = ".pdf,.doc,.docx,.txt,.md";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function MeetingToProjectModal({ open, onClose }: Props) {
  const { data: clients } = useClients();
  const [clientId, setClientId] = useState("");
  const [projectType, setProjectType] = useState("");
  const [meetingNotes, setMeetingNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    const valid = selected.filter(
      (f) => ACCEPTED_TYPES.includes(f.type) || f.name.endsWith(".md")
    );
    if (valid.length < selected.length) {
      toast.error("Apenas PDF, DOC, DOCX, TXT e MD são aceitos");
    }
    setFiles((prev) => [...prev, ...valid]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadFiles = async (): Promise<string[]> => {
    const urls: string[] = [];
    for (const file of files) {
      const path = `estrategicos/${Date.now()}_${file.name}`;
      const { error } = await supabase.storage.from("files").upload(path, file);
      if (error) {
        console.error("Upload error:", error);
        continue;
      }
      const { data: urlData } = supabase.storage.from("files").getPublicUrl(path);
      urls.push(urlData.publicUrl);
    }
    return urls;
  };

  const handleGenerate = async () => {
    if (!clientId || !projectType || (!meetingNotes.trim() && files.length === 0)) {
      toast.error("Preencha o cliente, tipo e cole anotações ou envie documentos");
      return;
    }
    setLoading(true);

    try {
      let fileUrls: string[] = [];
      if (files.length > 0) {
        fileUrls = await uploadFiles();
      }

      fireWebhook(webhooks.meetingToPlan, {
        client_id: clientId,
        project_type: projectType,
        meeting_notes: meetingNotes.trim(),
        file_urls: fileUrls,
      });

      setTimeout(() => {
        setLoading(false);
        toast.success("Plano sendo gerado pela IA. Você será notificado quando estiver pronto!");
        handleClose();
      }, 2000);
    } catch (err) {
      setLoading(false);
      toast.error("Erro ao enviar documentos");
    }
  };

  const handleClose = () => {
    setClientId("");
    setProjectType("");
    setMeetingNotes("");
    setFiles([]);
    setLoading(false);
    onClose();
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / 1048576).toFixed(1)}MB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      <div
        className="relative bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full max-w-[520px] sm:mx-4 animate-in fade-in zoom-in-[0.96] duration-200 max-h-[95vh] overflow-hidden"
        style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Gerar Projeto com IA</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Cole anotações ou envie documentos e a IA cria o projeto completo.
            </p>
          </div>
          <button
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Client select */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Cliente *</label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors"
            >
              <option value="">Selecione o cliente</option>
              {(clients || []).map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.company_name || c.full_name}
                </option>
              ))}
            </select>
          </div>

          {/* Project type select */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Tipo de projeto *</label>
            <select
              value={projectType}
              onChange={(e) => setProjectType(e.target.value)}
              className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors"
            >
              <option value="">Tipo de projeto</option>
              {PROJECT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* File upload */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Documentos</label>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              multiple
              onChange={handleFilesSelected}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 bg-secondary border border-dashed border-border rounded-[10px] px-3.5 py-3 text-sm text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              Enviar PDF, DOC, TXT ou MD
            </button>

            {files.length > 0 && (
              <div className="space-y-1.5 mt-2">
                {files.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 bg-secondary/50 border border-border rounded-lg px-3 py-2"
                  >
                    <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs text-foreground truncate flex-1">{f.name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{formatFileSize(f.size)}</span>
                    <button
                      onClick={() => removeFile(i)}
                      className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer bg-transparent border-none p-0.5"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Meeting notes textarea */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Anotações da reunião {files.length === 0 ? "*" : "(opcional)"}
            </label>
            <div className="relative">
              <textarea
                value={meetingNotes}
                onChange={(e) => setMeetingNotes(e.target.value)}
                placeholder="Cole aqui as anotações, transcrição ou resumo da reunião com o cliente..."
                rows={6}
                className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors resize-none min-h-[150px]"
              />
              <span className="absolute bottom-2 right-3 text-[10px] text-muted-foreground/50">
                {meetingNotes.length} caracteres
              </span>
            </div>
          </div>
        </div>

        <div className="px-5 sm:px-6 py-4 border-t border-border flex flex-col sm:flex-row justify-end gap-2 sm:gap-3">
          <button
            onClick={handleClose}
            disabled={loading}
            className="px-4 py-2 rounded-[10px] text-[13px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border border-border"
          >
            Cancelar
          </button>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full sm:w-auto px-5 py-2 rounded-[10px] text-[13px] font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {files.length > 0 ? "Enviando..." : "IA analisando..."}
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                Gerar Plano com IA
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
