import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import ClientPlainSummary from "@/components/reports/ClientPlainSummary";
import RichText from "@/components/shared/RichText";
import RitualEstruturado from "@/components/client/RitualEstruturado";
import { estruturaDoRitual } from "@/lib/ritualTexto";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowLeft, Download, MessageCircle, TrendingUp,
  BarChart3, Target, Zap, Eye, MousePointerClick, Users, DollarSign,
  Printer, ArrowUpRight, ArrowDownRight,
  FileText, Activity, Award, CheckCircle2,
  LayoutGrid, ArrowRight, Star, Lightbulb, AlertTriangle,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";
import SourceDashboard from "@/components/reports/SourceDashboard";
import ReportComparison from "@/components/reports/ReportComparison";
import MetricsAudit from "@/components/reports/MetricsAudit";
import { CelulaDeNumero, FaixaDeNumeros } from "@/components/sistema";
import {
  AjudaRecolhida,
  CabecalhoDePagina,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  Painel,
  Secao,
  botao,
  etiqueta,
  foco,
  juntar,
  texto,
} from "@/components/sistema";
import { useResolvedFileUrl } from "@/lib/fileUrls";
import { supportWhatsAppUrl } from "@/lib/supportContact";

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

/** "2026-08-01" vira data local (sem o fuso puxar para o dia anterior). */
function dataLocal(d: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(d);
}

function fmtDataCurta(d: string) {
  if (!d) return "";
  return dataLocal(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const fmtContagem = (v: number) =>
  v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "K" : Math.round(v).toLocaleString("pt-BR");

/** Situação do indicador: cor e nome. */
const SITUACAO = {
  good: { rotulo: "Excelente", classe: "bg-primary/10 text-primary" },
  warning: { rotulo: "Em otimização", classe: "bg-warning/10 text-warning" },
  bad: { rotulo: "Em ajuste", classe: "bg-destructive/10 text-destructive" },
} as const;

/** Tooltip dos gráficos: a superfície do painel, sem brilho. */
const estiloDaDica = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
  color: "hsl(var(--foreground))",
};
const eixo = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

export default function ReportDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  // O cliente lê a versão em linguagem simples; a técnica fica para a equipe.
  const isClientView = profile?.role === "client";

  const { data: report, isLoading, isError, refetch } = useQuery({
    queryKey: ["report-detail", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reports")
        .select("id, project_id, client_id, title, period_start, period_end, metrics, summary, file_url, status, created_by, created_at, highlights, next_steps, chart_type, chart_data, images, project:projects(name)")
        .eq("id", id!)
        .single();
      // Sem linha (ou endereço com id inválido) é "não encontrado"; o resto é
      // falha de rede e ganha "Tentar de novo".
      if (error && error.code !== "PGRST116" && error.code !== "22P02") throw error;
      return data;
    },
    enabled: !!id,
  });
  const { url: reportFileUrl, loading: reportFileLoading } = useResolvedFileUrl({
    fileUrl: report?.file_url,
  });

  // ── Relatório anterior do MESMO projeto (para comparação de seguidores etc.)
  const { data: previousReport } = useQuery({
    queryKey: ["report-detail-previous", id, report?.project_id, report?.created_at],
    queryFn: async () => {
      const { data } = await supabase
        .from("reports")
        .select("id, period_start, period_end, metrics, created_at")
        .eq("project_id", report!.project_id)
        .lt("created_at", report!.created_at)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!report?.project_id && !!report?.created_at,
  });

  /* ── Derived data ─────────────────────────────── */
  const analysis = useMemo(() => {
    if (!report) return null;

    const m = { ...((report.metrics || {}) as Record<string, any>) };
    const prevM = (previousReport?.metrics || {}) as Record<string, any>;
    const prevNum = (k: string) => Number(prevM[k]) || 0;

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
      chartColumns = Object.keys(rawChartData[0]).filter((k) => {
        if (k === "label") return false;
        // Serie sem valor no periodo nao entra: zero espalhado passa imagem ruim.
        return rawChartData.some((row) => Number(row[k]) > 0);
      });
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
        icon: MessageCircle, color: "hsl(142, 71%, 45%)", status: v < 25 ? "good" : v < 60 ? "warning" : "bad" });
    }
    if (spend > 0 && traffic > 0) {
      const v = spend / traffic;
      kpis.push({ label: "Custo por Clique", value: fmtR(v), detail: `${traffic.toLocaleString("pt-BR")} cliques no período`,
        icon: MousePointerClick, color: "hsl(200, 100%, 50%)", status: v < 3.5 ? "good" : v < 8 ? "warning" : "bad" });
    }
    if (reachVal > 0 && spend > 0) {
      const v = (spend / reachVal) * 1000;
      kpis.push({ label: "CPM", value: fmtR(v), detail: `Custo para alcançar 1.000 pessoas`,
        icon: Eye, color: "hsl(263, 70%, 66%)", status: v < 25 ? "good" : v < 60 ? "warning" : "bad" });
    }
    if (num("profile_visits") > 0 && reachVal > 0) {
      const r = (num("profile_visits") / reachVal) * 100;
      kpis.push({ label: "Taxa Perfil/Alcance", value: r.toFixed(2) + "%", detail: `${num("profile_visits").toLocaleString("pt-BR")} visitas vs. alcance`,
        icon: Target, color: "hsl(190, 90%, 50%)", status: r > 1 ? "good" : r > 0.3 ? "warning" : "bad" });
    }
    if (num("profile_visits") > 0 && contact > 0) {
      const r = (contact / num("profile_visits")) * 100;
      kpis.push({ label: "Perfil → Conversa", value: r.toFixed(1) + "%", detail: `${contact} de ${num("profile_visits").toLocaleString("pt-BR")} visitantes converteram`,
        icon: ArrowRight, color: "hsl(145, 100%, 50%)", status: r > 5 ? "good" : r > 1.5 ? "warning" : "bad" });
    }
    if (spend > 0 && num("purchases") > 0) {
      const v = spend / num("purchases");
      kpis.push({ label: "Custo por Compra", value: fmtR(v), detail: `${num("purchases")} vendas geradas`,
        icon: Award, color: "hsl(50, 95%, 55%)", status: v < 80 ? "good" : v < 250 ? "warning" : "bad" });
    }
    if (num("roas") > 0) {
      const v = num("roas");
      kpis.push({ label: "ROAS", value: v.toFixed(2) + "x", detail: `Retorno sobre o investimento publicitário`,
        icon: TrendingUp, color: "hsl(60, 90%, 50%)", status: v > 2 ? "good" : v > 1 ? "warning" : "bad" });
    }
    // ── Crescimento de Seguidores (vs período anterior) ──
    const fg = num("followers_gained");
    if (fg > 0) {
      const prevFg = prevNum("followers_gained");
      const days = report.period_start && report.period_end ? Math.max(1, daysBetween(report.period_start, report.period_end)) : 1;
      const perDay = fg / days;
      let detail = `${fg.toLocaleString("pt-BR")} novos seguidores em ${days} ${days === 1 ? "dia" : "dias"} · ${perDay.toFixed(1)}/dia`;
      if (prevFg > 0) {
        const mult = fg / prevFg;
        const deltaPct = ((fg - prevFg) / prevFg) * 100;
        if (mult >= 2) detail = `${fg} agora vs ${prevFg} no período anterior · crescimento de ${mult.toFixed(1)}x (+${deltaPct.toFixed(0)}%)`;
        else if (deltaPct >= 0) detail = `${fg} agora vs ${prevFg} no período anterior · +${deltaPct.toFixed(0)}% de aceleração`;
        else detail = `${fg} agora vs ${prevFg} no período anterior · momento de reativar conteúdo`;
      } else if (previousReport) {
        detail = `${fg.toLocaleString("pt-BR")} novos seguidores · primeiro ciclo com captação registrada`;
      }
      // Crescimento orgânico é quase sempre positivo: any growth = good, declínio severo = warning
      const status: "good" | "warning" | "bad" =
        prevFg > 0 && fg < prevFg * 0.4 ? "warning" : "good";
      kpis.push({
        label: "Novos Seguidores",
        value: "+" + fg.toLocaleString("pt-BR"),
        detail,
        icon: Users,
        color: "hsl(188, 94%, 50%)",
        status,
      });
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
  }, [report, previousReport]);

  // Documento: a página rola normal (nada de área com altura fixa, que
  // cortaria a impressão). Na impressão, borda e poço ficam claros e o "?"
  // some.
  const raiz = "print-report min-w-0 space-y-4 print:bg-white print:[--foreground:0_0%_7%] print:[--muted-foreground:0_0%_35%] print:[--card:0_0%_100%] print:[--border:0_0%_88%] print:[--muted:0_0%_94%] print:[&_[data-ajuda-recolhida]]:hidden";
  const voltar = () => (window.history.length > 1 ? navigate(-1) : navigate("/relatorios"));
  const botaoVoltar = (
    <button
      type="button"
      onClick={voltar}
      className={juntar("no-print mb-1 inline-flex items-center rounded text-[12px] text-muted-foreground transition-colors hover:text-foreground", foco)}
    >
      <ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
      Voltar
    </button>
  );

  if (isLoading) {
    return (
      <div className={raiz}>
        {botaoVoltar}
        <Carregando forma="aba" rotulo="Carregando relatório" />
      </div>
    );
  }

  if (isError && !report) {
    return (
      <div className={raiz}>
        {botaoVoltar}
        <EstadoDeErro
          titulo="Não foi possível abrir o relatório."
          acao={
            <button type="button" onClick={() => refetch()} className={botao.secundario}>
              Tentar de novo
            </button>
          }
        />
      </div>
    );
  }

  if (!report || !analysis) {
    return (
      <div className={raiz}>
        {botaoVoltar}
        <EstadoVazio
          icone={<FileText className="h-5 w-5" />}
          titulo="Relatório não encontrado"
          descricao="Ele pode ter sido removido ou não estar disponível para você."
          acao={
            <button type="button" onClick={() => navigate("/relatorios")} className={botao.secundario}>
              Ver relatórios
            </button>
          }
        />
      </div>
    );
  }

  const { standardMetrics, customMetrics, chartData, chartType, chartColumns, colStats, pieData, radarData, efficiencyData, funnelData, kpis, insights, periodDays, categories } = analysis;

  const metricas = (report.metrics || {}) as Record<string, any>;
  const publicado = report.status === "published";
  const descricao = [
    !isClientView ? (publicado ? "Publicado" : "Rascunho") : null,
    (report as any).project?.name || null,
    report.period_start && report.period_end ? `${fmtDataCurta(report.period_start)} a ${fmtDataCurta(report.period_end)}` : null,
    periodDays > 0 ? `${periodDays} dias` : null,
  ].filter(Boolean).join(" · ");

  const whatsappMsg = `Olá! Vi o relatório "${report.title}" e gostaria de conversar sobre os resultados.`;
  const whatsappUrl = supportWhatsAppUrl(whatsappMsg);
  const handlePrint = () => window.print();
  const temAnexo = !!report.file_url;

  // Ações na linha do título (o bloco repetido do pé saiu): conversar,
  // imprimir/salvar PDF e, se houver, baixar o anexo. Um primário só.
  const acoes = (
    <div className="no-print flex items-center [&>*+*]:ml-2">
      {whatsappUrl && (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={botao.secundario}
          aria-label="Falar sobre os resultados no WhatsApp"
          title="Falar sobre os resultados"
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          <span className="ml-1.5 hidden sm:inline">Falar sobre resultados</span>
        </a>
      )}
      <button
        type="button"
        onClick={handlePrint}
        className={temAnexo ? botao.secundario : botao.primario}
        aria-label="Imprimir ou salvar em PDF"
        title="Imprimir ou salvar em PDF"
      >
        <Printer className="h-4 w-4" aria-hidden="true" />
        <span className="ml-1.5 hidden sm:inline">{temAnexo ? "Imprimir" : "Salvar PDF"}</span>
      </button>
      {temAnexo && (
        <a
          href={reportFileUrl || undefined}
          aria-disabled={reportFileLoading || !reportFileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={juntar(botao.primario, "aria-disabled:pointer-events-none aria-disabled:opacity-50")}
          aria-label="Baixar o relatório em PDF"
          title="Baixar o relatório em PDF"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          <span className="ml-1.5 hidden sm:inline">{reportFileLoading ? "Preparando" : "Baixar PDF"}</span>
        </a>
      )}
    </div>
  );

  /* ── Gráfico principal: tipo, séries e cores de sempre, sem brilho ── */
  const renderMainChart = () => {
    if (chartData.length === 0 || chartColumns.length === 0) return null;
    const cor = (i: number) => CHART_COLORS[i % CHART_COLORS.length];
    const commonProps = { data: chartData, margin: { top: 8, right: 16, left: 0, bottom: 4 } };
    const grid = <CartesianGrid stroke="hsl(var(--border))" vertical={false} />;
    const xAxis = <XAxis dataKey="label" tick={eixo} axisLine={false} tickLine={false} dy={6} />;
    const yAxis = <YAxis tick={eixo} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => v >= 1000 ? (v / 1000).toFixed(0) + "K" : String(v)} />;
    const tooltip = (
      <Tooltip
        cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
        contentStyle={estiloDaDica}
        itemStyle={{ color: "hsl(var(--foreground))" }}
        labelStyle={{ color: "hsl(var(--muted-foreground))", fontSize: 11, marginBottom: 4 }}
        formatter={(value: any, name: string) => [Number(value).toLocaleString("pt-BR"), name]}
      />
    );
    const legenda = <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />;

    if (chartType === "bar") {
      return (
        <BarChart {...commonProps}>
          {grid}{xAxis}{yAxis}{tooltip}{legenda}
          {chartColumns.map((col, i) => (
            <Bar key={col} dataKey={col} fill={cor(i)} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      );
    }
    if (chartType === "line") {
      return (
        <LineChart {...commonProps}>
          {grid}{xAxis}{yAxis}{tooltip}{legenda}
          {chartColumns.map((col, i) => (
            <Line
              key={col}
              type="monotone"
              dataKey={col}
              stroke={cor(i)}
              strokeWidth={2}
              dot={{ r: 2.5, strokeWidth: 0, fill: cor(i) }}
              activeDot={{ r: 5, strokeWidth: 0, fill: cor(i) }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      );
    }
    return (
      <AreaChart {...commonProps}>
        {grid}{xAxis}{yAxis}{tooltip}{legenda}
        {chartColumns.map((col, i) => (
          <Area
            key={col}
            type="monotone"
            dataKey={col}
            stroke={cor(i)}
            fill={cor(i)}
            fillOpacity={0.12}
            strokeWidth={2}
            dot={{ r: 2, strokeWidth: 0, fill: cor(i) }}
            activeDot={{ r: 5, strokeWidth: 0, fill: cor(i) }}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    );
  };

  // Métricas agrupadas por categoria (uma faixa só, divisória entre grupos).
  const gruposDeMetricas: Array<{ nome: string; itens: Array<{ chave: string; rotulo: string; valor: string; apoio: string; referencia: number | null }> }> = [];
  categories.forEach((lista, nome) => {
    gruposDeMetricas.push({
      nome,
      itens: lista.map((metric) => ({
        chave: metric.key,
        rotulo: metric.shortLabel,
        valor: metric.format(metric.value),
        apoio: `${metric.label} · ${metric.unit}`,
        referencia: metric.benchmark ? Math.min((metric.value / metric.benchmark) * 100, 100) : null,
      })),
    });
  });
  if (customMetrics.length > 0) {
    gruposDeMetricas.push({
      nome: "Personalizada",
      itens: customMetrics.map((cm, i) => ({
        chave: `custom-${i}`,
        rotulo: cm.label,
        valor: Number.isFinite(Number(cm.value)) ? Number(cm.value).toLocaleString("pt-BR") : String(cm.value),
        apoio: "",
        referencia: null,
      })),
    });
  }
  const totalDeMetricas = standardMetrics.length + customMetrics.length;
  const corDaReferencia = (pct: number) => (pct >= 80 ? "bg-primary" : pct >= 50 ? "bg-warning" : "bg-destructive");
  const tomDaReferencia = (pct: number) => (pct >= 80 ? "text-primary" : pct >= 50 ? "text-warning" : "text-destructive");

  const temGraficos = chartData.length > 0 && chartColumns.length > 0;

  /* ── Render ─────────────────────────────────────── */
  return (
    <div className={raiz}>
      <div className="min-w-0">
        {botaoVoltar}
        <CabecalhoDePagina
          titulo={report.title}
          descricao={descricao || undefined}
          ajuda={
            isClientView
              ? "Leitura do período: o que aconteceu em linguagem simples, os números e os próximos passos. Para guardar, use Salvar PDF."
              : "Relatório completo: leitura para o cliente, comparação com o anterior, auditoria das métricas, indicadores e gráficos. Comparação, auditoria e indicadores só a equipe vê."
          }
          acoes={acoes}
        />
      </div>

      {/* Painel automático da planilha importada (Meta Ads, Google Ads, social, vendas) */}
      {metricas.__source && Array.isArray(metricas.__breakdown) && metricas.__breakdown.length > 0 && (
        <SourceDashboard
          source={metricas.__source}
          sourceLabel={metricas.__source_label || "Dados importados"}
          rows={metricas.__breakdown}
          dimensionKey={metricas.__dimension || "Item"}
          metrics={metricas}
        />
      )}

      {/* Leitura em linguagem clara (cliente primeiro) */}
      <ClientPlainSummary
        metrics={metricas}
        previousMetrics={(previousReport?.metrics || null) as Record<string, any> | null}
        periodDays={periodDays}
        summary={report.summary}
        nextSteps={report.next_steps}
      />

      {/* Conferência da equipe: comparação com o anterior e auditoria das métricas */}
      {!isClientView && (
        <div className="min-w-0 space-y-3 border-t border-border pt-5 empty:hidden">
          {report.project_id && (
            <ReportComparison
              projectId={report.project_id}
              currentReportId={report.id}
              currentCreatedAt={report.created_at}
              currentReportMetrics={report.metrics as any}
              currentPeriod={{ start: report.period_start, end: report.period_end }}
            />
          )}
          <MetricsAudit metrics={report.metrics as any} />
        </div>
      )}

      {/* Indicadores (equipe) */}
      {!isClientView && kpis.length > 0 && (
        <Secao
          titulo="Indicadores"
          descricao={`${kpis.length} ${kpis.length === 1 ? "indicador" : "indicadores"}`}
          ajuda="Indicadores-chave calculados com o investimento e os resultados do período. A situação compara com faixas de referência do mercado."
          divisoria
        >
          <Painel semEspaco>
            <FaixaDeNumeros semMoldura grade="grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
              {kpis.map((kpi, i) => (
                <CelulaDeNumero
                  key={i}
                  rotulo={kpi.label}
                  valor={kpi.value}
                  lado={<span className={juntar(etiqueta, SITUACAO[kpi.status].classe)}>{SITUACAO[kpi.status].rotulo}</span>}
                  apoio={kpi.detail}
                />
              ))}
            </FaixaDeNumeros>
          </Painel>
        </Secao>
      )}

      {/* Métricas do período */}
      {totalDeMetricas > 0 && (
        <Secao
          titulo="Métricas"
          descricao={`${totalDeMetricas} ${totalDeMetricas === 1 ? "métrica" : "métricas"}`}
          ajuda="Todas as métricas do período, por categoria. Quando existe referência de mercado, a barra mostra quanto dela foi atingido."
          divisoria
        >
          <Painel semEspaco>
            {/* Uma grade só, na ordem das categorias; a categoria vai à direita do rótulo */}
            <FaixaDeNumeros semMoldura grade="grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {gruposDeMetricas.map((grupo) => (
                  grupo.itens.map((item) => (
                    <CelulaDeNumero
                      key={item.chave}
                      rotulo={item.rotulo}
                      lado={<span className="hidden text-[11px] leading-4 text-muted-foreground sm:block">{grupo.nome}</span>}
                      valor={item.valor}
                      apoio={
                        <span className="block truncate">
                          <span className="sm:hidden">{grupo.nome}{item.apoio ? " · " : ""}</span>
                          {item.apoio}
                        </span>
                      }
                    >
                      {item.referencia !== null && (
                        <div className="mt-2">
                          <div className="flex items-center justify-between text-[11px] leading-4 text-muted-foreground">
                            <span>da referência</span>
                            <span className={juntar("font-medium tabular-nums", tomDaReferencia(item.referencia))}>{item.referencia.toFixed(0)}%</span>
                          </div>
                          <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                            <div className={juntar("h-full rounded-full", corDaReferencia(item.referencia))} style={{ width: `${item.referencia}%` }} />
                          </div>
                        </div>
                      )}
                    </CelulaDeNumero>
                  ))
              ))}
            </FaixaDeNumeros>
          </Painel>
        </Secao>
      )}

      {/* Evolução e análise visual */}
      {temGraficos && (
        <Secao
          titulo="Evolução"
          descricao={`${chartData.length} pontos · ${chartColumns.length} ${chartColumns.length === 1 ? "série" : "séries"}`}
          ajuda="Como cada métrica andou ao longo do período, com o resumo por métrica, a jornada das pessoas e a distribuição dos resultados."
          divisoria
          corpoClassName="space-y-4"
        >
          <Painel className="page-break-inside-avoid">
            <div className="h-72 sm:h-96">
              <ResponsiveContainer width="100%" height="100%">
                {renderMainChart()!}
              </ResponsiveContainer>
            </div>
          </Painel>

          {/* Resumo por série */}
          {colStats.length > 0 && (
            <Painel semEspaco titulo="Por métrica" descricao={`${colStats.length} ${colStats.length === 1 ? "métrica" : "métricas"}`}>
              <FaixaDeNumeros semMoldura grade="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {colStats.map((cs) => {
                  const TrendIcon = cs.trend > 3 ? ArrowUpRight : cs.trend < -3 ? ArrowDownRight : ArrowRight;
                  const tom = cs.trend > 3 ? "bg-primary/10 text-primary" : cs.trend < -3 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground";
                  const series = chartData.map((r, i) => ({ i, v: Number(r[cs.col]) || 0 }));
                  return (
                    <CelulaDeNumero
                      key={cs.col}
                      rotulo={
                        <>
                          <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: cs.color }} aria-hidden="true" />
                          {cs.col}
                        </>
                      }
                      lado={
                        <span className={juntar(etiqueta, tom)}>
                          <TrendIcon className="mr-0.5 h-3 w-3" aria-hidden="true" />
                          {Math.abs(cs.trend).toFixed(0)}%
                        </span>
                      }
                      valor={fmtContagem(cs.total)}
                      apoio={`total · média ${fmtContagem(cs.avg)} · pico ${fmtContagem(cs.max)}`}
                    >
                      {series.length > 2 && (
                        <div className="-mx-1 mt-2 h-10">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={series} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                              <Area type="monotone" dataKey="v" stroke={cs.color} strokeWidth={1.5} fill={cs.color} fillOpacity={0.12} dot={false} isAnimationActive={false} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </CelulaDeNumero>
                  );
                })}
              </FaixaDeNumeros>
            </Painel>
          )}

          {/* Jornada: da descoberta até a ação final */}
          {funnelData && funnelData.length >= 2 && (() => {
            const top = funnelData[0].value;
            const bottom = funnelData[funnelData.length - 1].value;
            const globalRate = top > 0 ? (bottom / top) * 100 : 0;
            const totalDropoff = top - bottom;
            const followers = Number(metricas.followers_gained) || 0;
            // Localiza o "gargalo": etapa com maior perda relativa entre passos consecutivos
            let bottleneckIdx = -1;
            let bottleneckRate = 1;
            funnelData.forEach((s, i) => {
              if (i === 0) return;
              const prev = funnelData[i - 1].value;
              const r = prev > 0 ? s.value / prev : 1;
              if (r < bottleneckRate) { bottleneckRate = r; bottleneckIdx = i; }
            });
            return (
              <Painel
                semEspaco
                className="page-break-inside-avoid"
                titulo="Jornada do cliente"
                ajuda="Da descoberta até a ação final. Cada etapa mostra quantas pessoas seguiram, quantas saíram e onde está a maior perda (gargalo)."
                descricao={`${funnelData.length} etapas${followers > 0 ? ` · +${followers.toLocaleString("pt-BR")} novos seguidores` : ""}`}
              >
                <FaixaDeNumeros semMoldura grade="grid-cols-2 lg:grid-cols-4">
                  <CelulaDeNumero rotulo="Entrada" valor={top.toLocaleString("pt-BR")} apoio={<span className="block truncate">{funnelData[0].name}</span>} />
                  <CelulaDeNumero rotulo="Conversão final" valor={bottom.toLocaleString("pt-BR")} apoio={<span className="block truncate">{funnelData[funnelData.length - 1].name}</span>} />
                  <CelulaDeNumero rotulo="Taxa global" valor={globalRate.toFixed(2) + "%"} apoio="da entrada ao final" destaque />
                  <CelulaDeNumero rotulo="Perda total" valor={totalDropoff.toLocaleString("pt-BR")} apoio="ao longo da jornada" />
                </FaixaDeNumeros>
                <ol className="divide-y divide-border border-t border-border">
                  {funnelData.map((stage, i) => {
                    const prevVal = i > 0 ? funnelData[i - 1].value : stage.value;
                    const stepRate = prevVal > 0 ? (stage.value / prevVal) * 100 : 100;
                    const dropOff = i > 0 ? prevVal - stage.value : 0;
                    const widthPct = top > 0 ? (stage.value / top) * 100 : 0;
                    const isBottleneck = i === bottleneckIdx;
                    const isFinal = i === funnelData.length - 1;
                    return (
                      <li key={i} className="min-w-0 px-4 py-3">
                        <div className="flex min-w-0 items-start">
                          <span className="mt-0.5 w-6 shrink-0 text-[12px] tabular-nums text-muted-foreground">{i + 1}</span>
                          <div className="mr-3 min-w-0 flex-1">
                            <div className="flex min-w-0 items-center">
                              <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{stage.name}</span>
                              {isFinal && <span className={juntar(etiqueta, "ml-1.5 bg-primary/10 text-primary")}>final</span>}
                              {i > 0 && (
                                <span
                                  className={juntar(
                                    etiqueta,
                                    "ml-1.5",
                                    isBottleneck ? "bg-warning/10 text-warning" : stepRate >= 30 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                                  )}
                                  title="Aproveitamento em relação à etapa anterior"
                                >
                                  {stepRate.toFixed(1)}%{isBottleneck ? " gargalo" : ""}
                                </span>
                              )}
                            </div>
                            <p className={juntar(texto.auxiliar, "mt-0.5 tabular-nums")}>
                              {widthPct.toFixed(1)}% do topo
                              {dropOff > 0 && ` · ${dropOff.toLocaleString("pt-BR")} saíram`}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[15px] font-semibold leading-5 tabular-nums text-foreground">{stage.value.toLocaleString("pt-BR")}</p>
                            <p className={juntar(texto.auxiliar, "mt-0.5")}>{i === 0 ? "entrada" : "permaneceram"}</p>
                          </div>
                        </div>
                        <div className="ml-6 mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full" style={{ width: `${widthPct}%`, background: stage.fill }} />
                        </div>
                      </li>
                    );
                  })}
                </ol>
                {bottleneckIdx > 0 && (
                  <p className="flex min-w-0 items-center border-t border-border px-4 py-3 text-[12px] leading-5 text-foreground">
                    <AlertTriangle className="mr-2 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-warning">Gargalo:</span>{" "}
                      <span className="font-medium">{funnelData[bottleneckIdx].name}</span> ({(bottleneckRate * 100).toFixed(1)}% de aproveitamento)
                    </span>
                    <AjudaRecolhida className="ml-1" rotulo="O que é o gargalo">
                      A etapa com a maior perda relativa do funil. Otimize esse ponto para destravar o resto do funil.
                    </AjudaRecolhida>
                  </p>
                )}
              </Painel>
            );
          })()}

          {/* Distribuição dos resultados */}
          {pieData.length >= 2 && (() => {
            const totalPie = pieData.reduce((s, d) => s + d.value, 0);
            return (
              <Painel
                className="page-break-inside-avoid"
                titulo="Distribuição"
                ajuda="Participação relativa de cada métrica no resultado total."
                descricao={`${pieData.length} métricas`}
              >
                <div className="grid grid-cols-1 items-center gap-4 lg:grid-cols-5 lg:gap-6">
                  <div className="relative h-60 lg:col-span-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={64}
                          outerRadius={100}
                          paddingAngle={2}
                          dataKey="value"
                          stroke="hsl(var(--card))"
                          strokeWidth={2}
                          isAnimationActive={false}
                        >
                          {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                        </Pie>
                        <Tooltip contentStyle={estiloDaDica} formatter={(v: any, n: any) => [Number(v).toLocaleString("pt-BR"), n]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <p className={texto.auxiliar}>Total</p>
                      <p className="text-[20px] font-semibold leading-7 tabular-nums text-foreground">{fmtContagem(totalPie)}</p>
                      <p className={texto.auxiliar}>{pieData.length} séries</p>
                    </div>
                  </div>
                  <ul className="min-w-0 divide-y divide-border lg:col-span-3">
                    {pieData.map((d, i) => {
                      const pct = totalPie > 0 ? (d.value / totalPie) * 100 : 0;
                      return (
                        <li key={i} className="min-w-0 py-2.5">
                          <div className="flex min-w-0 items-center">
                            <span className="mr-2 h-2 w-2 shrink-0 rounded-full" style={{ background: d.fill }} aria-hidden="true" />
                            <span className="mr-3 min-w-0 flex-1 truncate text-[13px] text-foreground">{d.name}</span>
                            <span className="shrink-0 text-[13px] font-medium tabular-nums text-foreground">{d.value.toLocaleString("pt-BR")}</span>
                            <span className={juntar(texto.auxiliar, "ml-3 w-12 shrink-0 text-right tabular-nums")}>{pct.toFixed(1)}%</span>
                          </div>
                          <div className="ml-4 mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: d.fill }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </Painel>
            );
          })()}

          {/* Diagnóstico e eficiência */}
          {(radarData.length >= 3 || efficiencyData.length > 0) && (
            <div className={juntar("grid grid-cols-1 gap-4", radarData.length >= 3 && efficiencyData.length > 0 && "lg:grid-cols-2")}>
              {radarData.length >= 3 && (
                <Painel
                  className="page-break-inside-avoid"
                  titulo="Diagnóstico"
                ajuda="Comparação com referências de mercado. 100% é a referência; a linha tracejada marca esse ponto."
                  descricao={`${radarData.length} eixos`}
                >
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radarData}>
                        <PolarGrid stroke="hsl(var(--border))" />
                        <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: "hsl(var(--foreground))" }} />
                        <PolarRadiusAxis tick={false} axisLine={false} />
                        {/* Referência (100%) */}
                        <Radar
                          name="Referência"
                          dataKey={() => 100}
                          stroke="hsl(var(--muted-foreground))"
                          strokeOpacity={0.6}
                          strokeDasharray="3 4"
                          fill="transparent"
                          strokeWidth={1}
                          isAnimationActive={false}
                        />
                        <Radar
                          name="Desempenho"
                          dataKey="value"
                          stroke="hsl(145, 100%, 50%)"
                          fill="hsl(145, 100%, 50%)"
                          fillOpacity={0.18}
                          strokeWidth={2}
                          dot={{ r: 3, fill: "hsl(145, 100%, 50%)", strokeWidth: 0 }}
                          isAnimationActive={false}
                        />
                        <Tooltip contentStyle={estiloDaDica} formatter={(v: any) => [v + "%", "da referência"]} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </Painel>
              )}

              {efficiencyData.length > 0 && (
                <Painel
                  className="page-break-inside-avoid"
                  titulo="Eficiência"
                ajuda="Quanto maior o índice, melhor o aproveitamento da verba."
                  descricao={`${efficiencyData.length} ${efficiencyData.length === 1 ? "índice" : "índices"}`}
                >
                  <ul className="divide-y divide-border">
                    {efficiencyData.map((d, i) => {
                      const grade = d.value >= 70 ? "Excelente" : d.value >= 45 ? "Bom" : d.value >= 25 ? "Regular" : "Crítico";
                      const tom = d.value >= 70 ? "bg-primary/10 text-primary"
                        : d.value >= 45 ? "bg-muted text-foreground"
                        : d.value >= 25 ? "bg-warning/10 text-warning"
                        : "bg-destructive/10 text-destructive";
                      return (
                        <li key={i} className="min-w-0 py-3 first:pt-0 last:pb-0">
                          <div className="flex min-w-0 items-center">
                            <span className="mr-2 h-2 w-2 shrink-0 rounded-full" style={{ background: d.fill }} aria-hidden="true" />
                            <span className="mr-3 min-w-0 flex-1 truncate text-[13px] text-foreground">{d.name}</span>
                            <span className={juntar(etiqueta, tom)}>{grade}</span>
                            <span className="ml-3 w-10 shrink-0 text-right text-[13px] font-medium tabular-nums text-foreground">{d.value}%</span>
                          </div>
                          <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div className="absolute inset-y-0 left-1/4 w-px bg-border" />
                            <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                            <div className="absolute inset-y-0 left-3/4 w-px bg-border" />
                            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${d.value}%`, background: d.fill }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Painel>
              )}
            </div>
          )}
        </Secao>
      )}

      {/* Tabela de dados por período */}
      {temGraficos && (
        <Secao titulo="Dados por período" descricao={`${chartData.length} períodos`} divisoria>
          <Painel semEspaco>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className={juntar(texto.rotulo, "px-2 py-2.5 first:pl-4 last:pr-4 sm:px-4 text-left")}>Período</th>
                    {chartColumns.map((col, i) => (
                      <th key={col} scope="col" className={juntar(texto.rotulo, "whitespace-nowrap px-2 py-2.5 first:pl-4 last:pr-4 sm:px-4 text-right")}>
                        <span className="mr-1.5 hidden h-2 w-2 sm:inline-block rounded-full align-middle" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} aria-hidden="true" />
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {chartData.map((row, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap px-2 py-2.5 first:pl-4 last:pr-4 sm:px-4 text-foreground">{row.label}</td>
                      {chartColumns.map((col, ci) => {
                        const val = Number(row[col]) || 0;
                        const maxVal = colStats[ci]?.max || 1;
                        const pct = (val / maxVal) * 100;
                        return (
                          <td key={col} className="px-2 py-2.5 first:pl-4 last:pr-4 sm:px-4 text-right">
                            <div className="flex items-center justify-end">
                              <div className="mr-2 hidden h-1 w-16 overflow-hidden rounded-full bg-muted sm:block">
                                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: CHART_COLORS[ci % CHART_COLORS.length] }} />
                              </div>
                              <span className="tabular-nums text-foreground">{val.toLocaleString("pt-BR")}</span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="px-2 py-2.5 first:pl-4 last:pr-4 sm:px-4 text-foreground">Total</td>
                    {chartColumns.map(col => {
                      const total = chartData.reduce((s, r) => s + (Number(r[col]) || 0), 0);
                      return (
                        <td key={col} className="px-2 py-2.5 first:pl-4 last:pr-4 sm:px-4 text-right tabular-nums text-primary">
                          {total.toLocaleString("pt-BR")}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </Painel>
        </Secao>
      )}

      {/* Análise automática */}
      {insights.length > 0 && (
        <Secao titulo="Análise" ajuda="Leituras geradas automaticamente a partir dos números do relatório." divisoria>
          <ul className="divide-y divide-border">
            {insights.map((insight, i) => {
              const Icone = insight.type === "success" ? Star : insight.type === "warning" ? AlertTriangle : Lightbulb;
              const tom = insight.type === "success" ? "text-primary" : insight.type === "warning" ? "text-warning" : "text-muted-foreground";
              return (
                <li key={i} className="flex min-w-0 items-start py-2.5 first:pt-0 last:pb-0">
                  <Icone className={juntar("mr-2.5 mt-0.5 h-4 w-4 shrink-0", tom)} aria-hidden="true" />
                  <p className={juntar(texto.corpo, "min-w-0")}>{insight.text}</p>
                </li>
              );
            })}
          </ul>
        </Secao>
      )}

      {/* Resumo executivo */}
      {report.summary && (
        <Secao titulo="Resumo executivo" ajuda="Visão geral dos resultados e do desempenho no período." divisoria>
          {/* Ritual escrito em blocos de WhatsApp aparece como secoes do
              painel, sem asteriscos; relatorio comum segue no RichText. */}
          {estruturaDoRitual(report.summary).blocos.length > 0
            ? <RitualEstruturado body={report.summary} nextSteps={report.next_steps} />
            : <RichText text={report.summary} />}
        </Secao>
      )}

      {/* Destaques e próximos passos */}
      {(report.highlights || report.next_steps) && (
        <div className={juntar("grid min-w-0 grid-cols-1 gap-6 border-t border-border pt-5", report.highlights && report.next_steps && "lg:grid-cols-2 lg:gap-8")}>
          {report.highlights && (
            <Secao titulo="Destaques" ajuda="Pontos do período que merecem atenção especial.">
              <RichText text={report.highlights} />
            </Secao>
          )}
          {report.next_steps && (
            <Secao titulo="Próximos passos" ajuda="Ações planejadas para o próximo período.">
              <RichText text={report.next_steps} />
            </Secao>
          )}
        </div>
      )}
    </div>
  );
}
