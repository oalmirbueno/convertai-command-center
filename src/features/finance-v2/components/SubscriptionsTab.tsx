import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarPlus,
  Pencil,
  Repeat2,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useGenerateMonthlyBilling } from "../api/useFinanceV2";
import {
  formatCurrency,
  formatDate,
  subscriptionTotals,
} from "../lib/finance";
import type {
  ClientSubscription,
  FinanceClient,
  PlanCatalogItem,
} from "../types";
import { ClientFinancialForm } from "./ClientFinancialForm";
import { Empty, Metric, statusBadge } from "./FinanceUi";

export function SubscriptionsTab({
  items,
  clients,
  plans,
}: {
  items: ClientSubscription[];
  clients: FinanceClient[];
  plans: PlanCatalogItem[];
}) {
  const [selected, setSelected] = useState<ClientSubscription | null>(null);
  const names = useMemo(
    () =>
      new Map(
        clients.map((client) => [
          client.id,
          client.name || client.brand || "Cliente",
        ]),
      ),
    [clients],
  );
  const totals = subscriptionTotals(items);
  const sorted = [...items].sort((left, right) =>
    (left.next_billing_date ?? "9999").localeCompare(
      right.next_billing_date ?? "9999",
    ),
  );
  const generate = useGenerateMonthlyBilling();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          label="MRR ativo"
          value={formatCurrency(totals.activeMrr)}
          icon={Repeat2}
          tone="good"
        />
        <Metric
          label="Assinaturas"
          value={String(totals.activeCount)}
          icon={Users}
        />
        <Metric
          label="Personalizadas"
          value={String(totals.customCount)}
          icon={Pencil}
          tone="warn"
        />
        <Metric
          label="Revisar"
          value={String(totals.needsReviewCount)}
          icon={AlertTriangle}
          tone={totals.needsReviewCount ? "bad" : "good"}
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          A geração é idempotente: repetir não duplica cobranças.
        </p>
        <Button
          variant="outline"
          disabled={generate.isPending}
          onClick={() => generate.mutate({})}
        >
          <CalendarPlus className="mr-2 size-4" />
          {generate.isPending ? "Gerando..." : "Gerar mensalidades"}
        </Button>
      </div>
      {generate.data && (
        <p className="text-sm text-emerald-600">
          {generate.data.generated_count} geradas,{" "}
          {generate.data.existing_count} já existentes.
        </p>
      )}
      {generate.isError && (
        <p className="text-sm text-destructive">
          {generate.error.message}
        </p>
      )}

      {!sorted.length ? (
        <Empty
          title="Nenhuma mensalidade configurada"
          description="Abra um cliente e associe um plano publicado."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="grid gap-3 p-4 md:hidden">
              {sorted.map((subscription) => (
                <div key={subscription.id} className="rounded-lg border p-3">
                  <div className="flex justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {names.get(subscription.client_id)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {subscription.plan.name} · v
                        {subscription.plan.version}
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setSelected(subscription)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </div>
                  <p className="mt-3 text-lg font-semibold">
                    {formatCurrency(
                      subscription.amount,
                      subscription.currency,
                    )}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Badge variant={statusBadge(subscription.status)}>
                      {subscription.status}
                    </Badge>
                    <Badge variant={statusBadge(subscription.review_status)}>
                      {subscription.review_status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Plano</TableHead>
                    <TableHead>Próxima</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Mensalidade</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((subscription) => (
                    <TableRow key={subscription.id}>
                      <TableCell className="font-medium">
                        {names.get(subscription.client_id)}
                      </TableCell>
                      <TableCell>
                        {subscription.plan.name} · v
                        {subscription.plan.version}
                      </TableCell>
                      <TableCell>
                        {formatDate(subscription.next_billing_date)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={statusBadge(subscription.review_status)}
                        >
                          {subscription.review_status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(
                          subscription.amount,
                          subscription.currency,
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setSelected(subscription)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Financeiro do cliente</DialogTitle>
            <DialogDescription>
              Atualize plano, valor e próxima cobrança sem sobrescrever o
              histórico.
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <ClientFinancialForm
              clientId={selected.client_id}
              current={selected}
              plans={plans}
              onDone={() => setSelected(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
