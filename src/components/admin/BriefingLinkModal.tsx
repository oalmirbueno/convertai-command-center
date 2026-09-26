import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Copy, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useClients, useProjects } from "@/hooks/useSupabaseData";
import { toast } from "sonner";
import { appPublicUrl } from "@/lib/publicUrl";
import { AjudaRecolhida, CampoDeFormulario, GrupoDeCampos, botao, campo, juntar, texto } from "@/components/sistema";

interface Props { open: boolean; onClose: () => void; }

export default function BriefingLinkModal({ open, onClose }: Props) {
  const { data: clients } = useClients();
  const { data: projects } = useProjects();
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [generatedUrl, setGeneratedUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);

  const clientProjects = (projects || []).filter((p: any) => p.client_id === clientId);

  useEffect(() => { if (!open) { setGeneratedUrl(""); setClientId(""); setProjectId(""); } }, [open]);

  if (!open) return null;

  const handleGenerate = async () => {
    if (!clientId) { toast.error("Selecione um cliente"); return; }
    setGenerating(true);
    try {
      const { data, error } = await supabase.from("briefings").insert({
        client_id: clientId,
        project_id: projectId || null,
      }).select("token").single();
      if (error) throw error;
      const url = appPublicUrl(`/briefing/${data.token}`);
      setGeneratedUrl(url);
      toast.success("Link gerado! Envie para o cliente.");
    } catch (err: any) {
      toast.error(err.message || "Erro ao gerar link");
    }
    setGenerating(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Portal no body: no celular a janela ficava por baixo das barras do painel.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="link-briefing-titulo" className="relative w-full max-w-[480px] border-border bg-card sm:rounded-lg sm:border">
        <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center">
            <h2 id="link-briefing-titulo" className={texto.tituloSecao}>Link do briefing</h2>
            <AjudaRecolhida className="ml-1.5">Gera um link público do formulário de briefing para o cliente preencher. Envie pelo WhatsApp ou e-mail.</AjudaRecolhida>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className={botao.icone}><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        <div className="space-y-4 px-4 py-5 sm:px-5">
          <GrupoDeCampos colunas={1}>
            <CampoDeFormulario rotulo="Cliente" obrigatorio>
              <select value={clientId} onChange={e => setClientId(e.target.value)} className={campo}>
                <option value="">Selecionar...</option>
                {(clients || []).map((c: any) => <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>)}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Projeto" apoio="Opcional. Sem projeto, crie depois.">
              <select value={projectId} onChange={e => setProjectId(e.target.value)} className={campo}>
                <option value="">Criar novo depois</option>
                {clientProjects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </CampoDeFormulario>
            {generatedUrl && (
              <CampoDeFormulario rotulo="Link gerado">
                <input readOnly value={generatedUrl} onFocus={(e) => e.currentTarget.select()} className={juntar(campo, "font-mono text-[12px]")} />
              </CampoDeFormulario>
            )}
          </GrupoDeCampos>
        </div>
        <div className="flex justify-end border-t border-border px-4 py-3 sm:px-5 [&>*+*]:ml-2">
          <button type="button" onClick={onClose} className={botao.secundario}>Fechar</button>
          {generatedUrl ? (
            <button type="button" onClick={handleCopy} className={botao.primario}>
              {copied ? <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              {copied ? "Copiado" : "Copiar link"}
            </button>
          ) : (
            <button type="button" onClick={handleGenerate} disabled={generating} className={botao.primario}>
              {generating ? "Gerando..." : "Gerar link"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
