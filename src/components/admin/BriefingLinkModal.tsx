import { useState, useEffect } from "react";
import { X, Copy, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useClients, useProjects } from "@/hooks/useSupabaseData";
import { toast } from "sonner";

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
      const url = `https://aceleriq.online/briefing/${data.token}`;
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-[440px] mx-4 animate-in fade-in zoom-in-[0.96] duration-200" style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Gerar Link Briefing</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-1"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Cliente *</label>
            <select value={clientId} onChange={e => setClientId(e.target.value)} className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors">
              <option value="">Selecionar...</option>
              {(clients || []).map((c: any) => <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Projeto (opcional)</label>
            <select value={projectId} onChange={e => setProjectId(e.target.value)} className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors">
              <option value="">Criar novo depois</option>
              {clientProjects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {generatedUrl ? (
            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Link Gerado</label>
              <div className="flex gap-2">
                <input readOnly value={generatedUrl} className="flex-1 bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground font-mono text-[12px]" />
                <button onClick={handleCopy} className="px-3 py-2 rounded-[10px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1 text-[13px]">
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={handleGenerate} disabled={generating}
              className="w-full px-5 py-2.5 rounded-[10px] text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50">
              {generating ? "Gerando..." : "Gerar Link"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
