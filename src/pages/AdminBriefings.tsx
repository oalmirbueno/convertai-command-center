import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { notifyOpsMilestone, notifyOpsUpdate } from "@/lib/opsSync";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { toast } from "sonner";
import { format } from "date-fns";
import { Eye, FolderPlus, Loader2, FileText } from "lucide-react";
import BriefingPdfModal from "@/components/briefing/BriefingPdfModal";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AreaDeTrabalho, CabecalhoDePagina, CampoDeFormulario, Carregando, EstadoDeErro, EstadoVazio, RegiaoRolavel, botao, campo, etiqueta, juntar, superficie, texto } from "@/components/sistema";

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

  const { data: briefings, isLoading, isError, refetch, isFetching } = useQuery({
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
        name: `Projeto · ${tipos || "Novo"}`,
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
      toast.success("Projeto criado a partir do briefing.");
      setGenerateBriefing(null);
      setGenClientId("");
    } catch (err: any) {
      toast.error(err.message || "Erro");
    }
    setGenerating(false);
  };

  const lista = (briefings || []) as any[];
  const nomeDo = (b: any) => b?.client?.company_name || b?.client?.full_name || (b?.responses as any)?.contato?.nome || "Sem vínculo";
  const tiposDo = (b: any) => {
    const r = b?.responses as any;
    return Array.isArray(r?.tiposProjeto) ? r.tiposProjeto.map((t: string) => typeLabels[t] || t).join(", ") : "";
  };

  // Sistema de design: cabeçalho curto com o "?", a lista numa superfície só
  // com divisória (sem caixa por linha) e as ações à direita de cada linha.
  // A lista mora numa AreaDeTrabalho: no computador vai até o fim da janela e
  // rola por dentro (sem altura fixa); no celular a página rola normal.
  return (
    <div className="min-w-0 animate-fade-in">
      <CabecalhoDePagina
        titulo="Briefings"
        descricao={isLoading ? undefined : `${lista.length} ${lista.length === 1 ? "recebido" : "recebidos"}`}
        ajuda="Diagnósticos que os clientes enviaram pelo link público. Ver abre as respostas e o PDF; Gerar projeto cria o projeto do cliente a partir do briefing."
      />

      <AreaDeTrabalho principalRolavel={false} className="mt-5">
      {isLoading ? (
        <Carregando linhas={4} rotulo="Carregando briefings" />
      ) : isError ? (
        <EstadoDeErro
          titulo="Não foi possível carregar os briefings."
          acao={<button type="button" onClick={() => void refetch()} disabled={isFetching} className={juntar(botao.secundario, "h-8 text-[12px]")}>Tentar de novo</button>}
        />
      ) : lista.length === 0 ? (
        <EstadoVazio icone={<FileText className="h-5 w-5" />} titulo="Nenhum briefing recebido ainda." descricao="Eles aparecem aqui quando o cliente envia o diagnóstico." />
      ) : (
        <RegiaoRolavel rotulo="Briefings recebidos" memoria="briefings:lista">
          <ul className={juntar(superficie.painel, "divide-y divide-border")}>
            {lista.map((b: any) => {
              const tipos = tiposDo(b);
              return (
                <li key={b.id} className="flex min-w-0 items-center px-4 py-3">
                  <div className="mr-3 min-w-0 flex-1">
                    <div className="flex min-w-0 items-center">
                      <p className="min-w-0 truncate text-[13px] font-medium text-foreground">{nomeDo(b)}</p>
                      {tipos && <span className={juntar(etiqueta, "ml-2 hidden min-w-0 truncate bg-muted text-muted-foreground sm:inline-flex")}>{tipos}</span>}
                    </div>
                    <p className={juntar(texto.auxiliar, "mt-0.5 truncate")}>
                      {b.created_at ? format(new Date(b.created_at), "dd/MM/yyyy 'às' HH:mm") : ""}
                      {tipos && <span className="sm:hidden"> · {tipos}</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center [&>*+*]:ml-1.5">
                    <button type="button" onClick={() => setViewBriefing(b)} aria-label={`Ver briefing de ${nomeDo(b)}`} className={juntar(botao.discreto, "px-2 sm:px-2.5")}>
                      <Eye className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                      <span className="hidden sm:inline">Ver</span>
                    </button>
                    <button type="button" onClick={() => { setGenerateBriefing(b); setGenClientId(b.client_id || ""); }} aria-label={`Gerar projeto do briefing de ${nomeDo(b)}`} className={juntar(botao.secundario, "px-2 sm:px-3")}>
                      <FolderPlus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                      <span className="hidden sm:inline">Gerar projeto</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </RegiaoRolavel>
      )}
      </AreaDeTrabalho>

      {/* Ver o briefing, com PDF */}
      <BriefingPdfModal
        open={!!viewBriefing}
        onClose={() => setViewBriefing(null)}
        briefing={viewBriefing}
        clientName={viewBriefing?.client?.company_name || viewBriefing?.client?.full_name || (viewBriefing?.responses as any)?.contato?.nome}
      />

      {/* Gerar projeto a partir do briefing */}
      <Dialog open={!!generateBriefing} onOpenChange={(v) => { if (!v && !generating) setGenerateBriefing(null); }}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader className="text-left">
            <DialogTitle className={texto.tituloSecao}>Gerar projeto do briefing</DialogTitle>
            <DialogDescription className={texto.auxiliar}>Cria o projeto com o marco de kick-off e avisa o cliente.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <CampoDeFormulario rotulo="Cliente" obrigatorio>
              <select value={genClientId} onChange={e => setGenClientId(e.target.value)} className={campo}>
                <option value="">Selecionar cliente...</option>
                {(clients || []).map((c: any) => <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>)}
              </select>
            </CampoDeFormulario>
            {(generateBriefing?.responses as any)?.objetivo && (
              <div className={juntar(superficie.poco, "px-3 py-2.5")}>
                <p className={texto.rotulo}>Resumo</p>
                <p className="mt-1 text-[13px] leading-5 text-foreground">{(generateBriefing.responses as any).objetivo.slice(0, 200)}</p>
              </div>
            )}
          </div>
          <DialogFooter className="[&>*+*]:mt-2 sm:[&>*+*]:mt-0">
            <button type="button" onClick={() => setGenerateBriefing(null)} disabled={generating} className={botao.secundario}>Cancelar</button>
            <button type="button" onClick={handleGenerate} disabled={generating || !genClientId} className={botao.primario}>
              {generating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              {generating ? "Criando..." : "Criar projeto"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
