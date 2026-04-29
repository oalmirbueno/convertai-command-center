import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { notifyOpsMilestone, notifyOpsUpdate } from "@/lib/opsSync";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { toast } from "sonner";
import { format } from "date-fns";
import { Eye, FolderPlus, X, Loader2, Download } from "lucide-react";
import BriefingPdfModal from "@/components/briefing/BriefingPdfModal";

const typeLabels: Record<string, string> = {
  social_media: "Social Media", trafego: "Tráfego Pago", automacao: "Automação",
  site: "Site / Landing Page", evento: "Evento", outro: "Outro",
};

export default function AdminBriefings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: clients } = useClients();
  const [viewBriefing, setViewBriefing] = useState<any>(null);
  const [generateBriefing, setGenerateBriefing] = useState<any>(null);
  const [generating, setGenerating] = useState(false);
  const [genClientId, setGenClientId] = useState("");

  const { data: briefings, isLoading } = useQuery({
    queryKey: ["briefings-admin", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("briefings")
        .select("*, client:profiles!briefings_client_id_fkey(full_name, company_name)")
        .eq("submitted", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const handleGenerate = async () => {
    if (!generateBriefing || !genClientId) { toast.error("Selecione o cliente"); return; }
    setGenerating(true);
    try {
      const r = generateBriefing.responses as any;
      const tipos = (r?.tiposProjeto || []).map((t: string) => typeLabels[t] || t).join(", ");
      const projectType = r?.tiposProjeto?.[0] || "outro";

      const { data: project, error } = await supabase.from("projects").insert({
        name: `Projeto — ${tipos || "Novo"}`,
        description: r?.objetivo || "",
        scope: JSON.stringify(r, null, 2),
        project_type: projectType,
        client_id: genClientId,
        created_by: user?.id || null,
        start_date: format(new Date(), "yyyy-MM-dd"),
        deadline: format(new Date(Date.now() + 30 * 86400000), "yyyy-MM-dd"),
        status: "planning",
        progress: 0,
      }).select().single();
      if (error) throw error;

      const { data: msIns } = await supabase.from("milestones").insert({
        project_id: project.id, title: "Kick-off",
        target_date: format(new Date(), "yyyy-MM-dd"), status: "completed", milestone_order: 0,
      }).select().single();
      notifyOpsMilestone(msIns);
      await supabase.from("notifications").insert({
        user_id: genClientId,
        message: `Novo projeto criado a partir do seu briefing`,
        notification_type: "project", link: "/dashboard",
      });

      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Projeto criado a partir do briefing!");
      setGenerateBriefing(null);
      setGenClientId("");
    } catch (err: any) {
      toast.error(err.message || "Erro");
    }
    setGenerating(false);
  };

  const renderResponses = (r: any) => {
    if (!r) return <p className="text-sm text-muted-foreground">Sem respostas</p>;
    const fields = [
      { label: "Objetivo", value: r.objetivo },
      { label: "Público-alvo", value: r.publicoAlvo },
      { label: "Tipos de Projeto", value: Array.isArray(r.tiposProjeto) ? r.tiposProjeto.map((t: string) => typeLabels[t] || t).join(", ") : r.tiposProjeto },
      { label: "Referências", value: r.referencias },
      { label: "Prazo", value: r.prazo },
      { label: "Orçamento", value: r.orcamento },
      { label: "Observações", value: r.observacoes },
      ...(r.contato ? [
        { label: "Contato — Nome", value: r.contato.nome },
        { label: "Contato — WhatsApp", value: r.contato.whatsapp },
        { label: "Contato — Email", value: r.contato.email },
      ] : []),
    ];
    return (
      <div className="space-y-3">
        {fields.filter(f => f.value).map(f => (
          <div key={f.label}>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{f.label}</p>
            <p className="text-sm text-foreground mt-0.5 whitespace-pre-wrap">{f.value}</p>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <p className="heading-page">Briefings</p>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Carregando...</div>
      ) : (briefings || []).length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Nenhum briefing recebido ainda.</div>
      ) : (
        <div className="space-y-2 stagger-children">
          {(briefings || []).map((b: any) => {
            const r = b.responses as any;
            const tipos = Array.isArray(r?.tiposProjeto) ? r.tiposProjeto.map((t: string) => typeLabels[t] || t).join(", ") : "";
            return (
              <div key={b.id} className="bg-card border border-border rounded-xl px-5 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground">
                      {b.client?.company_name || b.client?.full_name || r?.contato?.nome || "Sem vínculo"}
                    </p>
                    {tipos && <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">{tipos}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {b.created_at ? format(new Date(b.created_at), "dd/MM/yyyy 'às' HH:mm") : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setViewBriefing(b)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-muted-foreground border border-border hover:text-foreground hover:border-muted-foreground/50 transition-colors cursor-pointer bg-transparent">
                    <Eye className="w-3.5 h-3.5" /> Ver
                  </button>
                  <button onClick={() => { setGenerateBriefing(b); setGenClientId(b.client_id || ""); }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none">
                    <FolderPlus className="w-3.5 h-3.5" /> Gerar Projeto
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* View Briefing with PDF */}
      <BriefingPdfModal
        open={!!viewBriefing}
        onClose={() => setViewBriefing(null)}
        briefing={viewBriefing}
        clientName={viewBriefing?.client?.company_name || viewBriefing?.client?.full_name || (viewBriefing?.responses as any)?.contato?.nome}
      />

      {/* Generate Project Modal */}
      {generateBriefing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setGenerateBriefing(null)} />
          <div className="relative bg-card border border-border rounded-2xl w-full max-w-[440px] mx-4" style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Gerar Projeto do Briefing</h2>
              <button onClick={() => setGenerateBriefing(null)} className="text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none p-1"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Cliente *</label>
                <select value={genClientId} onChange={e => setGenClientId(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors">
                  <option value="">Selecionar cliente...</option>
                  {(clients || []).map((c: any) => <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>)}
                </select>
              </div>
              <div className="bg-secondary rounded-xl p-4">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Resumo</p>
                <p className="text-xs text-foreground">{(generateBriefing.responses as any)?.objetivo?.slice(0, 200)}</p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
              <button onClick={() => setGenerateBriefing(null)} className="px-4 py-2 rounded-[10px] text-[13px] text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border border-border">Cancelar</button>
              <button onClick={handleGenerate} disabled={generating || !genClientId}
                className="px-5 py-2 rounded-[10px] text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 cursor-pointer border-none disabled:opacity-50 flex items-center gap-2">
                {generating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {generating ? "Criando..." : "Criar Projeto"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
