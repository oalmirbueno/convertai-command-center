import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useProjects, useClients } from "@/hooks/useSupabaseData";
import { Plus, FileText, Eye, Send, Folder, ChevronRight, Megaphone } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  AreaDeTrabalho,
  CabecalhoDePagina,
  CampoDeBusca,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  Painel,
  SeletorCompacto,
  botao,
  etiqueta,
  foco,
  juntar,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";
import { groupReports, getClientName, PERIOD_ORDER } from "@/lib/reportGrouping";
import { recordMemory } from "@/lib/clientMemory";

const metricLabels: Record<string, string> = {
  reach: "Alcance", impressions: "Impressões", frequency: "Freq.",
  clicks: "Cliques", link_clicks: "Cliq. Link", ctr: "CTR %", cpc: "CPC", cpm: "CPM",
  ad_spend: "Investido", results: "Resultados", cost_per_result: "Custo/Result.", cpa: "CPA",
  messages: "Mensagens", cost_per_message: "Custo/Msg",
  leads: "Leads", cost_per_lead: "Custo/Lead",
  profile_visits: "Visitas Perfil", followers_gained: "Novos Seguid.", followers_total: "Seguidores",
  engagement: "Engaj.", engagement_rate: "Tx. Engaj. %",
  likes: "Curtidas", comments: "Coment.", shares: "Compart.", saves: "Salvos",
  video_views: "Views Vídeo", thru_plays: "ThruPlays",
  purchases: "Compras", revenue: "Receita", roas: "ROAS",
  conversions: "Conversões",
};

function formatNumber(n: number) {
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function normalizar(v: string) {
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function formatDate(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export default function AdminReports() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Busca e situação lembradas ao sair e voltar.
  const [busca, setBusca] = useEstadoDaTela("relatorios:busca", "", { validar: (v) => typeof v === "string" });
  const [filtroStatus, setFiltroStatus] = useEstadoDaTela("relatorios:situacao", "todos", {
    validar: (v) => v === "todos" || v === "publicados" || v === "rascunhos",
  });

  const { data: reports, isLoading, isError, refetch } = useQuery({
    queryKey: ["reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reports")
        .select("id, project_id, client_id, title, period_start, period_end, metrics, summary, file_url, status, created_by, created_at, highlights, next_steps, chart_type, chart_data, images, project:projects(name), client:profiles!reports_client_id_fkey(full_name, company_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const handleSendToClient = async (r: any) => {
    if (r.status !== "published") {
      const { error } = await supabase
        .from("reports")
        .update({ status: "published" })
        .eq("id", r.id);
      if (error) {
        toast.error("Não foi possível publicar o relatório");
        return;
      }
      // Publicar por aqui é o mesmo fato que publicar pela tela de criação:
      // a história do cliente precisa registrar dos dois caminhos, senão a
      // Central escreve o ritual sem saber que houve entrega.
      await recordMemory({
        clientId: r.client_id,
        projectId: r.project_id || null,
        kind: "entrega",
        title: `Relatório publicado: ${r.title}`,
        content: [
          r.period_start && r.period_end
            ? `Período: ${r.period_start} a ${r.period_end}.`
            : "",
          r.summary || "",
          r.next_steps ? `Próximos passos combinados: ${r.next_steps}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        source: "relatorio",
        tags: ["relatorio", "entrega"],
        metadata: { report_title: r.title, report_id: r.id },
      });
      queryClient.invalidateQueries({ queryKey: ["memoria-cliente"] });
    }
    const { error: notificationError } = await supabase.from("notifications").insert({
      user_id: r.client_id,
      message: `Novo relatório disponível: ${r.title}`,
      notification_type: "report",
      link: "/relatorios",
    });
    if (notificationError) {
      toast.error("Relatório publicado, mas a notificação não foi enviada");
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["reports"] });
    toast.success("Relatório enviado ao cliente!");
  };

  const lista = (reports || []) as any[];
  const termo = normalizar(busca);
  const filtrados = lista.filter((r) => {
    if (filtroStatus === "publicados" && r.status !== "published") return false;
    if (filtroStatus === "rascunhos" && r.status === "published") return false;
    if (!termo) return true;
    return normalizar([r.title, getClientName(r), r.project?.name].filter(Boolean).join(" ")).indexOf(termo) >= 0;
  });
  const rascunhos = lista.filter((r) => r.status !== "published").length;
  const filtrando = filtroStatus !== "todos" || !!termo;

  return (
    <div className="min-w-0 space-y-4">
      <CabecalhoDePagina
        titulo="Relatórios"
        descricao={
          isLoading && !reports
            ? "Carregando"
            : filtrando
              ? `${filtrados.length} de ${lista.length}`
              : `${lista.length} ${lista.length === 1 ? "relatório" : "relatórios"}${rascunhos ? ` · ${rascunhos} em rascunho` : ""}`
        }
        ajuda="Relatórios por cliente e por período. O de anúncios nasce em Anúncios, onde os números já estão coletados; o de entrega é criado aqui."
        acoes={
          <>
            {/* O relatório de anúncios passou a nascer em Anúncios, onde os
                números já estão coletados; aqui ficaria pedindo a planilha do
                Gerenciador de novo. O de entrega continua sendo criado daqui. */}
            <button type="button" onClick={() => navigate("/anuncios")} className={botao.secundario} aria-label="Relatório de anúncios">
              <Megaphone className="h-4 w-4" aria-hidden="true" />
              <span className="ml-1.5 hidden sm:inline">De anúncios</span>
            </button>
            <button type="button" onClick={() => navigate("/relatorios/novo")} className={botao.primario} aria-label="Novo relatório de entrega">
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="ml-1.5 hidden sm:inline">De entrega</span>
            </button>
          </>
        }
      />

      {lista.length > 0 && (
        <div className="-m-1 flex flex-wrap items-center [&>*]:m-1">
          <CampoDeBusca
            valor={busca}
            onMudar={setBusca}
            placeholder="Buscar por cliente, título ou projeto"
            rotulo="Buscar relatório"
            className="flex-1 basis-full sm:basis-[240px]"
          />
          <SeletorCompacto
            rotulo="Situação do relatório"
            opcoes={[
              { valor: "todos", rotulo: "Todos" },
              { valor: "publicados", rotulo: "Publicados" },
              { valor: "rascunhos", rotulo: "Rascunhos", contador: rascunhos || null },
            ]}
            valor={filtroStatus}
            onEscolher={setFiltroStatus}
          />
        </div>
      )}

      <AreaDeTrabalho memoriaDaRolagem="relatorios:lista" rotuloDoPrincipal="Relatórios por cliente">
        {isError ? (
          <EstadoDeErro
            titulo="Não foi possível carregar os relatórios."
            acao={
              <button type="button" onClick={() => refetch()} className={botao.secundario}>
                Tentar de novo
              </button>
            }
          />
        ) : isLoading && !reports ? (
          <Carregando rotulo="Carregando relatórios" linhas={5} />
        ) : lista.length === 0 ? (
          <EstadoVazio
            icone={<FileText className="h-5 w-5" />}
            titulo="Nenhum relatório ainda"
            descricao="Crie o de entrega aqui ou o de anúncios em Anúncios."
          />
        ) : filtrados.length === 0 ? (
          <EstadoVazio
            compacto
            titulo="Nenhum relatório nesse filtro."
            acao={
              <button type="button" onClick={() => { setBusca(""); setFiltroStatus("todos"); }} className={botao.discreto}>
                Limpar filtros
              </button>
            }
          />
        ) : (
          <GroupedReports
            reports={filtrados}
            abrirTudo={!!termo}
            metricLabels={metricLabels}
            formatNumber={formatNumber}
            formatDate={formatDate}
            onView={(id: string) => navigate(`/relatorios/${id}`)}
            onSend={handleSendToClient}
          />
        )}
      </AreaDeTrabalho>
    </div>
  );
}

function GroupedReports({ reports, abrirTudo, metricLabels, formatNumber, formatDate, onView, onSend }: any) {
  const grouped = groupReports(reports as any[], getClientName);
  const clients = Object.keys(grouped).sort();
  // Pastas iniciam RECOLHIDAS; o que a pessoa abriu fica lembrado ao sair e voltar.
  const objeto = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  const [openClients, setOpenClients] = useEstadoDaTela<Record<string, boolean>>("relatorios:pastas", {}, { validar: objeto });
  const [openModels, setOpenModels] = useEstadoDaTela<Record<string, boolean>>("relatorios:modelos", {}, { validar: objeto });

  const toggleClient = (c: string) => setOpenClients(s => ({ ...s, [c]: !s[c] }));
  const toggleModel = (k: string) => setOpenModels(s => ({ ...s, [k]: !s[k] }));

  return (
    <Painel semEspaco>
      <ul className="divide-y divide-border">
        {clients.map((client) => {
          const models = grouped[client];
          const modelKeys = PERIOD_ORDER.filter(p => models[p]);
          const totalCount = modelKeys.reduce((acc, k) => acc + models[k].length, 0);
          const isOpen = abrirTudo || !!openClients[client];
          return (
            <li key={client} className="min-w-0">
              <button
                type="button"
                onClick={() => toggleClient(client)}
                aria-expanded={isOpen}
                className={juntar("flex w-full min-w-0 items-center px-4 py-3 text-left transition-colors hover:bg-muted/30", foco)}
              >
                <ChevronRight className={`mr-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden="true" />
                <Folder className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{client}</span>
                <span className={juntar(texto.auxiliar, "ml-3 shrink-0 tabular-nums")}>{totalCount}</span>
              </button>
              {isOpen && (
                <div className="pb-2 pl-4 pr-3 sm:pl-10 sm:pr-4">
                  {modelKeys.map((model) => {
                    const list = models[model];
                    const key = `${client}::${model}`;
                    const modelOpen = abrirTudo || !!openModels[key];
                    return (
                      <div key={model} className="min-w-0">
                        <button
                          type="button"
                          onClick={() => toggleModel(key)}
                          aria-expanded={modelOpen}
                          className={juntar("flex w-full min-w-0 items-center rounded-md px-1 py-2 text-left hover:bg-muted/30", foco)}
                        >
                          <ChevronRight className={`mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${modelOpen ? "rotate-90" : ""}`} aria-hidden="true" />
                          <span className={juntar(texto.rotulo, "text-foreground")}>{model}</span>
                          <span className={juntar(texto.auxiliar, "ml-1.5 tabular-nums")}>{list.length}</span>
                        </button>
                        {modelOpen && (
                          <ul className="mb-2 divide-y divide-border border-l border-border pl-3 sm:ml-2">
                            {list.map((r: any) => {
                              const m = (r.metrics || {}) as Record<string, any>;
                              const visibleMetrics = Object.entries(m)
                                .filter(([k]) => k !== "custom" && metricLabels[k] && m[k] !== undefined)
                                .slice(0, 4);
                              const publicado = r.status === "published";
                              return (
                                <li key={r.id} className="flex min-w-0 items-center py-2.5">
                                  <button type="button" onClick={() => onView(r.id)} className={juntar("min-w-0 flex-1 rounded-md text-left", foco)}>
                                    <span className="flex min-w-0 items-center">
                                      <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{r.title}</span>
                                      <span className={juntar(etiqueta, "ml-2", publicado ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>
                                        {publicado ? "Publicado" : "Rascunho"}
                                      </span>
                                    </span>
                                    <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>
                                      {r.project?.name}
                                      {r.period_start && r.period_end && ` · ${formatDate(r.period_start)} a ${formatDate(r.period_end)}`}
                                    </span>
                                  </button>
                                  {visibleMetrics.length > 0 && (
                                    <dl className="ml-4 hidden shrink-0 lg:flex">
                                      {visibleMetrics.map(([key, val]) => (
                                        <div key={key} className="ml-4 w-[72px] text-right first:ml-0">
                                          <dd className="text-[13px] tabular-nums text-foreground">
                                            {key === "engagement" || key === "ctr" ? val + "%" : formatNumber(val as number)}
                                          </dd>
                                          <dt className="truncate text-[11px] text-muted-foreground">{metricLabels[key]}</dt>
                                        </div>
                                      ))}
                                    </dl>
                                  )}
                                  <div className="ml-3 flex shrink-0 items-center [&>*+*]:ml-1">
                                    <button type="button" onClick={() => onView(r.id)} className={botao.icone} aria-label={`Ver ${r.title}`} title="Ver">
                                      <Eye className="h-4 w-4" aria-hidden="true" />
                                    </button>
                                    <button type="button" onClick={() => onSend(r)} className={juntar(botao.discreto, "h-8")} aria-label={`Enviar ${r.title} ao cliente`}>
                                      <Send className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                                      <span className="hidden sm:inline">Enviar ao cliente</span>
                                    </button>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Painel>
  );
}
