import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { moedaDe } from "@/lib/freela/freelaLib";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { Carregando, EstadoDeErro, Painel, Secao, botao, juntar, superficie, texto } from "@/components/sistema";
import { GradeDeKpis, Kpi, type Tom, grafico } from "@/components/finance/pecasDoFinanceiro";
import { ChartLegend } from "@/components/ds";

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

export default function AdsInvestment({ billing: cobrancas, projectPayments }: Props) {
  const billing = (cobrancas || []).filter((b: any) => moedaDe(b) === "BRL");
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
    { label: "Investido no mês", value: fmt(curInvested), sub: "Marketing + tráfego pago", tom: "neutro" as Tom },
    { label: "Recebido no mês", value: fmt(curReceived), sub: "Todas as entradas do mês", tom: "sucesso" as Tom },
    { label: "Retorno no mês", value: roiMonth === null ? "-" : `${roiMonth.toFixed(1)}x`, sub: roiMonth === null ? "Sem investimento no mês" : "Receita ÷ investimento", tom: "info" as Tom },
    { label: "Investido total", value: fmt(totalInvested), sub: roiTotal === null ? "Registre marketing ou tráfego" : `Retorno acumulado ${roiTotal.toFixed(1)}x`, tom: "neutro" as Tom },
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
        <div className="space-y-4 sm:space-y-5">
          {/* Rodada ousada: um cartão grande por número, o primeiro sólido e o segundo de tinta. */}
          <GradeDeKpis>
            {numeros.map((s) => (
              <Kpi key={s.label} rotulo={s.label} valor={s.value} apoio={s.sub} tom={s.tom} />
            ))}
          </GradeDeKpis>

          <Painel titulo="Investido e receita" descricao="Últimos 6 meses">
            <ChartLegend className="mb-3 flex divide-y-0 [&>li+li]:ml-5 [&>li]:py-0" items={[{ label: "Investido em ads", tone: 3 }, { label: "Receita recebida", tone: 1 }]} />
            <div className="h-[260px] min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series} barCategoryGap="30%">
                  <CartesianGrid {...grafico.grade} />
                  <XAxis dataKey="label" {...grafico.eixo} />
                  <YAxis {...grafico.eixo} width={44}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    {...grafico.dica}
                    formatter={(v: number, name: string) => [fmt(Number(v)), name === "investido" ? "Investido em ads" : "Receita recebida"]}
                  />
                  <Bar dataKey="investido" fill={grafico.cor(3)} radius={grafico.raio} maxBarSize={32} name="investido" isAnimationActive={false} />
                  <Line type="monotone" dataKey="receita" stroke={grafico.cor(1)} strokeWidth={3} dot={false} activeDot={{ r: 5, strokeWidth: 0 }} name="receita" isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Painel>
        </div>
      )}
    </Secao>
  );
}
