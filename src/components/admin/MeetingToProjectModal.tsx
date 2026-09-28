import { useState, useRef } from "react";
import { Loader2, Sparkles, Upload, FileText, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AjudaRecolhida, CampoDeEscolha, CampoDeFormulario, botao, campo, campoTexto, foco, juntar, texto } from "@/components/sistema";
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
      const path = `${clientId}/estrategicos/${Date.now()}_${file.name}`;
      const { error } = await supabase.storage.from("files").upload(path, file);
      if (error) {
        console.error("Upload error:", error);
        continue;
      }
      const { data: urlData, error: signError } = await supabase.storage
        .from("files")
        .createSignedUrl(path, 15 * 60);
      if (signError || !urlData?.signedUrl) {
        console.error("Signed URL error:", signError);
        continue;
      }
      urls.push(urlData.signedUrl);
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
    // Janela do sistema (Dialog): foco preso, Esc fecha, rola por dentro e as
    // ações ficam presas no pé. A explicação fica no "?" do título.
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-[520px] flex-col overflow-hidden border-border bg-card p-0">
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <div className="flex min-w-0 items-center pr-8">
            <DialogTitle className={juntar(texto.tituloSecao, "min-w-0 truncate")}>Gerar Projeto com IA</DialogTitle>
            <AjudaRecolhida className="ml-1.5" rotulo="Como funciona">
              Cole anotações ou envie documentos e a IA cria o projeto completo.
            </AjudaRecolhida>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5">
          <CampoDeFormulario rotulo="Cliente" obrigatorio>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={campo}>
              <option value="">Selecione o cliente</option>
              {(clients || []).map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.company_name || c.full_name}
                </option>
              ))}
            </select>
          </CampoDeFormulario>

          <CampoDeFormulario rotulo="Tipo de projeto" obrigatorio>
            <select value={projectType} onChange={(e) => setProjectType(e.target.value)} className={campo}>
              <option value="">Tipo de projeto</option>
              {PROJECT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </CampoDeFormulario>

          {/* Documentos: lista com divisória, sem caixa por arquivo. */}
          <CampoDeEscolha rotulo="Documentos">
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
              className={juntar("flex w-full items-center justify-center rounded-md border border-dashed border-border px-3.5 py-3 text-[13px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground", foco)}
            >
              <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
              Enviar PDF, DOC, TXT ou MD
            </button>

            {files.length > 0 && (
              <ul className="mt-2 divide-y divide-border">
                {files.map((f, i) => (
                  <li key={i} className="flex min-w-0 items-center py-1.5">
                    <FileText className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{f.name}</span>
                    <span className="ml-2 shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatFileSize(f.size)}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className={juntar(botao.icone, "ml-1 h-7 w-7 hover:text-destructive")}
                      aria-label={`Remover ${f.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CampoDeEscolha>

          <CampoDeFormulario
            rotulo={files.length === 0 ? "Anotações da reunião" : "Anotações da reunião (opcional)"}
            obrigatorio={files.length === 0}
            apoio={`${meetingNotes.length} caracteres`}
          >
            <textarea
              value={meetingNotes}
              onChange={(e) => setMeetingNotes(e.target.value)}
              placeholder="Cole aqui as anotações, transcrição ou resumo da reunião com o cliente..."
              rows={6}
              className={juntar(campoTexto, "min-h-[150px] resize-none")}
            />
          </CampoDeFormulario>
        </div>

        <div className="flex shrink-0 items-center justify-end border-t border-border px-5 py-3 [&>*+*]:ml-2">
          <button type="button" onClick={handleClose} disabled={loading} className={botao.secundario}>
            Cancelar
          </button>
          <button type="button" onClick={handleGenerate} disabled={loading} className={botao.primario}>
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                {files.length > 0 ? "Enviando..." : "IA analisando..."}
              </>
            ) : (
              <>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Gerar Plano com IA
              </>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
