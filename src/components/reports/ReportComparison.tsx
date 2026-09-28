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
  CheckCircle2, AlertTriangle, Info, ChevronDown, Sparkles,
} from "lucide-react";
import { AjudaRecolhida, Painel, etiqueta, foco, juntar, texto } from "@/components/sistema";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

type AnyRec = Record<string, any>;

const safeDiv = (a: number, b: number) => (b > 0 && isFinite(a / b) ? a / b : 0);
// "2026-08-01" é lido como data local (new Date puro jogaria para o dia anterior no Brasil).
const dataLocal = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(d);
};
const fmtDate = (d?: string) => d ? dataLocal(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "";
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
  // Coleta TODAS as chaves possíveis (rows podem ter shapes ligeiramente diferentes)
  const allKeys = new Set<string>();
  for (const r of rows) Object.keys(r).forEach(k => allKeys.add(k));
  const keys = [...allKeys];
  const exclude = NOT_RATE_FOR[kind];
  let matchedKey: string | null = null;
  for (const hint of COL_HINTS[kind]) {
    const h = hint.toLowerCase();
    for (const k of keys) {
      const lk = k.toLowerCase();
      if (lk.includes(h) && !exclude.some(e => lk.includes(e))) {
        matchedKey = k;
        break;
      }
    }
    if (matchedKey) break;
  }
  if (!matchedKey) return 0;
  return rows.reduce((s, r) => s + (Number(r[matchedKey!]) || 0), 0);
}

function pickFromCustom(custom: AnyRec[] | undefined, kind: keyof typeof COL_HINTS): number {
  if (!Array.isArray(custom) || !custom.length) return 0;
  const exclude = NOT_RATE_FOR[kind];
  for (const hint of COL_HINTS[kind]) {
    const h = hint.toLowerCase();
    for (const c of custom) {
      const lk = String(c?.label || "").toLowerCase();
      if (lk && lk.includes(h) && !exclude.some(e => lk.includes(e))) {
        const v = Number(c.value);
        if (isFinite(v)) return v;
      }
    }
  }
  return 0;
}

function pickFromTopLevel(m: AnyRec, kind: keyof typeof COL_HINTS): number {
  const exclude = NOT_RATE_FOR[kind];
  for (const hint of COL_HINTS[kind]) {
    const h = hint.toLowerCase();
    for (const [k, v] of Object.entries(m)) {
      if (k.startsWith("__") || k === "custom") continue;
      if (typeof v !== "number" && typeof v !== "string") continue;
      const lk = k.toLowerCase();
      if (lk.includes(h) && !exclude.some(e => lk.includes(e))) {
        const n = Number(v);
        if (isFinite(n) && n !== 0) return n;
      }
    }
  }
  return 0;
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
  const custom = Array.isArray(m.custom) ? m.custom as AnyRec[] : [];

  // Estratégia em cascata: mapped explícito → breakdown → custom → busca fuzzy no topo
  const pick = (mapped: number, kind: keyof typeof COL_HINTS): number => {
    if (mapped > 0) return mapped;
    const fromBk = sumFromBreakdown(breakdown, kind);
    if (fromBk > 0) return fromBk;
    const fromCustom = pickFromCustom(custom, kind);
    if (fromCustom > 0) return fromCustom;
    return pickFromTopLevel(m, kind);
  };

  const spend     = pick(Number(m.ad_spend)    || Number(m.spend) || 0, "spend");
  const impr      = pick(Number(m.impressions) || 0, "impr");
  const reach     = pick(Number(m.reach)       || 0, "reach");
  const click     = pick(Number(m.link_clicks) || Number(m.clicks) || 0, "click");
  const results   = pick(Number(m.results)     || Number(m.conversions) || 0, "results");
  const messages  = pick(Number(m.messages)    || 0, "messages");
  const leads     = pick(Number(m.leads)       || 0, "leads");
  const revenue   = pick(Number(m.revenue)     || 0, "revenue");
  const purchases = pick(Number(m.purchases)   || 0, "purchases");

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
               chip: "bg-muted text-muted-foreground",
               label: "Esperado", icon: Info },
  gain:      { tone: "border-primary/25 bg-primary/5",
               chip: "bg-primary/10 text-primary",
               label: "Ganho", icon: CheckCircle2 },
  attention: { tone: "border-warning/30 bg-warning/5",
               chip: "bg-warning/10 text-warning",
               label: "Atenção", icon: AlertTriangle },
  critical:  { tone: "border-destructive/30 bg-destructive/5",
               chip: "bg-destructive/10 text-destructive",
               label: "Crítico", icon: AlertTriangle },
  neutral:   { tone: "border-border bg-card",
               chip: "bg-muted text-muted-foreground",
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

/** Classifica cada métrica considerando o contexto investimento × resultado × eficiência.
 *  Filosofia: cliente quer ver o trabalho funcionando. Só sinaliza atenção/crítico com
 *  evidência forte. Movimentações pequenas, estreias de métrica e ajustes de verba
 *  são "esperado" — não viram alarme. */
function analyze(curT: Totals, prevT: Totals, normalize: boolean, ratio: number): RowAnalysis[] {
  const v = (kind: keyof Totals, side: "cur" | "prev") => {
    const t = side === "cur" ? curT : prevT;
    const raw = t[kind];
    if (!normalize) return raw;
    const isVol = META[kind]?.volume;
    if (!isVol) return raw;
    return side === "cur" ? raw / ratio : raw;
  };

  const pctOf = (cur: number, prev: number) => prev !== 0 ? ((cur - prev) / prev) * 100 : (cur > 0 ? 100 : 0);

  const spendPct = pctOf(v("spend", "cur"), v("spend", "prev"));
  const ctrPct   = pctOf(curT.ctr, prevT.ctr);

  const SMALL = 8;
  const BIG = 20;
  const significant = (p: number, t = SMALL) => Math.abs(p) >= t;

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

    // Estreia: métrica nova no período atual (anterior = 0, atual > 0) → SEMPRE ganho
    if (prev === 0 && cur > 0) {
      out.push({
        key: k, cur: curT[k], prev: prevT[k], pct: 100, rawPct: 100,
        severity: meta.volume ? "gain" : "expected",
        narrative: meta.volume
          ? `Nova entrada de ${meta.label.toLowerCase()} neste período (${meta.format(cur)}). Período anterior não registrou.`
          : `${meta.label} agora mensurado: ${meta.format(cur)}.`,
      });
      continue;
    }

    // Métrica sumiu (não reportada agora) → neutro, não alarme
    if (cur === 0 && prev > 0) {
      out.push({
        key: k, cur: curT[k], prev: prevT[k], pct: -100, rawPct: -100,
        severity: "neutral",
        narrative: `Métrica não reportada neste período (anterior: ${meta.format(prev)}). Verifique se a coluna está no relatório.`,
      });
      continue;
    }

    let severity: Severity = "expected";
    let narrative = "";

    switch (k) {
      case "spend": {
        if (!significant(delta)) { severity = "expected"; narrative = "Investimento estável no período."; break; }
        severity = "expected";
        narrative = delta > 0
          ? `Mais verba alocada (+${delta.toFixed(0)}%) · escala em andamento.`
          : `Menos verba alocada (${delta.toFixed(0)}%). Quedas proporcionais em volume são esperadas e não indicam piora.`;
        break;
      }

      case "impr": case "reach": case "click": case "results":
      case "messages": case "leads": case "purchases": case "revenue": {
        if (!significant(delta)) { severity = "expected"; narrative = "Volume estável em relação ao período anterior."; break; }
        const efficiencyDelta = delta - spendPct;

        if (Math.abs(spendPct) < SMALL) {
          if (delta > 0) {
            severity = "gain";
            narrative = `Crescimento real de ${delta.toFixed(0)}% com a mesma verba · campanha mais produtiva.`;
          } else if (delta < -BIG) {
            severity = "attention";
            narrative = `Queda de ${Math.abs(delta).toFixed(0)}% sem mudança de verba · vale revisar criativos/segmentação.`;
          } else {
            severity = "expected";
            narrative = `Pequena oscilação dentro da margem natural do leilão.`;
          }
          break;
        }

        if (spendPct > 0) {
          if (efficiencyDelta > 5) {
            severity = "gain";
            narrative = `Volume subiu ${delta.toFixed(0)}% enquanto a verba subiu ${spendPct.toFixed(0)}% · ganho real de eficiência.`;
          } else if (efficiencyDelta < -BIG) {
            severity = "attention";
            narrative = `Aumento de verba (+${spendPct.toFixed(0)}%) sem retorno proporcional em volume (${delta > 0 ? "+" : ""}${delta.toFixed(0)}%).`;
          } else {
            severity = "expected";
            narrative = `Volume cresceu junto com a verba · escala saudável.`;
          }
          break;
        }

        if (spendPct < 0) {
          if (efficiencyDelta > 5) {
            severity = "gain";
            narrative = `Verba caiu ${Math.abs(spendPct).toFixed(0)}% mas volume caiu menos (${delta.toFixed(0)}%) · campanha ficou mais eficiente.`;
          } else if (efficiencyDelta < -BIG) {
            severity = "attention";
            narrative = `Volume caiu além da redução de verba (${delta.toFixed(0)}% vs ${spendPct.toFixed(0)}%).`;
          } else {
            severity = "expected";
            narrative = `Volume acompanhou a redução de verba (${spendPct.toFixed(0)}%). Eficiência mantida.`;
          }
        }
        break;
      }

      case "ctr": {
        if (!significant(delta, 5)) { severity = "expected"; narrative = "Qualidade do clique estável."; break; }
        if (delta > 0) { severity = "gain"; narrative = `Público mais qualificado: CTR +${delta.toFixed(1)}%.`; }
        else if (delta < -BIG) { severity = "attention"; narrative = `CTR caiu ${Math.abs(delta).toFixed(1)}% · vale rodar criativos novos.`; }
        else { severity = "expected"; narrative = `CTR oscilou ${delta.toFixed(1)}% · dentro da variação natural.`; }
        break;
      }

      case "cpc": case "cpm":
      case "cost_per_result": case "cost_per_message":
      case "cost_per_lead": case "cost_per_purchase": {
        if (!significant(delta)) { severity = "expected"; narrative = "Custo unitário estável."; break; }
        if (delta < 0) {
          severity = "gain";
          narrative = `Custo caiu ${Math.abs(delta).toFixed(0)}% · mídia mais eficiente.`;
        } else if (k === "cpc" && ctrPct > 5) {
          severity = "expected";
          narrative = `CPC subiu ${delta.toFixed(0)}%, mas CTR também (+${ctrPct.toFixed(1)}%) · público mais qualificado custa mais. Saudável.`;
        } else if (delta < BIG) {
          severity = "expected";
          narrative = `Custo subiu ${delta.toFixed(0)}% · variação típica do leilão.`;
        } else {
          severity = "attention";
          narrative = `Custo subiu ${delta.toFixed(0)}% · considere renovar criativos ou ajustar público.`;
        }
        break;
      }

      case "frequency": {
        if (!significant(delta)) { severity = "expected"; narrative = "Frequência estável."; break; }
        if (cur > 4 && delta > 0) {
          severity = "attention";
          narrative = `Frequência em ${cur.toFixed(1)}x · risco de fadiga. Considere ampliar o público.`;
        } else if (delta > 0) {
          severity = "expected"; narrative = `Frequência subiu para ${cur.toFixed(1)}x · ainda saudável.`;
        } else {
          severity = "expected"; narrative = `Frequência caiu para ${cur.toFixed(1)}x · público sendo renovado.`;
        }
        break;
      }

      case "roas": {
        if (!significant(delta, 5)) { severity = "expected"; narrative = `ROAS estável em ${cur.toFixed(2)}x.`; break; }
        if (delta > 0) { severity = "gain"; narrative = `ROAS subiu para ${cur.toFixed(2)}x · cada R$ 1 retornou R$ ${cur.toFixed(2)}.`; }
        else if (cur >= 2) { severity = "expected"; narrative = `ROAS em ${cur.toFixed(2)}x · segue lucrativo.`; }
        else if (cur >= 1) { severity = "attention"; narrative = `ROAS em ${cur.toFixed(2)}x · acima do ponto de equilíbrio mas merece atenção.`; }
        else { severity = "attention"; narrative = `ROAS em ${cur.toFixed(2)}x · abaixo do ponto de equilíbrio.`; }
        break;
      }
    }

    out.push({ key: k, cur: curT[k], prev: prevT[k], pct, rawPct, severity, narrative });
  }

  // Se a verba caiu, nenhuma volumétrica que acompanhou vira atenção
  if (spendPct < -SMALL) {
    out.forEach(r => {
      if (META[r.key]?.volume && r.key !== "spend" && (r.severity === "attention" || r.severity === "critical")) {
        const eff = r.pct - spendPct;
        if (eff > -10) {
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
      <Painel semEspaco as="section" aria-label="Comparação com o relatório anterior">
        <div className="flex min-w-0 items-center px-4 py-3">
          <GitCompareArrows className="mr-3 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className={juntar(texto.corpo, "min-w-0 text-muted-foreground")}>
            Primeiro relatório deste projeto · sem comparação disponível.
          </p>
        </div>
      </Painel>
    );
  }

  // Datas e normalização
  const curDays = daysBetween(currentPeriod?.start, currentPeriod?.end);
  const prevDays = daysBetween(previous.period_start, previous.period_end);
  const needNormalize = curDays > 0 && prevDays > 0 && Math.abs(curDays - prevDays) / Math.max(curDays, prevDays) > 0.2;
  const ratio = needNormalize && prevDays > 0 ? curDays / prevDays : 1;

  // ── Cabeçalho que abre e fecha (sempre visível; o estado fica lembrado) ──
  const header = (
    <button
      type="button"
      onClick={() => setOpen(o => !o)}
      aria-expanded={open}
      className={juntar("flex w-full min-w-0 items-center px-4 py-3 text-left transition-colors hover:bg-muted/30", foco)}
    >
      <GitCompareArrows className="mr-3 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="mr-3 min-w-0 flex-1">
        <span className={juntar(texto.tituloSecao, "block text-[14px]")}>Comparação com o anterior</span>
        <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>
          {previous.title?.slice(0, 60) || fmtDate(previous.created_at)}
          {prevDays > 0 && ` · ${fmtDate(previous.period_start)} a ${fmtDate(previous.period_end)}`}
        </span>
      </span>
      <span className={juntar(texto.auxiliar, "mr-1.5 hidden shrink-0 sm:inline")}>
        {open ? "Ocultar" : "Mostrar análise"}
      </span>
      <ChevronDown className={juntar("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
    </button>
  );

  if (!open) {
    return (
      <Painel semEspaco as="section" className="overflow-hidden" aria-label="Comparação com o relatório anterior">
        {header}
      </Painel>
    );
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

  const periodos = [
    {
      rotulo: "Atual",
      texto: currentPeriod?.start && currentPeriod?.end
        ? `${fmtDate(currentPeriod.start)} a ${fmtDate(currentPeriod.end)}`
        : "Período atual",
      dias: curDays,
    },
    {
      rotulo: "Anterior",
      texto: previous.period_start && previous.period_end
        ? `${fmtDate(previous.period_start)} a ${fmtDate(previous.period_end)}`
        : fmtDate(previous.created_at),
      dias: prevDays,
    },
  ];

  return (
    <Painel semEspaco as="section" className="overflow-hidden" aria-label="Comparação com o relatório anterior">
      {header}

      {/* Períodos lado a lado */}
      <div className="overflow-hidden border-t border-border">
        <div className="-ml-px -mt-px grid grid-cols-1 sm:grid-cols-2">
          {periodos.map((p) => (
            <div key={p.rotulo} className="min-w-0 border-l border-t border-border px-4 py-3">
              <p className={texto.rotulo}>{p.rotulo}</p>
              <p className="mt-0.5 truncate text-[13px] font-medium text-foreground">
                {p.texto}
                {p.dias > 0 && <span className={juntar(texto.auxiliar, "ml-2 tabular-nums")}>{p.dias} dias</span>}
              </p>
            </div>
          ))}
        </div>
      </div>

      {needNormalize && (
        <p className="flex min-w-0 items-center border-t border-border px-4 py-3 text-[12px] leading-5 text-foreground">
          <Info className="mr-2 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
          <span className="min-w-0 truncate">
            Períodos com tamanhos diferentes ({curDays} × {prevDays} dias)
          </span>
          <AjudaRecolhida className="ml-1" rotulo="Como a comparação foi ajustada">
            Os volumes do período atual foram ajustados para a mesma base diária. Taxas (CTR, CPC, CPM, ROAS) são comparadas direto.
          </AjudaRecolhida>
        </p>
      )}

      {/* Ganhos e pontos de atenção */}
      {(gains.length > 0 || attention.length > 0) && (
        <div className="overflow-hidden border-t border-border">
          <div className={juntar("-ml-px -mt-px grid grid-cols-1", gains.length > 0 && attention.length > 0 && "md:grid-cols-2")}>
            {gains.length > 0 && (
              <div className="min-w-0 border-l border-t border-border px-4 py-3">
                <p className="flex items-center text-[12px] font-medium leading-4 text-primary">
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Ganhos do período
                </p>
                <ul className="mt-2 space-y-1.5">
                  {gains.map(r => (
                    <li key={r.key} className="text-[12px] leading-5 text-foreground">
                      <span className="font-medium">{META[r.key].label}</span>
                      <span className="text-muted-foreground"> · {r.narrative}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {attention.length > 0 && (
              <div className="min-w-0 border-l border-t border-border px-4 py-3">
                <p className="flex items-center text-[12px] font-medium leading-4 text-warning">
                  <AlertTriangle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Pontos de atenção
                </p>
                <ul className="mt-2 space-y-1.5">
                  {attention.map(r => (
                    <li key={r.key} className="text-[12px] leading-5 text-foreground">
                      <span className="font-medium">{META[r.key].label}</span>
                      <span className="text-muted-foreground"> · {r.narrative}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cada métrica: situação, valor, variação, anterior e a leitura */}
      {rows.length > 0 && (
        <div className="overflow-hidden border-t border-border">
        <ul className="-ml-px -mt-px grid grid-cols-1 lg:grid-cols-2">
          {rows.map(r => {
            const sev = SEV_STYLE[r.severity];
            const meta = META[r.key];
            const TrendIcon = Math.abs(r.rawPct) < 0.5 ? Minus : r.rawPct > 0 ? ArrowUpRight : ArrowDownRight;
            return (
              <li key={r.key} className="flex min-w-0 items-start border-l border-t border-border px-4 py-3">
                <div className="mr-3 min-w-0 flex-1">
                  <div className="flex min-w-0 items-center">
                    <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{meta.label}</span>
                    <span className={juntar(etiqueta, "ml-2", sev.chip)}>{sev.label}</span>
                  </div>
                  <p className={juntar(texto.auxiliar, "mt-0.5 leading-5")}>{r.narrative}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[15px] font-semibold leading-5 tabular-nums text-foreground">{meta.format(r.cur)}</p>
                  <p className={juntar(texto.auxiliar, "mt-0.5 inline-flex items-center tabular-nums")}>
                    <TrendIcon className="mr-0.5 h-3 w-3" aria-hidden="true" />
                    {Math.abs(r.rawPct) < 0.5 ? "0%" : (r.rawPct > 0 ? "+" : "") + r.rawPct.toFixed(1) + "%"}
                  </p>
                  <p className={juntar(texto.auxiliar, "tabular-nums")}>antes {meta.format(r.prev)}</p>
                </div>
              </li>
            );
          })}
        </ul>
        </div>
      )}

      {/* Investimento campanha a campanha */}
      {breakdownChart.length >= 2 && (
        <div className="border-t border-border px-4 py-4">
          <h3 className="text-[13px] font-semibold leading-5 text-foreground">Investimento por campanha</h3>
          <p className={juntar(texto.auxiliar, "mt-0.5")}>Agora e no período anterior</p>
          <div className="mt-3 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={breakdownChart} margin={{ top: 10, right: 16, left: 0, bottom: 5 }}>
                <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={55} tickFormatter={(v: number) => "R$" + (v >= 1000 ? (v / 1000).toFixed(0) + "K" : v.toFixed(0))} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any, n: any) => ["R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), n]}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                <Bar dataKey="Anterior" fill="hsl(220, 15%, 55%)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="Atual"    fill="hsl(145, 100%, 50%)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Painel>
  );
}
