import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  flowFor,
  flowTotals,
  formatCurrency,
  formatDate,
} from "../lib/finance";
import type { CashFlowItem, FlowBasis } from "../types";
import { Empty, Metric, statusBadge } from "./FinanceUi";

const views: { id: FlowBasis; label: string; help: string }[] = [
  {
    id: "cash",
    label: "Caixa",
    help: "Somente valores efetivamente pagos ou recebidos.",
  },
  {
    id: "competence",
    label: "Competência",
    help: "Receitas e despesas reconhecidas no período.",
  },
  {
    id: "forecast",
    label: "Previsão",
    help: "Pendências futuras ainda não realizadas.",
  },
];

export function CashFlowTab({ items }: { items: CashFlowItem[] }) {
  const [basis, setBasis] = useState<FlowBasis>("cash");
  const [kind, setKind] = useState<"all" | "income" | "expense">("all");
  const rows = useMemo(
    () =>
      flowFor(items, basis)
        .filter((item) => kind === "all" || item.type === kind)
        .sort((left, right) => right.date.localeCompare(left.date)),
    [items, basis, kind],
  );
  const totals = flowTotals(rows);
  const view = views.find((item) => item.id === basis) ?? views[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap gap-2">
            {views.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant={basis === item.id ? "default" : "outline"}
                onClick={() => setBasis(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {view.help} As bases nunca são somadas entre si.
          </p>
        </div>
        <div className="flex gap-2">
          {(["all", "income", "expense"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={kind === value ? "secondary" : "ghost"}
              onClick={() => setKind(value)}
            >
              {{ all: "Tudo", income: "Entradas", expense: "Saídas" }[value]}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          label="Entradas"
          value={formatCurrency(totals.in)}
          icon={ArrowUpRight}
          tone="good"
        />
        <Metric
          label="Saídas"
          value={formatCurrency(totals.out)}
          icon={ArrowDownRight}
          tone="bad"
        />
        <Metric
          label="Resultado"
          value={formatCurrency(totals.net)}
          icon={Scale}
          tone={totals.net >= 0 ? "good" : "bad"}
        />
      </div>

      {!rows.length ? (
        <Empty
          title={"Sem dados de " + view.label.toLowerCase()}
          description="Mude o período ou registre uma movimentação."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Movimentações</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid gap-3 p-4 md:hidden">
              {rows.map((row) => (
                <div key={row.id} className="rounded-lg border p-3">
                  <div className="flex justify-between gap-3">
                    <div>
                      <p className="font-medium">{row.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(row.date)} · {row.category || "Sem categoria"}
                      </p>
                    </div>
                    <p
                      className={
                        row.type === "income"
                          ? "font-semibold text-emerald-600"
                          : "font-semibold text-rose-600"
                      }
                    >
                      {row.type === "income" ? "+" : "-"}
                      {formatCurrency(row.amount)}
                    </p>
                  </div>
                  <Badge className="mt-2" variant={statusBadge(row.status)}>
                    {row.status}
                  </Badge>
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{formatDate(row.date)}</TableCell>
                      <TableCell className="font-medium">
                        {row.description}
                      </TableCell>
                      <TableCell>{row.category || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadge(row.status)}>
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={
                          row.type === "income"
                            ? "text-right font-medium text-emerald-600"
                            : "text-right font-medium text-rose-600"
                        }
                      >
                        {row.type === "income" ? "+" : "-"}
                        {formatCurrency(row.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
