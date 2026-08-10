import { useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleDollarSign,
  Clock3,
  Repeat2,
  Save,
  Target,
  WalletCards,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateFinanceSettings } from "../api/useFinanceV2";
import {
  buildCashFlowSeries,
  flowFor,
  formatCurrency,
  formatDate,
} from "../lib/finance";
import type { FinanceDashboardData } from "../types";
import { Empty, Metric } from "./FinanceUi";

export function OverviewTab({ data }: { data: FinanceDashboardData }) {
  const summary = data.summary;
  const series = buildCashFlowSeries(flowFor(data.cash_flow, "cash"));
  const overdue = data.clients.reduce(
    (total, client) => total + client.billing.overdue,
    0,
  );
  const save = useUpdateFinanceSettings();
  const [goals, setGoals] = useState(data.settings.goals);

  const field = (key: keyof typeof goals, label: string) => (
    <div className="space-y-1">
      <Label htmlFor={key}>{label}</Label>
      <Input
        id={key}
        type="number"
        min={0}
        step="0.01"
        value={goals[key]}
        onChange={(event) =>
          setGoals((current) => ({
            ...current,
            [key]: Number(event.target.value),
          }))
        }
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Metric
          label="MRR"
          value={formatCurrency(summary.recurring_mrr)}
          hint="Receita recorrente"
          icon={Repeat2}
        />
        <Metric
          label="Entradas"
          value={formatCurrency(summary.cash.in)}
          hint="Caixa realizado"
          icon={ArrowUpRight}
          tone="good"
        />
        <Metric
          label="Saídas"
          value={formatCurrency(summary.cash.out)}
          hint="Caixa realizado"
          icon={ArrowDownRight}
          tone="bad"
        />
        <Metric
          label="Saldo"
          value={formatCurrency(summary.cash.net)}
          hint="Sem misturar previsão"
          icon={CircleDollarSign}
          tone={summary.cash.net >= 0 ? "good" : "bad"}
        />
        <Metric
          label="A receber"
          value={formatCurrency(summary.receivables_open)}
          hint="Saldo aberto"
          icon={WalletCards}
          tone="warn"
        />
        <Metric
          label="Em atraso"
          value={formatCurrency(overdue)}
          hint="Mensalidades vencidas"
          icon={Clock3}
          tone={overdue > 0 ? "bad" : "good"}
        />
      </div>

      {series.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Caixa realizado</CardTitle>
          </CardHeader>
          <CardContent className="h-72 px-1 sm:px-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value) =>
                    formatDate(String(value)).slice(0, 5)
                  }
                  fontSize={12}
                />
                <YAxis
                  tickFormatter={(value) =>
                    "R$" + Math.round(Number(value) / 1000) + "k"
                  }
                  width={50}
                  fontSize={12}
                />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  labelFormatter={(value) => formatDate(String(value))}
                />
                <Area
                  dataKey="income"
                  name="Entradas"
                  stroke="#10b981"
                  fill="#10b98122"
                  strokeWidth={2}
                />
                <Area
                  dataKey="expense"
                  name="Saídas"
                  stroke="#f43f5e"
                  fill="#f43f5e18"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      ) : (
        <Empty
          title="Sem caixa realizado"
          description="Recebimentos e pagamentos deste período aparecerão aqui."
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="size-4" />
            Metas e parâmetros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {field("monthly_revenue", "Receita mensal")}
            {field("retention_percent", "Retenção (%)")}
            {field("reserve_months", "Reserva (meses)")}
            {field("minimum_margin_percent", "Margem mínima (%)")}
            {field("target_pro_labore", "Pró-labore alvo")}
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Alterações valem para a configuração atual; o histórico fechado
              permanece preservado.
            </p>
            <Button
              disabled={save.isPending}
              onClick={() =>
                save.mutate({
                  p_monthly_revenue_goal: goals.monthly_revenue,
                  p_retention_percent: goals.retention_percent,
                  p_reserve_months: goals.reserve_months,
                  p_minimum_margin_percent: goals.minimum_margin_percent,
                  p_target_pro_labore: goals.target_pro_labore,
                })
              }
            >
              <Save className="mr-2 size-4" />
              {save.isPending ? "Salvando..." : "Salvar metas"}
            </Button>
          </div>
          {save.isError && (
            <p className="mt-2 text-sm text-destructive">
              {save.error.message}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
