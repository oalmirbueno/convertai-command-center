import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TrendingUp, Megaphone, Wallet, Target } from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { Carregando, EstadoDeErro, Painel, Secao, botao, juntar, superficie, texto } from "@/components/sistema";

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
  const { data: allExpenses = [], isLoading, isError, refetch } = useQuery({
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

  const numeros = [
    { label: "Investido no mês", value: fmt(curInvested), sub: "Marketing + tráfego pago", icon: Megaphone, color: "text-warning" },
    { label: "Recebido no mês", value: fmt(curReceived), sub: "Todas as entradas do mês", icon: TrendingUp, color: "text-success" },
    { label: "Retorno no mês", value: roiMonth === null ? "-" : `${roiMonth.toFixed(1)}x`, sub: roiMonth === null ? "Sem investimento no mês" : "Receita ÷ investimento", icon: Target, color: "text-info" },
    { label: "Investido total", value: fmt(totalInvested), sub: roiTotal === null ? "Registre marketing ou tráfego" : `Retorno acumulado ${roiTotal.toFixed(1)}x`, icon: Wallet, color: "text-foreground" },
  ];

  return (
    <Secao
      titulo="Investimento em anúncios"
      descricao="Da própria Aceleriq"
      ajuda={`Investimento = despesas nas categorias "Marketing & Ads próprios" e "Tráfego pago" (lançadas no Fluxo de caixa ou no Capital). O retorno compara com toda a receita recebida: é um termômetro de aquisição, não atribuição exata por campanha.`}
    >
      {isError && !allExpenses.length ? (
        <EstadoDeErro
          titulo="Não foi possível carregar as despesas."
          acao={<button type="button" onClick={() => { void refetch(); }} className={botao.secundario}>Tentar de novo</button>}
        />
      ) : isLoading ? (
        <Carregando forma="lista" linhas={3} rotulo="Carregando investimento em anúncios" />
      ) : (
        <div className="space-y-4">
          <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
            {numeros.map((s) => (
              <div key={s.label} className={juntar(superficie.painel, "min-w-0 p-3 sm:p-4")}>
                <div className="flex min-w-0 items-center">
                  <s.icon className={juntar("mr-1.5 h-3.5 w-3.5 shrink-0", s.color)} aria-hidden="true" />
                  <span className={juntar(texto.rotulo, "min-w-0 truncate")}>{s.label}</span>
                </div>
                <p className={juntar("mt-1.5 truncate text-[17px] font-semibold leading-6 tabular-nums sm:text-[18px]", s.color)}>{s.value}</p>
                <p className={juntar(texto.auxiliar, "mt-0.5 truncate")} title={s.sub}>{s.sub}</p>
              </div>
            ))}
          </div>

          <Painel titulo="Investido e receita" descricao="Últimos 6 meses">
            <div className="h-[200px] min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12 }}
                    formatter={(v: number, name: string) => [fmt(Number(v)), name === "investido" ? "Investido em ads" : "Receita recebida"]}
                  />
                  <Bar dataKey="investido" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} name="investido" isAnimationActive={false} />
                  <Line type="monotone" dataKey="receita" stroke="hsl(var(--success))" strokeWidth={2} dot={{ r: 3 }} name="receita" isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Painel>
        </div>
      )}
    </Secao>
  );
}
