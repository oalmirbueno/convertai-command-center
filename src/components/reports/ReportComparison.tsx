// Comparação automática vs. relatório anterior do MESMO projeto
// v2:
// - Toggle "Comparar com anterior" no topo (persiste em localStorage por relatório)
// - extractTotals(): lê tanto metrics.* quanto metrics.__breakdown (legado)
// - Análise contextual: investimento × eficiência × intenção, não apenas seta
// - Normalização por dia quando períodos têm tamanhos muito diferentes

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowUpRight, ArrowDownRight, GitCompareArrows, Minus,
  CheckCircle2, AlertTriangle, Info, ChevronDown, ChevronUp, Sparkles,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

type AnyRec = Record<string, any>;

const safeDiv = (a: number, b: number) => (b > 0 && isFinite(a / b) ? a / b : 0);
const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "";
const daysBetween = (a?: string, b?: string) => (a && b)
  ? Math.max(1, Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1)
  : 0;

/* ──────────────────────────────────────────────────────────
   Extração robusta de totais (cobre relatórios antigos)
   ────────────────────────────────────────────────────────── */
const COL_HINTS = {
  spend:    ["valor usado", "valor gasto", "amount spent", "amountspent", "investimento", "investido", "spend", "custo total"],
  impr:     ["impressões", "impressoes", "impressions", "impr"],
  reach:    ["alcance", "reach"],
  click:    ["cliques no link", "link clicks", "cliques (todos)", "cliques todos", "cliques", "clicks"],
  results:  ["resultados", "results", "conversões", "conversoes", "conversions"],
  messages: ["mensagens", "messag", "conversas"],
  leads:    ["leads", "cadastros"],
  revenue:  ["revenue", "receita", "valor das compras", "valor de conversão", "vendas", "sales"],
  purchases:["purchases", "compras", "pedidos", "orders"],
};
const NOT_RATE_FOR = {
  spend:    ["custo por", "cost per", "cpc", "cpm", "cpa", "cpr"],
  impr:     ["cpm", "custo por", "cost per"],
  reach:    ["custo por", "cost per", "cpm"],
  click:    ["custo por", "cost per", "cpc", "ctr", "%", "unico", "único"],
  results:  ["custo por", "cost per", "início", "inicio", "encerramento"],
  messages: ["custo por", "cost per"],
  leads:    ["custo por", "cost per"],
  revenue:  ["custo", "cost", "cpa"],
  purchases:["custo", "cost", "valor"],
};
function sumFromBreakdown(rows: AnyRec[], kind: keyof typeof COL_HINTS): number {
  if (!rows?.length) return 0;
  const keys = Object.keys(rows[0]);
  const exclude = NOT_RATE_FOR[kind];
  const matched: string[] = [];
  for (const hint of COL_HINTS[kind]) {
    const h = hint.toLowerCase();
    for (const k of keys) {
      const lk = k.toLowerCase();
      if (lk.includes(h) && !exclude.some(e => lk.includes(e)) && !matched.includes(k)) {
        matched.push(k);
        break;
      }
    }
    if (matched.length) break;
  }
  if (!matched.length) return 0;
  return rows.reduce((s, r) => s + (Number(r[matched[0]]) || 0), 0);
}

interface Totals {
  spend: number; impr: number; reach: number; click: number;
  results: number; messages: number; leads: number;
  revenue: number; purchases: number;
  ctr: number; cpc: number; cpm: number;
  frequency: number; cost_per_result: number;
  cost_per_message: number; cost_per_lead: number;
  cost_per_purchase: number; roas: number;
}

function extractTotals(report: AnyRec | null | undefined): Totals {
  const m = (report?.metrics || {}) as AnyRec;
  const breakdown = Array.isArray(m.__breakdown) ? m.__breakdown as AnyRec[] : [];
  const pick = (mapped: number, kind: keyof typeof COL_HINTS) =>
    mapped > 0 ? mapped : sumFromBreakdown(breakdown, kind);

  const spend  = pick(Number(m.ad_spend)    || 0, "spend");
  const impr   = pick(Number(m.impressions) || 0, "impr");
  const reach  = pick(Number(m.reach)       || 0, "reach");
  const click  = pick(Number(m.link_clicks) || Number(m.clicks) || 0, "click");
  const results= pick(Number(m.results)     || Number(m.conversions) || 0, "results");
  const messages = pick(Number(m.messages)  || 0, "messages");
  const leads    = pick(Number(m.leads)     || 0, "leads");
  const revenue  = pick(Number(m.revenue)   || 0, "revenue");
  const purchases= pick(Number(m.purchases) || 0, "purchases");

  return {
    spend, impr, reach, click, results, messages, leads, revenue, purchases,
    ctr: safeDiv(click, impr) * 100,
    cpc: safeDiv(spend, click),
    cpm: safeDiv(spend, impr) * 1000,
    frequency: safeDiv(impr, reach),
    cost_per_result: safeDiv(spend, results),
    cost_per_message: safeDiv(spend, messages),
    cost_per_lead: safeDiv(spend, leads),
    cost_per_purchase: safeDiv(spend, purchases),
    roas: safeDiv(revenue, spend),
  };
}

/* ──────────────────────────────────────────────────────────
   Formatação por métrica
   ────────────────────────────────────────────────────────── */
const fmtR = (v: number) => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = (v: number) => Math.round(v).toLocaleString("pt-BR");

const META: Record<string, { label: string; format: (v: number) => string; volume?: boolean }> = {
  spend:           { label: "Investimento",      format: fmtR, volume: true },
  impr:            { label: "Impressões",        format: fmtN, volume: true },
  reach:           { label: "Alcance",           format: fmtN, volume: true },
  click:           { label: "Cliques",           format: fmtN, volume: true },
  results:         { label: "Resultados",        format: fmtN, volume: true },
  messages:        { label: "Mensagens",         format: fmtN, volume: true },
  leads:           { label: "Leads",             format: fmtN, volume: true },
  revenue:         { label: "Receita",           format: fmtR, volume: true },
  purchases:       { label: "Compras",           format: fmtN, volume: true },
  ctr:             { label: "CTR",               format: v => v.toFixed(2) + "%" },
  cpc:             { label: "CPC",               format: fmtR },
  cpm:             { label: "CPM",               format: fmtR },
  frequency:       { label: "Frequência",        format: v => v.toFixed(2) + "x" },
  cost_per_result: { label: "Custo/Resultado",   format: fmtR },
  cost_per_message:{ label: "Custo/Mensagem",    format: fmtR },
  cost_per_lead:   { label: "Custo/Lead",        format: fmtR },
  cost_per_purchase:{ label: "Custo/Compra",     format: fmtR },
  roas:            { label: "ROAS",              format: v => v.toFixed(2) + "x" },
};

/* ──────────────────────────────────────────────────────────
   Severidades contextuais (não é up=bom, down=ruim)
   ────────────────────────────────────────────────────────── */
type Severity = "expected" | "gain" | "attention" | "critical" | "neutral";

const SEV_STYLE: Record<Severity, { tone: string; chip: string; label: string; icon: any }> = {
  expected:  { tone: "border-border bg-secondary/30",
               chip: "text-muted-foreground bg-secondary border-border",
               label: "Esperado", icon: Info },
  gain:      { tone: "border-primary/25 bg-primary/5",
               chip: "text-primary bg-primary/10 border-primary/25",
               label: "Ganho", icon: CheckCircle2 },
  attention: { tone: "border-warning/30 bg-warning/5",
               chip: "text-warning bg-warning/10 border-warning/30",
               label: "Atenção", icon: AlertTriangle },
  critical:  { tone: "border-destructive/30 bg-destructive/5",
               chip: "text-destructive bg-destructive/10 border-destructive/30",
               label: "Crítico", icon: AlertTriangle },
  neutral:   { tone: "border-border bg-card",
               chip: "text-muted-foreground bg-secondary border-border",
               label: "Neutro", icon: Minus },
};

interface RowAnalysis {
  key: string;
  cur: number;
  prev: number;
  pct: number;            // delta % normalizado (quando aplica)
  rawPct: number;         // delta % bruto
  severity: Severity;
  narrative: string;
}

/** Classifica cada métrica considerando o contexto investimento × resultado × eficiência. */
function analyze(curT: Totals, prevT: Totals, normalize: boolean, ratio: number): RowAnalysis[] {
  // Quando normaliza, divide volumétricas pela razão de dias (cur/prev)
  const v = (kind: keyof Totals, side: "cur" | "prev") => {
    const t = side === "cur" ? curT : prevT;
    const raw = t[kind];
    if (!normalize) return raw;
    const isVol = META[kind]?.volume;
    if (!isVol) return raw;
    return side === "cur" ? raw / ratio : raw; // current dividido pra mesma base diária do anterior
  };

  const pctOf = (cur: number, prev: number) => prev !== 0 ? ((cur - prev) / prev) * 100 : (cur > 0 ? 100 : 0);

  // Contexto macro
  const spendPct = pctOf(v("spend", "cur"), v("spend", "prev"));
  const resPct   = pctOf(v("results", "cur"), v("results", "prev"));
  const clickPct = pctOf(v("click", "cur"), v("click", "prev"));
  const ctrPct   = pctOf(curT.ctr, prevT.ctr);
  const significant = (p: number, t = 2) => Math.abs(p) >= t;

  const eficiencia = (resPct: number, spendPct: number): Severity => {
    // resultados acompanharam a verba?
    if (!significant(spendPct) && !significant(resPct)) return "expected";
    // mais eficiente: caiu menos que a verba ou subiu mais que ela
    const delta = resPct - spendPct;
    if (delta > 10)   return "gain";
    if (delta < -15)  return "critical";
    if (delta < -5)   return "attention";
    return "expected";
  };

  const out: RowAnalysis[] = [];
  const keys = Object.keys(META) as (keyof Totals)[];

  for (const k of keys) {
    const cur = v(k, "cur");
    const prev = v(k, "prev");
    if (cur === 0 && prev === 0) continue;

    const rawPct = pctOf(curT[k], prevT[k]);
    const pct = pctOf(cur, prev);
    const meta = META[k];
    const delta = pct;

    let severity: Severity = "neutral";
    let narrative = "";

    switch (k) {
      case "spend": {
        if (!significant(delta)) { severity = "expected"; narrative = "Investimento estável no período."; break; }
        severity = "expected";
        narrative = delta > 0
          ? `Mais verba alocada no período (${delta.toFixed(0)}% acima do anterior).`
          : `Menos verba alocada no período (${Math.abs(delta).toFixed(0)}% abaixo do anterior). Quedas proporcionais em volume são esperadas.`;
        break;
      }

      case "impr":
      case "reach":
      case "click":
      case "results":
      case "messages":
      case "leads":
      case "purchases":
      case "revenue": {
        if (!significant(delta)) { severity = "expected"; narrative = "Volume estável em relação ao período anterior."; break; }
        // Compara com a variação de investimento
        const efficiencyDelta = delta - spendPct;
        if (Math.abs(spendPct) < 2 && delta > 5) {
          severity = "gain"; narrative = `Crescimento real (+${delta.toFixed(0)}%) sem aumento de verba.`;
        } else if (Math.abs(spendPct) < 2 && delta < -5) {
          severity = "attention"; narrative = `Queda de ${Math.abs(delta).toFixed(0)}% sem mudança de verba — vale revisar criativos/segmentação.`;
        } else if (efficiencyDelta > 10) {
          severity = "gain"; narrative = `Volume cresceu ${delta > 0 ? "+" : ""}${delta.toFixed(0)}% enquanto a verba variou ${spendPct > 0 ? "+" : ""}${spendPct.toFixed(0)}% — mais eficiente.`;
        } else if (efficiencyDelta < -15 && delta < 0) {
          severity = "critical"; narrative = `Queda de ${Math.abs(delta).toFixed(0)}% acima da redução de verba (${spendPct.toFixed(0)}%) — perda real de eficiência.`;
        } else if (delta < 0 && spendPct < 0 && Math.abs(delta - spendPct) < 8) {
          severity = "expected"; narrative = `Volume acompanhou a redução de verba (${spendPct.toFixed(0)}%). Eficiência mantida.`;
        } else if (delta > 0 && spendPct > 0 && Math.abs(delta - spendPct) < 8) {
          severity = "expected"; narrative = `Volume cresceu junto com a verba — escala linear, sem ganho ou perda de eficiência.`;
        } else if (efficiencyDelta < -5) {
          severity = "attention"; narrative = `Volume caiu mais que a verba (${delta.toFixed(0)}% vs ${spendPct.toFixed(0)}%).`;
        } else {
          severity = "expected"; narrative = `Variação dentro do esperado para a mudança de verba.`;
        }
        break;
      }

      case "ctr": {
        if (!significant(delta)) { severity = "expected"; narrative = "Qualidade do clique estável."; break; }
        if (delta > 0)  { severity = "gain"; narrative = `Público mais qualificado: CTR +${delta.toFixed(1)}%.`; }
        else            { severity = "attention"; narrative = `CTR caiu ${Math.abs(delta).toFixed(1)}% — criativos podem estar fatigando.`; }
        break;
      }

      case "cpc":
      case "cpm":
      case "cost_per_result":
      case "cost_per_message":
      case "cost_per_lead":
      case "cost_per_purchase": {
        if (!significant(delta)) { severity = "expected"; narrative = "Custo unitário estável."; break; }
        if (delta < 0) {
          severity = "gain";
          narrative = `Custo caiu ${Math.abs(delta).toFixed(0)}% — mídia mais eficiente.`;
        } else {
          // contexto: subiu o custo, mas CTR também subiu? então é qualidade
          if (k === "cpc" && ctrPct > 5) {
            severity = "expected";
            narrative = `CPC subiu ${delta.toFixed(0)}%, mas CTR também (+${ctrPct.toFixed(1)}%) — público mais qualificado custa mais.`;
          } else if (k === "cpm" && significant(delta, 15)) {
            severity = "attention";
            narrative = `CPM subiu ${delta.toFixed(0)}% — leilão mais disputado ou audiência mais cara.`;
          } else {
            severity = "attention";
            narrative = `Custo unitário subiu ${delta.toFixed(0)}%.`;
          }
        }
        break;
      }

      case "frequency": {
        if (!significant(delta)) { severity = "expected"; narrative = "Frequência estável."; break; }
        if (cur > 3 && delta > 0) {
          severity = "attention";
          narrative = `Frequência em ${cur.toFixed(1)}x — risco de fadiga. Considere ampliar o público.`;
        } else if (delta > 0) {
          severity = "expected";
          narrative = `Frequência subiu para ${cur.toFixed(1)}x — ainda saudável.`;
        } else {
          severity = "expected";
          narrative = `Frequência caiu para ${cur.toFixed(1)}x — público sendo renovado.`;
        }
        break;
      }

      case "roas": {
        if (!significant(delta)) { severity = "expected"; narrative = "ROAS estável."; break; }
        if (delta > 0) { severity = "gain"; narrative = `ROAS subiu para ${cur.toFixed(2)}x — cada R$ 1 retornou R$ ${cur.toFixed(2)}.`; }
        else if (cur >= 2) { severity = "attention"; narrative = `ROAS caiu para ${cur.toFixed(2)}x — ainda lucrativo mas merece atenção.`; }
        else { severity = "critical"; narrative = `ROAS caiu para ${cur.toFixed(2)}x — abaixo do ponto de equilíbrio.`; }
        break;
      }
    }

    out.push({ key: k, cur: curT[k], prev: prevT[k], pct, rawPct, severity, narrative });
  }

  // Override geral: período de queda com volumes proporcionais à verba
  // (evita alarmar quando o cliente reduziu o investimento)
  if (spendPct < -10) {
    out.forEach(r => {
      if (META[r.key]?.volume && r.key !== "spend" && r.severity === "attention") {
        const eff = r.pct - spendPct;
        if (eff > -8) { // caiu na mesma proporção da verba
          r.severity = "expected";
          r.narrative = `Acompanhou a redução de verba (${spendPct.toFixed(0)}%). Sem perda de eficiência.`;
        }
      }
    });
  }

  return out;
}

interface Props {
  projectId: string;
  currentReportId: string;
  currentCreatedAt: string;
  currentReportMetrics: AnyRec;
  currentPeriod?: { start?: string; end?: string };
}

export default function ReportComparison({
  projectId, currentReportId, currentCreatedAt, currentReportMetrics, currentPeriod,
}: Props) {
  const storageKey = `report-compare-${currentReportId}`;
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(storageKey) === "1";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, open ? "1" : "0");
    }
  }, [open, storageKey]);

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

  // ── Estado 1: não há anterior ──
  if (!previous) {
    return (
      <div className="bg-card border border-border rounded-2xl px-5 py-3.5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <GitCompareArrows className="w-4 h-4 text-muted-foreground shrink-0" />
          <p className="text-[12px] text-muted-foreground">
            Primeiro relatório deste projeto — sem comparação disponível.
          </p>
        </div>
      </div>
    );
  }

  // Datas e normalização
  const curDays = daysBetween(currentPeriod?.start, currentPeriod?.end);
  const prevDays = daysBetween(previous.period_start, previous.period_end);
  const needNormalize = curDays > 0 && prevDays > 0 && Math.abs(curDays - prevDays) / Math.max(curDays, prevDays) > 0.2;
  const ratio = needNormalize && prevDays > 0 ? curDays / prevDays : 1;

  // ── Header / toggle (sempre visível) ──
  const header = (
    <button
      onClick={() => setOpen(o => !o)}
      className="w-full px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-secondary/30 transition-colors cursor-pointer bg-transparent border-0 text-left"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <GitCompareArrows className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            Comparar com Relatório Anterior
          </h2>
          <p className="text-[11px] text-muted-foreground truncate">
            {previous.title?.slice(0, 60) || fmtDate(previous.created_at)}
            {prevDays > 0 && ` · ${fmtDate(previous.period_start)} → ${fmtDate(previous.period_end)}`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] px-2.5 py-1 rounded-full bg-secondary text-muted-foreground border border-border uppercase tracking-wider font-semibold hidden sm:inline">
          {open ? "Ocultar" : "Mostrar análise"}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </div>
    </button>
  );

  if (!open) {
    return <section className="bg-card border border-border rounded-2xl overflow-hidden">{header}</section>;
  }

  // ── Análise ──
  const curT = extractTotals({ metrics: currentReportMetrics });
  const prevT = extractTotals(previous as AnyRec);
  const rows = analyze(curT, prevT, needNormalize, ratio).filter(r => !(r.cur === 0 && r.prev === 0));

  const gains      = rows.filter(r => r.severity === "gain").slice(0, 4);
  const attention  = rows.filter(r => r.severity === "attention" || r.severity === "critical").slice(0, 4);

  // ── Gráfico campanha-a-campanha (investimento) ──
  const curBreak: AnyRec[]  = Array.isArray((currentReportMetrics as any)?.__breakdown) ? (currentReportMetrics as any).__breakdown : [];
  const prevBreak: AnyRec[] = Array.isArray((previous.metrics as any)?.__breakdown) ? (previous.metrics as any).__breakdown : [];
  const curDim  = (currentReportMetrics as any)?.__dimension as string | undefined;
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
    <section className="bg-card border border-border rounded-2xl overflow-hidden">
      {header}

      <div className="border-t border-border/50 px-5 py-5 space-y-5">
        {/* Períodos & aviso de normalização */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-secondary/20 px-3.5 py-2.5">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Atual</p>
            <p className="text-sm font-semibold text-foreground">
              {currentPeriod?.start && currentPeriod?.end
                ? `${fmtDate(currentPeriod.start)} → ${fmtDate(currentPeriod.end)}`
                : "Período atual"}
              {curDays > 0 && <span className="text-[11px] text-muted-foreground font-normal ml-2 font-mono">{curDays}d</span>}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-secondary/20 px-3.5 py-2.5">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Anterior</p>
            <p className="text-sm font-semibold text-foreground">
              {previous.period_start && previous.period_end
                ? `${fmtDate(previous.period_start)} → ${fmtDate(previous.period_end)}`
                : fmtDate(previous.created_at)}
              {prevDays > 0 && <span className="text-[11px] text-muted-foreground font-normal ml-2 font-mono">{prevDays}d</span>}
            </p>
          </div>
        </div>

        {needNormalize && (
          <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3.5 py-2.5">
            <Info className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
            <p className="text-[11px] text-foreground leading-relaxed">
              Períodos com tamanhos diferentes ({curDays}d × {prevDays}d) — volumes do período atual foram ajustados para a mesma base diária. Taxas (CTR/CPC/CPM/ROAS) são comparadas direto.
            </p>
          </div>
        )}

        {/* Sumário contextual: ganhos × atenções */}
        {(gains.length > 0 || attention.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {gains.length > 0 && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5">
                <p className="text-[10px] uppercase tracking-wider text-primary font-bold mb-2 flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3" /> Ganhos do período
                </p>
                <ul className="space-y-1.5">
                  {gains.map(r => (
                    <li key={r.key} className="text-[12px] text-foreground leading-snug">
                      <span className="font-semibold">{META[r.key].label}</span>
                      <span className="text-muted-foreground"> — {r.narrative}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {attention.length > 0 && (
              <div className="rounded-xl border border-warning/30 bg-warning/5 p-3.5">
                <p className="text-[10px] uppercase tracking-wider text-warning font-bold mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3" /> Pontos de atenção
                </p>
                <ul className="space-y-1.5">
                  {attention.map(r => (
                    <li key={r.key} className="text-[12px] text-foreground leading-snug">
                      <span className="font-semibold">{META[r.key].label}</span>
                      <span className="text-muted-foreground"> — {r.narrative}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Grid de métricas com contexto */}
        {rows.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rows.map(r => {
              const sev = SEV_STYLE[r.severity];
              const meta = META[r.key];
              const Icon = sev.icon;
              const TrendIcon = Math.abs(r.rawPct) < 0.5 ? Minus : r.rawPct > 0 ? ArrowUpRight : ArrowDownRight;
              return (
                <div key={r.key} className={`rounded-2xl border p-4 transition-colors ${sev.tone}`}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold truncate">
                      {meta.label}
                    </p>
                    <span className={`text-[10px] px-2 py-0.5 rounded-md border font-bold flex items-center gap-1 ${sev.chip}`}>
                      <Icon className="w-3 h-3" />
                      {sev.label}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <p className="text-xl font-bold font-mono text-foreground tracking-tight">{meta.format(r.cur)}</p>
                    <span className="text-[11px] font-mono font-semibold text-muted-foreground flex items-center gap-0.5">
                      <TrendIcon className="w-3 h-3" />
                      {Math.abs(r.rawPct) < 0.5 ? "0%" : (r.rawPct > 0 ? "+" : "") + r.rawPct.toFixed(1) + "%"}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                    Anterior: {meta.format(r.prev)}
                  </p>
                  <p className="text-[11px] text-foreground/80 mt-2 leading-relaxed">
                    {r.narrative}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Gráfico campanha-a-campanha */}
        {breakdownChart.length >= 2 && (
          <div className="rounded-2xl border border-border bg-secondary/10 p-4">
            <h3 className="text-sm font-semibold text-foreground mb-1">Progressão por Campanha · Investimento</h3>
            <p className="text-[11px] text-muted-foreground mb-3">Quanto cada campanha recebeu agora vs. no período anterior.</p>
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
      </div>
    </section>
  );
}
