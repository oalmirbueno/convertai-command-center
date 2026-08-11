import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TrendingUp, Megaphone, Wallet, Target } from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// Investimento da própria Aceleriq em anúncios/aquisição:
// despesas operacionais de marketing + uso de capital em tráfego pago.
const isAdsInvestment = (e: any) => e?.category === "marketing" || e?.category === "inv_trafego";

const parseDate = (v?: string | null) => {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return new Date(y, m - 1, d, 12);
  }
  return new Date(v);
};
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const receivedAmountOf = (row: any): number => {
  const total = Number(row?.amount) || 0;
  const paid = Number(row?.paid_amount) || 0;
  if (row?.status === "partial") return Math.min(paid, total);
  if (row?.status === "paid") return paid > 0 && paid < total ? paid : total;
  return 0;
};

interface Props {
  billing: any[];
  projectPayments: any[];
}

export default function AdsInvestment({ billing, projectPayments }: Props) {
  const { data: allExpenses = [] } = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expenses").select("*").order("due_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const adsExpenses = useMemo(() => (allExpenses || []).filter(isAdsInvestment), [allExpenses]);

  const { series, curInvested, curReceived, totalInvested, totalReceived } = useMemo(() => {
    const investedBy: Record<string, number> = {};
    const receivedBy: Record<string, number> = {};

    adsExpenses.forEach((e: any) => {
      const d = parseDate(e.paid_date || e.due_date);
      if (!d) return;
      investedBy[monthKey(d)] = (investedBy[monthKey(d)] || 0) + Number(e.amount || 0);
    });

    (billing || [])
      .filter((b: any) => b.type !== "ads_recharge" && (b.status === "paid" || b.status === "partial"))
      .forEach((b: any) => {
        const d = parseDate(b.paid_date || b.due_date);
        if (!d) return;
        receivedBy[monthKey(d)] = (receivedBy[monthKey(d)] || 0) + receivedAmountOf(b);
      });
    (projectPayments || []).forEach((pp: any) => {
      (pp.installments || [])
        .filter((i: any) => i.status === "paid" || i.status === "partial")
        .forEach((i: any) => {
          const d = parseDate(i.paid_date || i.due_date);
          if (!d) return;
          receivedBy[monthKey(d)] = (receivedBy[monthKey(d)] || 0) + receivedAmountOf(i);
        });
    });

    const now = new Date();
    const rows: { label: string; investido: number; receita: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const k = monthKey(d);
      rows.push({
        label: `${MONTH_LABELS[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`,
        investido: investedBy[k] || 0,
        receita: receivedBy[k] || 0,
      });
    }
    const nowKey = monthKey(now);
    return {
      series: rows,
      curInvested: investedBy[nowKey] || 0,
      curReceived: receivedBy[nowKey] || 0,
      totalInvested: Object.values(investedBy).reduce((s, v) => s + v, 0),
      totalReceived: Object.values(receivedBy).reduce((s, v) => s + v, 0),
    };
  }, [adsExpenses, billing, projectPayments]);

  const roiMonth = curInvested > 0 ? curReceived / curInvested : null;
  const roiTotal = totalInvested > 0 ? totalReceived / totalInvested : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Megaphone className="w-3.5 h-3.5 text-primary" />
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          Investimento da Aceleriq em anúncios
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Investido este mês", value: fmt(curInvested), sub: "Marketing + tráfego pago", icon: Megaphone, color: "text-warning" },
          { label: "Receita recebida no mês", value: fmt(curReceived), sub: "Todas as entradas do mês", icon: TrendingUp, color: "text-success" },
          { label: "Retorno / real investido (mês)", value: roiMonth === null ? "-" : `${roiMonth.toFixed(1)}x`, sub: roiMonth === null ? "Sem investimento registrado no mês" : "Receita do mês ÷ investimento do mês", icon: Target, color: "text-info" },
          { label: "Investido total", value: fmt(totalInvested), sub: roiTotal === null ? "Registre despesas de marketing/tráfego" : `Retorno acumulado ${roiTotal.toFixed(1)}x`, icon: Wallet, color: "text-foreground" },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <s.icon className={`w-3.5 h-3.5 ${s.color}`} />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</span>
            </div>
            <p className={`text-lg font-mono font-semibold ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-3">
          Investido vs receita · últimos 6 meses
        </p>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                formatter={(v: number, name: string) => [fmt(Number(v)), name === "investido" ? "Investido em ads" : "Receita recebida"]}
              />
              <Bar dataKey="investido" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} name="investido" />
              <Line type="monotone" dataKey="receita" stroke="hsl(var(--success))" strokeWidth={2} dot={{ r: 3 }} name="receita" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Investimento = despesas nas categorias "Marketing & Ads próprios" e "Tráfego pago" (lançadas no Fluxo de Caixa ou no Capital). O retorno compara com toda a receita recebida · é um termômetro de aquisição, não atribuição exata por campanha.
        </p>
      </div>
    </div>
  );
}
