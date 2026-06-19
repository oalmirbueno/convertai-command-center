// Comparação automática vs. relatório anterior do MESMO projeto
// - Auto-cura taxas (CTR/CPC/CPM/ROAS) a partir dos totais
// - Mostra delta % por métrica (subiu/desceu) com semântica (custo cair = bom)
// - Gráfico de barras lado a lado por campanha (quando há __breakdown)

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowUpRight, ArrowDownRight, GitCompareArrows, Minus, TrendingUp,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

type AnyRec = Record<string, any>;

const safeDiv = (a: number, b: number) => (b > 0 && isFinite(a / b) ? a / b : 0);

function healMetrics(raw: AnyRec | null | undefined): AnyRec {
  const m: AnyRec = { ...(raw || {}) };
  const spend = Number(m.ad_spend) || 0;
  const impr  = Number(m.impressions) || 0;
  const reach = Number(m.reach) || 0;
  const click = Number(m.link_clicks) || Number(m.clicks) || 0;
  const res   = Number(m.results) || Number(m.conversions) || 0;
  if (impr > 0 && click > 0)   m.ctr = safeDiv(click, impr) * 100;
  if (click > 0 && spend > 0)  m.cpc = safeDiv(spend, click);
  if (impr > 0 && spend > 0)   m.cpm = safeDiv(spend, impr) * 1000;
  if (reach > 0 && impr > 0)   m.frequency = safeDiv(impr, reach);
  if (res > 0 && spend > 0)    m.cost_per_result = safeDiv(spend, res);
  if ((Number(m.messages)  || 0) > 0 && spend > 0) m.cost_per_message  = safeDiv(spend, Number(m.messages));
  if ((Number(m.leads)     || 0) > 0 && spend > 0) m.cost_per_lead     = safeDiv(spend, Number(m.leads));
  if ((Number(m.purchases) || 0) > 0 && spend > 0) m.cost_per_purchase = safeDiv(spend, Number(m.purchases));
  if ((Number(m.revenue)   || 0) > 0 && spend > 0) m.roas              = safeDiv(Number(m.revenue), spend);
  return m;
}

// Métricas onde MENOR é melhor (custo)
const LOWER_IS_BETTER = new Set([
  "cpc", "cpm", "cpa", "cost_per_result", "cost_per_message",
  "cost_per_lead", "cost_per_purchase", "frequency",
]);

const METRIC_LABELS: Record<string, { label: string; format: (v: number) => string }> = {
  ad_spend:           { label: "Investido",       format: v => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
  impressions:        { label: "Impressões",      format: v => Math.round(v).toLocaleString("pt-BR") },
  reach:              { label: "Alcance",         format: v => Math.round(v).toLocaleString("pt-BR") },
  clicks:             { label: "Cliques",         format: v => Math.round(v).toLocaleString("pt-BR") },
  link_clicks:        { label: "Cliques no Link", format: v => Math.round(v).toLocaleString("pt-BR") },
  results:            { label: "Resultados",      format: v => Math.round(v).toLocaleString("pt-BR") },
  messages:           { label: "Mensagens",       format: v => Math.round(v).toLocaleString("pt-BR") },
  leads:              { label: "Leads",           format: v => Math.round(v).toLocaleString("pt-BR") },
  purchases:          { label: "Compras",         format: v => Math.round(v).toLocaleString("pt-BR") },
  revenue:            { label: "Receita",         format: v => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
  ctr:                { label: "CTR",             format: v => v.toFixed(2) + "%" },
  cpc:                { label: "CPC",             format: v => "R$ " + v.toFixed(2) },
  cpm:                { label: "CPM",             format: v => "R$ " + v.toFixed(2) },
  cpa:                { label: "CPA",             format: v => "R$ " + v.toFixed(2) },
  cost_per_result:    { label: "Custo/Resultado", format: v => "R$ " + v.toFixed(2) },
  cost_per_message:   { label: "Custo/Mensagem",  format: v => "R$ " + v.toFixed(2) },
  cost_per_lead:      { label: "Custo/Lead",      format: v => "R$ " + v.toFixed(2) },
  cost_per_purchase:  { label: "Custo/Compra",    format: v => "R$ " + v.toFixed(2) },
  roas:               { label: "ROAS",            format: v => v.toFixed(2) + "x" },
  frequency:          { label: "Frequência",      format: v => v.toFixed(2) + "x" },
  engagement:         { label: "Engajamento",     format: v => Math.round(v).toLocaleString("pt-BR") },
  engagement_rate:    { label: "Taxa Engaj.",     format: v => v.toFixed(2) + "%" },
  followers_gained:   { label: "Novos Seg.",      format: v => Math.round(v).toLocaleString("pt-BR") },
  profile_visits:     { label: "Visitas Perfil",  format: v => Math.round(v).toLocaleString("pt-BR") },
};

const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "";

interface Props {
  projectId: string;
  currentReportId: string;
  currentCreatedAt: string;
  currentMetrics: AnyRec;
  currentPeriod?: { start?: string; end?: string };
}

export default function ReportComparison({
  projectId, currentReportId, currentCreatedAt, currentMetrics, currentPeriod,
}: Props) {
  const { data: previous, isLoading } = useQuery({
    queryKey: ["report-previous", projectId, currentReportId],
    queryFn: async () => {
      const { data } = await supabase
        .from("reports")
        .select("id, title, created_at, period_start, period_end, metrics")
        .eq("project_id", projectId)
        .lt("created_at", currentCreatedAt)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!projectId && !!currentReportId,
  });

  if (isLoading) return null;
  if (!previous) {
    return (
      <section className="bg-card border border-border rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-1">
          <GitCompareArrows className="w-4 h-4 text-primary" />
          Comparação com Relatório Anterior
        </h2>
        <p className="text-xs text-muted-foreground">
          Este é o primeiro relatório deste projeto. Quando houver um relatório anterior,
          a evolução aparecerá aqui automaticamente (subidas, quedas e gráficos lado a lado).
        </p>
      </section>
    );
  }

  const current  = healMetrics(currentMetrics);
  const prevHeal = healMetrics(previous.metrics as AnyRec);

  // Métricas comparáveis (presentes em pelo menos um lado e conhecidas)
  const keys = Object.keys(METRIC_LABELS).filter(k => {
    const a = Number(current[k]) || 0;
    const b = Number(prevHeal[k]) || 0;
    return (a !== 0 || b !== 0);
  });

  const rows = keys.map(k => {
    const cur = Number(current[k]) || 0;
    const prev = Number(prevHeal[k]) || 0;
    const delta = cur - prev;
    const pct = prev !== 0 ? (delta / prev) * 100 : (cur > 0 ? 100 : 0);
    const lowerBetter = LOWER_IS_BETTER.has(k);
    const trend: "up" | "down" | "flat" = Math.abs(pct) < 0.5 ? "flat" : delta > 0 ? "up" : "down";
    const good = trend === "flat" ? null : lowerBetter ? trend === "down" : trend === "up";
    return { k, cur, prev, pct, trend, good, cfg: METRIC_LABELS[k] };
  });

  // Insights automáticos (top 3 melhorias e quedas mais relevantes)
  const improved = rows.filter(r => r.good === true).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 3);
  const worsened = rows.filter(r => r.good === false).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 3);

  // ── Gráfico por campanha (quando há __breakdown nos dois lados) ──
  const curBreak: AnyRec[] = Array.isArray((currentMetrics as any)?.__breakdown) ? (currentMetrics as any).__breakdown : [];
  const prevBreak: AnyRec[] = Array.isArray((previous.metrics as any)?.__breakdown) ? (previous.metrics as any).__breakdown : [];
  const curDim  = (currentMetrics as any)?.__dimension as string | undefined;
  const prevDim = (previous.metrics as any)?.__dimension as string | undefined;

  const findSpendCol = (rs: AnyRec[]) => {
    if (!rs.length) return null;
    const keys = Object.keys(rs[0]);
    return keys.find(k => /valor usado|spend|investido|investimento|amount spent|custo total/i.test(k)) || null;
  };
  const curSpendKey = findSpendCol(curBreak);
  const prevSpendKey = findSpendCol(prevBreak);

  const breakdownChart = (() => {
    if (!curSpendKey || !prevSpendKey || !curDim || !prevDim) return [];
    const prevMap = new Map(prevBreak.map(r => [String(r[prevDim] || "").trim(), Number(r[prevSpendKey]) || 0]));
    return curBreak
      .map(r => {
        const name = String(r[curDim] || "").trim();
        return {
          name: name.length > 22 ? name.slice(0, 22) + "…" : name,
          Atual: Number(r[curSpendKey]) || 0,
          Anterior: prevMap.get(name) || 0,
        };
      })
      .filter(d => d.Atual > 0 || d.Anterior > 0)
      .sort((a, b) => (b.Atual + b.Anterior) - (a.Atual + a.Anterior))
      .slice(0, 10);
  })();

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-2">
          <GitCompareArrows className="w-3.5 h-3.5 text-primary" />
          Comparação com Relatório Anterior
        </h2>
        <span className="text-[10px] px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 font-semibold uppercase tracking-wider">
          vs. {previous.title?.slice(0, 32) || fmtDate(previous.created_at)}
        </span>
      </div>

      {/* Sumário contextual */}
      <div className="bg-card border border-border rounded-2xl p-5 relative overflow-hidden">
        <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-primary/5 blur-3xl pointer-events-none" />
        <div className="relative grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Atual</p>
            <p className="text-sm font-semibold text-foreground">
              {currentPeriod?.start && currentPeriod?.end
                ? `${fmtDate(currentPeriod.start)} → ${fmtDate(currentPeriod.end)}`
                : "Período atual"}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Anterior</p>
            <p className="text-sm font-semibold text-foreground">
              {previous.period_start && previous.period_end
                ? `${fmtDate(previous.period_start)} → ${fmtDate(previous.period_end)}`
                : fmtDate(previous.created_at)}
            </p>
          </div>
        </div>

        {(improved.length > 0 || worsened.length > 0) && (
          <div className="relative mt-5 pt-4 border-t border-border/50 grid grid-cols-1 md:grid-cols-2 gap-3">
            {improved.length > 0 && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-primary font-bold mb-1.5 flex items-center gap-1.5">
                  <TrendingUp className="w-3 h-3" /> O que melhorou
                </p>
                <ul className="space-y-1">
                  {improved.map(r => (
                    <li key={r.k} className="text-[12px] text-foreground flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{r.cfg.label}</span>
                      <span className="font-mono font-bold text-primary">
                        {r.pct > 0 ? "+" : ""}{r.pct.toFixed(1)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {worsened.length > 0 && (
              <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-destructive font-bold mb-1.5 flex items-center gap-1.5">
                  <ArrowDownRight className="w-3 h-3" /> Pontos de atenção
                </p>
                <ul className="space-y-1">
                  {worsened.map(r => (
                    <li key={r.k} className="text-[12px] text-foreground flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{r.cfg.label}</span>
                      <span className="font-mono font-bold text-destructive">
                        {r.pct > 0 ? "+" : ""}{r.pct.toFixed(1)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Grid de métricas comparadas */}
      {rows.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map(r => {
            const Icon = r.trend === "flat" ? Minus : r.trend === "up" ? ArrowUpRight : ArrowDownRight;
            const tone =
              r.good === null ? "text-muted-foreground bg-secondary/40 border-border" :
              r.good ? "text-primary bg-primary/10 border-primary/20" :
              "text-destructive bg-destructive/10 border-destructive/20";
            return (
              <div key={r.k} className="bg-card border border-border rounded-2xl p-4 hover:border-primary/20 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{r.cfg.label}</p>
                  <span className={`text-[10px] px-2 py-0.5 rounded-md border font-mono font-bold flex items-center gap-1 ${tone}`}>
                    <Icon className="w-3 h-3" />
                    {r.trend === "flat" ? "0%" : (r.pct > 0 ? "+" : "") + r.pct.toFixed(1) + "%"}
                  </span>
                </div>
                <p className="text-xl font-bold font-mono text-foreground tracking-tight">{r.cfg.format(r.cur)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Anterior: <span className="font-mono">{r.cfg.format(r.prev)}</span>
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Gráfico campanha-a-campanha (investimento) */}
      {breakdownChart.length >= 2 && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1">Progressão por Campanha · Investimento</h3>
          <p className="text-[11px] text-muted-foreground mb-3">Comparação direta de quanto cada campanha recebeu agora vs. no período anterior.</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={breakdownChart} margin={{ top: 10, right: 16, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={55} tickFormatter={(v: number) => "R$" + (v >= 1000 ? (v / 1000).toFixed(0) + "K" : v.toFixed(0))} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                  formatter={(v: any, n: any) => ["R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), n]}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="Anterior" fill="hsl(220, 15%, 55%)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Atual"    fill="hsl(145, 100%, 50%)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  );
}
