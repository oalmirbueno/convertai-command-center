// Auditoria automática: mostra de onde vêm CTR/CPC/CPM/derivados e valida
// se os números batem com spend × impressões × cliques × resultados.
// Aparece colapsado por padrão e fica verde quando tudo confere.

import { useState, useMemo } from "react";
import { ShieldCheck, ShieldAlert, ChevronDown, ChevronUp, Calculator } from "lucide-react";

type AnyRec = Record<string, any>;

interface Props {
  metrics: AnyRec;
}

const safeDiv = (a: number, b: number) => (b > 0 && isFinite(a / b) ? a / b : 0);
const fmtR = (v: number) => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = (v: number) => Math.round(v).toLocaleString("pt-BR");
const fmtPct = (v: number) => v.toFixed(2) + "%";

interface Check {
  key: string;
  label: string;
  formula: string;
  inputs: string;
  computed: number;
  stored: number | null;
  format: (v: number) => string;
  /** tolerância relativa para considerar OK (default 2%) */
  tol?: number;
}

export default function MetricsAudit({ metrics }: Props) {
  const [open, setOpen] = useState(false);

  const { checks, base } = useMemo(() => {
    const m = metrics || {};
    const spend = Number(m.ad_spend) || 0;
    const impr  = Number(m.impressions) || 0;
    const reach = Number(m.reach) || 0;
    const clicks = Number(m.clicks) || 0;
    const linkClicks = Number(m.link_clicks) || 0;
    const useClicks = linkClicks || clicks;
    const results = Number(m.results) || Number(m.conversions) || 0;

    const base = { spend, impr, reach, clicks, linkClicks, useClicks, results };

    const list: Check[] = [];

    if (impr > 0 && useClicks > 0) list.push({
      key: "ctr",
      label: "CTR",
      formula: "cliques ÷ impressões × 100",
      inputs: `${fmtN(useClicks)} ÷ ${fmtN(impr)} × 100`,
      computed: safeDiv(useClicks, impr) * 100,
      stored: m.ctr != null ? Number(m.ctr) : null,
      format: fmtPct,
    });

    if (spend > 0 && useClicks > 0) list.push({
      key: "cpc",
      label: "CPC",
      formula: "investimento ÷ cliques",
      inputs: `${fmtR(spend)} ÷ ${fmtN(useClicks)}`,
      computed: safeDiv(spend, useClicks),
      stored: m.cpc != null ? Number(m.cpc) : null,
      format: fmtR,
    });

    if (spend > 0 && impr > 0) list.push({
      key: "cpm",
      label: "CPM",
      formula: "investimento ÷ impressões × 1.000",
      inputs: `${fmtR(spend)} ÷ ${fmtN(impr)} × 1.000`,
      computed: safeDiv(spend, impr) * 1000,
      stored: m.cpm != null ? Number(m.cpm) : null,
      format: fmtR,
    });

    if (impr > 0 && reach > 0) list.push({
      key: "frequency",
      label: "Frequência",
      formula: "impressões ÷ alcance",
      inputs: `${fmtN(impr)} ÷ ${fmtN(reach)}`,
      computed: safeDiv(impr, reach),
      stored: m.frequency != null ? Number(m.frequency) : null,
      format: v => v.toFixed(2) + "x",
    });

    if (spend > 0 && results > 0) list.push({
      key: "cost_per_result",
      label: "Custo por Resultado",
      formula: "investimento ÷ resultados",
      inputs: `${fmtR(spend)} ÷ ${fmtN(results)}`,
      computed: safeDiv(spend, results),
      stored: m.cost_per_result != null ? Number(m.cost_per_result) : null,
      format: fmtR,
    });

    if (spend > 0 && (Number(m.messages) || 0) > 0) list.push({
      key: "cost_per_message",
      label: "Custo por Mensagem",
      formula: "investimento ÷ mensagens",
      inputs: `${fmtR(spend)} ÷ ${fmtN(Number(m.messages))}`,
      computed: safeDiv(spend, Number(m.messages)),
      stored: m.cost_per_message != null ? Number(m.cost_per_message) : null,
      format: fmtR,
    });

    if (spend > 0 && (Number(m.revenue) || 0) > 0) list.push({
      key: "roas",
      label: "ROAS",
      formula: "receita ÷ investimento",
      inputs: `${fmtR(Number(m.revenue))} ÷ ${fmtR(spend)}`,
      computed: safeDiv(Number(m.revenue), spend),
      stored: m.roas != null ? Number(m.roas) : null,
      format: v => v.toFixed(2) + "x",
    });

    return { checks: list, base };
  }, [metrics]);

  if (checks.length === 0) return null;

  const status = checks.map(c => {
    if (c.stored == null) return { c, ok: true as const, diff: 0 };
    const denom = Math.max(Math.abs(c.computed), 1e-9);
    const diff = Math.abs(c.stored - c.computed) / denom;
    return { c, ok: diff <= (c.tol ?? 0.02), diff };
  });
  const allOk = status.every(s => s.ok);
  const failures = status.filter(s => !s.ok);

  return (
    <section className="bg-card border border-border rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-secondary/30 transition-colors cursor-pointer bg-transparent border-0 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${allOk ? "bg-primary/10 border border-primary/20" : "bg-destructive/10 border border-destructive/20"}`}>
            {allOk
              ? <ShieldCheck className="w-4 h-4 text-primary" />
              : <ShieldAlert className="w-4 h-4 text-destructive" />}
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              Auditoria de Métricas
              <span className={`text-[10px] px-2 py-0.5 rounded-md border font-bold uppercase tracking-wider ${allOk ? "text-primary bg-primary/10 border-primary/20" : "text-destructive bg-destructive/10 border-destructive/20"}`}>
                {allOk ? "Tudo confere" : `${failures.length} divergência${failures.length > 1 ? "s" : ""}`}
              </span>
            </h2>
            <p className="text-[11px] text-muted-foreground truncate">
              Validando CTR, CPC, CPM e derivados contra investimento, impressões, cliques e resultados.
            </p>
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-border/50 pt-4">
          {/* Base inputs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {[
              { l: "Investimento", v: fmtR(base.spend),     show: base.spend > 0 },
              { l: "Impressões",   v: fmtN(base.impr),      show: base.impr > 0 },
              { l: "Alcance",      v: fmtN(base.reach),     show: base.reach > 0 },
              { l: "Cliques",      v: fmtN(base.useClicks), show: base.useClicks > 0 },
              { l: "Resultados",   v: fmtN(base.results),   show: base.results > 0 },
            ].filter(x => x.show).map((x, i) => (
              <div key={i} className="rounded-xl border border-border/60 bg-secondary/30 px-3 py-2">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">{x.l}</p>
                <p className="text-sm font-mono font-bold text-foreground">{x.v}</p>
              </div>
            ))}
          </div>

          {/* Checks */}
          <div className="space-y-2">
            {status.map(({ c, ok, diff }) => (
              <div key={c.key} className={`rounded-xl border p-3 ${ok ? "border-border bg-secondary/20" : "border-destructive/30 bg-destructive/5"}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Calculator className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-[12px] font-semibold text-foreground">{c.label}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border font-mono">
                        {c.formula}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground font-mono">{c.inputs}</p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Calculado</p>
                      <p className="text-sm font-mono font-bold text-primary">{c.format(c.computed)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Armazenado</p>
                      <p className={`text-sm font-mono font-bold ${c.stored == null ? "text-muted-foreground" : ok ? "text-foreground" : "text-destructive line-through"}`}>
                        {c.stored == null ? "—" : c.format(Number(c.stored))}
                      </p>
                    </div>
                    <span className={`text-[10px] px-2 py-1 rounded-md border font-bold ${ok ? "text-primary bg-primary/10 border-primary/20" : "text-destructive bg-destructive/10 border-destructive/20"}`}>
                      {ok ? "OK" : `Δ ${(diff * 100).toFixed(1)}%`}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {!allOk && (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Os valores exibidos no relatório já usam o cálculo correto (coluna <span className="text-primary font-semibold">Calculado</span>).
              Os valores em <span className="text-destructive font-semibold line-through">vermelho</span> estavam errados na importação
              — provavelmente o export trouxe colunas deslocadas ou somou taxas de várias campanhas.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
