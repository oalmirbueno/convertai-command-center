import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useClientIdentity } from "@/hooks/useClientIdentity";
import {
  FileText, BarChart3, TrendingUp, Calendar,
  Eye, MousePointerClick, Users, Zap, DollarSign, Target, MessageCircle,
  ChevronRight,
} from "lucide-react";
import { CabecalhoDePagina, CabecalhoDeSecao, Carregando, EstadoDeErro, EstadoVazio, botao, etiqueta, foco, juntar, lista, texto, useEstadoDaTela } from "@/components/sistema";
import ClientLiveCampaigns from "@/components/reports/ClientLiveCampaigns";
import { useNavigate } from "react-router-dom";
import { getPeriodModel, PERIOD_ORDER } from "@/lib/reportGrouping";
import {
  AreaChart, Area, ResponsiveContainer,
} from "recharts";

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
      return (data || []).filter((r: any) => !(r.metrics as any)?.ritual_type);
    },
    enabled: !!user,
  });

  return (
    <div className="min-w-0 space-y-6">
      <CabecalhoDePagina
        titulo="Relatórios"
        descricao={reports && reports.length ? `${reports.length} ${reports.length === 1 ? "publicado" : "publicados"}` : undefined}
        ajuda="Os resultados dos seus projetos, fechados pela equipe a cada período. Toque num relatório para ver os números e a leitura completa. Você recebe um aviso quando sai um novo."
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
const reportKind = (r: any): { label: string; cls: string } => {
  const m = (r.metrics || {}) as Record<string, unknown>;
  const hasAdsNumbers = ["ad_spend", "cpc", "cpm", "roas", "impressions", "reach", "clicks", "results"]
    .some((key) => Number(m[key]) > 0);
  if (hasAdsNumbers) return { label: "Anúncios", cls: "bg-primary/10 text-primary border-primary/25" };
  const images = Array.isArray(r.images) ? r.images : [];
  if (r.file_url || images.length > 0) return { label: "Entrega", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/25" };
  return { label: "Resumo", cls: "bg-secondary text-muted-foreground border-border" };
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
    <div className="space-y-6">
      {modelKeys.map((model, gi) => (
        // Um controle só de recolher (antes a Secao já trazia a setinha dela e
        // ainda havia um botão à direita). A memória continua a mesma:
        // "relatorios:grupos-fechados".
        <section
          key={model}
          className={juntar("min-w-0", gi > 0 && "border-t border-border pt-5")}
          data-recolhido={open[model] ? "nao" : "sim"}
        >
          <CabecalhoDeSecao
            className={open[model] ? "mb-3" : ""}
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
            <ul className={juntar(lista.aberta, lista.divisoria)}>
              {groups[model].map((r: any) => {
                const m = (r.metrics || {}) as Record<string, any>;
                const visibleMetrics = Object.entries(m)
                  .filter(([k]) => k !== "custom" && metricConfig[k] && m[k] !== undefined && m[k] !== 0)
                  .map(([k, v]) => ({ key: k, value: v as number, ...metricConfig[k] }));

                const chartData = ((r.chart_data || []) as Array<Record<string, any>>);
                const chartColumns = chartData.length > 0
                  ? Object.keys(chartData[0]).filter(k => k !== "label")
                  : [];

                // Mini sparkline data
                const sparklineData = chartData.length > 0 && chartColumns.length > 0
                  ? chartData.map(row => ({ v: Number(row[chartColumns[0]]) || 0 }))
                  : null;
                const kind = reportKind(r);

                return (
                  <li key={r.id} className="min-w-0">
                    <button
                      type="button"
                      className={juntar("group flex w-full min-w-0 items-start rounded-lg px-2 py-3.5 text-left transition-colors hover:bg-muted/40", foco)}
                      onClick={() => navigate(`/relatorios/${r.id}`)}
                      aria-label={`Abrir o relatório ${r.title}`}
                    >
                      <TrendingUp className="mr-3 mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <span className="block min-w-0 flex-1">
                        <span className="flex min-w-0 items-center">
                          <span className="mr-2 min-w-0 truncate text-[13px] font-medium leading-5 text-foreground">{r.title}</span>
                          <span className={juntar(etiqueta, "border", kind.cls)}>{kind.label}</span>
                        </span>
                        <span className={juntar(texto.auxiliar, "mt-0.5 flex min-w-0 items-center")}>
                          <span className="truncate">{(r as any).project?.name}</span>
                          {r.period_start && r.period_end && (
                            <>
                              <span className="mx-1.5 shrink-0" aria-hidden="true">·</span>
                              <Calendar className="mr-1 h-3 w-3 shrink-0" aria-hidden="true" />
                              <span className="shrink-0">{formatDateShort(r.period_start)} a {formatDateShort(r.period_end)}</span>
                            </>
                          )}
                        </span>
                        {visibleMetrics.length > 0 && (
                          <span className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
                            {visibleMetrics.slice(0, 8).map(metric => {
                              const Icon = metric.icon;
                              return (
                                <span key={metric.key} className="flex min-w-0 items-center">
                                  <Icon className="mr-1.5 h-3.5 w-3.5 shrink-0" style={{ color: metric.color }} aria-hidden="true" />
                                  <span className="mr-1 text-[13px] font-semibold tabular-nums text-foreground">{metric.format(metric.value)}</span>
                                  <span className="truncate text-[12px] text-muted-foreground">{metric.label}</span>
                                </span>
                              );
                            })}
                          </span>
                        )}
                        {r.summary && <span className={juntar(texto.auxiliar, "mt-2 line-clamp-2 block leading-5")}>{r.summary}</span>}
                      </span>
                      {sparklineData && (
                        <span className="ml-3 hidden h-8 w-20 shrink-0 sm:block" aria-hidden="true">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={sparklineData}>
                              <defs>
                                <linearGradient id={`spark-${r.id}`} x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="hsl(145, 100%, 50%)" stopOpacity={0.3} />
                                  <stop offset="95%" stopColor="hsl(145, 100%, 50%)" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <Area type="monotone" dataKey="v" stroke="hsl(145, 100%, 50%)" fill={`url(#spark-${r.id})`} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </span>
                      )}
                      <ChevronRight className="ml-2 mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
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
