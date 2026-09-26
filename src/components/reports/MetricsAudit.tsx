// Auditoria automática: mostra de onde vêm CTR/CPC/CPM/derivados e valida
// se os números batem com spend × impressões × cliques × resultados.
// Aparece colapsado por padrão e fica verde quando tudo confere.

import { useState, useMemo } from "react";
import { ShieldCheck, ShieldAlert, ChevronDown, Calculator } from "lucide-react";
import { Painel, etiqueta, foco, juntar, texto } from "@/components/sistema";

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

  const base_ = [
    { l: "Investimento", v: fmtR(base.spend),     show: base.spend > 0 },
    { l: "Impressões",   v: fmtN(base.impr),      show: base.impr > 0 },
    { l: "Alcance",      v: fmtN(base.reach),     show: base.reach > 0 },
    { l: "Cliques",      v: fmtN(base.useClicks), show: base.useClicks > 0 },
    { l: "Resultados",   v: fmtN(base.results),   show: base.results > 0 },
  ].filter(x => x.show);

  return (
    <Painel semEspaco as="section" className="overflow-hidden" aria-label="Auditoria das métricas">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className={juntar("flex w-full min-w-0 items-center px-4 py-3 text-left transition-colors hover:bg-muted/30", foco)}
      >
        {allOk
          ? <ShieldCheck className="mr-3 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          : <ShieldAlert className="mr-3 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />}
        <span className="mr-3 min-w-0 flex-1">
          <span className="flex min-w-0 items-center">
            <span className={juntar(texto.tituloSecao, "min-w-0 truncate text-[14px]")}>Auditoria das métricas</span>
            <span className={juntar(etiqueta, "ml-2", allOk ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive")}>
              {allOk ? "Tudo confere" : `${failures.length} divergência${failures.length > 1 ? "s" : ""}`}
            </span>
          </span>
          <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>
            Confere CTR, CPC, CPM e derivados com investimento, impressões, cliques e resultados.
          </span>
        </span>
        <ChevronDown className={juntar("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open && (
        <>
          {/* Totais de onde saem as contas */}
          {base_.length > 0 && (
            <div className="overflow-hidden border-t border-border">
              <div className="-ml-px -mt-px grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
                {base_.map((x) => (
                  <div key={x.l} className="min-w-0 border-l border-t border-border px-4 py-2.5">
                    <p className={texto.rotulo}>{x.l}</p>
                    <p className="mt-0.5 truncate text-[14px] font-semibold tabular-nums text-foreground">{x.v}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cada conta: fórmula, entradas, calculado × armazenado */}
          <ul className="divide-y divide-border border-t border-border">
            {status.map(({ c, ok, diff }) => (
              <li key={c.key} className={juntar("flex min-w-0 flex-wrap items-start px-4 py-3", !ok && "bg-destructive/5")}>
                <div className="mb-2 mr-4 min-w-0 flex-1 basis-[220px] sm:mb-0">
                  <p className="flex min-w-0 items-center">
                    <Calculator className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="text-[13px] font-medium text-foreground">{c.label}</span>
                    <span className={juntar(texto.auxiliar, "ml-2 min-w-0 truncate")}>{c.formula}</span>
                  </p>
                  <p className={juntar(texto.auxiliar, "mt-0.5 tabular-nums")}>{c.inputs}</p>
                </div>
                <div className="flex shrink-0 items-center [&>*+*]:ml-4">
                  <div className="text-right">
                    <p className={texto.auxiliar}>Calculado</p>
                    <p className="text-[13px] font-semibold tabular-nums text-primary">{c.format(c.computed)}</p>
                  </div>
                  <div className="text-right">
                    <p className={texto.auxiliar}>Armazenado</p>
                    <p className={juntar("text-[13px] font-semibold tabular-nums", c.stored == null ? "text-muted-foreground" : ok ? "text-foreground" : "text-destructive line-through")}>
                      {c.stored == null ? "-" : c.format(Number(c.stored))}
                    </p>
                  </div>
                  <span className={juntar(etiqueta, ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive")}>
                    {ok ? "OK" : `Δ ${(diff * 100).toFixed(1)}%`}
                  </span>
                </div>
              </li>
            ))}
          </ul>

          {!allOk && (
            <p className={juntar(texto.auxiliar, "border-t border-border px-4 py-3 leading-5")}>
              Os valores exibidos no relatório já usam o cálculo correto (coluna <span className="font-medium text-primary">Calculado</span>).
              Os valores em <span className="font-medium text-destructive line-through">vermelho</span> estavam errados na importação:
              provavelmente o export trouxe colunas deslocadas ou somou taxas de várias campanhas.
            </p>
          )}
        </>
      )}
    </Painel>
  );
}
