import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useClientIdentity } from "@/hooks/useClientIdentity";
import {
  FileText, BarChart3, TrendingUp, Calendar,
  Eye, MousePointerClick, Users, Zap, DollarSign, Target, MessageCircle,
  ChevronRight,
} from "lucide-react";
import { CabecalhoDeSecao, Carregando, EstadoDeErro, EstadoVazio, botao, espaco, foco, juntar, superficie, texto, useEstadoDaTela } from "@/components/sistema";
import { PageHeader, Sparkline, StatusPill, type Tone } from "@/components/ds";
import { Bolha } from "@/components/client/pecasOusadas";
import ClientLiveCampaigns from "@/components/reports/ClientLiveCampaigns";
import { useNavigate } from "react-router-dom";
import { getPeriodModel, PERIOD_ORDER } from "@/lib/reportGrouping";
import { semTextoInterno } from "@/lib/textoInterno";

const metricConfig: Record<string, { label: string; format: (v: number) => string; icon: any; color: string }> = {
  reach:            { label: "Alcance",      format: v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(v), icon: Eye,               color: "hsl(200, 100%, 50%)" },
  impressions:      { label: "Impressões",   format: v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(v), icon: BarChart3,         color: "hsl(263, 70%, 66%)" },
  engagement:       { label: "Engaj.",       format: v => v.toFixed(1) + "%",                                  icon: Zap,               color: "hsl(145, 100%, 50%)" },
  clicks:           { label: "Cliques",      format: v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(v), icon: MousePointerClick, color: "hsl(38, 92%, 50%)" },
  ctr:              { label: "CTR",          format: v => v.toFixed(2) + "%",                                  icon: Target,            color: "hsl(346, 87%, 60%)" },
  conversions:      { label: "Mensagens",    format: v => String(v),                                           icon: MessageCircle,     color: "hsl(142, 71%, 45%)" },
  followers_gained: { label: "Seguidores",   format: v => "+" + v,                                             icon: Users,             color: "hsl(188, 94%, 43%)" },
  ad_spend:         { label: "Investido",    format: v => "R$" + v.toLocaleString("pt-BR"),                    icon: DollarSign,        color: "hsl(221, 83%, 53%)" },
};

function formatDateShort(d: string) {
  if (!d) return "";
  // "2026-08-01" é data sem hora: lida como UTC, voltava um dia no Brasil.
  const soData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  const data = soData ? new Date(Number(soData[1]), Number(soData[2]) - 1, Number(soData[3])) : new Date(d);
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function ClientReports() {
  const { user } = useAuth();
  const { clientId } = useClientIdentity();
  const navigate = useNavigate();

  const { data: reports, isLoading, isError, refetch } = useQuery({
    queryKey: ["reports-client", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reports")
        .select("id, project_id, client_id, title, period_start, period_end, metrics, summary, file_url, status, created_by, created_at, highlights, next_steps, chart_type, chart_data, images, project:projects(name)")
        .eq("client_id", clientId!)
        .eq("status", "published")
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Rituais de acompanhamento (Rota, Prova, Radar, Marco) moram em
      // "Onde Estamos"; aqui ficam só os relatórios de mídia e resultados.
      // 19/10: nota interna publicada por engano (preparação do Hermes em 09/10) não aparece para o cliente.
      return semTextoInterno(data || []).filter((r: any) => !(r.metrics as any)?.ritual_type);
    },
    enabled: !!user,
  });

  return (
    <div className={espaco.pagina}>
      <PageHeader
        title="Relatórios"
        subtitle={reports && reports.length ? `${reports.length} ${reports.length === 1 ? "publicado" : "publicados"}` : undefined}
        help="Os resultados dos seus projetos, fechados pela equipe a cada período. Toque num relatório para ver os números e a leitura completa. Você recebe um aviso quando sai um novo."
      />

      {/* As campanhas ao vivo entram ANTES dos relatórios publicados, e não no
          lugar deles: o relatório fecha o período com a leitura da equipe, e
          este bloco responde o que o cliente pergunta no meio do mês. Some
          sozinho quando não há campanha rodando. */}
      <ClientLiveCampaigns clientId={clientId || undefined} />

      {isLoading ? (
        <Carregando linhas={3} rotulo="Carregando relatórios" />
      ) : isError && !reports ? (
        <EstadoDeErro
          titulo="Não foi possível carregar os relatórios."
          acao={<button type="button" className={botao.secundario} onClick={() => refetch()}>Tentar de novo</button>}
        />
      ) : (!reports || reports.length === 0) ? (
        <EstadoVazio
          icone={<FileText className="h-5 w-5" />}
          titulo="Nenhum relatório ainda"
          descricao="Seus relatórios aparecem aqui quando a equipe publicar. Você recebe um aviso."
        />
      ) : (
        <ClientReportsGrouped reports={reports} navigate={navigate} />
      )}
    </div>
  );
}

// Tres tipos convivem aqui fora dos rituais: anuncios (numeros de midia),
// entrega (prints e comprovacoes) e resumo geral.
const reportKind = (r: any): { label: string; tone: Tone } => {
  const m = (r.metrics || {}) as Record<string, unknown>;
  const hasAdsNumbers = ["ad_spend", "cpc", "cpm", "roas", "impressions", "reach", "clicks", "results"]
    .some((key) => Number(m[key]) > 0);
  if (hasAdsNumbers) return { label: "Anúncios", tone: "accent" };
  const images = Array.isArray(r.images) ? r.images : [];
  if (r.file_url || images.length > 0) return { label: "Entrega", tone: "info" };
  return { label: "Resumo", tone: "neutral" };
};

function ClientReportsGrouped({ reports, navigate }: { reports: any[]; navigate: any }) {
  const groups: Record<string, any[]> = {};
  for (const r of reports) {
    const m = getPeriodModel(r.period_start, r.period_end);
    (groups[m] ||= []).push(r);
  }
  const modelKeys = PERIOD_ORDER.filter(p => groups[p]);
  // Grupos fechados ficam lembrados ao sair e voltar (os demais abrem).
  const [fechados, setFechados] = useEstadoDaTela<string[]>("relatorios:grupos-fechados", [], { validar: (v) => Array.isArray(v) });
  const open: Record<string, boolean> = {};
  modelKeys.forEach((k) => { open[k] = fechados.indexOf(k) < 0; });
  const toggle = (k: string) => setFechados(s => (s.indexOf(k) >= 0 ? s.filter((x) => x !== k) : s.concat(k)));

  return (
    <div className="space-y-8">
      {modelKeys.map((model, gi) => (
        // Um controle só de recolher (antes a Secao já trazia a setinha dela e
        // ainda havia um botão à direita). A memória continua a mesma:
        // "relatorios:grupos-fechados".
        <section
          key={model}
          className="min-w-0"
          data-recolhido={open[model] ? "nao" : "sim"}
        >
          <CabecalhoDeSecao
            className={open[model] ? "mb-4 sm:mb-5" : ""}
            titulo={model}
            descricao={`${groups[model].length} ${groups[model].length === 1 ? "relatório" : "relatórios"}`}
            recolher={{
              recolhido: !open[model],
              onAlternar: () => toggle(model),
              resumo: `${groups[model].length} ${groups[model].length === 1 ? "relatório" : "relatórios"}`,
              modo: "icone",
            }}
          />
          {open[model] && (
            <ul className={juntar(espaco.grade, "grid-cols-1 lg:grid-cols-2")}>
              {groups[model].map((r: any, indice: number) => {
                const m = (r.metrics || {}) as Record<string, any>;
                const visibleMetrics = Object.entries(m)
                  .filter(([k]) => k !== "custom" && metricConfig[k] && m[k] !== undefined && m[k] !== 0)
                  .map(([k, v]) => ({ key: k, value: v as number, ...metricConfig[k] }));

                const chartData = ((r.chart_data || []) as Array<Record<string, any>>);
                const chartColumns = chartData.length > 0
                  ? Object.keys(chartData[0]).filter(k => k !== "label")
                  : [];

                // Série do minigráfico: a primeira coluna do gráfico que o relatório já traz.
                const sparklineData = chartData.length > 0 && chartColumns.length > 0
                  ? chartData.map(row => Number(row[chartColumns[0]]) || 0)
                  : null;
                const kind = reportKind(r);
                // O mais recente do primeiro grupo é o cartão de tinta da tela.
                const destaque = gi === 0 && indice === 0;

                return (
                  <li key={r.id} className="min-w-0">
                    <button
                      type="button"
                      className={juntar(superficie.painel, destaque && superficie.tinta, "group flex h-full w-full min-w-0 flex-col p-5 text-left transition-transform duration-200 hover:-translate-y-1 sm:p-6", foco)}
                      onClick={() => navigate(`/relatorios/${r.id}`)}
                      aria-label={`Abrir o relatório ${r.title}`}
                    >
                      <span className="flex w-full min-w-0 items-start">
                        <Bolha tom={destaque ? "solido" : "marca"} tamanho="lg" className="mr-4 max-sm:h-10 max-sm:w-10">
                          <TrendingUp className="h-5 w-5" />
                        </Bolha>
                        <span className="block min-w-0 flex-1">
                          <span className="block text-[18px] font-semibold leading-6 tracking-[-0.02em] text-foreground line-clamp-2 [overflow-wrap:anywhere] max-sm:text-[15px] max-sm:leading-5">{r.title}</span>
                          <span className={juntar(texto.auxiliar, "mt-1.5 flex min-w-0 flex-wrap items-center")}>
                            <StatusPill tone={kind.tone} className="mr-2 sm:hidden">{kind.label}</StatusPill>
                            {(r as any).project?.name && (
                              <>
                                <span className="truncate max-sm:hidden">{(r as any).project?.name}</span>
                                {r.period_start && r.period_end && <span className="mx-1.5 shrink-0 max-sm:hidden" aria-hidden="true">·</span>}
                              </>
                            )}
                            {r.period_start && r.period_end && (
                              <span className="inline-flex shrink-0 items-center">
                                <Calendar className="mr-1 h-3 w-3 shrink-0" aria-hidden="true" />
                                {formatDateShort(r.period_start)} a {formatDateShort(r.period_end)}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="ml-3 flex shrink-0 items-center">
                          <StatusPill tone={kind.tone} className="max-sm:hidden">{kind.label}</StatusPill>
                          <span aria-hidden="true" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-muted text-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground sm:ml-2 sm:h-9 sm:w-9">
                            <ChevronRight className="h-4 w-4" />
                          </span>
                        </span>
                      </span>
                      {/* Os números do período: dois no celular (o resto fica no relatório aberto), até oito na tela larga. */}
                      {visibleMetrics.length > 0 && (
                        <span className="mt-5 grid w-full min-w-0 grid-cols-2 gap-x-4 gap-y-5 sm:mt-6 sm:grid-cols-4 sm:gap-x-6">
                          {visibleMetrics.slice(0, 8).map((metric, mi) => {
                            const Icon = metric.icon;
                            return (
                              <span key={metric.key} className={juntar("block min-w-0", mi > 1 && "max-sm:hidden")}>
                                <span className="flex min-w-0 items-center text-[12px] leading-4 text-muted-foreground">
                                  <Icon className="mr-1.5 h-3.5 w-3.5 shrink-0" style={{ color: metric.color }} aria-hidden="true" />
                                  <span className="truncate">{metric.label}</span>
                                </span>
                                <span className="mt-1 block truncate text-[24px] font-semibold leading-8 tracking-[-0.02em] tabular-nums text-foreground max-sm:text-[20px] max-sm:leading-7">{metric.format(metric.value)}</span>
                              </span>
                            );
                          })}
                        </span>
                      )}
                      {r.summary && <span className={juntar(texto.auxiliar, "mt-4 line-clamp-2 hidden leading-5 sm:block")}>{r.summary}</span>}
                      {sparklineData && (
                        <span className="mt-auto block w-full min-w-0 pt-4 sm:pt-5">
                          <Sparkline values={sparklineData} tone={1} height={48} />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
