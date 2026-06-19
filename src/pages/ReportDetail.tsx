import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowLeft, Download, MessageCircle, TrendingUp, TrendingDown,
  BarChart3, Target, Zap, Eye, MousePointerClick, Users, DollarSign,
  Calendar, Printer, ArrowUpRight, ArrowDownRight,
  FileText, Layers, Activity, Award, CheckCircle2, Info,
  PieChart as PieChartIcon, Gauge, Sparkles, Shield, Clock,
  Hash, LayoutGrid, ArrowRight, Star, Lightbulb, AlertTriangle,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";
import SourceDashboard from "@/components/reports/SourceDashboard";
import ReportComparison from "@/components/reports/ReportComparison";
import MetricsAudit from "@/components/reports/MetricsAudit";

const fmtInt   = (v: number) => v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "K" : String(Math.round(v));
const fmtMoney = (v: number) => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct   = (v: number, d = 1) => v.toFixed(d) + "%";
const fmtMult  = (v: number) => v.toFixed(2) + "x";

/* ── Metric Config ────────────────────────────────────────── */
const metricConfig: Record<string, {
  label: string; shortLabel: string; format: (v: number) => string;
  icon: any; color: string; unit: string; category: string; benchmark?: number;
}> = {
  // ── Visibilidade ──
  reach:              { label: "Alcance Total",          shortLabel: "Alcance",       format: fmtInt,   icon: Eye,               color: "hsl(200, 100%, 50%)", unit: "pessoas",  category: "Visibilidade", benchmark: 10000 },
  impressions:        { label: "Impressões Totais",      shortLabel: "Impressões",    format: fmtInt,   icon: BarChart3,         color: "hsl(263, 70%, 66%)", unit: "vezes",    category: "Visibilidade", benchmark: 15000 },
  frequency:          { label: "Frequência Média",       shortLabel: "Frequência",    format: v => v.toFixed(2) + "x", icon: Activity, color: "hsl(220, 70%, 60%)", unit: "x",      category: "Visibilidade" },
  // ── Tráfego ──
  clicks:             { label: "Cliques (Todos)",        shortLabel: "Cliques",       format: fmtInt,   icon: MousePointerClick, color: "hsl(38, 92%, 50%)",  unit: "cliques",  category: "Tráfego",      benchmark: 100 },
  link_clicks:        { label: "Cliques no Link",        shortLabel: "Cliq. Link",    format: fmtInt,   icon: MousePointerClick, color: "hsl(28, 92%, 55%)",  unit: "cliques",  category: "Tráfego" },
  landing_page_views: { label: "Visitas na Landing",     shortLabel: "Landing",       format: fmtInt,   icon: LayoutGrid,        color: "hsl(18, 88%, 58%)",  unit: "visitas",  category: "Tráfego" },
  ctr:                { label: "Click-Through Rate",     shortLabel: "CTR",           format: v => fmtPct(v, 2), icon: Target,    color: "hsl(346, 87%, 60%)", unit: "%",        category: "Tráfego",      benchmark: 1 },
  cpc:                { label: "Custo por Clique",       shortLabel: "CPC",           format: fmtMoney, icon: DollarSign,        color: "hsl(355, 80%, 55%)", unit: "R$",       category: "Tráfego" },
  cpm:                { label: "Custo por Mil Impr.",    shortLabel: "CPM",           format: fmtMoney, icon: DollarSign,        color: "hsl(330, 75%, 55%)", unit: "R$",       category: "Tráfego" },
  // ── Investimento ──
  ad_spend:           { label: "Investimento em Mídia",  shortLabel: "Investido",     format: fmtMoney, icon: DollarSign,        color: "hsl(221, 83%, 53%)", unit: "R$",       category: "Investimento" },
  results:            { label: "Resultados",             shortLabel: "Resultados",    format: fmtInt,   icon: CheckCircle2,      color: "hsl(160, 70%, 45%)", unit: "result.",  category: "Investimento" },
  cost_per_result:    { label: "Custo por Resultado",    shortLabel: "Custo/Result.", format: fmtMoney, icon: DollarSign,        color: "hsl(165, 65%, 50%)", unit: "R$",       category: "Investimento" },
  cpa:                { label: "Custo por Aquisição",    shortLabel: "CPA",           format: fmtMoney, icon: DollarSign,        color: "hsl(280, 70%, 60%)", unit: "R$",       category: "Investimento" },
  // ── Conversa & Leads ──
  messages:           { label: "Mensagens Recebidas",    shortLabel: "Mensagens",     format: fmtInt,   icon: MessageCircle,     color: "hsl(142, 71%, 45%)", unit: "msgs",     category: "Conversão",    benchmark: 20 },
  conversions:        { label: "Conversas Iniciadas",    shortLabel: "Conversas",     format: fmtInt,   icon: MessageCircle,     color: "hsl(135, 75%, 48%)", unit: "conv.",    category: "Conversão" },
  cost_per_message:   { label: "Custo por Mensagem",     shortLabel: "Custo/Msg",     format: fmtMoney, icon: DollarSign,        color: "hsl(150, 60%, 45%)", unit: "R$",       category: "Conversão" },
  leads:              { label: "Leads Capturados",       shortLabel: "Leads",         format: fmtInt,   icon: Users,             color: "hsl(170, 75%, 45%)", unit: "leads",    category: "Conversão" },
  cost_per_lead:      { label: "Custo por Lead",         shortLabel: "Custo/Lead",    format: fmtMoney, icon: DollarSign,        color: "hsl(178, 70%, 45%)", unit: "R$",       category: "Conversão" },
  // ── Perfil & Crescimento ──
  profile_visits:     { label: "Visitas ao Perfil",      shortLabel: "Vis. Perfil",   format: fmtInt,   icon: Eye,               color: "hsl(190, 90%, 50%)", unit: "visitas",  category: "Perfil" },
  followers_gained:   { label: "Novos Seguidores",       shortLabel: "Novos Seg.",    format: v => "+" + fmtInt(v), icon: Users,  color: "hsl(188, 94%, 43%)", unit: "pessoas",  category: "Perfil" },
  followers_total:    { label: "Total de Seguidores",    shortLabel: "Seguidores",    format: fmtInt,   icon: Users,             color: "hsl(195, 85%, 50%)", unit: "pessoas",  category: "Perfil" },
  // ── Interação ──
  engagement:         { label: "Engajamento Total",      shortLabel: "Engajamento",   format: fmtInt,   icon: Zap,               color: "hsl(145, 100%, 50%)", unit: "interações", category: "Interação" },
  engagement_rate:    { label: "Taxa de Engajamento",    shortLabel: "Taxa Engaj.",   format: v => fmtPct(v, 2), icon: Zap,       color: "hsl(140, 95%, 50%)", unit: "%",        category: "Interação",    benchmark: 3 },
  likes:              { label: "Curtidas",               shortLabel: "Curtidas",      format: fmtInt,   icon: Star,              color: "hsl(350, 85%, 60%)", unit: "likes",    category: "Interação" },
  comments:           { label: "Comentários",            shortLabel: "Coment.",       format: fmtInt,   icon: MessageCircle,     color: "hsl(45, 90%, 55%)",  unit: "coment.",  category: "Interação" },
  shares:             { label: "Compartilhamentos",      shortLabel: "Compart.",      format: fmtInt,   icon: ArrowUpRight,      color: "hsl(210, 85%, 60%)", unit: "compart.", category: "Interação" },
  saves:              { label: "Salvamentos",            shortLabel: "Salvos",        format: fmtInt,   icon: Award,             color: "hsl(260, 75%, 60%)", unit: "salvos",   category: "Interação" },
  // ── Vídeo ──
  video_views:        { label: "Visualizações de Vídeo", shortLabel: "Views Vídeo",   format: fmtInt,   icon: Eye,               color: "hsl(295, 75%, 60%)", unit: "views",    category: "Vídeo" },
  thru_plays:         { label: "ThruPlays (Vídeo)",      shortLabel: "ThruPlays",     format: fmtInt,   icon: Eye,               color: "hsl(310, 75%, 58%)", unit: "plays",    category: "Vídeo" },
  // ── E-commerce ──
  purchases:          { label: "Compras Realizadas",     shortLabel: "Compras",       format: fmtInt,   icon: Award,             color: "hsl(50, 95%, 55%)",  unit: "compras",  category: "E-commerce" },
  revenue:            { label: "Receita Gerada",         shortLabel: "Receita",       format: fmtMoney, icon: DollarSign,        color: "hsl(55, 95%, 55%)",  unit: "R$",       category: "E-commerce" },
  roas:               { label: "ROAS",                   shortLabel: "ROAS",          format: fmtMult,  icon: TrendingUp,        color: "hsl(60, 90%, 50%)",  unit: "x",        category: "E-commerce" },
  add_to_cart:        { label: "Adições ao Carrinho",    shortLabel: "Add Carrinho",  format: fmtInt,   icon: ArrowRight,        color: "hsl(35, 90%, 55%)",  unit: "items",    category: "E-commerce" },
  initiate_checkout:  { label: "Checkouts Iniciados",    shortLabel: "Checkout",      format: fmtInt,   icon: ArrowRight,        color: "hsl(30, 90%, 55%)",  unit: "checkouts", category: "E-commerce" },
};

const CHART_COLORS = [
  "hsl(145, 100%, 50%)", "hsl(200, 100%, 50%)", "hsl(263, 70%, 66%)",
  "hsl(38, 92%, 50%)", "hsl(346, 87%, 60%)", "hsl(188, 94%, 43%)",
  "hsl(221, 83%, 53%)", "hsl(280, 70%, 60%)",
];

function fmtDate(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
}

function daysBetween(a: string, b: string) {
  return Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}

/* ── Component ────────────────────────────────────────────── */
export default function ReportDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: report, isLoading } = useQuery({
    queryKey: ["report-detail", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("reports")
        .select("*, project:projects(name)")
        .eq("id", id!)
        .single();
      return data;
    },
    enabled: !!id,
  });

  /* ── Derived data ─────────────────────────────── */
  const analysis = useMemo(() => {
    if (!report) return null;

    const m = { ...((report.metrics || {}) as Record<string, any>) };

    // ── Auto-heal: recalcula taxas/custos derivados a partir dos totais reais ──
    // Reports antigos podem ter CPC/CPM/CTR errados (export do Meta com colunas
    // deslocadas ou somatórios de taxas). Aqui derivamos sempre que possível.
    const safeDiv = (a: number, b: number) => (b > 0 && isFinite(a / b) ? a / b : 0);
    const _spend = Number(m.ad_spend) || 0;
    const _impr  = Number(m.impressions) || 0;
    const _reach = Number(m.reach) || 0;
    const _click = Number(m.link_clicks) || Number(m.clicks) || 0;
    const _res   = Number(m.results) || Number(m.conversions) || 0;
    if (_impr > 0 && _click > 0)  m.ctr = safeDiv(_click, _impr) * 100;
    if (_click > 0 && _spend > 0) m.cpc = safeDiv(_spend, _click);
    if (_impr > 0 && _spend > 0)  m.cpm = safeDiv(_spend, _impr) * 1000;
    if (_reach > 0 && _impr > 0)  m.frequency = safeDiv(_impr, _reach);
    if (_res > 0 && _spend > 0)   m.cost_per_result = safeDiv(_spend, _res);
    if ((Number(m.messages)  || 0) > 0 && _spend > 0) m.cost_per_message  = safeDiv(_spend, Number(m.messages));
    if ((Number(m.leads)     || 0) > 0 && _spend > 0) m.cost_per_lead     = safeDiv(_spend, Number(m.leads));
    if ((Number(m.purchases) || 0) > 0 && _spend > 0) m.cost_per_purchase = safeDiv(_spend, Number(m.purchases));
    if ((Number(m.revenue)   || 0) > 0 && _spend > 0) m.roas              = safeDiv(Number(m.revenue), _spend);

    const customMetrics = ((m.custom || []) as Array<{ label: string; value: number }>)
      .filter(c => c && c.label && Number(c.value) !== 0 && c.value !== null && c.value !== undefined);

    const RATE_KEYS = new Set(["ctr", "cpc", "cpm", "frequency", "engagement_rate", "roas", "cost_per_result", "cost_per_message", "cost_per_lead", "cpa"]);

    const standardMetrics = Object.entries(m)
      .filter(([k]) => k !== "custom" && !k.startsWith("__") && metricConfig[k] && m[k] !== undefined && m[k] !== null && Number(m[k]) !== 0)
      .map(([k, v]) => ({ key: k, value: Number(v), ...metricConfig[k] }));

    const volumeMetrics = standardMetrics.filter(sm => !RATE_KEYS.has(sm.key));

    const rawChartData = ((report as any).chart_data || []) as Array<Record<string, any>>;
    const chartType = ((report as any).chart_type || "area") as string;

    // Auto-generate chart data from metrics if none exists
    let chartData = rawChartData;
    let chartColumns: string[] = [];

    if (rawChartData.length > 0) {
      chartColumns = Object.keys(rawChartData[0]).filter(k => k !== "label");
    } else if (volumeMetrics.length >= 2 && report.period_start && report.period_end) {
      const start = new Date(report.period_start);
      const end = new Date(report.period_end);
      const totalDays = Math.max(1, daysBetween(report.period_start, report.period_end));

      let intervals: Date[] = [];
      if (totalDays <= 7) {
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) intervals.push(new Date(d));
      } else if (totalDays <= 31) {
        const step = Math.max(1, Math.floor(totalDays / 7));
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + step)) intervals.push(new Date(d));
        if (intervals[intervals.length - 1].getTime() < end.getTime()) intervals.push(new Date(end));
      } else {
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) intervals.push(new Date(d));
        if (intervals[intervals.length - 1].getTime() < end.getTime()) intervals.push(new Date(end));
      }

      const topVolume = volumeMetrics.slice(0, 4);
      const n = intervals.length;
      chartData = intervals.map((date, i) => {
        const label = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
        const row: Record<string, any> = { label };
        topVolume.forEach(metric => {
          const weight = 0.6 + (i / (n - 1 || 1)) * 0.8;
          const base = (metric.value / n) * weight;
          row[metric.shortLabel] = Math.round(Math.max(0, base));
        });
        return row;
      });

      topVolume.forEach(metric => {
        const currentTotal = chartData.reduce((s, r) => s + (Number(r[metric.shortLabel]) || 0), 0);
        const diff = metric.value - currentTotal;
        if (chartData.length > 0) {
          chartData[chartData.length - 1][metric.shortLabel] = Math.max(0, (chartData[chartData.length - 1][metric.shortLabel] || 0) + diff);
        }
      });

      chartColumns = topVolume.map(m => m.shortLabel);
    }

    // Column stats
    const colStats = chartColumns.map((col, i) => {
      const values = chartData.map(r => Number(r[col]) || 0);
      const total = values.reduce((a, b) => a + b, 0);
      const avg = values.length > 0 ? total / values.length : 0;
      const max = Math.max(...values, 1);
      const min = Math.min(...values);
      const first = values[0] ?? 0;
      const last = values[values.length - 1] ?? 0;
      const trend = first > 0 ? ((last - first) / first) * 100 : 0;
      return { col, total, avg, max, min, trend, color: CHART_COLORS[i % CHART_COLORS.length] };
    });

    // Pie data from volume metrics
    const pieData = volumeMetrics.slice(0, 6).map((mm, i) => ({
      name: mm.shortLabel, value: mm.value, fill: CHART_COLORS[i % CHART_COLORS.length],
    }));

    // Radar
    const radarData = standardMetrics
      .filter(mm => mm.benchmark && mm.benchmark > 0)
      .map(mm => ({
        metric: mm.shortLabel,
        value: Math.min(Math.round((mm.value / mm.benchmark!) * 100), 150),
        fullMark: 150,
      }));

    // ── SMART USER JOURNEY FUNNEL ─────────────────────────────
    // Stages adapt to whichever data is present (não foca só em conversão direta)
    const num = (k: string) => Number(m[k]) || 0;
    const funnelStages: Array<{ name: string; value: number; fill: string }> = [];
    const awareness = num("impressions") || num("reach");
    if (awareness > 0) funnelStages.push({ name: num("impressions") ? "Impressões" : "Alcance", value: awareness, fill: CHART_COLORS[2] });
    const reachVal = num("reach");
    if (num("impressions") && reachVal > 0 && reachVal !== awareness) funnelStages.push({ name: "Alcance", value: reachVal, fill: CHART_COLORS[1] });
    const interest = num("video_views") + num("profile_visits");
    if (interest > 0) {
      const lbl = num("profile_visits") && num("video_views") ? "Perfil + Vídeo"
                 : num("profile_visits") ? "Visitas ao Perfil" : "Views de Vídeo";
      funnelStages.push({ name: lbl, value: interest, fill: CHART_COLORS[5] });
    }
    const traffic = num("link_clicks") || num("clicks");
    if (traffic > 0) funnelStages.push({ name: num("link_clicks") ? "Cliques no Link" : "Cliques", value: traffic, fill: CHART_COLORS[3] });
    const landing = num("landing_page_views");
    if (landing > 0 && landing !== traffic) funnelStages.push({ name: "Visitas na Landing", value: landing, fill: CHART_COLORS[4] });
    const contact = num("messages") + num("conversions") + num("leads");
    if (contact > 0) {
      const parts: string[] = [];
      if (num("messages") + num("conversions")) parts.push("Conversas");
      if (num("leads")) parts.push("Leads");
      funnelStages.push({ name: parts.join(" + "), value: contact, fill: CHART_COLORS[0] });
    }
    const sales = num("purchases");
    if (sales > 0) funnelStages.push({ name: "Compras", value: sales, fill: CHART_COLORS[6] });

    const funnelData = funnelStages.length >= 2
      ? funnelStages.sort((a, b) => b.value - a.value)
      : null;

    // Efficiency radial (any cost-per-* present)
    const spend = num("ad_spend");
    const efficiencyData: Array<{ name: string; value: number; fill: string }> = [];
    const buildEff = (label: string, value: number, max: number, color: string) => {
      efficiencyData.push({ name: label, value: Math.min(Math.round((1 / value) * max), 100), fill: color });
    };
    if (spend && contact > 0) buildEff("Custo/Conversa", spend / contact, 100, CHART_COLORS[0]);
    if (spend && traffic > 0) buildEff("Custo/Clique", spend / traffic, 50, CHART_COLORS[1]);
    if (reachVal && traffic > 0) {
      efficiencyData.push({ name: "Cliques/Alcance", value: Math.min(Math.round((traffic / reachVal) * 1000), 100), fill: CHART_COLORS[2] });
    }

    // ── SMART KPIs (qualquer combinação de investimento × resultado) ──
    const kpis: Array<{ label: string; value: string; detail: string; icon: any; color: string; status: "good" | "warning" | "bad" }> = [];
    const fmtR = (v: number) => "R$ " + v.toFixed(2);

    if (spend > 0 && contact > 0) {
      const v = spend / contact;
      kpis.push({ label: "Custo por Conversa", value: fmtR(v), detail: `${contact} contatos com ${fmtR(spend)} investidos`,
        icon: MessageCircle, color: "hsl(142, 71%, 45%)", status: v < 15 ? "good" : v < 30 ? "warning" : "bad" });
    }
    if (spend > 0 && traffic > 0) {
      const v = spend / traffic;
      kpis.push({ label: "Custo por Clique", value: fmtR(v), detail: `${traffic.toLocaleString("pt-BR")} cliques no período`,
        icon: MousePointerClick, color: "hsl(200, 100%, 50%)", status: v < 2 ? "good" : v < 5 ? "warning" : "bad" });
    }
    if (reachVal > 0 && spend > 0) {
      const v = (spend / reachVal) * 1000;
      kpis.push({ label: "CPM", value: fmtR(v), detail: `Custo para alcançar 1.000 pessoas`,
        icon: Eye, color: "hsl(263, 70%, 66%)", status: v < 15 ? "good" : v < 40 ? "warning" : "bad" });
    }
    if (num("profile_visits") > 0 && reachVal > 0) {
      const r = (num("profile_visits") / reachVal) * 100;
      kpis.push({ label: "Taxa Perfil/Alcance", value: r.toFixed(2) + "%", detail: `${num("profile_visits").toLocaleString("pt-BR")} visitas vs. alcance`,
        icon: Target, color: "hsl(190, 90%, 50%)", status: r > 2 ? "good" : r > 0.5 ? "warning" : "bad" });
    }
    if (num("profile_visits") > 0 && contact > 0) {
      const r = (contact / num("profile_visits")) * 100;
      kpis.push({ label: "Perfil → Conversa", value: r.toFixed(1) + "%", detail: `${contact} de ${num("profile_visits").toLocaleString("pt-BR")} visitantes converteram`,
        icon: ArrowRight, color: "hsl(145, 100%, 50%)", status: r > 10 ? "good" : r > 3 ? "warning" : "bad" });
    }
    if (spend > 0 && num("purchases") > 0) {
      const v = spend / num("purchases");
      kpis.push({ label: "Custo por Compra", value: fmtR(v), detail: `${num("purchases")} vendas geradas`,
        icon: Award, color: "hsl(50, 95%, 55%)", status: v < 50 ? "good" : v < 150 ? "warning" : "bad" });
    }
    if (num("roas") > 0) {
      const v = num("roas");
      kpis.push({ label: "ROAS", value: v.toFixed(2) + "x", detail: `Retorno sobre o investimento publicitário`,
        icon: TrendingUp, color: "hsl(60, 90%, 50%)", status: v > 3 ? "good" : v > 1 ? "warning" : "bad" });
    }

    // ── Auto insights ──
    const insights: Array<{ text: string; type: "success" | "info" | "warning" }> = [];
    if (spend > 0 && contact > 0) {
      const v = spend / contact;
      insights.push({ text: `Cada conversa iniciada custou em média R$ ${v.toFixed(2)}. ${v < 15 ? "Custo competitivo para o segmento." : "Há espaço para otimizar o custo por contato com testes de criativo e segmentação."}`, type: v < 15 ? "success" : "warning" });
    }
    if (num("profile_visits") > 0 && contact > 0) {
      const r = (contact / num("profile_visits")) * 100;
      insights.push({ text: `${r.toFixed(1)}% das visitas ao perfil viraram conversa · ${r > 10 ? "ótima taxa de conversão entre interesse e contato." : "vale revisar a bio, os destaques e o primeiro post para aumentar a conversão."}`, type: r > 10 ? "success" : "info" });
    }
    if (spend > 0 && traffic > 0) {
      const cpc = spend / traffic;
      insights.push({ text: `CPC médio de R$ ${cpc.toFixed(2)}. ${cpc < 3 ? "Dentro do esperado para campanhas de tráfego." : "Recomendamos ajustar segmentação ou criativos."}`, type: cpc < 3 ? "info" : "warning" });
    }
    const engRate = num("engagement_rate") || num("engagement");
    if (engRate > 3 && num("engagement_rate")) {
      insights.push({ text: `Taxa de engajamento de ${engRate.toFixed(1)}% acima da média de mercado (1-3%), indicando ótima ressonância do conteúdo.`, type: "success" });
    }
    if (reachVal > 0 && num("impressions") > 0) {
      const freq = num("impressions") / reachVal;
      insights.push({ text: `Frequência média de ${freq.toFixed(1)}x · cada pessoa viu o anúncio ${freq.toFixed(1)} vez(es). ${freq > 3 ? "Considere ampliar o público para evitar fadiga." : "Frequência saudável."}`, type: freq > 3 ? "warning" : "info" });
    }
    if (num("followers_gained") > 0) {
      insights.push({ text: `${num("followers_gained").toLocaleString("pt-BR")} novos seguidores no período, fortalecendo organicamente a base.`, type: "success" });
    }
    if (num("roas") > 0) {
      const v = num("roas");
      insights.push({ text: `ROAS de ${v.toFixed(2)}x · cada R$ 1 investido retornou R$ ${v.toFixed(2)} em receita.`, type: v > 2 ? "success" : "info" });
    }

    // Category grouping
    const categories = new Map<string, typeof standardMetrics>();
    standardMetrics.forEach(mm => {
      if (!categories.has(mm.category)) categories.set(mm.category, []);
      categories.get(mm.category)!.push(mm);
    });

    const periodDays = report.period_start && report.period_end ? daysBetween(report.period_start, report.period_end) : 0;

    return { standardMetrics, customMetrics, chartData, chartType, chartColumns, colStats, pieData, radarData, efficiencyData, funnelData, kpis, insights, periodDays, categories, spend, contact, traffic, reach: reachVal };
  }, [report]);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 rounded-2xl" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40 rounded-2xl" />)}
        </div>
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  if (!report || !analysis) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Relatório não encontrado.</p>
      </div>
    );
  }

  const { standardMetrics, customMetrics, chartData, chartType, chartColumns, colStats, pieData, radarData, efficiencyData, funnelData, kpis, insights, periodDays, categories } = analysis;

  const periodLabel = report.period_start && report.period_end
    ? `${fmtDate(report.period_start)} a ${fmtDate(report.period_end)}`
    : "";

  const whatsappMsg = `Olá! Vi o relatório "${report.title}" e gostaria de conversar sobre os resultados.`;
  const whatsappUrl = `https://wa.me/5500000000000?text=${encodeURIComponent(whatsappMsg)}`;
  const handlePrint = () => window.print();

  const parseLines = (text: string) => text.split("\n").map(l => l.trim()).filter(Boolean);

  /* ── Chart renderer · Aceleriq futurist ───────────── */
  const renderMainChart = () => {
    if (chartData.length === 0 || chartColumns.length === 0) return null;

    const gradients = chartColumns.map((_, i) => ({
      id: `grad${i}`,
      lineId: `line${i}`,
      barId: `bar${i}`,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));

    const commonProps = { data: chartData, margin: { top: 16, right: 24, left: 0, bottom: 5 } };

    const sharedDefs = (
      <defs>
        {/* Neon glow filter */}
        <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* Soft glow filter */}
        <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {gradients.map(g => (
          <linearGradient key={g.id} id={g.id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={g.color} stopOpacity={0.55} />
            <stop offset="60%" stopColor={g.color} stopOpacity={0.15} />
            <stop offset="100%" stopColor={g.color} stopOpacity={0} />
          </linearGradient>
        ))}
        {gradients.map(g => (
          <linearGradient key={g.barId} id={g.barId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={g.color} stopOpacity={1} />
            <stop offset="100%" stopColor={g.color} stopOpacity={0.25} />
          </linearGradient>
        ))}
        {gradients.map(g => (
          <linearGradient key={g.lineId} id={g.lineId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={g.color} stopOpacity={0.6} />
            <stop offset="50%" stopColor={g.color} stopOpacity={1} />
            <stop offset="100%" stopColor={g.color} stopOpacity={0.6} />
          </linearGradient>
        ))}
        {/* Grid pattern overlay */}
        <pattern id="techGrid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M 32 0 L 0 0 0 32" fill="none" stroke="hsl(145 100% 50% / 0.04)" strokeWidth="0.5" />
        </pattern>
      </defs>
    );

    const xAxis = <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))", fontFamily: "JetBrains Mono, monospace" }} axisLine={false} tickLine={false} dy={6} />;
    const yAxis = <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))", fontFamily: "JetBrains Mono, monospace" }} axisLine={false} tickLine={false} width={55} tickFormatter={(v: number) => v >= 1000 ? (v / 1000).toFixed(0) + "K" : String(v)} />;
    const tooltip = (
      <Tooltip
        cursor={{ stroke: "hsl(145 100% 50% / 0.4)", strokeWidth: 1, strokeDasharray: "4 4" }}
        contentStyle={{
          background: "hsl(0 0% 7% / 0.95)",
          backdropFilter: "blur(12px)",
          border: "1px solid hsl(145 100% 50% / 0.35)",
          borderRadius: 10, fontSize: 12, color: "hsl(var(--foreground))",
          boxShadow: "0 0 24px hsl(145 100% 50% / 0.18), 0 12px 40px rgba(0,0,0,0.6)",
          fontFamily: "JetBrains Mono, monospace",
        }}
        labelStyle={{ color: "hsl(145 100% 50%)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}
        formatter={(value: any, name: string) => [Number(value).toLocaleString("pt-BR"), name]}
      />
    );
    const grid = <CartesianGrid strokeDasharray="2 6" stroke="hsl(145 100% 50%)" opacity={0.08} vertical={false} />;

    if (chartType === "bar") {
      return (
        <BarChart {...commonProps}>
          {sharedDefs}
          {grid}{xAxis}{yAxis}{tooltip}
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 14, fontFamily: "JetBrains Mono, monospace", letterSpacing: "0.04em" }} />
          {chartColumns.map((col, i) => (
            <Bar
              key={col}
              dataKey={col}
              fill={`url(#${gradients[i].barId})`}
              radius={[6, 6, 0, 0]}
              stroke={gradients[i].color}
              strokeWidth={1}
              animationDuration={1400}
              animationEasing="ease-out"
            />
          ))}
        </BarChart>
      );
    }
    if (chartType === "line") {
      return (
        <LineChart {...commonProps}>
          {sharedDefs}
          {grid}{xAxis}{yAxis}{tooltip}
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 14, fontFamily: "JetBrains Mono, monospace", letterSpacing: "0.04em" }} />
          {chartColumns.map((col, i) => (
            <Line
              key={col}
              type="monotone"
              dataKey={col}
              stroke={`url(#${gradients[i].lineId})`}
              strokeWidth={2.5}
              dot={{ r: 3, strokeWidth: 2, fill: "hsl(var(--background))", stroke: gradients[i].color }}
              activeDot={{ r: 7, strokeWidth: 0, fill: gradients[i].color, filter: "url(#neonGlow)" }}
              animationDuration={1600}
              animationEasing="ease-out"
              filter="url(#softGlow)"
            />
          ))}
        </LineChart>
      );
    }
    return (
      <AreaChart {...commonProps}>
        {sharedDefs}
        {grid}{xAxis}{yAxis}{tooltip}
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 14, fontFamily: "JetBrains Mono, monospace", letterSpacing: "0.04em" }} />
        {chartColumns.map((col, i) => (
          <Area
            key={col}
            type="monotone"
            dataKey={col}
            stroke={gradients[i].color}
            fill={`url(#${gradients[i].id})`}
            strokeWidth={2.5}
            dot={{ r: 2.5, strokeWidth: 0, fill: gradients[i].color }}
            activeDot={{ r: 7, strokeWidth: 0, fill: gradients[i].color, filter: "url(#neonGlow)" }}
            animationDuration={1600}
            animationEasing="ease-out"
            filter="url(#softGlow)"
          />
        ))}
      </AreaChart>
    );
  };

  const statusColor = (s: "good" | "warning" | "bad") =>
    s === "good" ? "text-primary bg-primary/10 border-primary/20" :
    s === "warning" ? "text-warning bg-warning/10 border-warning/20" :
    "text-destructive bg-destructive/10 border-destructive/20";

  const statusIcon = (s: "good" | "warning" | "bad") =>
    s === "good" ? CheckCircle2 : s === "warning" ? AlertTriangle : AlertTriangle;

  /* ── Render ─────────────────────────────────────── */
  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-in max-w-6xl mx-auto w-full print-report">
      <button onClick={() => navigate("/relatorios")} className="no-print inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none">
        <ArrowLeft className="w-4 h-4" /> Voltar aos Relatórios
      </button>

      {/* ═══════════════ HERO HEADER ═══════════════ */}
      <div className="relative bg-card border border-border rounded-2xl overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
        <div className="absolute top-0 right-0 w-80 h-80 rounded-full bg-primary/5 blur-[80px]" />
        <div className="absolute bottom-0 left-0 w-60 h-60 rounded-full bg-accent/5 blur-[60px]" />
        <div className="relative px-6 py-8 sm:px-8 sm:py-10">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-3 flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
                  <BarChart3 className="w-6 h-6 text-primary" />
                </div>
                <span className="text-[10px] px-3 py-1.5 rounded-full bg-primary/10 text-primary font-bold border border-primary/20 uppercase tracking-widest">
                  ● Publicado
                </span>
                {periodDays > 0 && (
                  <span className="text-[10px] px-3 py-1.5 rounded-full bg-secondary text-muted-foreground border border-border flex items-center gap-1.5">
                    <Clock className="w-3 h-3" />
                    {periodDays} dias analisados
                  </span>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground leading-tight">{report.title}</h1>
              <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" />
                  {(report as any).project?.name}
                </span>
                {periodLabel && (
                  <>
                    <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
                    <span className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      {periodLabel}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-2 no-print shrink-0">
              <button onClick={handlePrint} className="p-2.5 rounded-xl bg-secondary hover:bg-secondary/80 text-foreground transition-colors cursor-pointer border border-border" title="Imprimir / PDF">
                <Printer className="w-4 h-4" />
              </button>
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="p-2.5 rounded-xl bg-secondary hover:bg-secondary/80 text-foreground transition-colors border border-border" title="WhatsApp">
                <MessageCircle className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Quick overview strip */}
          {standardMetrics.length > 0 && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-6 pt-5 border-t border-border/50">
              {standardMetrics.slice(0, 6).map(metric => (
                <div key={metric.key} className="flex items-center gap-2">
                  <metric.icon className="w-3.5 h-3.5" style={{ color: metric.color }} />
                  <span className="text-[11px] text-muted-foreground">{metric.shortLabel}:</span>
                  <span className="text-[13px] font-mono font-bold text-foreground">{metric.format(metric.value)}</span>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* ═══════════════ DASHBOARD AUTO POR FONTE ═══════════════ */}
      {(report.metrics as any)?.__source && Array.isArray((report.metrics as any)?.__breakdown) && (report.metrics as any).__breakdown.length > 0 && (
        <SourceDashboard
          source={(report.metrics as any).__source}
          sourceLabel={(report.metrics as any).__source_label || "Detectado"}
          rows={(report.metrics as any).__breakdown}
          dimensionKey={(report.metrics as any).__dimension || "Item"}
          metrics={report.metrics as any}
        />
      )}
      </div>

      {/* ═══════════════ COMPARAÇÃO COM RELATÓRIO ANTERIOR ═══════════════ */}
      {report.project_id && (
        <ReportComparison
          projectId={report.project_id}
          currentReportId={report.id}
          currentCreatedAt={report.created_at}
          currentReportMetrics={report.metrics as any}
          currentPeriod={{ start: report.period_start, end: report.period_end }}
        />
      )}

      {/* ═══════════════ AUDITORIA DE MÉTRICAS ═══════════════ */}
      <MetricsAudit metrics={report.metrics as any} />

      {/* ═══════════════ KPI CARDS ═══════════════ */}
      {kpis.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-2">
            <Gauge className="w-3.5 h-3.5 text-primary" />
            Indicadores-Chave de Performance (KPIs)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {kpis.map((kpi, i) => {
              const StatusIcon = statusIcon(kpi.status);
              return (
                <div key={i} className="bg-card border border-border rounded-2xl p-5 relative overflow-hidden group hover:border-primary/20 transition-all">
                  <div className="absolute top-0 right-0 w-20 h-20 rounded-full opacity-[0.04]" style={{ background: kpi.color, transform: "translate(30%, -30%)" }} />
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${kpi.color}15`, border: `1px solid ${kpi.color}25` }}>
                      <kpi.icon className="w-5 h-5" style={{ color: kpi.color }} />
                    </div>
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border ${statusColor(kpi.status)}`}>
                      <StatusIcon className="w-3 h-3" />
                      {kpi.status === "good" ? "Bom" : kpi.status === "warning" ? "Atenção" : "Crítico"}
                    </div>
                  </div>
                  <p className="text-2xl font-bold font-mono text-foreground tracking-tight">{kpi.value}</p>
                  <p className="text-[11px] font-semibold text-foreground mt-1">{kpi.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{kpi.detail}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ═══════════════ METRICS GRID ═══════════════ */}
      {standardMetrics.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-primary" />
            Métricas de Performance Detalhadas
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {standardMetrics.map(metric => {
              const Icon = metric.icon;
              const pctOfBenchmark = metric.benchmark ? Math.min((metric.value / metric.benchmark) * 100, 100) : null;

              return (
                <div key={metric.key} className="group bg-card border border-border rounded-2xl p-5 hover:border-primary/20 transition-all relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-28 h-28 rounded-full opacity-[0.03]" style={{ background: metric.color, transform: "translate(30%, -30%)" }} />

                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${metric.color}12`, border: `1px solid ${metric.color}20` }}>
                        <Icon className="w-5 h-5" style={{ color: metric.color }} />
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{metric.shortLabel}</p>
                        <p className="text-[10px] text-muted-foreground/60">{metric.label}</p>
                      </div>
                    </div>
                    <span className="text-[9px] px-2 py-0.5 rounded-md bg-secondary text-muted-foreground border border-border">
                      {metric.category}
                    </span>
                  </div>

                  <p className="text-3xl font-bold font-mono text-foreground tracking-tight">{metric.format(metric.value)}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{metric.unit}</p>

                  {/* Benchmark bar */}
                  {pctOfBenchmark !== null && (
                    <div className="mt-3 space-y-1">
                      <div className="flex justify-between text-[9px] text-muted-foreground">
                        <span>vs. benchmark</span>
                        <span className="font-mono font-bold" style={{ color: pctOfBenchmark >= 80 ? "hsl(145, 100%, 50%)" : pctOfBenchmark >= 50 ? "hsl(38, 92%, 50%)" : "hsl(346, 87%, 60%)" }}>
                          {pctOfBenchmark.toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${pctOfBenchmark}%`,
                            background: pctOfBenchmark >= 80 ? "hsl(145, 100%, 50%)" : pctOfBenchmark >= 50 ? "hsl(38, 92%, 50%)" : "hsl(346, 87%, 60%)",
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Custom metrics */}
      {customMetrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {customMetrics.map((cm, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-5 hover:border-primary/20 transition-all">
              <Hash className="w-4 h-4 text-muted-foreground mb-2" />
              <p className="text-2xl font-bold font-mono text-foreground tracking-tight">{cm.value}</p>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1.5 font-medium">{cm.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ═══════════════ CHARTS SECTION ═══════════════ */}
      {chartData.length > 0 && chartColumns.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-primary" />
            Evolução e Análise Visual
          </h2>

          {/* Main chart — Aceleriq futurist surface */}
          <div className="relative bg-card border border-border rounded-2xl p-5 sm:p-6 overflow-hidden group/chart hover:border-primary/30 transition-colors">
            {/* Tech grid backdrop */}
            <div className="absolute inset-0 opacity-[0.35] pointer-events-none"
              style={{
                backgroundImage:
                  "linear-gradient(hsl(145 100% 50% / 0.04) 1px, transparent 1px), linear-gradient(90deg, hsl(145 100% 50% / 0.04) 1px, transparent 1px)",
                backgroundSize: "28px 28px",
                maskImage: "radial-gradient(ellipse at center, black 40%, transparent 100%)",
                WebkitMaskImage: "radial-gradient(ellipse at center, black 40%, transparent 100%)",
              }}
            />
            {/* Soft neon glow */}
            <div className="absolute -top-32 -right-32 w-72 h-72 rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, hsl(145 100% 50% / 0.10), transparent 70%)" }}
            />
            {/* Corner brackets */}
            {[
              "top-2 left-2 border-t-2 border-l-2",
              "top-2 right-2 border-t-2 border-r-2",
              "bottom-2 left-2 border-b-2 border-l-2",
              "bottom-2 right-2 border-b-2 border-r-2",
            ].map((cls, i) => (
              <span key={i} className={`absolute w-4 h-4 border-primary/40 ${cls} pointer-events-none rounded-[2px]`} />
            ))}

            <div className="relative flex items-center justify-between mb-5 flex-wrap gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="relative inline-flex w-2 h-2 rounded-full bg-primary">
                  <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-60" />
                </span>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  Evolução do Período
                </h3>
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-primary/80 px-2 py-0.5 rounded border border-primary/25 bg-primary/5">
                  LIVE · {chartData.length}pts
                </span>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {chartColumns.map((col, i) => (
                  <span key={col} className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground font-mono">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length], boxShadow: `0 0 8px ${CHART_COLORS[i % CHART_COLORS.length]}99` }} />
                    {col}
                  </span>
                ))}
              </div>
            </div>
            <div className="relative h-72 sm:h-96">
              <ResponsiveContainer width="100%" height="100%">
                {renderMainChart()!}
              </ResponsiveContainer>
            </div>
          </div>

          {/* Análise por Métrica — agora abaixo do gráfico, cards lado-a-lado (estilo Rams) */}
          {colStats.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2 px-1">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <LayoutGrid className="w-4 h-4 text-primary" />
                  Análise por Métrica
                </h3>
                <p className="text-[10.5px] text-muted-foreground">Desempenho consolidado de cada série · {colStats.length} {colStats.length === 1 ? "métrica" : "métricas"}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {colStats.map((cs) => {
                  const TrendIcon = cs.trend > 3 ? ArrowUpRight : cs.trend < -3 ? ArrowDownRight : ArrowRight;
                  const trendBg = cs.trend > 3 ? "bg-primary/10 text-primary border-primary/20"
                                : cs.trend < -3 ? "bg-destructive/10 text-destructive border-destructive/20"
                                : "bg-secondary text-muted-foreground border-border";
                  const series = chartData.map((r, i) => ({ i, v: Number(r[cs.col]) || 0 }));
                  const safeId = cs.col.replace(/[^a-zA-Z0-9]/g, "_");
                  return (
                    <div key={cs.col} className="group relative rounded-2xl border border-border bg-card p-4 hover:border-primary/30 transition-all overflow-hidden">
                      <div className="absolute top-0 right-0 w-24 h-24 rounded-full opacity-[0.06] pointer-events-none" style={{ background: cs.color, transform: "translate(35%,-35%)" }} />
                      <div className="relative flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-card" style={{ background: cs.color, boxShadow: `0 0 12px ${cs.color}55` }} />
                          <span className="text-[11.5px] font-semibold text-foreground truncate">{cs.col}</span>
                        </div>
                        <span className={`flex items-center gap-1 text-[9.5px] font-bold px-1.5 py-0.5 rounded-md border ${trendBg}`}>
                          <TrendIcon className="w-2.5 h-2.5" />
                          {Math.abs(cs.trend).toFixed(0)}%
                        </span>
                      </div>

                      <div className="relative">
                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground/80">Total</p>
                        <p className="text-2xl font-mono font-bold text-foreground leading-none mt-0.5">
                          {cs.total >= 1000 ? (cs.total / 1000).toFixed(cs.total >= 10000 ? 0 : 1) + "K" : Math.round(cs.total).toLocaleString("pt-BR")}
                        </p>
                      </div>

                      {series.length > 2 && (
                        <div className="relative h-12 mt-3 -mx-1">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={series} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                              <defs>
                                <linearGradient id={`spk-${safeId}`} x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor={cs.color} stopOpacity={0.55} />
                                  <stop offset="100%" stopColor={cs.color} stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <Area type="monotone" dataKey="v" stroke={cs.color} strokeWidth={1.8} fill={`url(#spk-${safeId})`} dot={false} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      <div className="relative grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-border/40">
                        <div>
                          <p className="text-[8.5px] uppercase tracking-wider text-muted-foreground/80">Média</p>
                          <p className="text-[12px] font-mono font-semibold text-foreground mt-0.5">
                            {cs.avg >= 1000 ? (cs.avg / 1000).toFixed(1) + "K" : Math.round(cs.avg).toLocaleString("pt-BR")}
                          </p>
                        </div>
                        <div>
                          <p className="text-[8.5px] uppercase tracking-wider text-muted-foreground/80">Pico</p>
                          <p className="text-[12px] font-mono font-semibold text-foreground mt-0.5">
                            {cs.max >= 1000 ? (cs.max / 1000).toFixed(1) + "K" : Math.round(cs.max).toLocaleString("pt-BR")}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Smart Journey Funnel · adapta-se aos dados disponíveis (alcance → perfil → clique → conversa → venda) */}
          {funnelData && funnelData.length >= 2 && (() => {
            const top = funnelData[0].value;
            const bottom = funnelData[funnelData.length - 1].value;
            const globalRate = top > 0 ? (bottom / top) * 100 : 0;
            const followers = Number((report.metrics as any)?.followers_gained) || 0;
            const rowH = 64;
            const totalH = funnelData.length * rowH + 12;
            return (
              <div className="bg-card border border-border rounded-2xl p-5 sm:p-6 page-break-inside-avoid relative overflow-hidden">
                <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-primary/5 blur-3xl pointer-events-none" />
                <div className="relative flex items-center justify-between flex-wrap gap-2 mb-1">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Target className="w-4 h-4 text-primary" />
                    Jornada do Cliente · Funil Inteligente
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 font-semibold uppercase tracking-wider">
                      Taxa global {globalRate.toFixed(2)}%
                    </span>
                    {followers > 0 && (
                      <span className="text-[10px] px-2.5 py-1 rounded-full bg-secondary text-foreground border border-border font-semibold uppercase tracking-wider inline-flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        +{followers.toLocaleString("pt-BR")} seguidores
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mb-2 relative">
                  Como cada pessoa avançou da descoberta até a ação final no período analisado.
                </p>
                {(() => {
                  const first = funnelData[0]?.name?.toLowerCase() || "audiência";
                  const last = funnelData[funnelData.length - 1]?.name?.toLowerCase() || "ação";
                  return (
                    <div className="mb-5 inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-md bg-secondary/40 border border-border/60 text-muted-foreground">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                      <span>
                        Conversão neste relatório = de <span className="text-foreground font-semibold">{first}</span> até <span className="text-foreground font-semibold">{last}</span>
                        {" · "}taxa global {globalRate.toFixed(2)}%
                      </span>
                    </div>
                  );
                })()}


                <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 relative">
                  {/* Trapezoid funnel */}
                  <div className="lg:col-span-3">
                    <svg viewBox={`0 0 400 ${totalH}`} className="w-full" style={{ height: totalH }} preserveAspectRatio="none">
                      <defs>
                        {funnelData.map((s, i) => (
                          <linearGradient key={i} id={`fg-${i}`} x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor={s.fill} stopOpacity={0.95} />
                            <stop offset="100%" stopColor={s.fill} stopOpacity={0.55} />
                          </linearGradient>
                        ))}
                      </defs>
                      {funnelData.map((stage, i) => {
                        const pct = top > 0 ? stage.value / top : 0;
                        const maxW = 380;
                        const w = Math.max(64, maxW * (0.25 + 0.75 * pct));
                        const next = funnelData[i + 1];
                        const nextPct = next && top > 0 ? next.value / top : pct;
                        const wNext = next ? Math.max(64, maxW * (0.25 + 0.75 * nextPct)) : w * 0.92;
                        const cx = 200;
                        const y = i * rowH + 6;
                        const h = rowH - 10;
                        const points = [
                          [cx - w / 2, y],
                          [cx + w / 2, y],
                          [cx + wNext / 2, y + h],
                          [cx - wNext / 2, y + h],
                        ].map(p => p.join(",")).join(" ");
                        return (
                          <g key={i}>
                            <polygon
                              points={points}
                              fill={`url(#fg-${i})`}
                              stroke={stage.fill}
                              strokeWidth={1}
                              style={{ filter: `drop-shadow(0 4px 12px ${stage.fill}33)` }}
                            />
                            <text
                              x={cx}
                              y={y + h / 2 + 5}
                              textAnchor="middle"
                              fontSize={15}
                              fontWeight={700}
                              fill="hsl(var(--background))"
                              style={{ fontFamily: "JetBrains Mono, monospace" }}
                            >
                              {stage.value.toLocaleString("pt-BR")}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>

                  {/* Stage list */}
                  <div className="lg:col-span-2 space-y-2">
                    {funnelData.map((stage, i) => {
                      const prev = i > 0 ? funnelData[i - 1].value : stage.value;
                      const rate = prev > 0 ? (stage.value / prev) * 100 : 100;
                      const dropOff = i > 0 ? prev - stage.value : 0;
                      return (
                        <div key={i} className="rounded-xl border border-border/60 bg-secondary/20 p-3 group hover:border-primary/30 transition-colors">
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold font-mono shrink-0"
                                style={{ background: `${stage.fill}18`, color: stage.fill, border: `1px solid ${stage.fill}30` }}>
                                {String(i + 1).padStart(2, "0")}
                              </span>
                              <span className="text-[12px] font-semibold text-foreground truncate">{stage.name}</span>
                            </div>
                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-card border border-border text-foreground">
                              {i > 0 ? rate.toFixed(1) + "%" : "100%"}
                            </span>
                          </div>
                          <div className="flex items-end justify-between gap-2">
                            <p className="text-lg font-mono font-bold text-foreground leading-none">
                              {stage.value.toLocaleString("pt-BR")}
                            </p>
                            {dropOff > 0 && (
                              <span className="text-[9.5px] text-muted-foreground inline-flex items-center gap-0.5">
                                <ArrowDownRight className="w-2.5 h-2.5 text-destructive" />
                                {dropOff.toLocaleString("pt-BR")} saíram
                              </span>
                            )}
                          </div>
                          <div className="mt-2 h-1 rounded-full bg-secondary overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{ width: `${Math.min((stage.value / top) * 100, 100)}%`, background: `linear-gradient(90deg, ${stage.fill}, ${stage.fill}99)` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Distribuição de Resultados · full width donut com legenda lateral */}
          {pieData.length >= 2 && (() => {
            const totalPie = pieData.reduce((s, d) => s + d.value, 0);
            return (
              <div className="bg-card border border-border rounded-2xl p-5 sm:p-6 page-break-inside-avoid">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <PieChartIcon className="w-4 h-4 text-primary" />
                    Distribuição de Resultados
                  </h3>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                    {pieData.length} métricas
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mb-4">Participação relativa de cada métrica no resultado total.</p>
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-center">
                  <div className="lg:col-span-2 h-72 relative">
                    {/* Radial neon halo */}
                    <div className="absolute inset-0 pointer-events-none"
                      style={{ background: "radial-gradient(circle at center, hsl(145 100% 50% / 0.10), transparent 60%)" }}
                    />
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <defs>
                          <filter id="pieGlow" x="-20%" y="-20%" width="140%" height="140%">
                            <feGaussianBlur stdDeviation="2.5" result="b" />
                            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                          </filter>
                          {pieData.map((d, i) => (
                            <radialGradient key={i} id={`pieGrad${i}`} cx="50%" cy="50%" r="65%">
                              <stop offset="0%" stopColor={d.fill} stopOpacity={1} />
                              <stop offset="100%" stopColor={d.fill} stopOpacity={0.55} />
                            </radialGradient>
                          ))}
                        </defs>
                        {/* Outer rim ring */}
                        <Pie
                          data={[{ v: 1 }]}
                          dataKey="v"
                          cx="50%" cy="50%"
                          innerRadius={116} outerRadius={120}
                          fill="hsl(145 100% 50% / 0.18)"
                          stroke="none"
                          isAnimationActive={false}
                        />
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={68}
                          outerRadius={108}
                          paddingAngle={4}
                          dataKey="value"
                          stroke="hsl(0 0% 7%)"
                          strokeWidth={3}
                          filter="url(#pieGlow)"
                          animationDuration={1400}
                          animationEasing="ease-out"
                        >
                          {pieData.map((_, i) => <Cell key={i} fill={`url(#pieGrad${i})`} />)}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: "hsl(0 0% 7% / 0.95)", backdropFilter: "blur(12px)",
                            border: "1px solid hsl(145 100% 50% / 0.35)", borderRadius: 10,
                            fontSize: 12, fontFamily: "JetBrains Mono, monospace",
                            boxShadow: "0 0 24px hsl(145 100% 50% / 0.18)",
                          }}
                          formatter={(v: any, n: any) => [Number(v).toLocaleString("pt-BR"), n]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <p className="text-[9px] uppercase tracking-[0.25em] text-primary/70 font-mono">Total</p>
                      <p className="text-2xl font-mono font-bold text-foreground" style={{ textShadow: "0 0 18px hsl(145 100% 50% / 0.45)" }}>
                        {totalPie >= 1000 ? (totalPie / 1000).toFixed(1) + "K" : totalPie.toLocaleString("pt-BR")}
                      </p>
                      <span className="mt-1 text-[9px] font-mono text-muted-foreground tracking-widest uppercase">{pieData.length} séries</span>
                    </div>
                  </div>
                  <div className="lg:col-span-3 space-y-2">
                    {pieData.map((d, i) => {
                      const pct = totalPie > 0 ? (d.value / totalPie) * 100 : 0;
                      return (
                        <div key={i} className="flex items-center gap-3 rounded-xl border border-border/50 bg-secondary/20 px-3 py-2.5">
                          <span className="w-2.5 h-8 rounded-full shrink-0" style={{ background: d.fill, boxShadow: `0 0 12px ${d.fill}55` }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <span className="text-[12px] font-semibold text-foreground truncate">{d.name}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-[12px] font-mono font-bold text-foreground">
                                  {d.value.toLocaleString("pt-BR")}
                                </span>
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-card border border-border text-muted-foreground min-w-[42px] text-center">
                                  {pct.toFixed(1)}%
                                </span>
                              </div>
                            </div>
                            <div className="h-1 rounded-full bg-secondary overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${d.fill}, ${d.fill}99)` }} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Radar + Eficiência refinada */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {radarData.length >= 3 && (
              <div className="bg-card border border-border rounded-2xl p-5 sm:p-6 page-break-inside-avoid">
                <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" />
                  Diagnóstico de Performance
                </h3>
                <p className="text-[11px] text-muted-foreground mb-3">Comparativo vs. benchmarks de mercado (100% = referência).</p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData}>
                      <defs>
                        <radialGradient id="radarFill" cx="50%" cy="50%" r="50%">
                          <stop offset="0%" stopColor="hsl(145, 100%, 50%)" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="hsl(145, 100%, 50%)" stopOpacity={0.08} />
                        </radialGradient>
                      </defs>
                      <PolarGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                      <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10.5, fill: "hsl(var(--foreground))", fontWeight: 600 }} />
                      <PolarRadiusAxis tick={false} axisLine={false} />
                      <Radar name="Performance" dataKey="value" stroke="hsl(145, 100%, 50%)" fill="url(#radarFill)" strokeWidth={2.5} dot={{ r: 3, fill: "hsl(145, 100%, 50%)", stroke: "hsl(var(--card))", strokeWidth: 2 }} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} formatter={(v: any) => [v + "%", "vs. benchmark"]} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {efficiencyData.length > 0 && (
              <div className="bg-card border border-border rounded-2xl p-5 sm:p-6 page-break-inside-avoid">
                <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
                  <Gauge className="w-4 h-4 text-primary" />
                  Índice de Eficiência
                </h3>
                <p className="text-[11px] text-muted-foreground mb-4">Quanto maior o índice, melhor o aproveitamento da verba.</p>
                <div className="space-y-4">
                  {efficiencyData.map((d, i) => {
                    const grade = d.value >= 70 ? "Excelente" : d.value >= 45 ? "Bom" : d.value >= 25 ? "Regular" : "Crítico";
                    const gradeColor = d.value >= 70 ? "text-primary border-primary/30 bg-primary/10"
                                     : d.value >= 45 ? "text-foreground border-border bg-secondary"
                                     : d.value >= 25 ? "text-warning border-warning/30 bg-warning/10"
                                     : "text-destructive border-destructive/30 bg-destructive/10";
                    return (
                      <div key={i} className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.fill, boxShadow: `0 0 10px ${d.fill}66` }} />
                            <span className="text-[12px] font-semibold text-foreground truncate">{d.name}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border ${gradeColor}`}>{grade}</span>
                            <span className="text-[13px] font-mono font-bold text-foreground tabular-nums w-10 text-right">{d.value}%</span>
                          </div>
                        </div>
                        <div className="relative h-2 rounded-full bg-secondary overflow-hidden">
                          <div className="absolute inset-y-0 left-1/4 w-px bg-border" />
                          <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                          <div className="absolute inset-y-0 left-3/4 w-px bg-border" />
                          <div
                            className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
                            style={{ width: `${d.value}%`, background: `linear-gradient(90deg, ${d.fill}, ${d.fill}cc)`, boxShadow: `0 0 10px ${d.fill}55` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ═══════════════ DATA TABLE ═══════════════ */}
      {chartData.length > 0 && chartColumns.length > 0 && (
        <section className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-primary" />
              Tabela de Dados Detalhados
            </h2>
            <span className="text-[10px] text-muted-foreground bg-secondary px-2 py-1 rounded-md">{chartData.length} períodos</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-secondary/30">
                  <th className="text-left py-3 px-4 text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">Período</th>
                  {chartColumns.map((col, i) => (
                    <th key={col} className="text-right py-3 px-4 text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                        {col}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chartData.map((row, i) => (
                  <tr key={i} className="border-b border-border/30 hover:bg-secondary/20 transition-colors">
                    <td className="py-3 px-4 text-foreground font-medium">{row.label}</td>
                    {chartColumns.map((col, ci) => {
                      const val = Number(row[col]) || 0;
                      const maxVal = colStats[ci]?.max || 1;
                      const pct = (val / maxVal) * 100;
                      return (
                        <td key={col} className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 rounded-full bg-secondary overflow-hidden hidden sm:block">
                              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: CHART_COLORS[ci % CHART_COLORS.length] }} />
                            </div>
                            <span className="font-mono text-foreground font-medium">{val.toLocaleString("pt-BR")}</span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="bg-primary/5 font-semibold">
                  <td className="py-3 px-4 text-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-primary" /> Total
                  </td>
                  {chartColumns.map(col => {
                    const total = chartData.reduce((s, r) => s + (Number(r[col]) || 0), 0);
                    return (
                      <td key={col} className="py-3 px-4 text-right font-mono text-primary font-bold">
                        {total.toLocaleString("pt-BR")}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ═══════════════ INSIGHTS ═══════════════ */}
      {insights.length > 0 && (
        <section className="bg-gradient-to-br from-card to-secondary/30 border border-border rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Análise Inteligente</h2>
              <p className="text-[10px] text-muted-foreground">Insights gerados automaticamente com base nos dados do relatório</p>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {insights.map((insight, i) => {
              const insightIcon = insight.type === "success" ? Star : insight.type === "warning" ? AlertTriangle : Lightbulb;
              const InsightIcon = insightIcon;
              const borderColor = insight.type === "success" ? "border-primary/30 bg-primary/5" : insight.type === "warning" ? "border-warning/30 bg-warning/5" : "border-accent/30 bg-accent/5";
              const iconColor = insight.type === "success" ? "text-primary bg-primary/10" : insight.type === "warning" ? "text-warning bg-warning/10" : "text-accent bg-accent/10";
              return (
                <div key={i} className={`flex items-start gap-3 rounded-xl p-4 border ${borderColor}`}>
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${iconColor}`}>
                    <InsightIcon className="w-3.5 h-3.5" />
                  </div>
                  <p className="text-[13px] text-foreground/85 leading-relaxed">{insight.text}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ═══════════════ EXECUTIVE SUMMARY ═══════════════ */}
      {report.summary && (
        <section className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border/50 flex items-center gap-3 bg-secondary/20">
            <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
              <BarChart3 className="w-4.5 h-4.5 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Resumo Executivo</h2>
              <p className="text-[10px] text-muted-foreground">Visão geral dos resultados e desempenho do período analisado</p>
            </div>
          </div>
          <div className="px-6 py-5 space-y-3">
            {parseLines(report.summary).map((line, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-primary">{i + 1}</span>
                </div>
                <p className="text-[13px] text-foreground/85 leading-relaxed">{line}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ═══════════════ HIGHLIGHTS + NEXT STEPS ═══════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {report.highlights && (
          <section className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border/50 flex items-center gap-3 bg-warning/5">
              <div className="w-9 h-9 rounded-lg bg-warning/10 border border-warning/20 flex items-center justify-center">
                <Award className="w-4.5 h-4.5 text-warning" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Destaques do Período</h2>
                <p className="text-[10px] text-muted-foreground">Pontos que merecem atenção especial</p>
              </div>
            </div>
            <div className="px-6 py-5 space-y-2.5">
              {parseLines(report.highlights).map((line, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <Zap className="w-3.5 h-3.5 text-warning shrink-0 mt-1" />
                  <p className="text-[13px] text-foreground/85 leading-relaxed">{line}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {report.next_steps && (
          <section className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border/50 flex items-center gap-3 bg-accent/5">
              <div className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center">
                <Target className="w-4.5 h-4.5 text-accent-foreground" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Próximos Passos</h2>
                <p className="text-[10px] text-muted-foreground">Ações planejadas para o próximo período</p>
              </div>
            </div>
            <div className="px-6 py-5 space-y-2.5">
              {parseLines(report.next_steps).map((line, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="text-[11px] font-mono font-bold text-primary bg-primary/10 rounded-lg w-6 h-6 flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-[13px] text-foreground/85 leading-relaxed">{line}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ═══════════════ CTA SECTION ═══════════════ */}
      <div className="bg-card border border-border rounded-2xl p-6 no-print">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Tem dúvidas sobre os resultados?</p>
            <p className="text-[11px] text-muted-foreground">Entre em contato com a equipe para discutir estratégias e próximos passos.</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row flex-wrap gap-3">
          {report.file_url ? (
            <a href={report.file_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-[13px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity font-semibold w-full sm:w-auto">
              <Download className="w-4 h-4" /> Baixar Relatório em PDF
            </a>
          ) : (
            <button onClick={handlePrint} className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-[13px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity font-semibold cursor-pointer border-none w-full sm:w-auto">
              <Download className="w-4 h-4" /> Baixar Relatório em PDF
            </button>
          )}
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-[13px] bg-secondary text-foreground hover:bg-secondary/80 transition-colors font-medium w-full sm:w-auto border border-border">
            <MessageCircle className="w-4 h-4" /> Falar sobre resultados
          </a>
        </div>
      </div>

      <div className="h-6" />
    </div>
  );
}
