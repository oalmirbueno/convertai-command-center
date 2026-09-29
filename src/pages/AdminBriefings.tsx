import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { notifyOpsMilestone } from "@/lib/opsSync";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { toast } from "sonner";
import { format } from "date-fns";
import { ArrowLeft, FileText, Link2, Loader2 } from "lucide-react";
import GerarLinkDoBriefing from "@/components/briefing/GerarLinkDoBriefing";
import LeituraDoBriefing, { type LinhaDoBriefingNoPainel, nomeDoBriefing } from "@/components/briefing/LeituraDoBriefing";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AreaDeTrabalho, CabecalhoDePagina, CampoDeFormulario, Carregando, EstadoDeErro, EstadoVazio, RegiaoRolavel, botao, campo, etiqueta, juntar, lista, texto } from "@/components/sistema";
import { estadoDoLink, modeloDeFabrica } from "../../supabase/functions/_shared/briefing-modelos";

/**
 * Briefings (frente BRF, 30/09/2026): todos os links, de todos os modelos,
 * com o estado de cada um (aguardando, recebido, expirado, reabertura
 * pedida). Abrir um leva à leitura (/briefings?briefing=<id>), que é também o
 * link do aviso que a equipe recebe quando o briefing chega. "Novo link" gera
 * o link com o modelo escolhido; ?client=<id> filtra e já vem no novo link.
 */

type Filtro = "todos" | "aguardando" | "recebidos" | "reabrir";
const FILTROS: Array<{ valor: Filtro; rotulo: string }> = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "aguardando", rotulo: "Aguardando" },
  { valor: "recebidos", rotulo: "Recebidos" },
  { valor: "reabrir", rotulo: "Reabrir" },
];

const CAMPOS_DA_LISTA =
  "id, token, client_id, project_id, marca_id, modelo, titulo, responses, submitted, expira_em, enviado_em, envios, reabertura_pedida_em, reabertura_motivo, arquivado_em, arquivo_pdf_id, created_at, client:profiles!briefings_client_id_fkey(full_name, company_name)";

function estadoDaLinha(b: LinhaDoBriefingNoPainel): { rotulo: string; classe: string } {
  if (b.submitted && b.reabertura_pedida_em) return { rotulo: "Reabrir", classe: "bg-amber-500/15 text-amber-700 dark:text-amber-300" };
  const e = estadoDoLink(b);
  if (e === "enviado") return { rotulo: "Recebido", classe: "bg-primary/15 text-primary" };
  if (e === "expirado") return { rotulo: "Expirado", classe: "bg-muted text-muted-foreground" };
  return { rotulo: "Aguardando", classe: "bg-muted text-foreground" };
}

export default function AdminBriefings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: clients } = useClients();
  const [params, setParams] = useSearchParams();
  const abertoId = params.get("briefing") || params.get("id");
  const clienteDaUrl = params.get("client");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [novoLink, setNovoLink] = useState(false);
  const [generateBriefing, setGenerateBriefing] = useState<LinhaDoBriefingNoPainel | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genClientId, setGenClientId] = useState("");

  const { data: briefings, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["briefings-admin", user?.id, clienteDaUrl],
    queryFn: async () => {
      let q = supabase.from("briefings").select(CAMPOS_DA_LISTA).is("arquivado_em" as any, null).order("created_at", { ascending: false }).limit(300);
      if (clienteDaUrl) q = q.eq("client_id", clienteDaUrl);
      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as LinhaDoBriefingNoPainel[]) || [];
    },
    enabled: !!user,
  });

  const todos = briefings || [];
  const filtrados = useMemo(
    () =>
      todos.filter((b) => {
        if (filtro === "todos") return true;
        if (filtro === "reabrir") return !!b.submitted && !!b.reabertura_pedida_em;
        if (filtro === "recebidos") return !!b.submitted;
        return !b.submitted;
      }),
    [todos, filtro],
  );
  const contagem = (f: Filtro) =>
    f === "todos" ? todos.length : f === "reabrir" ? todos.filter((b) => b.submitted && b.reabertura_pedida_em).length : f === "recebidos" ? todos.filter((b) => b.submitted).length : todos.filter((b) => !b.submitted).length;

  const abrir = (id: string | null) => {
    const p = new URLSearchParams(params);
    p.delete("id");
    if (id) p.set("briefing", id);
    else p.delete("briefing");
    setParams(p);
  };

  const handleGenerate = async () => {
    if (!generateBriefing || !genClientId) {
      toast.error("Selecione o cliente");
      return;
    }
    setGenerating(true);
    try {
      const m = modeloDeFabrica(generateBriefing.modelo);
      const r = (generateBriefing.responses || {}) as Record<string, any>;
      const { data: project, error } = await supabase.from("projects").insert({
        name: `Projeto · ${m.nome}`,
        description: String(r.historia || r.companyDescription || r.objetivo || "").slice(0, 500),
        scope: JSON.stringify(r, null, 2),
        project_type: m.slug === "site" || m.slug === "landing" ? "site" : m.slug === "redes" ? "social_media" : "outro",
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
        message: "Novo projeto criado a partir do seu briefing",
        notification_type: "project", link: "/dashboard",
      });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Projeto criado a partir do briefing.");
      setGenerateBriefing(null);
      setGenClientId("");
    } catch (err: any) {
      toast.error(err?.message || "Erro");
    }
    setGenerating(false);
  };

  const dialogoDoProjeto = (
    <Dialog open={!!generateBriefing} onOpenChange={(v) => { if (!v && !generating) setGenerateBriefing(null); }}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader className="text-left">
          <DialogTitle className={texto.tituloSecao}>Gerar projeto do briefing</DialogTitle>
          <DialogDescription className={texto.auxiliar}>Cria o projeto com o marco de kick-off e avisa o cliente.</DialogDescription>
        </DialogHeader>
        <CampoDeFormulario rotulo="Cliente" obrigatorio>
          <select value={genClientId} onChange={(e) => setGenClientId(e.target.value)} className={campo}>
            <option value="">Selecionar cliente...</option>
            {((clients as any[]) || []).map((c) => <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>)}
          </select>
        </CampoDeFormulario>
        <DialogFooter className="[&>*+*]:mt-2 sm:[&>*+*]:mt-0">
          <button type="button" onClick={() => setGenerateBriefing(null)} disabled={generating} className={botao.secundario}>Cancelar</button>
          <button type="button" onClick={() => void handleGenerate()} disabled={generating || !genClientId} className={botao.primario}>
            {generating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {generating ? "Criando..." : "Criar projeto"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (abertoId) {
    return (
      <div className="min-w-0 animate-fade-in">
        <button type="button" onClick={() => abrir(null)} className={juntar(botao.discreto, "-ml-2 mb-3 h-8 px-2 text-[12px]")}>
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
          Briefings
        </button>
        <LeituraDoBriefing briefingId={abertoId} onGerarProjeto={(b) => { setGenerateBriefing(b); setGenClientId(b.client_id || ""); }} />
        {dialogoDoProjeto}
      </div>
    );
  }

  return (
    <div className="min-w-0 animate-fade-in">
      <CabecalhoDePagina
        titulo="Briefings"
        descricao={isLoading ? undefined : `${todos.length} ${todos.length === 1 ? "link" : "links"}`}
        ajuda="Os links de briefing de todos os modelos (diagnóstico, site, landing, identidade, naming, redes e vídeo), com o estado de cada um. Abra um para ler as respostas, os pontos principais e confirmar as sugestões para o contexto."
        acoes={
          <button type="button" onClick={() => setNovoLink(true)} className={botao.primario}>
            <Link2 className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Novo link</span>
          </button>
        }
      />

      <div role="tablist" aria-label="Filtrar briefings" className="-mx-1 mt-4 flex flex-wrap">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            type="button"
            role="tab"
            aria-selected={filtro === f.valor}
            onClick={() => setFiltro(f.valor)}
            className={juntar(botao.barra, "m-1", filtro === f.valor && "bg-muted text-foreground")}
          >
            {f.rotulo}
            <span className="ml-1.5 tabular-nums text-muted-foreground">{contagem(f.valor)}</span>
          </button>
        ))}
      </div>

      <AreaDeTrabalho principalRolavel={false} className="mt-3">
        {isLoading ? (
          <Carregando linhas={4} rotulo="Carregando briefings" />
        ) : isError ? (
          <EstadoDeErro
            titulo="Não foi possível carregar os briefings."
            acao={<button type="button" onClick={() => void refetch()} disabled={isFetching} className={juntar(botao.secundario, "h-8 text-[12px]")}>Tentar de novo</button>}
          />
        ) : filtrados.length === 0 ? (
          <EstadoVazio icone={<FileText className="h-5 w-5" />} titulo="Nenhum briefing aqui." descricao="Gere um link em Novo link, na ficha do cliente ou no botão Briefing das mesas." />
        ) : (
          <RegiaoRolavel rotulo="Briefings" memoria="briefings:lista">
            <ul className={juntar(lista.aberta, lista.divisoria)}>
              {filtrados.map((b) => {
                const est = estadoDaLinha(b);
                const m = modeloDeFabrica(b.modelo);
                const quando = b.submitted ? b.enviado_em || b.created_at : b.created_at;
                return (
                  <li key={b.id}>
                    <button type="button" onClick={() => abrir(b.id)} className={juntar(lista.linha, "w-full text-left")} aria-label={`Abrir briefing de ${nomeDoBriefing(b)}`}>
                      <span className="mr-3 min-w-0 flex-1">
                        <span className="flex min-w-0 items-center">
                          <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{nomeDoBriefing(b)}</span>
                          <span className={juntar(etiqueta, "ml-2 shrink-0", est.classe)}>{est.rotulo}</span>
                        </span>
                        <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>
                          {b.titulo || m.nome} · {quando ? format(new Date(quando), "dd/MM/yyyy 'às' HH:mm") : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </RegiaoRolavel>
        )}
      </AreaDeTrabalho>

      <GerarLinkDoBriefing
        open={novoLink}
        onClose={() => setNovoLink(false)}
        clientId={clienteDaUrl}
        aoGerar={() => void queryClient.invalidateQueries({ queryKey: ["briefings-admin"] })}
      />
      {dialogoDoProjeto}
    </div>
  );
}
