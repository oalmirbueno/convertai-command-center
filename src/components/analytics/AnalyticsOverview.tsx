import { useMemo } from "react";
import {
  ArrowUpRight,
  BadgeDollarSign,
  BarChart3,
  CircleDollarSign,
  MousePointerClick,
  Plus,
  ReceiptText,
  Target,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildCampaignPerformance,
  buildDailyAnalyticsSeries,
  calculateAnalyticsSummary,
  formatAnalyticsNumber,
  type AnalyticsDataSet,
  type AnalyticsMetricResult,
} from "@/lib/analytics";

interface AnalyticsOverviewProps {
  data: AnalyticsDataSet;
  startDate: string;
  endDate: string;
  selectedCampaignId?: string;
  canManage: boolean;
  onCreateCampaign: () => void;
  onCreateMetricBatch: () => void;
}

const channelLabels: Record<string, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  tiktok_ads: "TikTok Ads",
  organic: "Orgânico",
  email: "E-mail",
  referral: "Indicação",
  whatsapp: "WhatsApp",
  other: "Outro",
};

const statusLabels: Record<string, string> = {
  draft: "Rascunho",
  active: "Ativa",
  paused: "Pausada",
  completed: "Concluída",
  archived: "Arquivada",
};

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(`${value}T12:00:00Z`))
    .replace(".", "");
}

function MetricCard({
  label,
  metric,
  icon: Icon,
  format = "number",
  helper,
  currency,
  unavailableReason,
}: {
  label: string;
  metric: AnalyticsMetricResult;
  icon: typeof TrendingUp;
  format?: "number" | "currency" | "percent" | "multiplier";
  helper: string;
  currency?: string | null;
  unavailableReason?: string;
}) {
  return (
    <article className="min-h-[132px] rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-4 font-mono text-2xl font-semibold tabular-nums text-foreground">
        {formatAnalyticsNumber(metric.value, {
          style: format,
          currency: currency || "BRL",
        })}
      </p>
      <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
        {!metric.available
          ? unavailableReason || "Sem dados suficientes no período"
          : metric.partial
            ? `Parcial, ${helper}`
            : helper}
      </p>
    </article>
  );
}

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-[260px] items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-6 text-center">
      <div>
        <BarChart3
          className="mx-auto mb-3 h-6 w-6 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-sm font-medium text-foreground">
          Ainda não há série para mostrar
        </p>
        <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
          {message}
        </p>
      </div>
    </div>
  );
}

export default function AnalyticsOverview({
  data,
  startDate,
  endDate,
  selectedCampaignId,
  canManage,
  onCreateCampaign,
  onCreateMetricBatch,
}: AnalyticsOverviewProps) {
  const summary = useMemo(
    () =>
      calculateAnalyticsSummary(
        data.metricEntries,
        data.events,
        data.definitions,
      ),
    [data.definitions, data.events, data.metricEntries],
  );
  const series = useMemo(
    () =>
      buildDailyAnalyticsSeries(
        startDate,
        endDate,
        data.metricEntries,
        data.events,
        data.definitions,
      ),
    [
      data.definitions,
      data.events,
      data.metricEntries,
      endDate,
      startDate,
    ],
  );
  const hasCurrencySeries = series.some(
    (point) => point.investment !== null || point.revenue !== null,
  );
  const hasVolumeSeries = series.some(
    (point) =>
      point.traffic !== null || point.primaryConversions !== null,
  );
  const trafficLabel =
    summary.traffic.source === "sessions"
      ? "Sessões"
      : summary.traffic.source === "clicks"
        ? "Cliques"
        : "Tráfego";
  const campaignPerformance = useMemo(
    () =>
      buildCampaignPerformance({
        ...data,
        campaigns: selectedCampaignId
          ? data.campaigns.filter(
              (campaign) => campaign.id === selectedCampaignId,
            )
          : data.campaigns,
      }),
    [data, selectedCampaignId],
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        <MetricCard
          label="Investimento"
          metric={summary.investment}
          icon={ReceiptText}
          format="currency"
          helper="soma de ad_spend"
          currency={summary.currency}
          unavailableReason={
            summary.mixedCurrency
              ? "Recorte com moedas diferentes"
              : undefined
          }
        />
        <MetricCard
          label={trafficLabel}
          metric={summary.traffic}
          icon={MousePointerClick}
          helper={
            summary.traffic.source === "sessions"
              ? "sessões, sem somar cliques"
              : summary.traffic.source === "clicks"
                ? "fallback por ausência de sessões"
                : "adicione sessões ou cliques"
          }
        />
        <MetricCard
          label="Conversões primárias"
          metric={summary.primaryConversions}
          icon={Target}
          helper="eventos marcados como primários"
        />
        <MetricCard
          label="Receita atribuída"
          metric={summary.revenue}
          icon={CircleDollarSign}
          format="currency"
          helper="eventos que contam como receita"
          currency={summary.currency}
          unavailableReason={
            summary.mixedCurrency
              ? "Recorte com moedas diferentes"
              : undefined
          }
        />
        <MetricCard
          label="Taxa de conversão"
          metric={summary.cvr}
          icon={TrendingUp}
          format="percent"
          helper={`conversões ÷ ${trafficLabel.toLowerCase()}`}
        />
        <MetricCard
          label="CPA"
          metric={summary.cpa}
          icon={BadgeDollarSign}
          format="currency"
          helper="investimento ÷ conversões"
          currency={summary.currency}
          unavailableReason={
            summary.mixedCurrency
              ? "Recorte com moedas diferentes"
              : undefined
          }
        />
        <MetricCard
          label="ROAS"
          metric={summary.roas}
          icon={ArrowUpRight}
          format="multiplier"
          helper="receita ÷ investimento"
          unavailableReason={
            summary.mixedCurrency
              ? "Recorte com moedas diferentes"
              : undefined
          }
        />
      </div>

      {summary.mixedCurrency && (
        <div
          role="status"
          className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-xs leading-5 text-foreground"
        >
          Este recorte mistura moedas. Investimento, receita, CPA e ROAS ficam
          como Sem dados até você filtrar uma campanha ou moeda compatível.
        </div>
      )}

      <section
        className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm sm:p-5"
        aria-labelledby="analytics-trends-title"
      >
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2
              id="analytics-trends-title"
              className="text-base font-semibold text-foreground"
            >
              Tendência do período
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Valores ausentes ficam em branco. O painel não converte ausência
              em zero.
            </p>
          </div>
          {canManage && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 gap-2 sm:min-h-9"
              onClick={onCreateMetricBatch}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Lançar métricas
            </Button>
          )}
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-border bg-background/60 p-3">
            <h3 className="mb-1 text-sm font-medium text-foreground">
              Investimento e receita
            </h3>
            <p className="mb-4 text-[11px] text-muted-foreground">
              {summary.currency
                ? `Em ${summary.currency}, por data inicial do lançamento`
                : "Por data inicial do lançamento"}
            </p>
            {hasCurrencySeries ? (
              <>
                <p className="sr-only">
                  Gráfico de linhas de investimento e receita atribuída. Os
                  valores exatos estão disponíveis na tabela após os gráficos.
                </p>
                <div className="h-[260px] w-full" aria-hidden="true">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={series}
                      margin={{ top: 6, right: 8, left: -12, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="hsl(var(--border))"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatShortDate}
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={24}
                      />
                      <YAxis
                        tickFormatter={(value) =>
                          new Intl.NumberFormat("pt-BR", {
                            notation: "compact",
                          }).format(value)
                        }
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                        width={52}
                      />
                      <Tooltip
                        formatter={(value, name) => [
                          formatAnalyticsNumber(Number(value), {
                            style: "currency",
                            currency: summary.currency || "BRL",
                          }),
                          name === "investment" ? "Investimento" : "Receita",
                        ]}
                        labelFormatter={(value) =>
                          new Intl.DateTimeFormat("pt-BR", {
                            dateStyle: "medium",
                            timeZone: "UTC",
                          }).format(new Date(`${value}T12:00:00Z`))
                        }
                        contentStyle={{
                          borderRadius: 10,
                          borderColor: "hsl(var(--border))",
                          background: "hsl(var(--popover))",
                          color: "hsl(var(--popover-foreground))",
                          fontSize: 12,
                        }}
                      />
                      <Legend
                        formatter={(value) =>
                          value === "investment" ? "Investimento" : "Receita"
                        }
                        wrapperStyle={{ fontSize: 11 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="investment"
                        stroke="hsl(var(--muted-foreground))"
                        strokeWidth={2}
                        dot={false}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="revenue"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2.5}
                        dot={false}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : (
              <ChartEmpty message="Lance investimento ou registre conversões com valor para iniciar esta leitura." />
            )}
          </div>

          <div className="rounded-xl border border-border bg-background/60 p-3">
            <h3 className="mb-1 text-sm font-medium text-foreground">
              {trafficLabel} e conversões
            </h3>
            <p className="mb-4 text-[11px] text-muted-foreground">
              Volume diário, sem tratar clique como sessão
            </p>
            {hasVolumeSeries ? (
              <>
                <p className="sr-only">
                  Gráfico de linhas de tráfego e conversões primárias. Os
                  valores exatos estão disponíveis na tabela após os gráficos.
                </p>
                <div className="h-[260px] w-full" aria-hidden="true">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={series}
                      margin={{ top: 6, right: 8, left: -12, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="hsl(var(--border))"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatShortDate}
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={24}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                        width={52}
                      />
                      <Tooltip
                        formatter={(value, name) => [
                          formatAnalyticsNumber(Number(value)),
                          name === "traffic"
                            ? trafficLabel
                            : "Conversões primárias",
                        ]}
                        labelFormatter={(value) =>
                          new Intl.DateTimeFormat("pt-BR", {
                            dateStyle: "medium",
                            timeZone: "UTC",
                          }).format(new Date(`${value}T12:00:00Z`))
                        }
                        contentStyle={{
                          borderRadius: 10,
                          borderColor: "hsl(var(--border))",
                          background: "hsl(var(--popover))",
                          color: "hsl(var(--popover-foreground))",
                          fontSize: 12,
                        }}
                      />
                      <Legend
                        formatter={(value) =>
                          value === "traffic"
                            ? trafficLabel
                            : "Conversões primárias"
                        }
                        wrapperStyle={{ fontSize: 11 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="traffic"
                        stroke="hsl(var(--muted-foreground))"
                        strokeWidth={2}
                        dot={false}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="primaryConversions"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2.5}
                        dot={false}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : (
              <ChartEmpty message="Lance sessões ou cliques e configure uma conversão primária." />
            )}
          </div>
        </div>

        <details className="mt-4 rounded-xl border border-border bg-background/50">
          <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Ver dados dos gráficos
          </summary>
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full min-w-[680px] text-left text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-medium">
                    Data
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Investimento
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Receita
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    {trafficLabel}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Conversões
                  </th>
                </tr>
              </thead>
              <tbody>
                {series.map((point) => (
                  <tr key={point.date} className="border-t border-border">
                    <th
                      scope="row"
                      className="whitespace-nowrap px-4 py-3 font-medium text-foreground"
                    >
                      {new Intl.DateTimeFormat("pt-BR", {
                        dateStyle: "short",
                        timeZone: "UTC",
                      }).format(new Date(`${point.date}T12:00:00Z`))}
                    </th>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {formatAnalyticsNumber(point.investment, {
                          style: "currency",
                          currency: summary.currency || "BRL",
                      })}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {formatAnalyticsNumber(point.revenue, {
                          style: "currency",
                          currency: summary.currency || "BRL",
                      })}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatAnalyticsNumber(point.traffic)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatAnalyticsNumber(point.primaryConversions)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section
        className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm sm:p-5"
        aria-labelledby="analytics-campaigns-title"
      >
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2
              id="analytics-campaigns-title"
              className="text-base font-semibold text-foreground"
            >
              Campanhas
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Comparação direta usando o mesmo recorte de datas.
            </p>
          </div>
          {canManage && (
            <Button
              type="button"
              className="min-h-11 gap-2 sm:min-h-9"
              onClick={onCreateCampaign}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Nova campanha
            </Button>
          )}
        </div>

        {campaignPerformance.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-5 py-10 text-center">
            <UsersRound
              className="mx-auto mb-3 h-6 w-6 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-foreground">
              Nenhuma campanha neste recorte
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
              Crie a campanha primeiro. Depois vincule UTMs, métricas e
              conversões para formar a leitura.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {campaignPerformance.map(({ campaign, summary: row, utmCount }) => (
                <article
                  key={campaign.id}
                  className="rounded-xl border border-border bg-background/60 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-foreground">
                        {campaign.name}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {channelLabels[campaign.channel] || campaign.channel}
                      </p>
                    </div>
                    <Badge variant="secondary">
                      {statusLabels[campaign.status] || campaign.status}
                    </Badge>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Investimento</dt>
                      <dd className="mt-1 font-mono font-medium tabular-nums">
                        {formatAnalyticsNumber(row.investment.value, {
                          style: "currency",
                          currency: row.currency || "BRL",
                        })}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Conversões</dt>
                      <dd className="mt-1 font-mono font-medium tabular-nums">
                        {formatAnalyticsNumber(
                          row.primaryConversions.value,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">CPA</dt>
                      <dd className="mt-1 font-mono font-medium tabular-nums">
                        {formatAnalyticsNumber(row.cpa.value, {
                          style: "currency",
                          currency: row.currency || "BRL",
                        })}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">ROAS</dt>
                      <dd className="mt-1 font-mono font-medium tabular-nums">
                        {formatAnalyticsNumber(row.roas.value, {
                          style: "multiplier",
                        })}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    {utmCount} {utmCount === 1 ? "link UTM" : "links UTM"}
                  </p>
                </article>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[860px] text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th scope="col" className="px-3 py-3 font-medium">
                      Campanha
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">
                      Investimento
                    </th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">
                      Conversões
                    </th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">
                      CPA
                    </th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">
                      ROAS
                    </th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">
                      UTMs
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {campaignPerformance.map(
                    ({ campaign, summary: row, utmCount }) => (
                      <tr
                        key={campaign.id}
                        className="border-b border-border last:border-b-0"
                      >
                        <th scope="row" className="px-3 py-3.5">
                          <span className="block font-medium text-foreground">
                            {campaign.name}
                          </span>
                          <span className="mt-1 block font-normal text-muted-foreground">
                            {channelLabels[campaign.channel] ||
                              campaign.channel}
                          </span>
                        </th>
                        <td className="px-3 py-3.5">
                          <Badge variant="secondary">
                            {statusLabels[campaign.status] ||
                              campaign.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono tabular-nums">
                          {formatAnalyticsNumber(row.investment.value, {
                            style: "currency",
                            currency: row.currency || "BRL",
                          })}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono tabular-nums">
                          {formatAnalyticsNumber(
                            row.primaryConversions.value,
                          )}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono tabular-nums">
                          {formatAnalyticsNumber(row.cpa.value, {
                            style: "currency",
                            currency: row.currency || "BRL",
                          })}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono tabular-nums">
                          {formatAnalyticsNumber(row.roas.value, {
                            style: "multiplier",
                          })}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono tabular-nums">
                          {utmCount}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
